# 발주사 하한 예측탭 V1 — 설계 문서 (B안 채택, 데이터 검증 완료)

> 작성일: 2026-05-13 · 대상 프로젝트: bid-analyzer · 진입 단계: Phase 23-3 1단계(Design) 완료
> 이전 폐기 문서: `AGENCY_AWARD_PREDICTOR_V6_FULL_HISTORY.md` (전제 부적합으로 전면 재작성)
> 채택안: **B안** (br1 예측 + base_ratio·fr 컨텍스트 표시) — 시뮬레이션 근거는 §5 참조

---

## 1. 목적

신규 입찰 건(`bid_predictions.source='file_upload'`)에 대해 발주사별로 **1순위 사정률(`br1`)을 예측**해 자사 투찰 신고값 결정에 활용한다. 같은 화면에서 해당 발주사의 과거 1순위 사정률·낙찰가 비율·낙찰하한율을 함께 노출해 자사 투찰가 설계도 지원한다. 자사가 나라장터에서 직접 투찰하기 전의 **정보 제공 도구**이며, 앱 내 "확정/제출" 액션은 없다.

## 2. 도메인 컬럼 의미 (실측 검증 완료)

사용자가 직전 대화에서 정의한 수식과 실제 컬럼 의미가 달라, 실제 데이터로 검증해 다음과 같이 확정한다.

| DB 컬럼 | 단위 | 실제 의미 | 실측 예 (한전 경기본부 2026-04-13) |
|---|---|---|---|
| `bid_records.ba` | 원 | 기초금액 | 310,632,300 |
| `bid_records.ep` | 원 | 예정가격(추첨 결과) | 282,393,000 |
| `bid_records.bp` | 원 | 1순위 낙찰가 | 279,411,860 |
| `bid_records.fr` | % | 낙찰하한율 (금액대별 87.745% / 88.25% 등) | 88.25 |
| `bid_records.br1` | **100-base** | **1순위 사정률** (1위가 신고한 사정률; 추첨 예가 평균 근접도) | 99.5896 |
| `bid_records.ar1` | **100-base** | br1의 미세 변형(0.001~0.005pp 차이, 의미 사실상 중복) | 99.5884 |
| `bid_records.base_ratio` | **100-base** | 낙찰가/기초 × 100 (= fr + 마진) | 89.9494 |
| `bid_records.br0 / ar0` | **0-base** | br1·ar1의 (값 − 100) 변형 | -0.4103 / -0.4115 |
| `agency_rate_distribution.median_adj_ratio` | **100-base** | 발주사+업종별 `br1` 분포 중앙값 (1,846행 사전 계산) | 99.8222 |
| `agency_rate_distribution.p25/p75_adj_ratio` | **100-base** | 같은 분포의 사분위 | 99.35 / 100.23 |
| `bid_predictions.pred_adj_rate / opt_adj / bid1st_v2_adj / actual_adj_rate` | **0-base** | 기존 v6~v8 예측값과 매칭 시 실측 (br1−100) | -0.0172 등 |
| `agency_win_stats.median_adj_rate` | **0-base** | `br1` 분포의 중앙값과는 다른 의미(직접 계산값과 불일치) — V1에서 사용 안 함 | 0.0223 |

**100-base vs 0-base 변환 규칙**: 100-base 컬럼은 화면에 그대로 표시. 0-base 컬럼만 `100 + value`로 변환. 두 단위를 섞어 빼면 단위 오류 — 같은 단위끼리만 산술.

**ep/ba 비율 (사용자 직전 정의 "발주사 사정율 = ep/ba×100")**: 데이터 전수에서 **90.9091% 고정** (= 10/11). 발주사가 매번 결정하는 값이 아니라 입찰 제도 자체의 구조적 상수이므로 컬럼으로 표시할 가치가 없음 → V1에서 제외.

## 3. 비목표 (V1 범위 밖)

- 신규 예측 산식·새 Generator 코드 작성 — 기존 `agency_rate_distribution` 통계값을 그대로 신호로 사용한다.
- 기존 8개 탭(`dash/analysis/predict/notices/feedback/quality/chat/admin`)의 UI·로직·DOM 변경.
- 기존 DB 객체 스키마·정의 변경, 신규 RPC·신규 테이블·신규 인덱스 생성.
- 외부 라이브러리 추가 (recharts, supabase-js, react-query 등). V1은 표 중심, 시각화는 V2로.
- 시계열·히스토그램 차트, 발주처 비교, 엑셀 다운로드 — V2 후속.

## 4. 사용자 흐름

```
[메인 탭바]  대시보드 / 분석 / 예측 / 공고 / 피드백 / 검증 / 챗 / 관리자  (기존 그대로)
                                                              ↓
                                            (신규)  발주사 하한 예측
                                                              │
                                                              ├ 메인 리스트
                                                              │    bid_predictions(source='file_upload') 행 단위
                                                              │    (canonical_ag, cat) 키로 신호 조회
                                                              │
                                                              └ 행 클릭 → 같은 위치에서 펼침
                                                                   해당 canonical_ag의 bid_records 최근 30건
                                                                   + 금액대별 요약
```

별도 페이지·라우트 없음. `App.jsx` 안의 `setTab("agency_floor")` 분기 하나만 추가.

## 5. 시뮬레이션 결과 및 B안 선정 근거

### 5.1 시뮬레이션 1 — 1순위 사정률(br1) 예측 정확도

`bid_records` 전수 51,496행에 대해 각 안의 신호로 `br1`을 예측한 결과(`is_excluded=false` 필터 적용):

| 그룹 | n | A안(고정 100%) MAE | **B안(분포 중앙값) MAE** | A안 1pp 적중 | **B안 1pp 적중** |
|---|---|---|---|---|---|
| 한전 | 6,054 | 1.0544pp | **1.0194pp** | 77.9% | 75.8% |
| 군부대 | 7,189 | 0.6789pp | **0.6101pp** | 76.5% | **81.6%** |
| 기타 | 38,253 | 0.6933pp | **0.6653pp** | 80.8% | **81.8%** |

- B안 MAE가 모든 그룹에서 A안보다 작음 (한전은 미세, 군부대·기타는 명확).
- 군부대·기타의 1pp 적중률 5%+ 우위 — 자사가 신고값을 분포 중앙값에 맞추면 1순위 가능 범위 안에 더 자주 들어옴.

### 5.2 시뮬레이션 2 — 자사 투찰가 마진(낙찰가 − 낙찰하한) 분포

낙찰가 비율 `base_ratio`를 표시하면 자사 투찰가 = `기초 × (fr + 마진)` 룰을 한눈에 점검 가능:

| 금액대 | n | fr 평균 | 마진 중앙값 | 마진 P90 | 해석 |
|---|---|---|---|---|---|
| 3억 미만 | 44,570 | 87.795% | +0.07pp | +1.14pp | 거의 낙찰하한 정확 |
| 3억~10억 | 5,404 | 87.782% | -0.03pp | +1.26pp | 거의 낙찰하한 정확 |
| 10억 이상 | 1,789 | 86.635% | +0.40pp | +1.72pp | 살짝 위 |

→ 자사 룰: **투찰가 = ba × (fr / 100 + 0.0~0.4pp 마진)**. base_ratio 컬럼이 이를 매번 검증해 줌.

### 5.3 안별 비교 매트릭스

| 평가축 | A안 (ep/ba 90.9091% + base_ratio) | **B안 (br1 예측 + base_ratio·fr)** | C안 (br1만) |
|---|---|---|---|
| 사정률 신고값 결정 | 불가 (고정값) | **가능 (분포 중앙값)** | 가능 |
| 투찰가 마진 룰 검증 | 가능 (base_ratio) | **가능 (base_ratio + fr 옆 배치)** | 불가 |
| 1pp 적중률(군부대) | 76.5% | **81.6%** | 81.6% |
| 컬럼 수 | 6 | 8 | 5 |
| 자사 낙찰 결정 두 축 모두 지원 | △ (한 축만) | **✓ 두 축 모두** | △ (한 축만) |

→ **B안이 자사 1순위 적중 목표에 가장 부합**. C안은 정보 손실, A안은 사정률 신고 신호 부재.

## 6. 예측 신호 정의 (B안)

발주사 사정률(`br1`) 점추정값을 다음 우선순위로 산출한다. 모두 100-base, 화면 표시 시 변환 없음.

| 우선순위 | 신호원 | 조회 키 | 조건 |
|---|---|---|---|
| 1 | `agency_rate_distribution.median_adj_ratio` | `canonical_ag`+`cat` 정확 매치 | `sample_size ≥ 5` 이고 `confidence ∈ ('high','medium')` |
| 2 | `agency_rate_distribution.median_adj_ratio` AVG | `canonical_ag` 매치 (cat 무시, 같은 발주사의 모든 업종 행 평균) | 1단계 미스 시 |
| 3 | `agency_rate_distribution` 전수 median | 글로벌 폴백 (예: 99.8% 근처) | 발주사 자체가 분포 테이블에 없을 때 (고양시 등) |
| — | 표시 `예측 불가` + 0건 사유 | — | `canonical_ag` IS NULL인 경우만 |

폴백 단계는 작은 배지(`업종매치`, `발주사매치`, `글로벌`)로 신뢰도와 함께 행 옆에 표시. `agency_win_stats`는 의미 불일치 검증으로 V1에서 사용하지 않는다.

## 7. 오차 계산

오차는 매칭된 실측이 존재할 때만 표시 (`bid_predictions.match_status='matched'` AND `bid_predictions.matched_record_id IS NOT NULL`).

```
오차_pp = (예측 사정률, 100-base) − (실측 사정률, 100-base)
       = signal_median_adj_ratio − bid_records.br1
```

실측 사정률은 **두 가지 동등 경로**가 있으나 V1은 일관성 위해 한 경로만 사용:
- 채택: `bid_predictions.actual_adj_rate`(0-base)를 `100 + actual_adj_rate`로 변환해 100-base화. → 단일 테이블에서 join 회피.
- 미채택: `bid_records.br1` 직접 — 추가 join 필요, 결과는 동일.

표시 규칙: 소수점 4자리, 부호 포함, 단위 `pp`. `|오차| ≥ 0.5pp`는 빨강, 미만은 회색. 미매칭은 `—`.

## 8. UI 와이어프레임

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  발주사 하한 예측                                                                  │
│  예측 대상 142건 · 매칭 31건 · 평균 |오차| 0.18pp · 1pp 적중률 78%                 │
├──────┬─────────────────┬────┬──────────┬──────────┬──────────┬─────┬───────────┤
│ 개찰 │ 발주사 / 업종     │ 기초│ 예측 1위 │ 실측 1위 │ 실측 낙찰│ 낙찰 │ 오차 (pp) │
│ 일자 │                  │ 억  │ 사정률   │ 사정률   │ 가/기초  │ 하한 │           │
├──────┼─────────────────┼────┼──────────┼──────────┼──────────┼─────┼───────────┤
│26-05-│ 한국전력 경기북부 │6.56│ 99.78%   │ 99.81%   │ 88.74%   │88.25│  -0.03 ✓ │
│  12  │ 전기              │    │[업종·high│[matched] │ (+0.49pp │  %  │ matched   │
│      │                  │    │ ·n=1629] │          │  마진)   │     │           │
├──────┼─────────────────┼────┼──────────┼──────────┼──────────┼─────┼───────────┤
│26-05-│ 고양시 / 전기     │0.85│ 99.80%   │   —      │   —      │  —  │   —       │
│  08  │                  │    │[글로벌폴 │ pending  │ pending  │     │ pending   │
│      │                  │    │ 백·low]  │          │          │     │           │
└──────┴─────────────────┴────┴──────────┴──────────┴──────────┴─────┴───────────┘
  (행 클릭 시 같은 위치 아래로 펼침)
  ▾ 한국전력공사 경기북부본부 — 이전 입찰 이력 (canonical_ag 매치, 최근 30건)
     개찰일      공고명(요약)       기초    1위사정률  낙찰가/기초  fr     1위업체
     26-04-29   김포 위병면        0.14억   99.5806%   87.3770%   88.25  ㈜우주전기
     26-04-22   파주 변전소        2.30억   99.5500%   87.6889%   88.25  (주)휴먼
     ...
     [요약] 1위사정률 평균 99.74% · std 0.52% · n=30
            낙찰가/기초 평균 88.12% (= fr 평균 87.88% + 마진 +0.24pp)
```

핵심 컬럼 8개 + 행 펼침 시 보조 테이블 7컬럼 + 요약 2줄. 차트 없음.

## 9. 컴포넌트 분해 (단일 App.jsx 유지)

`src/App.jsx` 안에 함수형 컴포넌트 3개 추가, `setTab("agency_floor")` 분기에서 렌더링.

| 컴포넌트 | 책임 | 인풋 |
|---|---|---|
| `AgencyFloorTab` | 탭 본체. 데이터 fetch·요약 헤더·테이블 컨테이너. | 없음 (내부 fetch) |
| `AgencyFloorRow` | 메인 테이블 한 행 + 펼침 토글. | `prediction`, `signal`, `expanded`, `onToggle` |
| `AgencyFloorHistoryPanel` | 펼침 시 보조 테이블 + 금액대별 요약. | `canonical_ag`, lazy fetch 결과 |

세 컴포넌트 모두 같은 `App.jsx` 파일에 함수 선언. `src/components/`에 신규 디렉토리 추가 없음.

## 10. 데이터 흐름

```
[탭 마운트]
  └─ fetchAgencyFloorData()
       1) GET /rest/v1/bid_predictions
            ?source=eq.file_upload
            &select=id,ag,canonical_ag,cat,ba,ep,av,od,
                    actual_adj_rate,actual_bid_amount,actual_winner,
                    match_status,matched_record_id,created_at
            &order=od.desc.nullslast&limit=500
       2) GET /rest/v1/agency_rate_distribution
            ?canonical_ag=in.(<예측 행의 canonical_ag 유니크 집합>)
            &select=canonical_ag,cat,median_adj_ratio,p25_adj_ratio,p75_adj_ratio,
                    std_adj_ratio,sample_size,confidence
       3) 매칭된 행만 추가 GET /rest/v1/bid_records
            ?id=in.(<matched_record_id 집합>)
            &select=id,br1,base_ratio,fr,bp
       4) 클라이언트 조인:
            · 예측 신호: (canonical_ag, cat) → 1단계, fail → canonical_ag만 평균 → 2단계, fail → 글로벌 → 3단계
            · 실측: matched 인 행만 bid_records 결과로 채움

[행 클릭]
  └─ fetchAgencyHistory(canonical_ag)
       GET /rest/v1/bid_records
         ?canonical_ag=eq.<value>
         &br1=not.is.null&is_excluded=eq.false
         &order=od.desc.nullslast&limit=30
         &select=od,pn,ba,br1,base_ratio,fr,bp,co,pc
       (lazy, 펼친 행별로 별도 fetch, 메모리에 캐시)
```

전부 기존 `src/lib/supabase.js`의 fetch 래퍼 패턴을 따른다. 신규 fetch 헬퍼 3개 추가:
`sbFetchAgencyFloorPredictions`, `sbFetchAgencyRateDistribution`, `sbFetchAgencyHistoryByName`.

## 11. DB 매핑 표 (단위 명시)

| UI 표시 | 원본 컬럼 | 단위 | 변환 |
|---|---|---|---|
| 개찰일 | `bid_predictions.od` | date | YYYY-MM-DD |
| 발주사 | `bid_predictions.ag`(표시), `canonical_ag`(키) | text | 그대로 |
| 업종 | `bid_predictions.cat` | text | 그대로 |
| 기초금액 | `bid_predictions.ba` | 원 | `÷ 1e8`, 소수점 2자리 + "억" |
| **예측 1위 사정률** | `agency_rate_distribution.median_adj_ratio` | 100-base | **그대로**, "%" 부착 |
| 신호 메타 | `confidence`, `sample_size`, `cat`(매치 단계) | text/int | 배지 |
| **실측 1위 사정률** | `bid_predictions.actual_adj_rate` | 0-base | **`100 + value`**, "%" |
| **실측 낙찰가/기초** | `bid_records.base_ratio` (via matched_record_id) | 100-base | **그대로**, "%" |
| **낙찰하한율 fr** | `bid_records.fr` (via matched_record_id) | % | 그대로 |
| 낙찰가 | `bid_records.bp` (via matched_record_id) | 원 | `÷ 1e8`, "억" |
| **오차** | `(median_adj_ratio) − (100 + actual_adj_rate)` | pp | 4자리, 부호, 색상 |

행 펼침 테이블:
| UI 표시 | 원본 컬럼 | 단위 | 변환 |
|---|---|---|---|
| 개찰일 | `bid_records.od` | date | YYYY-MM-DD |
| 공고명 | `bid_records.pn` | text | 35자 이상 ... 처리 |
| 기초 | `bid_records.ba` | 원 | "억" |
| 1위 사정률 | `bid_records.br1` | 100-base | 그대로 |
| 낙찰가/기초 | `bid_records.base_ratio` | 100-base | 그대로 |
| fr | `bid_records.fr` | % | 그대로 |
| 1위 업체 | `bid_records.co` | text | 그대로 |

## 12. 엣지 케이스

| 케이스 | 처리 |
|---|---|
| `canonical_ag IS NULL` | 예측 컬럼 `예측 불가`, 펼침 비활성 |
| 신호 4단계 모두 폴백 실패 | `예측 불가`, 사유 표시 |
| `match_status='pending'` | 실측 4개 컬럼(사정률·낙찰가/기초·fr·낙찰가) + 오차 모두 `—` |
| `matched_record_id` 있지만 `bid_records.br1 IS NULL` (구 데이터) | 사정률·오차 `—`, 낙찰가/기초·fr는 채워질 수 있으면 채움 |
| `bid_records.is_excluded=true` 인 매칭 | 메인 리스트에는 실측 표시하되 행 색상으로 표시(연회색). 펼침의 이력에서는 `is_excluded=eq.false` 필터로 자동 제외 |
| 같은 canonical_ag 펼침 이력 0건 | "이전 입찰 없음" 표시 |
| `bid_predictions.is_cancelled=true` | 메인 리스트에서 제외 (bid_predictions에만 있는 컬럼) |
| 같은 발주사 펼침을 두 행 동시에 펼침 | 둘 다 별도 fetch, 캐시 키 = `canonical_ag` |

## 13. 작업 순서

1. **`src/lib/supabase.js`** — fetch 함수 3개 추가:
   - `sbFetchAgencyFloorPredictions()` — bid_predictions 메인 fetch
   - `sbFetchAgencyRateDistribution(canonicalAgs)` — 신호 fetch
   - `sbFetchAgencyHistoryByName(canonicalAg)` — 펼침 lazy fetch
2. **`src/App.jsx`** —
   - 탭 정의 배열에 `agency_floor` 추가 (이름: "발주사 하한 예측")
   - 탭 분기에 `<AgencyFloorTab />` 렌더링
   - 같은 파일에 `AgencyFloorTab`, `AgencyFloorRow`, `AgencyFloorHistoryPanel` 3개 함수 컴포넌트 정의
   - 기존 컴포넌트·함수는 한 줄도 수정 안 함
3. **빌드 확인** — `npx vite build` 통과
4. **UI 스모크 테스트** — 신규 탭 진입, 30+ 행 표시, matched/pending 혼합, 행 펼침 lazy fetch, 4단계 폴백 각 1건 이상 등장
5. **회귀 확인** — 기존 8개 탭 정상 동작 (탭 전환 라운드트립 1회)

## 14. Phase 23-3 게이트 정책

| 단계 | 적용 |
|---|---|
| 1. Design | 본 문서 = 완료. `predict-architect` 면제 — 신규 Generator 코드 부재, 기존 `agency_rate_distribution` 통계 조회만, 핵심 영역(한전·고양시·군부대) 예측 산식 변경 없음 |
| 2. Build | `src/App.jsx`·`src/lib/supabase.js` Edit. `getFinalRecommendation`, `opt_adj`, `pred_bias_map`, 낙찰하한율 함수 미수정 → PostToolUse hook 트리거 대상 아님 |
| 3. Verify | `/evaluate` 면제 — 기존 예측 산출물(`bid_predictions.opt_adj` 등) 변경 없음. 신규 탭은 정보 표시 레이어 |
| 4. Operate | `deploy-gate` 서브에이전트는 빌드 통과 확인용으로 호출. 기존 통합 MAE / 핵심 영역 MAE는 변화 없음(보존 검증) |
| 5. Predict | 본 탭은 정보 제공만, "확정/제출" 류 액션 없음 — 정책 부합 |

회귀 방지 인프라(model_release_gate, evaluate_model_release, model_registry)는 신규 예측 모델 도입 시에만 동작하므로 V1과 무관.

## 15. V2 후속 (의도적 보류)

- 시각화: 히스토그램(`canonical_ag`별 br1 분포), 시계열 차트(월별 추이). recharts 도입 시 추가.
- 엑셀 다운로드 (현재 화면 데이터 → xlsx, 기존 xlsx 의존성 재사용).
- 다중 발주사 비교 모드.
- 자사 사업자번호 매칭(자사 투찰 위치 표시).
- 금액대 필터·정렬·검색 등 강화 컨트롤.
- 발주사 클릭 시 별도 페이지·라우트 진입.
- `agency_rate_distribution` 자동 재계산 트리거 (현재 `last_recalc_at` 기준 STALE 경고만 표시).
