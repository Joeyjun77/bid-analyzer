# 예측 리스트 신뢰도 — 실측 정확도 기반 재정의 (설계)

> 작성일: 2026-05-26 / 작성: Claude Opus 4.7
> Track 2 신뢰도 UI 후속. 선행: 5/25 신뢰 높음 초록 강조(448d146·af7e7c1), hit 메트릭 정의 분리(c979749, MEASUREMENT_SPEC §4.5)
> 위상: brainstorming 산출물 → writing-plans 입력

---

## 1. 목표 / 문제

현재 예측 리스트의 "신뢰도"(`predConfidence(predSource)`)는 **발주사통계 표본 크기 N**만으로 3단계(높음 N≥200 / 보통 N≥50 / 부족)를 매긴다.

**문제**: N은 실측 정확도(MAE)와 **비단조**다. 예) 고양시는 N=535(표시상 "높음")이지만 실측 MAE 1.05·bias +0.47로 실제로는 부정확하다(`pred_bias_map` 핵심 영역 괴리). 즉 사용자가 "높음"을 믿고 골랐는데 실제 적중은 나쁠 수 있다.

**목표**: 신뢰도가 **표본 크기가 아니라 실측 정확도**(이 기관/금액대 과거 예측이 실제로 얼마나 맞았는가)를 반영하게 한다. 사용자 선택(2026-05-26): "신뢰도 숫자를 실측에 맞게 정확하게."

**메트릭 용어**(MEASUREMENT_SPEC §4.5): 본 신뢰도는 **사정률적중 정확도**(`|opt_adj − actual_adj_rate|`의 MAE·bias) 기반이다. 자사1위적중(top1_win)과 무관.

---

## 2. 핵심 제약

- 앱은 **정보 제공 도구** — "확정/제출" 류 액션 금지(신뢰도는 표시 전용).
- **Phase 23-3 Generator/Evaluator 경계**: 신뢰도는 표시 신호이며 `opt_adj`·추천값에 되먹임하지 않는다. 단 구현 전 predict-architect 분류 필수(§6).
- `pred_bias_map`은 Generator-trigger 대상 → **수정 금지**. 신규 뷰로 분리한다.
- 렌더 시점 가용 신호: N(`pred_source`), bias(`predBiasMap`, 이미 적재). MAE/SD는 미보유 → 신규 뷰 필요.

---

## 3. 설계

### §3.1 신규 뷰 `agency_accuracy_map` (read-only, Evaluator)

`pred_bias_map`와 **동일한 base CTE·4 grain·HAVING 최소표본** 규칙을 그대로 mirror하고, 집계에 `mae`·`sd`를 추가한다. `pred_bias_map`은 손대지 않는다(Generator bias source 분리 — 약간의 중복 집계는 경계 보존 비용으로 수용).

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

컬럼: `grain, key1, key2, n, bias, mae, sd`.

### §3.2 신뢰도 공식 — `predConfidenceV2(predSource, accMap, {at, ag, ba})`

`src/lib/utils.js`. 기존 `predConfidence`는 fallback용으로 유지.

1. **grain fallback lookup**(getBiasArrow·getFinalRecommendation과 동일 순서):
   AG×BA(`ag|seg`) → AG(`ag`) → AT×BA(`at|seg`) → AT(`at`). 첫 히트의 `{n, bias, mae}` 사용. `seg`는 ba로 S1~S5 계산.
2. **전역 임계값 3단계**:
   - **높음**: `n≥30` **AND** `mae≤0.55` **AND** `|bias|≤0.20`
   - **보통**: `n≥30` **AND** `mae≤0.80` **AND** `|bias|≤0.40` (높음 아님)
   - **주의/부족**: 그 외
3. **fallback**: accMap 전 grain 미스(신규 at 등) → `predConfidence(predSource)`(현행 N기반) 반환. 안전망(아무것도 안 깨짐).
4. 반환: `{level, srcLabel, n, mae, bias, grainSrc, basis:'accuracy'|'sample'}`. `basis='sample'`이면 fallback.

**실측 검증**(2026-05-26 /accuracy 기준):
| 기관 | mae | \|bias\| | 판정 | 비고 |
|---|---|---|---|---|
| 한전 | 0.42 | 0.13 | 높음 | 사정률 점추정 영역(gap_p90 0.006) |
| 지자체 | 0.61 | 소 | 보통 | mae>0.55 |
| 군시설 | 0.58 | 0.24 | 보통 | \|bias\|>0.20 → 높음 차단(분산형) |
| **고양시** | 1.05 | 0.47 | **주의** | **현행 "높음"에서 강등 — 목표 달성** |

### §3.3 클라이언트 통합

- `src/lib/supabase.js`: `sbFetchAccuracyMap()` 신설 — `sbFetchPredBiasMap` mirror, `agency_accuracy_map?select=grain,key1,key2,n,bias,mae,sd&limit=2000` → `{agBa,ag,atBa,at}` 맵(값은 `{n,bias,mae}` 객체). limit·캐싱 패턴 동일.
- `src/App.jsx`: `accuracyMap` state 추가 + 기존 데이터 로드 effect(predBiasMap 적재 근처)에서 fetch. 리스트 렌더(line ~1688, 현 `predConfidence(d.pred_source)` 자리)에서 `predConfidenceV2(d.pred_source, accuracyMap, {at:d.at, ag:d.ag, ba:d.ba})` 호출.
- 색/라벨(녹 높음 / 금 보통 / 청 부족)은 유지하되 **의미가 N→정확도로 전환**됨을 툴팁이 명시:
  > "실측 정확도 기반 — 이 기관/금액대 과거 예측 MAE {mae}%p · 편향 {bias}%p (표본 {n}건, {grainSrc}). 표본 크기가 아니라 실제 사정률 적중 정확도입니다." (fallback이면 "과거 실측 부족 → 표본 규모 기준" 단서)

### §3.4 행동 변화 (수용된 결과)

전역 임계값이라 **"높음"이 크게 줄어든다**. 현행 N기반은 지자체 302건 등 다수가 높음이지만, 정확도 기반은 사정률 점추정이 실제로 정확한 좁은 분포 영역(한전·LH·조달청)에 집중된다. 이는 "실측에 맞게"의 정직한 결과이며, 군시설 사정률은 실제 부정확(MEASUREMENT_SPEC §6.1 gap_p90 0.80)하니 낮게 나오는 게 맞다. 사용자 승인됨(2026-05-26).

---

## 4. 테스트

- `predConfidenceV2` 순수 함수 → node 단위 테스트(기존 bidCacheLogic 테스트 패턴): 한전/지자체/군시설/고양시 케이스 + grain fallback(AG 미스→AT 히트) + accMap 전 grain 미스→sample fallback + g2b_auto format.
- `npx vite build` 통과.
- 뷰: `agency_accuracy_map` 적재 행수·핵심 기관 mae가 /accuracy 체크3과 일치하는지 SQL 대조.

## 5. 범위 밖 (YAGNI / 후속 분리)

- ① 상세보정 M 합산, ② 임계값 100 vs 200 — 둘 다 **N기반 신호 튜닝**이라 본 정확도 기반 전환으로 **사실상 무의미해짐**(superseded). 폐기 후보.
- ③ 신뢰도 필터/정렬, ④ g2b_auto 노출 — 독립 UI 작업, 별도 spec.
- per-prediction 모델 기반 calibration(접근 C) — V2 calibration 트랙과 중복, 미채택.

## 6. Generator/Evaluator 분류 + 검증 게이트

구현 착수 전 **predict-architect 호출**로 분류 확정. 예상: **Evaluator**(표시 전용 + 별도 read-only 뷰, `opt_adj`·`pred_bias_map` 무영향) → `/evaluate` 면제, build+단위테스트로 충분. 만약 Generator 분류 시 `/evaluate` 5대 게이트 적용.

## 7. 리스크

- 매칭 표본이 적은 기관은 AT-level fallback에 의존 → 신뢰도가 at 평균을 반영(기관 특이성 약화). 허용(N기반보다는 정확). 
- mae 임계값(0.55/0.80)은 2026-05-26 실측 기준 — 표본 누적 시 재튜닝 가능(상수로 분리해 조정 용이).
- 뷰 중복 집계(pred_bias_map vs agency_accuracy_map) — 성능 미미(둘 다 limit 2000 로드), 경계 보존 우선.
