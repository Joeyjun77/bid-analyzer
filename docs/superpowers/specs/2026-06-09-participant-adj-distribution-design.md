# 참여업체 사정율 분포 시스템 — 설계 (2026-06-09)

## 1. 배경 / 목적

복수예가(SUCVIEW) 엑셀의 **참여업체리스트**(순위·등록번호·업체명·대표자·투찰금액·투찰율·기초대비·업체별사정율)는
현재 DB에 **저장되지 않는다**. `parseSucview`는 참여업체 영역에서 투찰율(col 8)만 뽑아
`participant_count`·`bid_dist`·`bid_median` 등 **집계값으로만 압축**하고 개별 업체 행은 버린다.

목표: 참여업체 행을 저장하고, G2B 양식 리스트의 각 건에서 **그 발주처 최근 30건의 참여업체
"업체별 사정율(= 가정사정율)" 분포**를 공유축 매트릭스로 보는 모달을 제공한다.
이는 사용자가 쓰던 `오케이저장.xlsm`(`기본`/`자료` 시트 오버레이)의 앱 내 재현이다.

### 도메인 확정 사항
- **업체별사정율 = 가정사정율** — 각 업체가 베팅한 사정율. 투찰금액에서 역산된 값으로,
  SUCVIEW `업체별사정율(%)` 칸에 **절대(100기준, 예 99.8611)** 와 **편차(-0.1388)** 두 형태로 표기된다.
  분포 축은 **100기준 절대값**(`adj_rate`)을 사용하고, 편차는 `adj_rate − 100`으로 UI에서 파생한다.
- 1순위는 실제 사정율(예가/기초)에 가장 근접하게 베팅해 낙찰한다. 참여업체 사정율 분포의
  최빈대·1순위 위치가 곧 "이기는 사정율 밴드"의 관측 근거다.

## 2. 구현 순서 (2-Phase)

조회/시각화는 데이터가 쌓여야 검증된다. 따라서 **적재 인프라(Phase 1)를 먼저** 배포해
대량 업로드로 데이터를 축적한 뒤, **조회/시각화(Phase 2)**를 실제 데이터 위에서 구축한다.

- **데이터탭 업로드는 이미 다중 파일 루프(`loadFiles`: `for…of files`)를 지원**한다.
  Phase 1은 SUCVIEW 분기에서 참여업체를 추가 저장하기만 하면 되고, 새 업로드 UI는 불필요하다.

---

## Phase 1 — 적재 인프라

### 1.1 DB: `bid_participants` 테이블 (마이그레이션)

| 컬럼 | 타입 | 의미 | 출처(SUCVIEW 열 인덱스) |
|---|---|---|---|
| `id` | bigserial PK | | |
| `pn_no` | text NOT NULL | 공고번호 (조인키) | 헤더 |
| `od` | date | 개찰일 (denormalize, 최근30·정렬 가속) | detail |
| `ag` | text | 발주처 | detail |
| `canonical_ag` | text | 정규화 발주처 (필터·검색) | detail |
| `at` | text | 발주유형 | detail |
| `rank` | int | 순위 (1 = 1순위) | col 0 |
| `co_no` | text | 등록번호(사업자번호) | col 1 |
| `co_name` | text | 업체명 | col 3 |
| `rep` | text | 대표자 | col 5 |
| `bid_amount` | numeric | 투찰금액 | col 6 |
| `bid_rate` | numeric | 투찰율(%) (A값 보정, 낙찰하한율 비교 기준) | col 8 |
| `base_rate` | numeric | 기초대비(%) (투찰금액/기초금액) | col 9 |
| `adj_rate` | numeric | **업체별사정율 = 가정사정율 (100기준 절대)** ← 분포 축 | col 10 |
| `created_at` | timestamptz default now() | | |

- 제약: `UNIQUE NULLS NOT DISTINCT (pn_no, co_no)` → 재업로드 멱등(upsert).
  동일 건 내 등록번호 중복은 사실상 없으나, 만일 충돌 시 마지막 행이 승리.
- 인덱스: `(canonical_ag, od DESC)` (최근 N건 조회), `(co_no)` (경쟁사 교차검색).
- RLS: enable. `service_role` INSERT + authenticated INSERT 정책을 **기존 `bid_details` 정책과 동일하게** 미러
  (앱은 `authedFetch`(anon/auth 키)로 적재).
- `bid_records`/`bid_details` DELETE 금기와 동일하게, 본 테이블도 UPDATE/DELETE는 운영 금지(INSERT/UPSERT-only).

### 1.2 파싱: `parseSucview` 확장 (`src/lib/utils.js`)

현재 참여리스트 루프(참여업체리스트 헤더 `순위`+`등록번호` 다음 행부터, 약 line 462–467)는
`col 8`만 읽어 `bidRates`를 만든다. 이를 **9개 컬럼 전체**를 담는 `participants[]`로 확장한다.

```js
// 참여업체 행 → participants[] (분포 시스템용). bidRates/통계는 그대로 유지.
const participants = [];
if (startRow > 0) {
  for (let i = startRow; i < rows.length; i++) {
    const rank = parseInt(String(rows[i]?.[0]));
    if (isNaN(rank)) break;
    const adj = parseFloat(String(rows[i]?.[10])); // 업체별사정율 100기준 절대
    participants.push({
      rank,
      co_no: String(rows[i]?.[1] || "").trim(),
      co_name: String(rows[i]?.[3] || "").trim(),
      rep: String(rows[i]?.[5] || "").trim(),
      bid_amount: pnv(String(rows[i]?.[6] || "").replace(/,/g, "")),
      bid_rate: parseFloat(String(rows[i]?.[8])) || null,
      base_rate: parseFloat(String(rows[i]?.[9])) || null,
      adj_rate: isNaN(adj) ? null : adj,
    });
  }
}
// 반환 객체에 participants 추가. participant_count는 기존(bidRates.length)와 일치 검증.
```

- `participants`를 `parseSucview` 반환 객체에 추가한다(기존 필드 불변).
- 참여리스트(숫자 rank)는 투찰결과 블록(자회사/나의/1순위)과 **별개 블록**이라 영향 없음.

#### 자회사 행 버그 동시 수정 (번들)
같은 함수의 `my_*`/`win_*` 추출(약 line 456–461)이 **절대 행번호(17/19) 하드코딩**이라,
자회사 행이 끼는 양식에서 `my_*`가 자회사 행을 잘못 읽고 `my_rank`가 자회사 등록번호(예 1410)를
순위로 오인한다. 절대행 대신 **라벨 스캔**으로 교체:

```js
let my_rank=null, my_bid_rate=null, my_adj_rate=null, win_bid_rate=null, win_adj_rate=null;
let trHdr=-1;
for(let i=15;i<Math.min(rows.length,22);i++){
  if(String(rows[i]?.[0]).trim()==="순위"&&String(rows[i]?.[1]||"").includes("등록번호")){trHdr=i;break}}
if(trHdr>0){
  for(let i=trHdr+1;i<Math.min(rows.length,trHdr+8);i++){
    const label=String(rows[i]?.[0]||"").trim();
    if(!label||label.includes("참 여")||label.includes("참여업체"))break; // 참여리스트 시작 → 종료
    const bidR=parseFloat(g(i,8)); const adjR=parseFloat(g(i,11));
    if(label.includes("나의업체")){
      my_bid_rate=isNaN(bidR)?null:bidR; my_adj_rate=isNaN(adjR)?null:adjR;
      const m=label.match(/\(\s*(-?\d+)\s*\)/); if(m)my_rank=parseInt(m[1]);
    }else if(label.includes("1순위")){
      win_bid_rate=isNaN(bidR)?null:bidR; win_adj_rate=isNaN(adjR)?null:adjR;
    } // 자회사 행은 의도적으로 건너뜀
  }
}
```

- 주의: `my_rank` 의미(`나의업체(-80)`의 `-80`)는 불명 — 부호 포함 캡처하되 정의는 후속 확인 과제.
- 기존 DB 오염(자회사 양식으로 적재된 `bid_details.my_*`)은 이 fix로 자동 정정되지 않음 →
  해당 건 재업로드 시 `pn_no` upsert로 덮어쓰기.

### 1.3 저장: `sbSaveParticipants` (`src/lib/supabase.js`)

```js
export async function sbSaveParticipants(meta, participants){
  if(!participants?.length) return true;
  const rows = participants.map(p => ({
    pn_no: meta.pn_no, od: meta.od, ag: meta.ag,
    canonical_ag: meta.canonical_ag || meta.ag, at: meta.at,
    rank: p.rank, co_no: p.co_no, co_name: p.co_name, rep: p.rep,
    bid_amount: p.bid_amount, bid_rate: p.bid_rate, base_rate: p.base_rate, adj_rate: p.adj_rate,
  }));
  // 1000행씩 청크 bulk POST (on_conflict 멱등)
  for(let i=0;i<rows.length;i+=1000){
    const body = sanitizeJson(JSON.stringify(rows.slice(i,i+1000)));
    const res = await authedFetch("/rest/v1/bid_participants?on_conflict=pn_no,co_no",
      {method:"POST",headers:{...JSON_H,"Prefer":"resolution=merge-duplicates,return=minimal"},body});
    if(!res.ok) return false;
  }
  return true;
}
```

- `canonical_ag`는 detail에 없으면 `clsAg`/기존 정규화 헬퍼로 산출하거나 `ag`로 폴백.
  (G2BSheetTab가 `canonical_ag || ag`로 집계하므로 폴백 일관)

### 1.4 업로드 연결 (`src/App.jsx` `loadFiles` SUCVIEW 분기)

```js
if(isSucviewFile(raw)){
  const detail=parseSucview(raw,file.name); if(!detail.pn_no)throw new Error("공고번호 없음");
  await sbSaveDetail(detail);
  if(detail.participants?.length){
    await sbSaveParticipants(
      {pn_no:detail.pn_no, od:detail.od, ag:detail.ag, canonical_ag:detail.ag, at:detail.at},
      detail.participants);
  }
  const sim=simDraws(detail.pre_rates); setSimResult(sim);
  logs.push({name:file.name,type:"ok",text:`[상세] ${detail.ag} | 예가15개 + 참여${detail.participant_count}건`});
  setUploadLog([...logs]); continue;
}
```

- 참여 저장 실패는 detail 저장을 막지 않도록 경고 로깅(상세는 이미 저장됨). 대량 업로드 내성 우선.

### 1.5 Phase 1 검증
- `npx vite build` 통과.
- 단위: `parseSucview`가 샘플 SUCVIEW에서 `participants.length === participant_count`, 1순위 행 `adj_rate`가
  헤더 사정율과 근접함을 node로 확인.
- 수동: SUCVIEW 1건 업로드 후 `SELECT count(*) FROM bid_participants WHERE pn_no=…` 일치 확인.
- **배포 후 사용자가 데이터탭에서 SUCVIEW 다발 업로드 → 데이터 축적.**

---

## Phase 2 — 조회 / 시각화 (데이터 축적 후)

### 2.1 분포 RPC: `get_participant_distribution(p_ag text, p_n int default 30, p_bucket numeric default 0.01)`

8만 행을 클라가 받지 않도록 **서버에서 집계**해 작은 JSON 반환:

```jsonc
{
  "columns": [   // 최근 N건 (canonical_ag = p_ag, 참여데이터 있는 건만, od desc)
    { "pn_no": "...", "od": "2026-06-08", "pn": "공고명", "n": 2820, "win_rate": 99.8611 }
  ],
  "cells": [     // 건 × 버킷 카운트 (+ 1순위 버킷 마킹)
    { "pn_no": "...", "bucket": 99.86, "cnt": 820, "is_win": false }
  ]
}
```

- **발주처 매칭 키 일관성**: 버튼이 넘기는 `r.canonical_ag`(bid_records 정규명)와 적재된
  `bid_participants.canonical_ag`(Phase 1에서 raw `ag` 폴백) 문자열이 다르면 빈 결과가 난다.
  Phase 2 진입 시 둘 중 하나로 통일한다 — (a) Phase 1 적재를 bid_records와 동일 정규화로
  backfill, 또는 (b) RPC가 `bid_details`를 경유해 `pn_no → bid_records.canonical_ag`로 매칭.
  **(b) 권장**(적재 무수정, 조인으로 정규명 확보).
- 버킷 = `floor(adj_rate / p_bucket) * p_bucket` (절삭, 화면 표기와 일치).
- `win_rate` = `rank=1` 행의 `adj_rate`. `pn`(공고명)은 `bid_details` 조인.
- 30건 × 수십 버킷 ≈ 1,500행 → 가벼움. 데이터 없는 과거 건은 `HAVING count>0`로 제외.
- 경쟁사 추적용 보조 쿼리(on-demand): `bid_participants WHERE canonical_ag=? AND co_no=?`
  → 그 업체의 건별 `adj_rate` 추이.

### 2.2 프론트: `G2BSheetTab` 버튼 + 매트릭스 모달

**버튼**
- 각 G2B 리스트 행에 `참여분포` 버튼 추가(`상세` 옆 신규 컬럼).
- 탭 진입 시 `SELECT DISTINCT pn_no FROM bid_participants`로 **참여데이터 보유 pn_no Set**을 1회 프리로드
  → 보유 행만 버튼 활성(나머지 비활성/툴팁 "참여데이터 없음").
- 클릭 → `r.canonical_ag` 기준 RPC 호출, **그 건(`r.pn_no`) 컬럼 하이라이트**.

**매트릭스 모달** (선택 시안 = 공유축 매트릭스)
- 세로축 = 사정율 버킷(내림차순, **데이터 있는 버킷만** 렌더 → 압축). 자리수 토글(0.1 / 0.05 / 0.01).
- 가로축 = 최근 30건(헤더: 개찰일 + 공고명 약칭, 툴팁 전체; `odYearColor` 재사용 가능). 하단 `참여합` 행.
- 셀 = 카운트. **기존 `g2bFrequency.js`의 `INTENSITY_STYLE`/`intensityLevel` 재사용**(8단계 색).
  1순위 버킷에 `★`. 클릭 건 컬럼 외곽 강조.
- **업체 검색**(등록번호/업체명) → 2.1 보조 쿼리로 그 업체의 건별 셀 하이라이트 + 사정율 추이.
- 배경 스크롤 잠금·`overscrollBehavior:contain` 등 기존 모달 패턴 답습.

### 2.3 Phase 2 검증
- `npx vite build` 통과.
- RPC 카운트가 원본 `bid_participants` 직접 집계와 일치(샘플 발주처).
- 모달 `참여합` = 각 건 `participant_count`와 일치.

---

## 3. 거버넌스 / 영향도

- `parseSucview`는 **데이터 수집 파서**이며 Generator 예측 로직(`getFinalRecommendation`·`opt_adj`·
  `pred_bias_map`·낙찰하한율 함수)이 **아니다** → `predict-architect`/`/evaluate` 게이트 **면제**.
  예측 MAE 무영향, 순수 additive(신규 테이블·RPC·UI·파서 확장).
- 금기 준수: Supabase SDK 미설치(REST 유지), main 직접 작업, `bid_records`/`bid_details` DELETE 금지.
- DB 변경은 마이그레이션(테이블+인덱스+RLS, 이후 RPC). 코드는 `npx vite build` 통과 후 커밋.

## 4. 모듈 경계 (독립 테스트 단위)

| 단위 | 책임 | 의존 |
|---|---|---|
| `parseSucview` participants 추출 | 행 → 구조화 배열 (순수함수) | rows 배열 |
| `sbSaveParticipants` | 멱등 bulk 적재 | authedFetch |
| `get_participant_distribution` | 서버측 분포 집계 | bid_participants, bid_details |
| 매트릭스 모달 컴포넌트 | RPC 결과 → 표현 | props(분포 JSON) |

각 단위는 인터페이스(배열/JSON/props)로만 연결되어 독립 변경·테스트 가능.

## 5. 미해결 / 후속 과제
- `나의업체(-80)`의 `-80` 의미 확인(순위 정의).
- 매트릭스 기본 버킷 자리수(0.01 vs 0.05) 실데이터 보고 튜닝.
- 경쟁사 추이 뷰의 시각화 형태(스파크라인 vs 라인)는 Phase 2 진입 시 시안 재확인.
