# 예측 리스트 신뢰도 — 실측 정확도 기반 재정의 (설계)

> 작성일: 2026-05-26 / 작성: Claude Opus 4.7 / **개정: 2026-05-26 (코덱스 R-confidence 검증 P0·P1 반영)**
> Track 2 신뢰도 UI 후속. 선행: 5/25 신뢰 높음 초록 강조(448d146·af7e7c1), hit 메트릭 정의 분리(c979749, MEASUREMENT_SPEC §4.5)
> 위상: brainstorming 산출물 → writing-plans 입력

---

## 1. 목표 / 문제

현재 예측 리스트의 "신뢰도"(`predConfidence(predSource)`)는 **발주사통계 표본 크기 N**만으로 3단계(높음 N≥200 / 보통 N≥50 / 부족)를 매긴다.

**문제**: N은 실측 정확도(MAE)와 **비단조**다. 발주사통계 풀 크기(N)가 커도 그 기관의 과거 예측이 실제로 정확했다는 보장이 없다. 사용자가 "높음"을 믿고 골랐는데 실제 적중은 나쁠 수 있다.

**목표**: 신뢰도가 **표본 크기가 아니라 실측 정확도**(이 기관/금액대 과거 예측이 실제로 얼마나 맞았는가)를 반영. 사용자 선택(2026-05-26): "신뢰도 숫자를 실측에 맞게 정확하게."

**메트릭 용어**(MEASUREMENT_SPEC §4.5): 본 신뢰도는 **사정률적중 정확도**(`|opt_adj − actual_adj_rate|`의 MAE·bias·sd) 기반. 자사1위적중(top1_win)과 무관 — 사정률 정확도가 높다고 낙찰을 보장하지 않음(§3.2 #3 참조).

---

## 2. 핵심 제약

- 앱은 **정보 제공 도구** — "확정/제출" 류 액션 금지(신뢰도는 표시 전용).
- **Phase 23-3 Generator/Evaluator 경계**: 신뢰도는 표시 신호이며 `opt_adj`·추천값에 되먹임하지 않는다. 구현 전 predict-architect 분류 필수(§6).
- `pred_bias_map`은 Generator-trigger 대상 → **수정 금지**. 신규 뷰로 분리.
- 렌더 시점 가용: N(`pred_source`), bias(`predBiasMap`). MAE/sd는 미보유 → 신규 뷰 필요.

---

## 3. 설계

### §3.1 신규 뷰 `agency_accuracy_map` (read-only, Evaluator)

`pred_bias_map`와 **동일한 base CTE·4 grain·HAVING 최소표본** 규칙을 mirror하고, 집계에 `mae`·`sd`를 추가. `pred_bias_map`은 손대지 않음(Generator bias source 분리).

```sql
CREATE OR REPLACE VIEW agency_accuracy_map AS
WITH base AS (
  SELECT ag, at,
    CASE WHEN ba < 1e8 THEN 'S1' WHEN ba < 3e8 THEN 'S2' WHEN ba < 1e9 THEN 'S3'
         WHEN ba < 3e9 THEN 'S4' ELSE 'S5' END AS ba_seg,
    opt_adj - actual_adj_rate AS err
  FROM bid_predictions
  WHERE match_status='matched' AND actual_adj_rate IS NOT NULL AND opt_adj IS NOT NULL
    AND ba IS NOT NULL
    AND COALESCE(actual_winner,'') <> ALL (ARRAY['유찰','유찰(무)'])
    AND abs(opt_adj - actual_adj_rate) <= 5
)
-- grain별 (pred_bias_map과 동일 HAVING): AG_BA n>=5 / AG n>=(군시설 6 else 25) / AT_BA n>=20 / AT n>=30
-- 각 grain SELECT: grain, key1, key2, count(*) n, round(avg(err),4) bias,
--                  round(avg(abs(err)),4) mae, round(stddev_samp(err),4) sd
-- UNION ALL 4 grains.
```

컬럼: `grain, key1, key2, n, bias, mae, sd`. **base 조건은 pred_bias_map과 1:1 동일해야 함**(§4 drift 테스트로 고정).

### §3.2 신뢰도 공식 — `predConfidenceV2(predSource, accMap, {at, ag, ba})`

`src/lib/utils.js`. 기존 `predConfidence`는 fallback용 유지. **코덱스 검증(2026-05-26) P0·P1 반영.**

1. **grain lookup — "tier 판정 가능한 grain 선택"** (코덱스 P0-1):
   AG×BA → AG → AT×BA → AT 순회. **첫 히트가 아니라 `n≥30`(tier-reliable)인 가장 fine한 grain**을 tier에 사용. fine grain이 있어도 `n<30`이면 다음(coarser)으로 진행. 이유: 뷰 HAVING 최소(AG_BA≥5/AG≥25/AT_BA≥20/AT≥30)가 30보다 낮아 "첫 히트"는 thin grain(n=5)에 멈춰 우연 강등됨.
   - `n≥30` grain이 없고 present grain만 있으면 → tier **최대 "보통"**(높음 금지), 가장 fine한 present grain mae/bias를 hint로.
   - 전 grain 미스(신규 at) → `predConfidence(predSource)` fallback이되 **최대 "보통" cap, "높음" 금지**(코덱스 P0-2). `basis='sample'`.
2. **전역 임계값 3단계** (사정률 정확도; sd_err로 tail-risk 반영 — 코덱스 P1-4):
   - **높음**: `n≥30` AND `mae≤0.55` AND `|bias|≤0.20` AND `sd_err≤0.65`
   - **보통**: `n≥30` AND `mae≤0.85` AND `|bias|≤0.45` (높음 아님)
   - **주의/부족**: 그 외
3. **WIN-zone 본질 영역 cap** (코덱스 P1-3 + MEASUREMENT_SPEC §6.1): `gap_p90≥0.10` 영역(현재 `{군시설}`)은 사정률 정확도가 높아도 **badge 최대 "보통"**. 낙찰이 WIN-zone 변수라 사정률 "높음"이 낙찰 보장처럼 오도되는 것 방지. 툴팁 명시.
4. 반환: `{level, srcLabel, n, mae, bias, sd, grainSrc, basis:'accuracy'|'sample', winZoneArea:bool}`.

**실측 검증**(전체 기간 AG-grain robust 신호, 2026-05-26):
| 기관(grain) | n | mae | sd_err | abs(bias) | 판정 | 비고 |
|---|---|---|---|---|---|---|
| 한전 | 60 | 0.44 | 0.58 | 0.05 | **높음** | 좁은 분포(sd_actual 0.56), 자기 분포 바닥 |
| 군시설 | 87 | 0.51 | 0.62 | 0.08 | **보통** | 사정률 MAE 양호하나 WIN-zone 영역 cap |
| 지자체 | 256 | 0.64 | 0.81 | 0.07 | 보통 | mae>0.55 |
| 경기도 고양시 | 38 | 0.553 | 0.72 | 0.15 | **보통** | 현행 N기반 "높음"→"보통" 강등(목표) |
| 교육청/LH | 12~13 | 0.63~0.68 | — | 0.47~0.56 | 주의 | n<30 → fallback, abs(bias) 큼 |

> ⚠ **초안 정정**: 고양시 "MAE 1.05/주의"는 30d n=4 noise. robust AG(n=38)은 mae 0.553 → "보통"(높음→보통 강등은 달성). 군시설 사정률 MAE 0.51은 지자체(0.64)보다 양호 — 코덱스 P1#3의 "군시설 사정률 부정확"은 gap_p90(WIN-zone)과의 혼동. badge cap은 WIN-zone 오도 방지 목적이지 사정률 부정확 때문이 아님.

### §3.3 임계값 근거 (코덱스 P1-5)

- 복수예가 추첨 이론 MAE 하한 0.642%는 **전체(generic) 추첨 분포** 기준. 개별 기관 분포는 더 좁을 수 있음.
- 관계: 최적(상수예측) MAE ≈ 0.8 × `sd_actual`. 한전 `sd_actual` 0.563 → 최적 MAE ≈ 0.45 ≈ 실측 0.44. **즉 한전 MAE<0.642는 데이터 누수가 아니라 "전체 추첨보다 좁은 분포"라는 뜻**(높음 = 더 예측 가능한 기관).
- 높음 `mae≤0.55`는 `sd_actual≲0.69`(전체 추첨보다 좁음) 영역을 잡는 기준. `sd_err≤0.65`는 같은 MAE라도 분산 큰(꼬리위험) 기관을 높음에서 배제.
- 임계값은 2026-05-26 실측 캘리브레이션 — **상수로 분리**(`utils.js` 상단)해 표본 누적 시 재튜닝.

### §3.4 클라이언트 통합

- `src/lib/supabase.js`: `sbFetchAccuracyMap()` — `sbFetchPredBiasMap` mirror, `agency_accuracy_map?select=grain,key1,key2,n,bias,mae,sd&limit=2000` → `{agBa,ag,atBa,at}` 맵(값 `{n,bias,mae,sd}`).
- `src/App.jsx`: `accuracyMap` state + 기존 로드 effect(predBiasMap 근처)에서 fetch. 리스트 렌더(line ~1688, 현 `predConfidence(d.pred_source)` 자리)에서 `predConfidenceV2(d.pred_source, accuracyMap, {at:d.at, ag:d.ag, ba:d.ba})`.
- 색/라벨(녹 높음 / 금 보통 / 청 부족) 유지하되 **의미가 N→정확도로 전환**됨을 툴팁 명시:
  > "실측 정확도 기반 — 이 기관/금액대 과거 예측 MAE {mae}%p · 편향 {bias}%p (표본 {n}건, {grainSrc}). 표본 크기가 아니라 실제 사정률 적중 정확도."
  - WIN-zone 영역(군시설): "사정률 정확도는 양호하나 이 영역은 낙찰이 WIN-zone 변수 — 자사1위적중 별도 확인."
  - fallback(basis='sample'): "과거 실측 부족 → 표본 규모 기준(최대 보통)."

### §3.5 행동 변화 (수용된 결과)

전역 임계값이라 **"높음"이 크게 줄어든다** — 사정률 점추정이 실제로 정확한 좁은 분포 영역(한전·조달청 등)에 집중. "실측에 맞게"의 정직한 결과(사용자 승인 2026-05-26). 군시설은 사정률 MAE는 양호하나 WIN-zone 영역이라 badge "보통" cap.

---

## 4. 테스트

- `predConfidenceV2` 순수 함수 → node 단위 테스트(bidCacheLogic 패턴):
  - 한전(높음)/군시설(보통 cap)/지자체(보통)/경기도 고양시(보통) 케이스
  - **grain lookup P0-1**: AG_BA n=5 존재 + AG n=80 존재 → AG로 tier(첫 히트 강등 안 됨)
  - **fallback cap P0-2**: accMap 전 grain 미스 + pred_source N≥200 → 최대 "보통"("높음" 아님)
  - g2b_auto format
- `npx vite build` 통과.
- **drift 테스트 (코덱스 P2)**: `agency_accuracy_map`과 `pred_bias_map`의 (grain,key1,key2,n,bias)가 동일한지 SQL FULL JOIN 대조(base 조건 일치 보증). 핵심 기관 mae가 /accuracy 체크3과 일치 확인.

## 5. 범위 밖 (YAGNI / 후속 분리)

- ① 상세보정 M 합산, ② 임계값 100 vs 200 — N기반 신호 튜닝이라 본 전환으로 **superseded**(폐기 후보). 단 `n`은 신뢰구간/표본충분성 표시로 계속 사용(코덱스 P1-6).
- ③ 신뢰도 필터/정렬, ④ g2b_auto 노출 — 독립 UI, 별도 spec.
- per-prediction 모델 calibration(접근 C) — V2 calibration 트랙 중복, 미채택.

## 6. Generator/Evaluator 분류 + 검증 게이트

구현 전 **predict-architect 호출**로 분류 확정. 예상: **Evaluator**(표시 전용 + 별도 read-only 뷰, `opt_adj`·`getFinalRecommendation`·`pred_bias_map` 보정값 무영향; 코덱스 동의) → `/evaluate` 면제, build+단위테스트로 충분. Generator 분류 시 `/evaluate` 5대 게이트.

## 7. 리스크

- 표본 적은 기관/세부지자체(고양시 일산서구청 n=10 등)는 AT-level fallback → at 평균 반영(기관 특이성 약화). 허용(N기반보다 정확, P0-2로 높음은 차단).
- 임계값(0.55/0.85/0.65/0.20/0.45)은 2026-05-26 캘리브레이션 — 상수 분리, 표본 누적 재튜닝.
- 두 뷰 base 조건 **drift**가 중복 집계보다 큰 위험 → §4 SQL 대조 테스트로 고정.
- WIN-zone 영역 집합 `{군시설}`은 MEASUREMENT_SPEC §6.1 gap_p90 기준 — 신규 영역 추가 시 동기화.
