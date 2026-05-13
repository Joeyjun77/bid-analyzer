# 발주처사정율 예측 시스템 V6-B1 — MVP (메인탭 + 일괄예측) Design Spec

> 작성일: 2026-05-13 · 대상 프로젝트: bid-analyzer · Phase 23-3 1단계(Design) 완료
> Sub-project: V6-B1 (V6-B 4분할 중 첫 단계) · 이전 단계: V6-A (DB 인프라 완료 commit `d9f226f`) · 다음 단계: V6-B2 외부 데이터 임포트
> 참조: V6-A spec `docs/superpowers/specs/2026-05-13-agency-predictor-v6a-db-infra-design.md`,
>   V6-A 완료 plan `docs/superpowers/plans/2026-05-13-agency-predictor-v6a-db-infra.md`

## 0. V6-B sub-project 분해

V6-A spec §0이 V6-B를 단일 단위로 정의했으나 가져온 V6 FULL_HISTORY 문서가 컴포넌트 8+개·파서 3개를 포함해 한 spec엔 너무 큼. V6-A처럼 4단계 분해.

| Sub | 범위 | 산출물 |
|---|---|---|
| **V6-B1** | MVP (본 spec) | 신규 탭 + SUCVIEW/입찰서류함 업로드 → 일괄 예측 → 결과 행 |
| V6-B2 | 외부 데이터 임포트 | `parseAwardListFile`, `parseInfonaFile`, bid_history 외부 source 누적 + recalibrate 재학습 |
| V6-B3 | 수동 작업 | `ManualPredictModule`, `ManualMatchDialog`, `FilterBar` |
| V6-B4 | KPI 대시보드 | `KpiDashboard`, 부적격률·MAE·1위 트래킹 |

V6-B1 완료 시점에는 자사가 이미 사용하는 SUCVIEW/입찰서류함 엑셀로 신규 입찰을 업로드해 발주처사정율 + 3-strategy 투찰가 + 부적격 위험까지 한 화면에서 확인 가능. UI 변경 + DB INSERT만, 신규 RPC·테이블 0.

## 1. 목적과 비목표

### 1.1 목적
사용자가 기존 SUCVIEW/입찰서류함 엑셀(자사가 현재 데이터/예측 탭에서 사용하는 형식)을 업로드하면 `predict_with_history()`를 행마다 호출해 **발주처사정율 + 3-strategy(공격·균형·안전) 투찰가 + 부적격 위험**을 즉시 표시. 자사가 나라장터에서 직접 투찰하기 전 의사결정을 돕는 **정보 제공 도구**(앱 내 "확정/제출" 액션 없음).

### 1.2 비목표 (V6-B1 범위 밖)
- 외부 인포나21c·낙찰정보 임포트 (V6-B2)
- 수동 사정률 입력·수동 매칭·고급 필터 (V6-B3)
- KPI 대시보드·결과 분석 (V6-B4)
- 시각화 차트, 발주처 분석 페이지 7뷰 (V6-C)
- `bid_predictions_v3` 결과 매칭 (V6-D)
- 신규 의존성 (recharts, supabase-js SDK) — V6-A spec §14 보류 결정 결과 모두 채택 안 함

### 1.3 기존 시스템 보호 원칙
V6-A spec §1.3과 동일. `bid_records`/`bid_predictions`/`predict_v6` 등 일체 변경 금지. V6-B1은 신규 탭 1개 + `src/lib/supabase.js` append + (선택적) `src/components/AgencyPredictorTab.jsx` 신규 1개 파일만.

### 1.4 V1(`agency-floor-prediction-tab-v1`)과의 관계
**다른 변수를 예측하는 별개 탭**. V1 탭은 `agency_rate_distribution`(1순위 사정률 br1) 정보 표시. V6-B1 탭은 `predict_with_history()`(발주처사정율 ep/ba) + 투찰가. 두 탭은 공존하나 사용자가 혼동하지 않도록 명칭 구분: V1=`🎯 발주사 하한`(미실행), V6-B1=`💎 발주처 예측 V6`.

### 1.5 V6-A spec §15 보류 결정 처리
- supabase-js SDK 도입 ↛ **authedFetch 패턴 유지** (CLAUDE.md 정책 준수). V6-B/C/D 모두 동일.
- recharts 도입 ↛ V6-C에서 결정 (B1엔 차트 없음).
- 외부 데이터 임포트 ↛ V6-B2.
- 자사 사업자번호 매칭 ↛ V6-D.
- recalibrate outlier 필터 ↛ V6-B2 (외부 데이터 누적 후 함께 결정).

### 1.6 V6-B1 RLS hotfix (2026-05-14, post-deploy)

V6-B1 spec/plan 작성 시 V6-A `§8 RLS 정책`의 "INSERT/UPDATE/DELETE는 service_role만"이 클라이언트
직접 INSERT 패턴과 충돌함을 명세 누락. 첫 일괄 예측에서 403 5건(bid_history 2 + bpv3 3) 발생.
사후 적용 마이그레이션 `V6A_13_rls_insert_v6b1_hotfix.sql`이 다음 두 정책 추가:
- `bid_history` INSERT WITH CHECK `(source='file_upload')` — legacy/external_award는 service_role 전용 유지
- `bid_predictions_v3` INSERT WITH CHECK `(true)` — bpv3_lifecycle 트리거가 불변성/expires_at 보호

V6-A spec §8.1에 동일 내용 반영 완료. 향후 V6-B2 파서가 `upload_batches`/`bid_notices_temp` INSERT
필요 시 같은 패턴으로 정책 추가 예정.

## 2. 컴포넌트 분해

### 2.1 파일 구조 (변경 매트릭스)
| 파일 | 변경 유형 | 책임 |
|---|---|---|
| `src/components/AgencyPredictorTab.jsx` | **신규** | 탭 본체 + 행 컴포넌트 (`AgencyPredictorRow`)를 같은 파일에 함수형으로 정의 |
| `src/lib/supabase.js` | append | 신규 fetch 헬퍼 4개 |
| `src/App.jsx` | 수정 (3곳) | (a) import 추가, (b) Tb 묶음에 새 탭 1개, (c) 탭 분기 1개 |
| `src/lib/utils.js`, `src/lib/constants.js`, `src/lib/probability.js` | 변경 없음 | — |
| DB 객체 | 변경 없음 | V6-A 완성된 5개 테이블·8개 RPC·2개 트리거 그대로 사용 |

App.jsx에 함수형 컴포넌트를 추가하는 V1 plan 패턴이 아니라 별도 파일(`src/components/AgencyPredictorTab.jsx`)로 분리한다 — App.jsx가 이미 1800+줄로 커서 추가 컴포넌트는 외부 파일 권장.

### 2.2 `AgencyPredictorTab` (메인 컨테이너)
책임: 데이터 fetch (탭 마운트 시 `sbFetchAgencyPredictionsV3` 호출 → 마지막 200건 표시), 파일 업로드 핸들러, 일괄 예측 진행 상태, 요약 헤더 렌더링, 테이블 렌더링.

상태:
```
preds: bid_predictions_v3 행 배열
loading: 'idle' | 'fetching' | 'parsing' | 'predicting' | 'saving'
progress: {done, total} - 일괄 예측 진행률
parseLogs: 업로드 결과 로그 (성공/실패/스킵 건수)
errors: 행별 에러 맵
```

### 2.3 `AgencyPredictorRow` (행 — 같은 파일 내 정의)
책임: `bid_predictions_v3` 한 행을 9컬럼으로 렌더링. 부적격 위험 색상 분류, 신뢰도 배지, 금액 단위 변환(원→억).

행 펼침 패널은 V6-C에서 추가 — B1엔 onClick 핸들러 없음.

## 3. 신규 fetch 헬퍼 (`src/lib/supabase.js` append, 4개)

### 3.1 `sbCallPredictWithHistory(args)`
```js
export async function sbCallPredictWithHistory({bid_no, canonical_ag, industry, base_amount, a_value, floor_rate}){
  try{
    const body = JSON.stringify({
      p_bid_no: bid_no, p_canonical_ag: canonical_ag, p_industry: industry,
      p_base_amount: base_amount, p_a_value: a_value, p_floor_rate: floor_rate
    });
    const res = await authedFetch("/rest/v1/rpc/predict_with_history", {
      method: "POST", headers: JSON_H, body
    });
    if(!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  }catch(e){ return null }
}
```

### 3.2 `sbBatchInsertBidHistoryUpload(rows)`
```js
// rows: [{bid_no, ag, industry, opened_at, base_amount, a_value, floor_rate, notice_title, contract_method}]
// source='file_upload', UNIQUE (bid_no, source) ON CONFLICT DO NOTHING
export async function sbBatchInsertBidHistoryUpload(rows){
  const BATCH = 100;
  for(let i=0; i<rows.length; i+=BATCH){
    const batch = rows.slice(i, i+BATCH).map(r => ({...r, source: 'file_upload'}));
    const body = sanitizeJson(JSON.stringify(batch));
    await authedFetch("/rest/v1/bid_history?on_conflict=bid_no,source", {
      method: "POST",
      headers: {...JSON_H, "Prefer": "resolution=merge-duplicates,return=minimal"},
      body
    });
  }
}
```

### 3.3 `sbBatchInsertBidPredictionsV3(rows)`
```js
// rows: predict_with_history 결과 + 입력 메타. amount_tier는 클라이언트에서 amount_tier_of(base) 호출 대신 RPC 호출 또는 계산
// model_version='v3.0' default (DB 컬럼 default)
export async function sbBatchInsertBidPredictionsV3(rows){
  const BATCH = 50;
  for(let i=0; i<rows.length; i+=BATCH){
    const batch = rows.slice(i, i+BATCH);
    const body = sanitizeJson(JSON.stringify(batch));
    const res = await authedFetch("/rest/v1/bid_predictions_v3", {
      method: "POST",
      headers: {...JSON_H, "Prefer": "return=minimal"},
      body
    });
    if(!res.ok) throw new Error(`bpv3 INSERT: ${res.status}`);
  }
}
```

### 3.4 `sbFetchAgencyPredictionsV3(limit=200)`
```js
export async function sbFetchAgencyPredictionsV3(limit=200){
  try{
    const cols = "id,bid_no,canonical_ag,industry,amount_tier,base_amount,"
      +"predicted_ratio,predicted_floor_amount,"
      +"strategy_aggressive_bid,strategy_balanced_bid,strategy_safe_bid,"
      +"aggressive_margin,balanced_margin,safe_margin,"
      +"disq_risk_aggressive,disq_risk_balanced,disq_risk_safe,"
      +"confidence_tier,signal_stage,sample_size_used,model_version,"
      +"match_status,actual_ratio,result,created_at";
    const res = await authedFetch(
      "/rest/v1/bid_predictions_v3?select="+cols
      +"&order=created_at.desc&limit="+limit
    );
    if(!res.ok) return [];
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  }catch(e){ return [] }
}
```

`amount_tier_of()`는 RPC가 아닌 보조 함수. JSON-RPC 한 번 호출이 부담 → 클라이언트에 동등 JS 함수를 둠 (utils.js에 `amountTierOf(numeric)`을 한 줄 추가). 또는 PostgREST `select=amount_tier_of(?)` 패턴 사용 — 본 spec은 클라이언트 함수가 단순하므로 그쪽 채택.

## 4. 데이터 흐름 (전체)

```
[탭 마운트]
  └─ sbFetchAgencyPredictionsV3(200) → setPreds → 테이블 표시 (마지막 200건)

[파일 업로드]
  └─ 기존 parseFile + parseSucview/parseBidDoc로 행 추출 (parseLogs에 성공/실패/스킵 누적)
  └─ 가드: 낙찰정보리스트면 차단 (기존 isNakList 가드 재사용)
  └─ 행마다 다음 인풋 추출:
       bid_no = pn_no
       ag = clean(원본 발주사명)
       canonical_ag = normalizeAgencyName(ag)  // utils.js 기존 함수
       industry = cat
       base_amount = ba
       a_value = av  (NULL 가능)
       opened_at = od
       floor_rate = eraFR(at, ep || ba, od)  // 기존 함수, ep 미상이면 ba 대용
       notice_title = pn
  └─ sbBatchInsertBidHistoryUpload(rows) — 일괄 INSERT (trigger_normalize_bh로 canonical_ag 자동 채움)

[일괄 예측 시작 — "▶ 예측 시작" 버튼]
  └─ progress = {done:0, total:rows.length}
  └─ Promise pool (concurrency=5):
       각 행에 대해 sbCallPredictWithHistory → result row
       result에 입력 메타(bid_no, canonical_ag, industry, amount_tier, base_amount, a_value, floor_rate)를 합쳐 INSERT 행 구성
       progress.done++ → setProgress
  └─ sbBatchInsertBidPredictionsV3(allResults) → 영구 저장
  └─ sbFetchAgencyPredictionsV3(200) 다시 호출 → setPreds → 테이블 갱신
```

## 5. 요약 헤더 통계

```
예측 대상 N건 · 평균 부적격(균형) X.X% · 1단계 매치 Y건 / 2단계 Z건 / 글로벌 폴백 W건 · 모델 v3.0
```

`preds` 배열에서 클라이언트 집계.

## 6. UI 와이어프레임

```
┌──────────────────────────────────────────────────────────────────────────┐
│  💎 발주처 예측 V6                                                         │
│  예측 대상 142건 · 평균 부적격(균형) 24.3% · 단계 1/2/3 = 87/41/14 · v3.0  │
├──────────────────────────────────────────────────────────────────────────┤
│ [📁 파일 선택] SUCVIEW / 입찰서류함 형식 (xlsx, 다중 가능)                │
│ [▶ 일괄 예측 시작 (3건 대기)]   [⟳ 새로고침]                              │
├────┬────────────┬────┬─────────┬──────────┬──────────┬──────────┬───────┬─────┤
│개찰│ 발주사/업종 │기초│예측사정율│ 공격투찰  │ 균형투찰  │ 안전투찰  │부적격 │신뢰 │
│ 일 │            │억  │         │ (마진)    │ (마진)    │ (마진)    │(균형) │     │
├────┼────────────┼────┼─────────┼──────────┼──────────┼──────────┼───────┼─────┤
│26-5│한전 경기북부│6.56│ 91.0256%│5.354억   │5.362억   │5.370억   │ 0.34  │medi │
│ -12│ 전기        │    │[stage 1]│ (0.150)  │ (0.300)  │ (0.450)  │       │um   │
├────┼────────────┼────┼─────────┼──────────┼──────────┼──────────┼───────┼─────┤
│26-5│고양시 / 전기│0.85│100.0000%│0.737억   │0.738억   │0.739억   │ 0.50  │insuf│
│ -08│             │    │[stage 3]│ (0.150)  │ (0.300)  │ (0.450)  │ ⚠     │f    │
└────┴────────────┴────┴─────────┴──────────┴──────────┴──────────┴───────┴─────┘
업로드 로그: 성공 3건 · 스킵 1건(중복) · 실패 0건
```

색상 룰:
- 부적격 ≥ 0.40 → `#e24b4a` (빨강)
- 부적격 0.20–0.40 → `#d4a834` (주황)
- 부적격 < 0.20 → `C.txd` (회색)
- 신뢰도 배지: `high` 녹색, `medium` 파랑, `low` 회색, `insufficient` 주황 + 경고 ⚠

## 7. 컬럼 단위·변환 (표)

| UI 컬럼 | 원본 | 단위 | 변환 |
|---|---|---|---|
| 개찰일 | bid_predictions_v3.created_at의 일부 또는 입력 메타 opened_at | date | YYYY-MM-DD (slice 5,10) |
| 발주사 | bpv3.canonical_ag | text | 그대로 |
| 업종 | bpv3.industry | text | 그대로 (raw `cat`) |
| 기초 | bpv3.base_amount | 원 | ÷1e8, 소수 2자리 + "억" |
| 예측사정율 | bpv3.predicted_ratio | 100-base | 4자리 + "%" + "[stage N]" |
| 공격/균형/안전 투찰가 | bpv3.strategy_*_bid | 원 | ÷1e8, 3자리 + "억" |
| (마진) | bpv3.*_margin | pp | 3자리 (괄호 안) |
| 부적격(균형) | bpv3.disq_risk_balanced | 0~1 | × 100 + 색상 |
| 신뢰 | bpv3.confidence_tier | text | 배지 |

## 8. 엣지 케이스

| 케이스 | 처리 |
|---|---|
| `canonical_ag` 정규화 결과 NULL/빈 문자열 | 글로벌 폴백 (signal_stage=3, confidence='insufficient') |
| 같은 `bid_no` 중복 업로드 | bid_history `ON CONFLICT (bid_no, source) DO NOTHING` / bid_predictions_v3는 새 행 (재예측 이력) |
| `floor_rate` 미상 | `eraFR(at, ep ?? ba, od)` 자동 계산 — 기존 utils 함수 |
| `industry`(cat) 미상 | NULL 전달 → 2단계 폴백 (canonical_ag만) |
| 예측 호출 실패 (RPC 5xx) | 해당 행만 errors 맵에 기록, 다른 행은 계속. UI 행에 ⚠ 배지 |
| 사용자가 낙찰정보리스트 업로드 | 기존 `isNakList` 가드로 차단 — "낙찰정보리스트는 데이터탭에 업로드해주세요" 메시지 |
| `predicted_ratio`가 비현실적 (예: > 110 또는 < 70) | 행은 표시하되 confidence='insufficient'로 자동 강등 (UI 클라이언트 측 가드) |
| `bid_no` NULL/빈 문자열 | 스킵 + parseLogs에 "bid_no 없음" 기록 |
| `base_amount` ≤ 0 | 스킵 |
| 업로드 후 일괄 예측 진행 중 사용자가 다른 탭 이동 | useEffect cleanup으로 in-flight 취소, 진행률 보존하지 않음 (단순) |

## 9. Phase 23-3 게이트 적용

| 단계 | 적용 |
|---|---|
| 1. Design | 본 spec = 완료. `predict-architect` 면제 — 신규 코드, 기존 핵심 영역(한전·고양시·군부대) `opt_adj` 예측 산식 변경 0. 다른 변수(`predicted_ratio`) 예측. |
| 2. Build | `src/components/AgencyPredictorTab.jsx` 신규 + `src/lib/supabase.js` append + `src/App.jsx` 3곳 수정. `getFinalRecommendation`/`opt_adj`/`pred_bias_map`/낙찰하한율 함수 미수정 → PostToolUse hook 비트리거. `npx vite build` 통과 확인. |
| 3. Verify | `/evaluate` 면제 — 기존 `bid_predictions.opt_adj` 변경 0. 신규 탭은 정보 표시 + 별도 테이블 INSERT. |
| 4. Operate | `deploy-gate` 호출 (src/* 변경 → Vercel 자동 배포). 빌드 통과 + 핵심 영역 MAE 보존 검증. |
| 5. Predict | 본 탭은 정보 제공 + bid_predictions_v3 자동 INSERT만. "확정/제출" 류 액션 없음 ✓ |

## 10. V6-B1 작업 순서 (writing-plans 단위)

1. `src/lib/supabase.js` — fetch 헬퍼 4개 append + 빌드 검증
2. `src/lib/utils.js` — `amountTierOf(NUMERIC)→TEXT` 한 줄 추가 + 빌드 검증
3. `src/components/AgencyPredictorTab.jsx` 신규 — 컴포넌트 구조 + 데이터 fetch 로딩 (예측 호출 없이) + 빌드
4. `src/App.jsx` — import + Tb 묶음 + 탭 분기 (3곳)
5. 파일 업로드 핸들러 + parseFile/parseSucview/parseBidDoc 통합
6. 일괄 예측 핸들러 + Promise pool + bpv3 INSERT
7. 요약 헤더 + 색상 룰 + 신뢰 배지
8. UI 스모크 (사용자 진행) — 8가지 체크리스트

## 11. 비테스트 정책

bid-analyzer는 자동 테스트 인프라가 없음 (package.json 의존성 react/react-dom/xlsx만). V1 plan과 동일하게 **빌드 통과 + 수동 진입 체크리스트**로 마무리. 자동 테스트 작성 안 함.

수동 체크리스트 (V6-B1 완료 정의):
- [ ] 새 탭 `💎 발주처 예측 V6`이 탭바에 등장
- [ ] 탭 진입 시 마지막 예측 ≥ 0건 표시 (첫 사용 시 0건도 OK)
- [ ] 파일 업로드 시 parseLogs에 성공/실패/스킵 표시
- [ ] 일괄 예측 시작 시 progress 갱신
- [ ] 결과 행 9컬럼 모두 표시
- [ ] 부적격 색상 룰 작동 (≥0.40 빨강 1건 이상 확인)
- [ ] 신뢰 배지 high/medium/low/insufficient 중 ≥ 2종류 등장
- [ ] 같은 파일 재업로드 시 bid_history는 중복 없음, bid_predictions_v3는 새 행 추가
- [ ] 기존 8개 탭 라운드트립 정상

## 12. V6-B1 완료 후 보류된 결정 (V6-B2 시작 시 처리)

- `parseInfonaFile.js`·`parseAwardListFile.js` 신규 작성 (외부 데이터)
- bid_history 외부 source('infona', 'external_award') 누적 → recalibrate 자동 트리거
- recalibrate outlier 필터 (`price_ratio BETWEEN 70 AND 130`) 도입 검토
- 자사 사업자번호 매칭 (V6-D)
- 결과 매칭 RPC `auto_match_predictions` (V6-D)

---

본 spec 승인 후 `superpowers:writing-plans` 스킬로 task 단위 실행 plan 작성.
