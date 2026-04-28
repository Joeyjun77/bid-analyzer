# 자사 1위 낙찰 추천 시스템 재설계 — Phase 23-9

**작성일**: 2026-04-28
**작성자**: bsilisk777@gmail.com (with Claude Opus 4.7)
**상태**: 설계 완료 — 사용자 검토 대기
**관련 Phase**: 23-9 (predictV5 강등 + recommendBid1st 신설 + calcWin1stBid 폐기)

---

## 1. 배경과 문제 정의

### 1.1 현재 시스템의 본질적 한계

현재 시스템은 `predictV5`로 시장 사정률 분포의 점추정값을 산출하고, `calcWin1stBid`(WIN_OPT_GAP 정적 보정)로 자사 추천 투찰가를 계산한다. 평가는 MAE(Mean Absolute Error) 기준이며 ±0.3%를 "안정권"으로 정의해 왔다.

`bid1st_validation` VIEW로 1,230건 baseline을 측정한 결과:

| metric | 값 | 의미 |
|---|---|---|
| `floor_safe_pct` | **22.20%** | 자사 추천 투찰가 그대로 입찰 시 78%가 자격 미달로 자동 탈락 |
| `closer_than_winner_pct` | 79.02% | 1위 적중 자체는 79%이지만 |
| `both_pct` (실 낙찰 가능) | **21.06%** | 적격성을 곱하면 실제 낙찰 가능 21%만 |
| `close_but_invalid_pct` | 57.97% | 1위 적중인데 부적격으로 놓친 케이스 |

진단:
- `predictV5`의 `opt_adj` 자체도 floor_safe 46% — 시장 사정률 점추정을 그대로 투찰가로 쓰는 설계가 적격선과 정합되지 않음.
- `calcWin1stBid`는 floor_safe를 46% → 22%로 24%p 깎음. 1위 근접도 0.43%p 개선 vs 적격성 24%p 손실 — 데이터로 유해성 입증.
- WIN_OPT_GAP은 자사 입찰 449건(미낙찰)에서 산출된 정적 상수로, 자사 표본 편향 그대로 반영.

### 1.2 사용자 재정의

±0.3% "안정권" 정의를 폐기하고 다음 요구를 반영한 시스템 재설계:

1. **소수점 셋~넷째자리(0.001~0.0001%)** 정밀도 추천 사정률
2. **자사 1위 낙찰 보장 가능**한 추천 (단순 사정률 점추정 X)
3. **발주사별·입찰건별** 차별화된 추천
4. 평가 metric을 MAE에서 **`closer_than_winner_pct` + `floor_safe_pct`**로 전환

### 1.3 노이즈 0.642%와의 화해

복수예비가 C(15,4) 추첨의 이론적 노이즈 바닥은 **0.642%**(CLAUDE.md 도메인 지식). 어떤 모델도 단일 입찰의 사정률을 0.0001% 정밀도로 점추정 못 함.

해석: **0.0001% 정밀도는 "추천 위치(자사 투찰가)의 미세 조정 출력 자릿수"이며, 사정률 점추정의 정확도가 아니다.** 1위 사정률은 도메인상 낙찰하한선 +0.001~0.005% 매우 좁은 영역에 몰려 있어, 이 미세 영역에서 자사 위치를 0.0001% 단위로 결정하는 건 실제 의미 있다.

---

## 2. 사용자 요구사항 확정 (브레인스토밍 6개 결정)

| # | 결정 사항 | 선택 |
|---|---|---|
| Q1 | 성공 기준 | **C+** — 1위 적중 우선 + 적격성 가시화(라벨링·통계 누적) |
| Q2 | 학습 grain | **F** — 다단 fallback (AG×BA → AG → AT×BA → AT) |
| Q3 | 추천 출력 형식 | **B+C** — 자동 추천(1위 확률 최대 위치) + 3구간(P25/P50/P75) + 적격성 라벨 |
| Q4 | 분포 추정 모델 | **E** — 통계 추정(A) 기본 + Monte Carlo(C) 보강 (단계 분리) |
| Q5 | 기존 시스템 관계 | **D** — 단계적 진화: predictV5는 시장 분포 추정으로 강등·유지, calcWin1stBid 폐기, 신규 recommendBid1st 모듈이 메인 추천 |
| Q6 | 롤아웃 | **A** — 단계별 + 전 영역 통합 (1→2→3단계, 8~12주) |

---

## 3. 아키텍처

### 3.1 컴포넌트 구조

```
┌────────────────────────────────────────────────────────────┐
│ 입력: at, ag (canonical_ag), ba, ep, av, fr, od, pc, cat   │
└────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────┐
│ predictV5 (기존 유지 — 출력 의미 재정의: 시장 분포 추정)     │
│ → ref.med, ref.std, agency_predictor offset, pred_bias_map │
└────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────┐
│ ★ recommendBid1st()  — 신규 메인 추천 모듈                  │
│                                                            │
│   [A] 1위 사정률 분포 통계 (1단계)                          │
│       win1st_dist_map: 다단 fallback                       │
│       {AG_BA → AG → AT_BA → AT} × {mean, std, n}           │
│       출처: bid_records 53K (br1, 2024-01-01 이후)         │
│                                                            │
│   [C] Monte Carlo 보강 (2단계)                              │
│       bid_details.pre_rates → C(15,4) 1365회 시뮬레이션    │
│       자사 위치별 1위 확률 직접 카운트                       │
│                                                            │
│   [적격성 가드]                                             │
│       legal_min = av + (xp - av) × fr/100                  │
│       각 후보에 floor_safe 라벨 부착                        │
│                                                            │
│   [위치 결정 알고리즘]                                      │
│       grid search 0.0001% 단위 (±1.5% 범위, 30,000 후보)   │
│       자동 추천 = argmax(win_prob × floor_safe_indicator)  │
│       3구간(P25/P50/P75) = 분포 분위수 위치                │
└────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────┐
│ getFinalRecommendation (어댑터화 — 시그니처 무변경)         │
│ → bid1st_v2_adj 우선, 없으면 기존 opt_adj 폴백              │
└────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────┐
│ UI 출력                                                     │
│   ■ 자동 추천: +0.4827% [자격OK] 1위확률 52%                │
│   ■ 적극(P25): +0.18% [자격OK] 1위확률 38%                  │
│   ■ 균형(P50): +0.48% [자격OK] 1위확률 52%                  │
│   ■ 보수(P75): +0.81% [자격미달] 1위확률 19%                │
└────────────────────────────────────────────────────────────┘

[검증 인프라]
  ├ calc_win1st_bid_db          (베이스라인 비교용, 영구 유지)
  ├ bid1st_validation           (기존 calcWin1stBid 평가, 영구 유지)
  ├ bid1st_v2_validation        (신규 추천 평가, 신설)
  └ prediction_quality_daily    (기존 MAE 인프라, 호환)
```

### 3.2 핵심 변화점

1. **메인 추천이 `predictV5` 출력 → `recommendBid1st`로 교체** (1단계). predictV5는 시장 분포 추정 입력으로 강등.
2. **`calcWin1stBid` 호출 제거** (1단계). 함수와 WIN_OPT_GAP 상수는 3단계에서 폐기.
3. **신규 데이터 소스 `win1st_dist_map`** — `bid_records` 53K 기반 다단 fallback (현 `agency_predictor`/`pred_bias_map` 패턴 재사용).
4. **검증 인프라 이중화** — 기존 `bid1st_validation`은 베이스라인 측정용 영구 유지, 신규 `bid1st_v2_validation`이 운영 metric.
5. **DB 컬럼 호환** — `opt_adj`/`pred_adj_rate` 등 기존 컬럼 무변경 (옛 평가 인프라 호환).

---

## 4. 컴포넌트 — `recommendBid1st()`

### 4.1 함수 시그니처 (`src/lib/utils.js`)

```js
export function recommendBid1st(
  bid,         // {at, agName, ba, ep, av, pc, fr}
  context,     // {predictV5Result, win1stDistMap, bidDetails, agencyPred}
  options = {
    gridStep:         0.0001,   // 0.0001% 정밀도 grid
    gridRange:        1.5,      // 검색 범위 ±1.5%
    minSamples:       5,        // grain fallback 최소 표본
    noiseFloor:       0.642,    // 추첨 노이즈 바닥
    enableMonteCarlo: false     // 1단계 false, 2단계 true
  }
)
```

### 4.2 반환 구조

```js
{
  auto: {                     // 자동 추천 (메인)
    adj:       0.4827,        // 사정률 (0.0001% 정밀)
    bid:       88234156,      // 투찰가
    winProb:   0.52,          // 1위 확률 0~1
    floorSafe: true,
    label:     '자격OK·1위52%'
  },
  scenarios: {                // 3구간
    aggressive:   { adj, bid, winProb, floorSafe, label },  // P25
    balanced:     { adj, bid, winProb, floorSafe, label },  // P50
    conservative: { adj, bid, winProb, floorSafe, label }   // P75
  },
  distribution: {             // 참고 정보 (UI 펼침형)
    grain:           'AG_BA',
    n:               12,
    mean:            0.45,
    std:             0.31,
    src:             '한전 S2 (12건)',
    monteCarloUsed:  false
  }
}
```

### 4.3 알고리즘 (5단계)

**Step 1: 분포 추정 (다단 fallback)**

```
win1st_dist_map에서 {AG_BA → AG → AT_BA → AT} 순 lookup
n ≥ minSamples(5)인 첫 grain 선택
→ {mean, std, n, grain, src}
```

**Step 2: 노이즈 floor 적용**

```
effStd = max(std, noiseFloor)   // 0.642% 미만으로 줄지 못함
```
이론 한계를 std에 명시적으로 반영해 winProb 과신뢰 차단.

**Step 3: Monte Carlo 보강 (옵션, 2단계)**

```
if (enableMonteCarlo && bidDetails 보유):
  같은 발주사·금액대 bid_details 검색
  pre_rates 15개 → C(15,4) = 1365회 추첨 시뮬레이션
  → simMean, simStd로 mean/effStd 대체
  distribution.monteCarloUsed = true
```

**Step 4: Grid Search (0.0001% 단위)**

```
candidates = [mean - 1.5, mean - 1.5 + 0.0001, ..., mean + 1.5]   // 30,000개
각 adj에 대해:
  xp        = ba × (1 + adj/100)
  bid       = av + (xp - av) × fr/100
  legal_min = av + (xp - av) × fr/100      // 식 동일 — 실제 가드는 fr 정합 검사
  floorSafe = (계산된 bid가 입력 fr와 일관)
  winProb   = floorSafe × Φ((adj - mean) / effStd)   // 1단계 단순 가정
              (Monte Carlo 활성 시 시뮬레이션 빈도)
```

**Step 5: 출력 산출**

```
auto = argmax_{c ∈ candidates}(winProb(c))
       단, winProb 동률 시 mean에 가까운 쪽 선택 (안정성)
scenarios = {
  aggressive   = mean - 0.6745 × effStd  (P25 정규분포 분위수)
  balanced     = mean
  conservative = mean + 0.6745 × effStd  (P75)
}
각 scenario에 winProb·floorSafe 부착
```

### 4.4 winProb 정의

**1단계 (단순 모델)**:
```
P(자사 1위) = floorSafe × Φ((자사위치 − 분포평균) / effStd)
```
해석: 자사 위치가 1위 사정률 분포의 평균보다 위에 있을수록 1위 확률 ↑. 적격성 미달이면 자동 0.

**2단계 (Monte Carlo 교정)**:
시뮬레이션 직접 카운트로 winProb 산출 — 분포 형태 가정 제거.

### 4.5 헬퍼 함수

```js
function lookupWin1stDist(at, agName, baSeg, distMap) {
  const ag_ba_key = `${agName}|${baSeg}`;
  if (distMap.agBa[ag_ba_key])  return { ...distMap.agBa[ag_ba_key], grain: 'AG_BA',
    src: `${agName} ${baSeg}(${distMap.agBa[ag_ba_key].n}건)` };
  if (distMap.ag[agName])       return { ...distMap.ag[agName],      grain: 'AG',
    src: `${agName}(${distMap.ag[agName].n}건)` };
  const at_ba_key = `${at}|${baSeg}`;
  if (distMap.atBa[at_ba_key])  return { ...distMap.atBa[at_ba_key], grain: 'AT_BA',
    src: `${at} ${baSeg}(${distMap.atBa[at_ba_key].n}건)` };
  if (distMap.at[at])           return { ...distMap.at[at],          grain: 'AT',
    src: `${at}(${distMap.at[at].n}건)` };
  return null;  // 모든 grain 미달 → 시스템 기본값 (mean=0, std=0.642)
}

function calcWinProb(adj, mean, effStd, floorSafe) {
  if (!floorSafe) return 0;
  const z = (adj - mean) / effStd;
  return 0.5 * (1 + erf(z / Math.SQRT2));   // Φ(z), JS 표준 erf 미존재 시 polynomial 근사
}
```

---

## 5. 데이터 모델

### 5.1 `win1st_dist_map` VIEW (신설)

```sql
CREATE OR REPLACE VIEW win1st_dist_map AS
WITH src AS (
  SELECT
    at, canonical_ag,
    CASE
      WHEN ba < 1e8  THEN 'S1'   -- 1억 미만
      WHEN ba < 3e8  THEN 'S2'   -- 1~3억
      WHEN ba < 1e9  THEN 'S3'   -- 3~10억
      WHEN ba < 3e9  THEN 'S4'   -- 10~30억
      ELSE                'S5'   -- 30억 이상
    END AS ba_seg,
    (br1 - 100) AS adj           -- 사정률 (100% 기준)
  FROM bid_records
  WHERE br1 IS NOT NULL
    AND br1 BETWEEN 95 AND 105
    AND ba IS NOT NULL AND ba > 0
    AND at IS NOT NULL AND canonical_ag IS NOT NULL
    AND co IS NOT NULL AND co NOT LIKE '%유찰%'
    AND is_excluded IS NOT TRUE
    AND od >= '2024-01-01'       -- STALE_CUTOFF (Phase 14-5)
)
SELECT 'AG_BA' AS grain, canonical_ag AS key1, ba_seg AS key2,
       COUNT(*)::int AS n,
       ROUND(AVG(adj)::numeric, 4) AS mean,
       ROUND(stddev_samp(adj)::numeric, 4) AS std
FROM src GROUP BY canonical_ag, ba_seg HAVING COUNT(*) >= 5
UNION ALL
SELECT 'AG', canonical_ag, NULL,
       COUNT(*)::int, ROUND(AVG(adj)::numeric, 4), ROUND(stddev_samp(adj)::numeric, 4)
FROM src GROUP BY canonical_ag HAVING COUNT(*) >= 5
UNION ALL
SELECT 'AT_BA', at, ba_seg,
       COUNT(*)::int, ROUND(AVG(adj)::numeric, 4), ROUND(stddev_samp(adj)::numeric, 4)
FROM src GROUP BY at, ba_seg HAVING COUNT(*) >= 5
UNION ALL
SELECT 'AT', at, NULL,
       COUNT(*)::int, ROUND(AVG(adj)::numeric, 4), ROUND(stddev_samp(adj)::numeric, 4)
FROM src GROUP BY at HAVING COUNT(*) >= 5;
```

### 5.2 `bid_predictions` 신규 6개 컬럼

```sql
ALTER TABLE bid_predictions
  ADD COLUMN IF NOT EXISTS bid1st_v2_adj         numeric,
  ADD COLUMN IF NOT EXISTS bid1st_v2_bid         numeric,
  ADD COLUMN IF NOT EXISTS bid1st_v2_win_prob    numeric,
  ADD COLUMN IF NOT EXISTS bid1st_v2_floor_safe  boolean,
  ADD COLUMN IF NOT EXISTS bid1st_v2_grain       text,
  ADD COLUMN IF NOT EXISTS bid1st_v2_src         text;
```

3구간(P25/P50/P75)은 DB 미저장, UI에서 매번 재계산.

### 5.3 `bid1st_v2_validation` VIEW (신설)

```sql
CREATE OR REPLACE VIEW bid1st_v2_validation AS
SELECT
  p.id, p.at, p.ag, p.canonical_ag, p.open_date, p.match_status,
  p.ba, p.ep, p.av,
  p.bid1st_v2_adj         AS adj,
  p.bid1st_v2_bid         AS bid,
  p.bid1st_v2_win_prob    AS predicted_win_prob,
  p.bid1st_v2_floor_safe  AS floor_safe,
  p.bid1st_v2_grain       AS grain,
  p.bid1st_v2_src         AS src,
  p.pred_floor_rate       AS fr,
  p.actual_bid_amount     AS winner_bid,
  p.actual_expected_price AS winner_xp,
  p.actual_adj_rate,
  CASE WHEN p.actual_expected_price IS NOT NULL THEN
    p.bid1st_v2_bid > p.actual_bid_amount
    AND p.bid1st_v2_bid <= p.actual_expected_price
  END AS closer_than_winner,
  CASE WHEN p.actual_bid_amount > 0 THEN
    (p.bid1st_v2_bid - p.actual_bid_amount)::numeric / p.actual_bid_amount * 100
  END AS bid1st_pct_gap,
  CASE WHEN p.actual_expected_price IS NOT NULL THEN
    (p.bid1st_v2_bid > p.actual_bid_amount
     AND p.bid1st_v2_bid <= p.actual_expected_price)::int
  END AS actual_won
FROM bid_predictions p
WHERE p.match_status='matched'
  AND p.bid1st_v2_bid IS NOT NULL
  AND p.actual_bid_amount IS NOT NULL;

COMMENT ON VIEW bid1st_v2_validation IS
  'Phase 23-9 검증: recommendBid1st 자동 추천의 1위 적중률·적격성·win_prob calibration.';
```

### 5.4 supabase.js 신규 함수

```js
export async function sbFetchWin1stDistMap() {
  const res = await authedFetch(
    "/rest/v1/win1st_dist_map?select=grain,key1,key2,n,mean,std&limit=2000"
  );
  if (!res.ok) return { agBa:{}, ag:{}, atBa:{}, at:{} };
  const rows = await res.json();
  const m = { agBa:{}, ag:{}, atBa:{}, at:{} };
  for (const r of rows) {
    const v = { n: Number(r.n), mean: Number(r.mean), std: Number(r.std) };
    if      (r.grain==='AG_BA') m.agBa[r.key1+'|'+r.key2] = v;
    else if (r.grain==='AG')    m.ag[r.key1] = v;
    else if (r.grain==='AT_BA') m.atBa[r.key1+'|'+r.key2] = v;
    else if (r.grain==='AT')    m.at[r.key1] = v;
  }
  return m;
}
```

---

## 6. 데이터 흐름

```
[1] 사용자 업로드 (입찰서류함 XLS)
       │ loadPredFiles → parseBidDoc → items
       ▼
[2] predictV5(item) → 시장 사정률 분포 추정 결과
       ▼
[3] recommendBid1st(item, {predictV5Result, win1stDistMap, bidDetails, agencyPred})
       → { auto, scenarios, distribution }
       ▼
[4] sbSavePredictions
       │ bid1st_v2_adj, bid1st_v2_bid, bid1st_v2_win_prob,
       │ bid1st_v2_floor_safe, bid1st_v2_grain, bid1st_v2_src
       ▼
[5] UI 표시 (수동 시뮬레이션·통합 예측 리스트)
       자동 추천 + 3구간 + 분포 정보 펼침형
       ▼
─────────────── (며칠~몇 주 경과 — 개찰) ───────────────
       ▼
[6] 데이터탭 낙찰정보리스트 업로드 → sbUpsert(bid_records)
       ▼
[7] sbMatchPredictions (기존 그대로) → actual_bid_amount 등 채움
       ▼
[8] bid1st_v2_validation VIEW 자동 노출
       closer_than_winner, floor_safe, bid1st_pct_gap, win_prob calibration
```

---

## 7. UI 변경 (`src/App.jsx`)

### 7.1 수동 시뮬레이션 (App.jsx:1657~)

```
📊 시장 분포 추정: 평균 100.45% · 표준편차 0.31% (한전 S2, 12건, AG_BA)

★ 자동 추천 (1위 확률 최대화)
  사정률  100.4827%   [자격OK]   1위확률 52%
  투찰가  88,234,156원   투찰율 88.2341%

▽ 3구간 옵션 (위험 선호도)
  적극(P25)  100.1834%   [자격OK]    1위확률 38%
  균형(P50)  100.4500%   [자격OK]    1위확률 49%
  보수(P75)  100.8121%   [자격미달]  1위확률 19%

▽ 분포 정보 (펼침)
  grain: AG_BA · src: 한전 S2 (12건)
  Monte Carlo: 미적용 (1단계)
```

### 7.2 통합 예측 리스트 (App.jsx:1754~)

신규 컬럼: `자동 추천(adj)`, `1위확률(%)`, `자격`, `grain`.

색상 라벨:
- `[자격OK·1위 X%]` X≥40 초록 / X<40 노랑
- `[자격미달]` 주황 (경고 아이콘 + tooltip)
- `[1위 불가]` (winProb < 5%) 회색

### 7.3 `getFinalRecommendation` 어댑터화 (App.jsx:233~277)

기존 시그니처 유지, 내부만 교체:

```js
const getFinalRecommendation = useCallback((p)=>{
  if(!p) return {adj:null, bid:null, source:null};
  if(isLhJongsim(p.at,p.ba,p.pn))
    return {adj:null, bid:null, bid1st:null, source:'jongsim_unsupported', jongsim:true};

  // ★ Phase 23-9: bid1st_v2 우선
  if (p.bid1st_v2_adj != null) {
    return {
      adj:       Number(p.bid1st_v2_adj),
      bid:       Number(p.bid1st_v2_bid),
      bid1st:    Number(p.bid1st_v2_bid),    // calcWin1stBid 폐기 — 동일 값
      winProb:   Number(p.bid1st_v2_win_prob),
      floorSafe: Boolean(p.bid1st_v2_floor_safe),
      source:    `v2(${p.bid1st_v2_grain}: ${p.bid1st_v2_src})`
    };
  }
  // 기존 폴백 (Phase 23-2/3 보정 그대로)
  // ... (기존 코드 유지 — 1·2단계 동안만 활성, 3단계에서 제거)
}, [predBiasMap, basegFinetune]);
```

호출처(`App.jsx:1160, 1772, 1965`)는 무변경.

---

## 8. 에러 처리

| 시나리오 | 처리 |
|---|---|
| `win1stDistMap` 미로드 | `recommendBid1st` null 반환 → 기존 `predictV5`/`opt_adj` 폴백 |
| 모든 grain `n < 5` 미달 | `distribution.grain = null`, mean=0·std=0.642 fallback. UI `[표본 부족·시스템 기본]` 회색 |
| `predictV5` 실패 (null) | `recommendBid1st`도 null. 기존 에러 처리 그대로 |
| `av`/`xp`/`fr` 누락 | `legal_min` 계산 시 av=0, xp=ba 폴백. 적격성 라벨에 `[추정]` 표시 |
| LH 종심제·순심제 | `isLhJongsim` 가드로 즉시 차단 (기존 동일) |
| `bid_details` 없음 (Monte Carlo 시도 시) | `enableMonteCarlo=false`로 자동 fallback |
| Grid search 결과 모두 부적격 | `auto.floorSafe=false`, `[자격미달]` + 가장 높은 winProb 위치 추천 |

---

## 9. 검증 인프라

### 9.1 단계별 통과 기준

| metric | baseline | 1→2 | 2→3 |
|---|---|---|---|
| `closer_than_winner_pct` | 79.02% | **85%+** | **87%+** |
| `floor_safe_pct` | 22.20% | **22%+** (악화 없음) | **25%+** |
| `both_pct` (실 낙찰 가능) | 21.06% | 측정만 | **30%+** |
| `bid1st_pct_gap_p50` | 1.49% | 측정만 | **1.0% 이하** |
| `win_prob calibration` | — | predicted vs actual ±10%p | ±5%p |

### 9.2 운영 측정 쿼리

```sql
SELECT
  date_trunc('week', open_date) AS wk,
  COUNT(*) AS n,
  ROUND(100.0 * COUNT(*) FILTER (WHERE closer_than_winner) / COUNT(*), 2) AS close_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE floor_safe) / COUNT(*), 2) AS floor_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE closer_than_winner AND floor_safe) / COUNT(*), 2) AS both_pct,
  ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY ABS(bid1st_pct_gap))::numeric, 4) AS abs_gap_p50
FROM bid1st_v2_validation
WHERE open_date >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY 1 ORDER BY 1 DESC;
```

### 9.3 테스트 전략

bid-analyzer는 단위 테스트 인프라가 거의 없음. 다층 검증으로 대체:

1. `npx vite build` 통과 (현 패턴)
2. `/evaluate` 회귀 검증 — opt_adj 무변경 확인 → mae 무영향 PASS 자동
3. 1단계 배포 후 1주 운영 데이터로 baseline 측정
4. A/B 비교 쿼리 — `bid1st_validation`(기존) vs `bid1st_v2_validation`(신규) 동시 노출
5. 단위 테스트 (선택) — `recommendBid1st` `.test.js` 작성. 우선순위 낮음.

---

## 10. 단계별 일정

### 10.1 1단계 — A 통계 추정 + UI 노출 (4주)

| # | 항목 | 파일 | 분류 |
|---|---|---|---|
| 1.1 | `bid_predictions` 신규 6개 컬럼 ALTER | DB migration | Evaluator |
| 1.2 | `win1st_dist_map` VIEW 생성 | DB migration | Evaluator |
| 1.3 | `bid1st_v2_validation` VIEW 생성 | DB migration | Evaluator |
| 1.4 | `sbFetchWin1stDistMap()` 추가 | `src/lib/supabase.js` | Evaluator |
| 1.5 | `sbSavePredictions` dbRows에 `bid1st_v2_*` 추가 | `src/lib/supabase.js` | Evaluator |
| 1.6 | `recommendBid1st()` 신규 함수 | `src/lib/utils.js` | Generator |
| 1.7 | `lookupWin1stDist`, `calcWinProb` 헬퍼 | `src/lib/utils.js` | Generator |
| 1.8 | `App.jsx`: state·fetch·loadPredFiles·doManualPred에 통합 | `src/App.jsx` | Generator |
| 1.9 | `getFinalRecommendation` 어댑터화 | `src/App.jsx:233~277` | Generator |
| 1.10 | 수동 시뮬레이션 + 통합 예측 리스트 UI 변경 | `src/App.jsx` | UI |

**Phase 23-3 게이트**: predict-architect → npx vite build → /evaluate (mae PASS) → deploy-gate → push.

### 10.2 2단계 — C Monte Carlo 보강 (4주)

| # | 항목 |
|---|---|
| 2.1 | `recommendBid1st` `options.enableMonteCarlo = true` (기본 활성) |
| 2.2 | `bid_details.pre_rates` 보유 입찰엔 `simDraws` 결과로 분포 mean/std 대체 |
| 2.3 | `bid1st_v2_grain`에 `+MC` 표기 추가 (예: `AG_BA+MC`) |

### 10.3 3단계 — 정리 (1~2주)

| # | 항목 |
|---|---|
| 3.1 | `calcWin1stBid` 함수 제거 (`src/lib/utils.js:24~28`) |
| 3.2 | `WIN_OPT_GAP` 상수 제거 (`src/lib/constants-tables.js:9~17`) |
| 3.3 | `getFinalRecommendation` 폴백 로직 제거 (`bid1st_v2_adj` 무조건 사용) |
| 3.4 | `calc_win1st_bid_db` SQL 함수 + `bid1st_validation` VIEW는 baseline 비교용 영구 보존 |
| 3.5 | `opt_adj`/`pred_adj_rate` DB 컬럼은 그대로 유지 |

### 10.4 일정 요약

```
W1-2:   1단계 작업 1.1~1.10 + 빌드/게이트/배포
W3-6:   1단계 측정 (4주)
W6:     1단계 PASS 판정 → 2단계 시작
W7:     2단계 작업 2.1~2.3 + 게이트/배포
W8-11:  2단계 측정 (4주)
W11:    2단계 PASS 판정 → 3단계 시작
W12:    3단계 코드 정리 + 게이트/배포
─────
총 8~12주
```

---

## 11. 마이그레이션 + 롤백

### 11.1 마이그레이션 순서 (1단계 시작)

```sql
-- 1) 컬럼 추가 (안전)
ALTER TABLE bid_predictions
  ADD COLUMN IF NOT EXISTS bid1st_v2_adj         numeric,
  ADD COLUMN IF NOT EXISTS bid1st_v2_bid         numeric,
  ADD COLUMN IF NOT EXISTS bid1st_v2_win_prob    numeric,
  ADD COLUMN IF NOT EXISTS bid1st_v2_floor_safe  boolean,
  ADD COLUMN IF NOT EXISTS bid1st_v2_grain       text,
  ADD COLUMN IF NOT EXISTS bid1st_v2_src         text;

-- 2) win1st_dist_map VIEW 생성 + 셀 커버리지 즉시 측정
CREATE OR REPLACE VIEW win1st_dist_map AS ...;

-- 3) bid1st_v2_validation VIEW 생성
CREATE OR REPLACE VIEW bid1st_v2_validation AS ...;

-- 4) (검증) 셀 커버리지 측정
SELECT grain, COUNT(*) AS cells, SUM(n) AS total_obs
FROM win1st_dist_map GROUP BY grain;

-- 5) 코드 배포 후 신규 입찰부터 bid1st_v2_* 채워짐 (백필 불필요)
```

### 11.2 롤백 (1단계 즉시 가역)

**즉시 롤백** (수 분 내):
```sql
UPDATE bid_predictions SET bid1st_v2_adj = NULL WHERE bid1st_v2_adj IS NOT NULL;
```
`getFinalRecommendation`이 자동으로 기존 `opt_adj` 폴백. DB 컬럼·VIEW는 유지(혼란 방지). 코드는 리버트 커밋 별도 처리.

**부분 롤백** (특정 grain 문제 시):
```sql
DROP VIEW win1st_dist_map;   -- 임시
-- AG_BA/AG 절 제거한 새 VIEW 생성 (AT/AT_BA만 활성)
```

### 11.3 운영 위험 시나리오

| 시나리오 | 트리거 | 조치 |
|---|---|---|
| `closer_pct` 1단계 후 80% 정체 (목표 85% 미달) | 4주 측정 | grain 조정·재학습 후 재시도, 또는 단계 ABORT |
| `floor_safe_pct` 19% 이하 악화 | 주간 측정 | **즉시 롤백** (UPDATE NULL) |
| `win_prob calibration` ±15%p 초과 | 매칭 200건 누적 | UI에서 1위확률 % 표시 일시 중단, 적격성·grain만 표시 |
| 셀 커버리지(`AG_BA` hit율) 30% 미만 | VIEW 생성 직후 | grain 정의 재검토 (ba_seg 5→3 축소), 또는 1단계 시작 보류 |
| Phase 23-3 deploy-gate FAIL | push 직전 | 원인 분석·수정 → 재시도 |

---

## 12. Phase 23-3 게이트 흐름 요약

각 단계 push 직전:

```
1) npx vite build 통과
2) predict-architect 호출 (Generator 영향 사전 평가)
3) /evaluate 실행 (PASS/WARN/FAIL)
4) deploy-gate 통합 게이트 (빌드 + 핵심 영역 MAE + evaluate_model_release)
5) PASS 시에만 git push origin main
6) 배포 후 24시간 내 /accuracy 재측정 (WARN 이상인 경우)
```

opt_adj/pred_adj_rate가 무변경이므로 evaluate_model_release의 mae·hit_0_5_pct·floor_safe_pct는 baseline 동일 PASS 자동 기대.

---

## 13. 향후 확장 (3단계 이후)

- **시간 가중**: 최근 90일 weight 2배 등 drift 대응 (`win1st_dist_map`에 `recent_mean` 추가)
- **참여업체수(`pc`) 의존성 재검토**: 현 데이터로는 r ≈ 0.02로 noise 수준이지만, recommendBid1st 이후 데이터 누적 시 재측정
- **분포 형태 비모수화**: 1·2단계 정규 가정 → KDE 평활 또는 ECDF
- **시각화 슬라이더**: 분포·자격선 그래프 + 슬라이더 (브레인스토밍 Q3 D안 — 별도 단계)
- **자사 입찰 데이터 누적**: bid_details 자사 1위 표본이 늘면 `WIN_OPT_GAP` 식 재학습 가능 (현재 자사 1위 1건으로 불가능)

---

## 14. 결정 이력 (브레인스토밍 요약)

- Q1 성공 기준 → C+ (1위 적중 우선 + 적격성 가시화)
- Q2 학습 grain → F (다단 fallback)
- Q3 출력 형식 → B+C (자동 추천 + 3구간)
- Q4 분포 추정 → E (A 통계 + C Monte Carlo)
- Q5 시스템 관계 → D (단계적 진화)
- Q6 롤아웃 → A (단계별 + 전 영역 통합, 8~12주)

---

**문서 끝.**
