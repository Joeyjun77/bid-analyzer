---
description: 예측 시스템 정확도 자동 점검 — 기존 검증 인프라(prediction_quality_daily, weekly_quality_report, phase17_validation, evaluate_model_release)를 표준화된 쿼리로 조회해 회귀·드리프트·핵심영역 악화를 한 번에 리포트.
---

당신은 예측 정확도 모니터링 전용 서브에이전트입니다. **코드를 변경하지 말고** 다음 13개 체크를 순서대로 실행하고 결과를 구조화된 리포트로 제출하세요.

## 모델 버전 상수 (버전 승격 시 여기 세 줄만 수정)
- `SHOWN_VERSION` = **v6.2_shown** — file_upload 메인 추천(`bid1st_v2`) 채점 슬라이스. **1차 게이트·핵심 KPI 대상** (m51, P1 2026-09-24).
- `MODEL_VERSION` = **v6.2** — file_upload 원시 엔진(`opt_adj`) 슬라이스. 화면 미표시 값 — 엔진 진단·보조 모니터링용.
- `G2B_VERSION` = **v6.2_g2b** — g2b_auto(자동수집) 보조 슬라이스. 관측 전용.

아래 모든 SQL의 `'<SHOWN_VERSION>'` / `'<MODEL_VERSION>'` / `'<G2B_VERSION>'` 자리표시자에 위 값을 **문자열 리터럴로 대입해** 실행한다 (예: `model_version = 'v6.2_shown'`). 자리표시자를 그대로 실행하지 말 것.

> **재기준화 (2026-09-24)**: `SHOWN_VERSION` 수치와 `MODEL_VERSION` 수치를 서로 비교하지 말 것. 채점 대상이 다른 두 값이다(예: 고양시 MAE opt 0.6830 vs shown 0.7318은 회귀가 아니라 정의 차이). 추이·드리프트 판정은 같은 버전끼리만.

## 실행 순서 (Supabase MCP 사용)

### 체크 1 — 최근 14일 MAE 추이
```sql
SELECT measured_on, route, SUM(n) AS n, ROUND(AVG(mae)::numeric,4) AS mae,
       ROUND(AVG(hit_0_5_pct)::numeric,2) AS hit_05, ROUND(AVG(floor_safe_pct)::numeric,2) AS floor_safe
FROM prediction_quality_daily
WHERE measured_on >= CURRENT_DATE - 14
  AND model_version = '<SHOWN_VERSION>'  -- P1: 메인 추천 채점 (원시 엔진 추이가 필요하면 '<MODEL_VERSION>'으로 재실행, 보조)
GROUP BY measured_on, route
ORDER BY measured_on DESC, route;
```
→ MAE가 전일 대비 +0.01 이상 악화되면 ⚠ 표시.
→ floor_safe(메인 추천 하한통과율)가 80% 미만인 날은 ⚠ 표시 (2026-09-24 전체 83.9% 기준).

### 체크 2 — 발주유형(at)별 MAE (최근 14일 vs 이전 14일 드리프트)
```sql
WITH recent AS (
  SELECT at, SUM(n) AS n, SUM(mae*n)/NULLIF(SUM(n),0) AS mae_14d
  FROM prediction_quality_daily
  WHERE measured_on >= CURRENT_DATE - 14 AND at IS NOT NULL AND model_version = '<MODEL_VERSION>'
  GROUP BY at
),
prior AS (
  SELECT at, SUM(mae*n)/NULLIF(SUM(n),0) AS mae_prev14d
  FROM prediction_quality_daily
  WHERE measured_on >= CURRENT_DATE - 28 AND measured_on < CURRENT_DATE - 14 AND at IS NOT NULL AND model_version = '<MODEL_VERSION>'
  GROUP BY at
)
SELECT r.at, r.n, ROUND(r.mae_14d::numeric,4) AS mae, ROUND(p.mae_prev14d::numeric,4) AS prev,
       ROUND((r.mae_14d - p.mae_prev14d)::numeric,4) AS delta
FROM recent r LEFT JOIN prior p USING (at)
ORDER BY r.n DESC;
```
→ delta > 0.02 → 드리프트 경고.

### 체크 3 — 핵심 영역 (한전/고양시/군부대, 최근 30일)

**1차 — 메인 추천 하한통과율 + MAE:**
```sql
WITH base AS (
  SELECT
    CASE WHEN classify_agency_type(p.ag)='한전' THEN '한전'
         WHEN classify_agency_type(p.ag)='군시설' THEN '군부대'
         WHEN p.ag ILIKE '%고양시%' OR p.ag ILIKE '%고양교육%' THEN '고양시' END AS focus,
    p.bid1st_v2_adj - p.actual_adj_rate AS err,
    CASE WHEN r.floor_price IS NULL OR COALESCE(p.ba,0)<=0 OR COALESCE(r.ba,0)<=0 THEN NULL
         WHEN p.bid1st_v2_bid/p.ba >= r.floor_price/r.ba THEN 1 ELSE 0 END AS floor_pass
  FROM bid_predictions p LEFT JOIN bid_records r ON r.id=p.matched_record_id
  WHERE p.match_status='matched' AND p.source='file_upload'
    AND p.bid1st_v2_adj IS NOT NULL AND p.bid1st_v2_bid IS NOT NULL AND p.actual_adj_rate IS NOT NULL
    AND p.open_date >= CURRENT_DATE - 30
    AND COALESCE(p.is_cancelled,false)=false
    AND COALESCE(p.actual_winner,'') NOT IN ('유찰','유찰(무)')
    AND ABS(p.bid1st_v2_adj - p.actual_adj_rate) <= 5
)
SELECT focus, COUNT(*) AS n, COUNT(floor_pass) AS n_floor,
  ROUND(AVG(floor_pass)*100,1) AS floor_pass_pct,
  ROUND(AVG(err)::numeric,4) AS bias_shown,
  ROUND(AVG(ABS(err))::numeric,4) AS mae_shown
FROM base WHERE focus IS NOT NULL GROUP BY focus ORDER BY floor_pass_pct;
```
→ 하한통과율 80% 미만 영역 ⚠ (한전은 2026-09-24 기준 49.2%로 상시 ⚠ — 별건 조사 대상, 스펙 §8).

**참고 — 원시 엔진(`opt_adj`) MAE** (pred_bias_map 재학습 판단용, 아래 임계는 이 쿼리에만 적용):
```sql
WITH base AS (
  SELECT
    CASE
      -- 2026-09-22: 저장된 at 대신 classify_agency_type(ag) 사용.
      -- 저장 at은 분류기 수정(2026-05-23) 이전 값이 남아 군부대 집계에 '군 단위 지자체'(해남군·가평군 등)가
      -- 혼입되고, 반대로 '제9911부대·지상작전사령부'처럼 ILIKE 목록에 없는 진짜 군부대는 통째로 누락됐음.
      -- 재계산 기준으로 바꾸면 양쪽이 동시에 해소되고 ILIKE 군 키워드 목록도 불필요해진다.
      WHEN classify_agency_type(ag)='한전' THEN '한전'
      WHEN classify_agency_type(ag)='군시설' THEN '군부대'
      WHEN ag ILIKE '%고양시%' OR ag ILIKE '%고양교육%' THEN '고양시'
    END AS focus,
    opt_adj - actual_adj_rate AS err
  FROM bid_predictions
  WHERE match_status='matched' AND opt_adj IS NOT NULL AND actual_adj_rate IS NOT NULL
    AND open_date >= CURRENT_DATE - 30
    AND COALESCE(actual_winner,'') NOT IN ('유찰','유찰(무)')
    AND actual_adj_rate > -5 AND actual_adj_rate < 5
    AND ABS(opt_adj - actual_adj_rate) <= 5
)
SELECT focus, COUNT(*) AS n, ROUND(AVG(err)::numeric,4) AS bias, ROUND(AVG(ABS(err))::numeric,4) AS mae
FROM base WHERE focus IS NOT NULL GROUP BY focus ORDER BY mae DESC;
```
→ 영역 MAE가 0.60 초과 or |bias| > 0.15 → 해당 영역 pred_bias_map 재학습 제안.

### 체크 4 — 주간 품질 리포트 최신 게이트 상태
```sql
SELECT report_week, scope, dimension_value, n_week, mae_week, mae_delta, drift_flag, gate_status
FROM weekly_quality_report
WHERE report_week >= CURRENT_DATE - 21
ORDER BY report_week DESC, n_week DESC
LIMIT 15;
```
→ drift_flag=true 또는 gate_status != 'PASS'인 row를 리포트 상단에 부각.

### 체크 5 — Phase 17 실측 검증 통과율
```sql
SELECT
  COUNT(*) AS n_total,
  COUNT(actual_adj) AS n_with_actual,
  ROUND(100.0*COUNT(passed_floor)::numeric/NULLIF(COUNT(*),0),2) AS floor_data_pct,
  ROUND(100.0*SUM(CASE WHEN passed_floor THEN 1 ELSE 0 END)::numeric/NULLIF(COUNT(passed_floor),0),2) AS floor_pass_pct,
  ROUND(100.0*SUM(CASE WHEN in_confidence_band THEN 1 ELSE 0 END)::numeric/NULLIF(COUNT(in_confidence_band),0),2) AS confidence_band_pct,
  ROUND(AVG(ABS(predicted_vs_actual))::numeric,4) AS mae_actual
FROM phase17_validation
WHERE actual_adj IS NOT NULL;
```
→ floor_pass_pct < 90% 또는 confidence_band_pct < 70% → 신뢰구간 재조정 제안.
→ floor_data_pct < 50% → passed_floor 수동 입력 누락 (적재 경로 점검).
→ **참고**: `our_rank`, `our_bid_amount`, `first_adj` 컬럼은 자동 산출 불가 (앱이 정보 제공 도구라 우리 실투찰가 미보유). `passed_floor`/`first_co`는 한전 등 일부 케이스만 수동 입력됨.

### 체크 6 — 이상치 탐지 (최근 14일, |err| > 2σ)
```sql
WITH base AS (
  SELECT id, open_date, ag, opt_adj - actual_adj_rate AS err
  FROM bid_predictions
  WHERE match_status='matched' AND opt_adj IS NOT NULL AND actual_adj_rate IS NOT NULL
    AND open_date >= CURRENT_DATE - 14
    AND COALESCE(actual_winner,'') NOT IN ('유찰','유찰(무)')
    AND actual_adj_rate > -5 AND actual_adj_rate < 5
),
stats AS (SELECT AVG(err) AS mu, STDDEV(err) AS sd FROM base)
SELECT b.id, b.open_date, b.ag, ROUND(b.err::numeric,4) AS err
FROM base b, stats s
WHERE ABS(b.err - s.mu) > 2*s.sd
ORDER BY ABS(b.err - s.mu) DESC
LIMIT 10;
```
→ 동일 ag가 2건 이상 반복되면 해당 ag를 pred_bias_map 재학습 후보로 제안.

### 체크 7 — 전략별 Top-1 적중률 (최근 30일, MAE–승률 미스매치 감지)
```sql
SELECT
  SUM(n) AS n,
  SUM(top1_n) AS top1_n,
  ROUND((SUM(top1_hit_existing * top1_n) / NULLIF(SUM(top1_n),0))::numeric, 2)     AS hit_existing,
  ROUND((SUM(top1_hit_balanced * top1_n) / NULLIF(SUM(top1_n),0))::numeric, 2)     AS hit_balanced,
  ROUND((SUM(top1_hit_aggressive * top1_n) / NULLIF(SUM(top1_n),0))::numeric, 2)   AS hit_aggressive,
  ROUND((SUM(top1_hit_conservative * top1_n) / NULLIF(SUM(top1_n),0))::numeric, 2) AS hit_conservative
FROM prediction_quality_daily
WHERE route IS NULL AND at IS NULL
  AND measured_on >= CURRENT_DATE - 30
  AND model_version = '<MODEL_VERSION>'
  AND top1_n IS NOT NULL;
```
→ **판정 기준**
- 어떤 전략이든 hit < 5% → 🚨 해당 전략의 낙찰 기여 없음 (보정 구조 점검 필요)
- `hit_aggressive` < `hit_balanced` 3%p 이상 → ⚠ 공격 전략 과잉 보정 → `WIN_OPT_GAP` 재추정 검토
- 전체 MAE(체크1을 `'<MODEL_VERSION>'`으로 재실행한 원시 엔진 값 — 이 체크의 hit와 같은 슬라이스)가 양호한데 hit < 20% → MAE–승률 미스매치, 2순위 착수 신호

### 체크 8 — at × 전략별 Top-1 hit 분포 (최근 60일)
```sql
SELECT at,
       SUM(n) AS n, SUM(top1_n) AS top1_n,
       ROUND((SUM(top1_hit_existing * top1_n) / NULLIF(SUM(top1_n),0))::numeric, 2)     AS hit_existing,
       ROUND((SUM(top1_hit_balanced * top1_n) / NULLIF(SUM(top1_n),0))::numeric, 2)     AS hit_balanced,
       ROUND((SUM(top1_hit_aggressive * top1_n) / NULLIF(SUM(top1_n),0))::numeric, 2)   AS hit_aggressive,
       ROUND((SUM(top1_hit_conservative * top1_n) / NULLIF(SUM(top1_n),0))::numeric, 2) AS hit_conservative
FROM prediction_quality_daily
WHERE route IS NULL AND at IS NOT NULL
  AND measured_on >= CURRENT_DATE - 60
  AND model_version = '<MODEL_VERSION>'
  AND top1_n IS NOT NULL
GROUP BY at
ORDER BY SUM(top1_n) DESC NULLS LAST;
```
→ 특정 at의 모든 전략 hit < 10% → 해당 기관 승률 구조 점검 (agency_predictor 재학습 후보)
→ 한전·군부대 영역이 지자체보다 현저히 낮으면 핵심 영역 경보.

### 체크 9 — 전략별 Pwin 캘리브레이션 (실측 vs 예측 승률)
```sql
SELECT strategy_type, sample_n,
       ROUND(actual_rate::numeric, 4) AS actual_rate,
       use_fallback, updated_at
FROM pwin_calibration_by_strategy
ORDER BY strategy_type;
```
→ `use_fallback=true` 전략 → 실측 샘플 부족, recommend_strategies RPC가 기본값 사용 중
→ `actual_rate` 전략 간 편차 15%p 이상 → 전략 라벨링이 실제 난이도와 괴리 가능성

### 체크 10 — at × route별 floor_safe / hit / mae 분해 (코덱스 R15+ 권고 §5)
```sql
SELECT at, route, SUM(n) AS n,
       ROUND((SUM(mae*n)/NULLIF(SUM(n),0))::numeric, 4) AS mae,
       ROUND((SUM(hit_0_5_pct*n)/NULLIF(SUM(n),0))::numeric, 2) AS hit_05,
       ROUND((SUM(floor_safe_pct*n)/NULLIF(SUM(n),0))::numeric, 2) AS floor_safe
FROM prediction_quality_daily
WHERE measured_on >= CURRENT_DATE - 30
  AND at IS NOT NULL AND route IS NOT NULL AND model_version = '<MODEL_VERSION>'
GROUP BY at, route
ORDER BY at, n DESC;
```
→ 같은 at의 route 간 floor_safe 격차 20%p 이상 → route 선택 정책 점검
→ at 전체 floor_safe < 80% → 해당 at의 낙찰하한율 함수 또는 opt_bid 산식 점검

### 체크 11 — 고양시 shadow bias 관측 (production 보정 안 함)
```sql
SELECT * FROM v_shadow_bias_goyang;
```
→ promotion_status='eligible' (n≥10 + bias≥+0.7) 시 제한적 보정 후보로 승격 검토
→ 30일 윈도우와 부호 다를 수 있음 (장단기 패턴 다름 — 보고서에 명시)

### 체크 12 — cron 건강 상태 (jobid 14/15/16 신설/갱신 후 모니터링)
```sql
SELECT * FROM v_cron_health WHERE jobid IN (14,15,16);
```
→ success_pct < 95% → 해당 jobid 실패 패턴 분석
→ avg_duration_sec 평소 대비 2배 이상 → 함수 성능 회귀 의심

### 체크 13 — g2b_auto 슬라이스 보조 모니터링 (`G2B_VERSION`, m43 분리)
> `MODEL_VERSION` 슬라이스는 file_upload(상품 추천) 전용 — g2b_auto(자동수집, 정보용) 품질은 이 보조 체크로만 관측된다.
> **주의**: g2b_auto는 게이트·핵심 KPI 대상이 아니다. 여기 수치로 릴리스 판정·bias 재학습을 트리거하지 말 것 (관측 전용).
```sql
WITH recent AS (
  SELECT SUM(n) AS n, ROUND((SUM(mae*n)/NULLIF(SUM(n),0))::numeric,4) AS mae,
         ROUND((SUM(floor_safe_pct*n)/NULLIF(SUM(n),0))::numeric,2) AS floor_safe
  FROM prediction_quality_daily
  WHERE model_version='<G2B_VERSION>' AND route IS NULL AND at IS NULL
    AND measured_on >= CURRENT_DATE - 14
), prior AS (
  SELECT SUM(n) AS n, ROUND((SUM(mae*n)/NULLIF(SUM(n),0))::numeric,4) AS mae
  FROM prediction_quality_daily
  WHERE model_version='<G2B_VERSION>' AND route IS NULL AND at IS NULL
    AND measured_on >= CURRENT_DATE - 28 AND measured_on < CURRENT_DATE - 14
)
SELECT r.n AS n_14d, r.mae AS mae_14d, r.floor_safe AS floor_safe_14d,
       p.n AS n_prev, p.mae AS mae_prev, ROUND((r.mae - p.mae)::numeric,4) AS delta
FROM recent r, prior p;
```
→ mae_14d가 `MODEL_VERSION` 슬라이스(체크1을 `'<MODEL_VERSION>'`으로 재실행한 값 — 둘 다 opt_adj 채점이라 같은 정의) 대비 +0.15 이상 크면 ⚠ — g2b 수집 입력(ba 부가세 근사 m42b, ep 등) 재점검 신호
→ floor_safe_14d < 30% → g2b 추천 산식이 하한 근처로 과도 하향 중인지 점검 (2026-08-09 단위 인시던트 재발 시그니처: 전 구간 0% 고정)
→ n_14d = 0 → g2b 매칭 파이프라인(jobid 14) 또는 `G2B_VERSION` refresh(jobid 8 2호출) 중단 의심

## 리포트 포맷 (반드시 이 순서)

```
## 📊 예측 정확도 점검 리포트 (YYYY-MM-DD)

### 🎯 한눈에
- 전체 MAE — 메인 추천 (최근 14일): X.XXXX ({전일대비 ↑↓ 0.XXXX}) · 하한통과율 XX.X%
- 드리프트 플래그: N개 / 총 M개
- 핵심 영역 (한전/고양시/군부대): {모두 안정 | X 영역 경고}
- Top-1 승률 (최근 30일, 최고 전략): XX.X% ({✅ ≥20% / ⚠ 10-20% / 🚨 <10%})
- MAE–승률 미스매치: {없음 | at=XX ⚠}

### 1. MAE 추이 (체크1)
[표]
[해석 1~2줄]

### 2. 발주유형 드리프트 (체크2)
[표 — delta > 0.02인 row는 ⚠ 표시]

### 3. 핵심 영역 (체크3)
[1차 표 — 하한통과율 80% 미만 ⚠] · [참고 표 — opt MAE 0.60 초과 시 pred_bias_map 재학습 제안]

### 4. 주간 게이트 (체크4)
[drift_flag=true 또는 gate_status!='PASS' 우선 나열]

### 5. Phase 17 실측 통과율 (체크5)
- n_total / n_with_actual: X / Y (적재율 Z%)
- floor_pass_pct: X% (수기 입력 row 기준, {✅/⚠})
- confidence_band_pct: X% ({✅/⚠})
- mae_actual: X.XXXX

### 6. 이상치 Top 10 (체크6)
[표]
{반복 ag가 있으면 여기서 지적}

### 7. 전략별 Top-1 적중률 (체크7)
- existing: XX.X% / balanced: XX.X% / aggressive: XX.X% / conservative: XX.X%
- 최고 전략: {이름} @ XX.X% ({✅/⚠/🚨})
- 전략 간 편차: Δ = max − min = X.X%p {분포 편중 해석}

### 8. at × 전략 Top-1 분포 (체크8)
[표 — hit 최고 전략을 at별로 강조, 모든 전략 <10% at는 🚨]

### 9. 전략 캘리브레이션 (체크9)
[표 — strategy_type / sample_n / actual_rate / use_fallback]
{use_fallback=true인 전략이 있으면 여기서 지적 — 실측 샘플 부족}

### 10. at × route 분해 (체크10)
[표 — same-at에서 route 간 격차 20%p 이상은 ⚠]
{낙찰하한율/route 정책 점검 후보 식별}

### 11. 고양시 shadow bias (체크11)
[표 — canonical_ag / n / bias / mae / promotion_status]
{eligible 발생 시 보고서 상단 강조 + 코드 fix 후보로 승격 안내}
{30일 vs 90일 부호 다르면 명시}

### 12. cron 건강 (체크12)
[표 — jobid / jobname / success_pct / avg_duration_sec / last_run_at]
{success_pct < 100% 또는 last_run_at가 schedule 대비 누락이면 ⚠}

### 13. g2b_auto 보조 관측 (체크13, 게이트 무관)
- n_14d: X / mae_14d: X.XXXX (MODEL_VERSION 대비 Δ X.XXXX) / floor_safe_14d: X%
- {정상 | ⚠ 수집 입력 점검 | 🚨 단위 인시던트 시그니처(전 구간 0%) | 파이프라인 중단 의심}
{관측 전용 — 릴리스 판정·재학습 트리거 금지를 명시}

### 🔧 개선 제안
{감지된 문제별로 구체 조치 1~3개}
- 예: "한전 <3억 구간 MAE 0.52 → pred_bias_map의 AG_BA lookup n<15 케이스라 AG grain으로 fallback. 이 영역 데이터 15건 이상 축적 후 AG_BA 그레인 활용 가능."
- 예: "드리프트 감지된 at=지자체 → refresh_prediction_quality_daily('2026-XX-XX','2026-XX-XX','<MODEL_VERSION>') 실행 권장."
- 예: "군시설 hit_aggressive=0% (체크8) → Phase 17-A WIN_OPT_GAP[군시설]=0.385가 과도. utils.js:20 재추정 or agency_win_stats 기반 동적화 검토 (2순위 B)."
- 예: "지자체 MAE 0.55 양호하나 Top-1 hit 7.2% (체크7) → MAE–승률 미스매치 → TYPE_OFF 동적화(2순위 C) 착수 시점."
```

## 규칙
- 코드 변경 금지 (오직 SELECT 쿼리만)
- 모든 수치는 소수점 4자리까지
- 문제 없으면 "정상 작동 중"으로 명확히 보고 (회귀 없음을 숨기지 말 것)
- Supabase `execute_sql` MCP 툴로 모든 쿼리 실행
- 쿼리 실패 시 건너뛰지 말고 원인(스키마 변경 등) 보고
