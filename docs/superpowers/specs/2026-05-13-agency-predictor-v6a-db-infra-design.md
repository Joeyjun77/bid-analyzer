# 발주처사정율 예측 시스템 V6-A — DB 인프라 (Design Spec)

> 작성일: 2026-05-13 · 대상 프로젝트: bid-analyzer · Phase 23-3 1단계(Design) 완료
> Sub-project: V6-A (4분할 중 첫 단계) · 다음 단계: V6-B 메인 탭 + 일괄 예측
> 참조 자료: `c:/Users/home/Downloads/재구축/00-COMPATIBILITY.md`,
>   `AGENCY_AWARD_PREDICTOR_V6_FULL_HISTORY.md`, `SIMULATION_REPORT.md`,
>   `ZERO_MARGIN_SIMULATION.md`, `CLAUDE_CODE_HANDOFF_GUIDE.md`
> 본 spec은 위 4개 문서에 누락된 인프라 명세(테이블 5개 컬럼·RPC 4개·트리거 2개·백필·recalibrate)를
> 시뮬레이션·마진 보고서 + 현재 `bid_records` 스키마 근거로 도출하여 확정한다.

## 0. V6 sub-project 분해

가져온 V6 시스템은 핸드오프 가이드 기준 7-8 세션 분량이다. 단일 spec으로는 너무 크므로
다음 4개로 분해해 V6-A부터 진행한다(첫 단계만 spec → plan → 실행).

| Sub | 범위 | 산출물 |
|---|---|---|
| **V6-A** | DB 인프라 (본 spec) | 테이블 5개 + RPC 4개 + 트리거 2개 + 백필 + recalibrate |
| V6-B | 메인 탭 + 일괄 예측 | `AgencyAwardPredictor.jsx`, `BatchPredictModule.jsx`, 파서 3개 |
| V6-C | 발주처 분석 페이지 7뷰 | `AgencyDetailPage.jsx` + tabs/ 7개, 차트 라이브러리 도입 결정 |
| V6-D | 매칭 + KPI 대시보드 | 자동/수동 매칭, 부적격률·MAE·1위 트래킹, `KpiDashboard.jsx` |

V6-A 완료 시점에는 신규 5개 테이블에 53,199+건이 준비되고 `predict_with_history()` 직접 호출이
가능한 상태가 된다. UI는 0줄.

## 1. 목적과 비목표

### 1.1 목적
기존 시스템(자사 사정률 `opt_adj` 예측 v6.2)과 **완전히 분리된** 별도 모듈로
**발주처사정율 = 예정가격(ep) ÷ 기초금액(ba) × 100** 예측 시스템의 DB 베이스를 구축한다.
시뮬레이션 보고서가 입증한 운영 가설(MAE 0.25%로 연 3.4억, MAE 0.10%로 연 5억 매출 효과)을
실현하기 위한 데이터·캐시·예측 RPC 토대.

### 1.2 비목표 (V6-A 범위 밖 — 후속 sub-project)
- 프론트엔드 컴포넌트, 파서, UI, 시각화 (V6-B/C)
- 분석 RPC: `get_agency_full_history`, `get_agency_ratio_distribution`,
  `get_agency_tier_analysis`, `get_agency_time_series`, `get_agency_winners`,
  `search_agencies_v2`, `get_predictions_dashboard`, `get_dashboard_kpis` (V6-C)
- 자사 식별·매칭 RPC: `auto_match_predictions`, `mark_expired_predictions`,
  자사 컬럼 백필 (V6-D)
- 신규 의존성 (recharts, supabase-js SDK 등) — 별도 결정 시점은 V6-B 시작 시
- 외부 인포나·낙찰정보 임포트 — V6-B 파서 구현 후

### 1.3 기존 시스템 보호 원칙 (00-COMPATIBILITY.md)
- `bid_records`, `bid_predictions`, `bid_details`, `agency_environment_profile`,
  `predict_v6` 등 일체 변경 금지. SELECT만 허용 (백필 시).
- A-plan 불변성(`bid_predictions.opt_adj` UPDATE 금지)은 기존 테이블에만 적용.
- V6-A의 어떤 객체도 기존 RPC/뷰/트리거를 수정하지 않는다.

### 1.4 V1 발주사 하한 예측탭(`2026-05-13-agency-floor-prediction-tab-v1`)과의 관계
**다른 변수를 예측하는 별개 작업**. V1은 `agency_rate_distribution`(1순위 사정률 br1 분포)을
정보 표시용으로 노출하는 작은 탭(DB 변경 0). V6-A는 새 변수(`price_ratio = ep/ba×100`)
예측을 위한 신규 인프라. 두 작업은 공존 가능하나 V1은 본 V6-A와 무관하므로 우선순위에 따라
별도 결정.

## 2. 도메인 컬럼 의미 (실측 검증)

V1 spec의 `§2 도메인 컬럼 의미`와 동일 정의 사용. 추가 정의:

| 컬럼 | 단위 | 의미 | 예 |
|---|---|---|---|
| `bid_history.price_ratio` | 100-base | 발주처사정율 = `ep/ba × 100` (= **fr + 마진**) | 90.91 (구조적 상수 부근) |
| `bid_history.win_window_pct` | 100-base | 1위가 받은 낙찰 마진 = `(bp − floor_price) / ba × 100` | 0.0004% (중앙값, SIMULATION §1) |
| `agency_profile.recommended_margin` | pp(0-base) | std 기반 권장 마진 | 0.10 ~ 0.40 |
| `bid_predictions_v3.disq_risk_*` | 0~1 | 정규분포 가정 부적격 확률 = `1 − Φ(margin/std)` | 0.02 ~ 0.50 |

**중요한 도메인 사실** (SIMULATION_REPORT 검증):
- `ep/ba`는 거의 90.9091% 고정 (= 10/11). 즉 **발주처사정율 자체는 거의 상수**.
- 진짜 변동성은 `price_ratio` 그 자체보다 **추첨 결과 ep**의 분산.
- 그러므로 본 시스템이 예측하는 "발주처사정율"의 실용적 의미는 결국 **추첨된 예가/기초 비율**이며
  분포의 mean/std/percentile이 발주처별로 다르다는 가정이 핵심 (시뮬 §3 결과 참조).

## 3. 5개 테이블 컬럼 스키마 확정

### 3.1 `bid_history` — 외부+자사 통합 입찰 이력
```sql
CREATE TABLE bid_history (
  id              BIGSERIAL PRIMARY KEY,
  bid_no          TEXT NOT NULL,
  legacy_record_id BIGINT,                       -- bid_records.id 출처 추적 (NULL = 외부)
  source          TEXT NOT NULL DEFAULT 'legacy_bid_records'
                    CHECK (source IN ('legacy_bid_records','infona','external_award','file_upload')),

  ag              TEXT,                           -- raw 발주사명
  canonical_ag    TEXT,                           -- normalize_agency_name(ag) 결과
  industry        TEXT,                           -- bid_records.cat
  work_cat        TEXT,
  region          TEXT,
  contract_method TEXT,

  opened_at       DATE,
  notice_title    TEXT,

  base_amount     NUMERIC,
  a_value         NUMERIC,                        -- A값 (av)
  expected_price  NUMERIC,                        -- 예정가격 (ep)
  floor_amount    NUMERIC,                        -- 낙찰하한가 (floor_price)
  floor_rate      NUMERIC,                        -- 낙찰하한율 % (fr)

  price_ratio     NUMERIC GENERATED ALWAYS AS (
                    CASE WHEN base_amount > 0 AND expected_price IS NOT NULL
                         THEN (expected_price / base_amount * 100)
                    END
                  ) STORED,
  price_ratio_dev NUMERIC,                        -- V6-A에선 NULL 보존. V6-C 분석 RPC가 (price_ratio - agency_mean)을 동적 계산하거나 후속 sub-project에서 별도 갱신 RPC를 추가

  rank1_company   TEXT,
  rank1_biz_no    TEXT,
  rank1_amount    NUMERIC,                        -- 1순위 낙찰가 (bp)
  rank1_ratio     NUMERIC,                        -- 1순위 사정률 100-base (br1)

  competitor_count INTEGER,                       -- 참가업체수 (pc)
  win_window_pct  NUMERIC GENERATED ALWAYS AS (
                    CASE WHEN base_amount > 0 AND rank1_amount IS NOT NULL AND floor_amount IS NOT NULL
                         THEN ((rank1_amount - floor_amount) / base_amount * 100)
                    END
                  ) STORED,

  -- V6-D에서 채움 (V6-A에선 NULL)
  self_bid_amount       NUMERIC,
  self_rank             INTEGER,
  self_was_disqualified BOOLEAN,

  is_excluded     BOOLEAN DEFAULT FALSE,
  excl_reason     TEXT,

  created_at      TIMESTAMPTZ DEFAULT now(),
  imported_at     TIMESTAMPTZ DEFAULT now(),

  UNIQUE (bid_no, source)
);

COMMENT ON TABLE bid_history IS
  'V6-A: 외부+자사 통합 입찰 이력. 기존 bid_records와 분리된 신규 시스템 (00-COMPATIBILITY.md). price_ratio = ep/ba×100. 자사 컬럼은 V6-D에서 채움.';
```

### 3.2 `agency_profile` — (canonical_ag, industry, amount_tier) 캐시
```sql
CREATE TABLE agency_profile (
  id                  BIGSERIAL PRIMARY KEY,
  canonical_ag        TEXT NOT NULL,
  industry            TEXT,                       -- NULL = 모든 업종 합계
  amount_tier         TEXT,                       -- NULL = 모든 금액대 합계
  display_name        TEXT,

  sample_size         INTEGER NOT NULL DEFAULT 0,
  mean_ratio          NUMERIC,
  median_ratio        NUMERIC,
  std_dev             NUMERIC,
  p25                 NUMERIC,
  p75                 NUMERIC,
  min_ratio           NUMERIC,
  max_ratio           NUMERIC,

  recommended_margin  NUMERIC,                    -- calculate_recommended_margin
  confidence_tier     TEXT,                       -- classify_confidence_tier
                                                  --   ('high'/'medium'/'low'/'insufficient')

  avg_competitor      INTEGER,
  avg_win_window      NUMERIC,
  top_winner_company  TEXT,
  top_winner_share    NUMERIC,                    -- 0~1

  -- V6-D에서 채움
  self_total_bids     INTEGER DEFAULT 0,
  self_wins           INTEGER DEFAULT 0,
  self_disq_rate      NUMERIC,

  last_bid_date       DATE,
  last_recalc_at      TIMESTAMPTZ DEFAULT now(),

  UNIQUE (canonical_ag, industry, amount_tier)
);

COMMENT ON TABLE agency_profile IS
  'V6-A: 발주처×업종×금액대 통계 캐시. NULL을 "전체 합계" 의미로 사용해 search_agencies_v2의 SUM 집계와 일치. recalibrate_agency_profiles()로 갱신.';
```

`amount_tier` 표준 카테고리: `'~1억'`, `'1억~3억'`, `'3억~5억'`, `'5억~10억'`, `'10억~30억'`, `'30억~'`
(AGENCY_AWARD_PREDICTOR_V6_FULL_HISTORY.md §1.1 RPC와 일치)

### 3.3 `bid_predictions_v3` — 예측 결과 + 매칭/결과 추적
```sql
CREATE TABLE bid_predictions_v3 (
  id                       BIGSERIAL PRIMARY KEY,
  bid_no                   TEXT NOT NULL,
  canonical_ag             TEXT,
  industry                 TEXT,
  amount_tier              TEXT,
  base_amount              NUMERIC,
  a_value                  NUMERIC,
  floor_rate               NUMERIC,

  -- 예측 결과 (불변)
  predicted_ratio          NUMERIC NOT NULL,
  predicted_floor_amount   NUMERIC,

  -- 3-strategy (불변)
  aggressive_margin        NUMERIC,
  balanced_margin          NUMERIC,
  safe_margin              NUMERIC,
  strategy_aggressive_bid  NUMERIC,
  strategy_balanced_bid    NUMERIC,
  strategy_safe_bid        NUMERIC,
  disq_risk_aggressive     NUMERIC,
  disq_risk_balanced       NUMERIC,
  disq_risk_safe           NUMERIC,

  -- 메타 (불변)
  confidence_tier          TEXT,
  signal_stage             INTEGER,                -- 1/2/3 (어느 폴백 단계인지)
  sample_size_used         INTEGER,
  model_version            TEXT NOT NULL DEFAULT 'v3.0',

  -- 매칭/결과 (UPDATE 허용)
  match_status             TEXT NOT NULL DEFAULT 'pending'
                             CHECK (match_status IN ('pending','matched','no_match','expired')),
  matched_history_id       BIGINT REFERENCES bid_history(id),
  actual_ratio             NUMERIC,
  ratio_error              NUMERIC,
  result                   TEXT,                   -- 'rank1'/'top5'/'top10'/'top50'/'disqualified'/null

  created_at               TIMESTAMPTZ DEFAULT now(),
  expires_at               TIMESTAMPTZ,            -- 트리거가 created_at + 30일로 자동 설정
  matched_at               TIMESTAMPTZ
);

COMMENT ON TABLE bid_predictions_v3 IS
  'V6-A: 발주처사정율 예측 결과. predicted_*, strategy_*, disq_risk_*, confidence_tier, signal_stage, sample_size_used는 트리거로 UPDATE 차단(불변성). matched_*, actual_*, result, match_status만 UPDATE 가능.';
```

### 3.4 `upload_batches` — 업로드 배치 추적
```sql
CREATE TABLE upload_batches (
  id              BIGSERIAL PRIMARY KEY,
  batch_type      TEXT NOT NULL CHECK (batch_type IN ('notice','infona','award_list')),
  file_name       TEXT,
  file_size_bytes BIGINT,
  total_rows      INTEGER,
  inserted_rows   INTEGER DEFAULT 0,
  skipped_rows    INTEGER DEFAULT 0,
  error_rows      INTEGER DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','completed','failed')),
  error_log       JSONB,
  uploaded_by     UUID REFERENCES auth.users(id),
  uploaded_at     TIMESTAMPTZ DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

COMMENT ON TABLE upload_batches IS
  'V6-A: 파일 업로드 배치 메타. V6-B 파서가 실제로 사용하지만 인프라 차원에서 V6-A에서 생성.';
```

### 3.5 `bid_notices_temp` — 예측 대기 임시 테이블
```sql
CREATE TABLE bid_notices_temp (
  id              BIGSERIAL PRIMARY KEY,
  batch_id        BIGINT REFERENCES upload_batches(id) ON DELETE CASCADE,
  bid_no          TEXT NOT NULL,
  ag              TEXT,
  canonical_ag    TEXT,
  industry        TEXT,
  base_amount     NUMERIC,
  a_value         NUMERIC,
  floor_rate      NUMERIC,
  opened_at       DATE,
  notice_title    TEXT,
  contract_method TEXT,

  predicted       BOOLEAN DEFAULT FALSE,
  prediction_id   BIGINT REFERENCES bid_predictions_v3(id),
  error_message   TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE bid_notices_temp IS
  'V6-A: batch_predict_from_notices가 소비할 예측 대기 행. 예측 완료 후 predicted=true + prediction_id 채움.';
```

## 4. RPC 4개 + 보조 함수 1개 시그니처와 알고리즘

### 4.0 보조 함수 `amount_tier_of(p_amount NUMERIC) → TEXT`
```sql
CREATE OR REPLACE FUNCTION amount_tier_of(p_amount NUMERIC)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_amount IS NULL              THEN NULL
    WHEN p_amount <  100000000         THEN '~1억'
    WHEN p_amount <  300000000         THEN '1억~3억'
    WHEN p_amount <  500000000         THEN '3억~5억'
    WHEN p_amount < 1000000000         THEN '5억~10억'
    WHEN p_amount < 3000000000         THEN '10억~30억'
    ELSE                                    '30억~'
  END;
$$;
```
근거: AGENCY_AWARD_PREDICTOR_V6_FULL_HISTORY.md §1.1/§1.3의 표준 카테고리와 동일.

### 4.1 `classify_confidence_tier(p_n INTEGER, p_std NUMERIC) → TEXT`
```sql
CREATE OR REPLACE FUNCTION classify_confidence_tier(p_n INTEGER, p_std NUMERIC)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_n IS NULL OR p_n < 5 THEN 'insufficient'
    WHEN p_n >= 30 AND p_std IS NOT NULL AND p_std < 0.5 THEN 'high'
    WHEN p_n >= 10 AND p_std IS NOT NULL AND p_std < 1.0 THEN 'medium'
    ELSE 'low'
  END;
$$;
```
근거: ZERO_MARGIN_SIMULATION §5 — std<0.3% 발주처는 마진 0 시도 가능 영역,
std<1.0%까지는 데이터 누적 시 안정적, 그 이상은 mean 자체가 신뢰 어려움.

### 4.2 `calculate_recommended_margin(p_std NUMERIC, p_n INTEGER) → NUMERIC`
```sql
CREATE OR REPLACE FUNCTION calculate_recommended_margin(p_std NUMERIC, p_n INTEGER)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_n IS NULL OR p_n < 5            THEN 0.30   -- 안전판 (시뮬 권장 시작점)
    WHEN p_std IS NULL                     THEN 0.30
    WHEN p_std < 0.3                       THEN 0.10
    WHEN p_std < 0.6                       THEN 0.20
    WHEN p_std < 1.0                       THEN 0.30
    ELSE                                        0.40
  END;
$$;
```
근거: ZERO_MARGIN_SIMULATION §8.2 표 — 같은 MAE 0.25% 기준 마진 0.30%일 때 부적격률
50%→17%로 급감, 1위 확률은 거의 동일. SIMULATION_REPORT §3 Phase 1 권장값(0.020%)은 1위
직격 노림 시점이며 Phase 1 균일 마진은 0.30%로 시작 후 std 기반 동적으로.

### 4.3 `calculate_disq_risk(p_margin NUMERIC, p_std NUMERIC) → NUMERIC`

> p_margin IS NULL 가드는 spec smoke의 r_margin_null=0.5 기대값을 보장.

```sql
CREATE OR REPLACE FUNCTION calculate_disq_risk(p_margin NUMERIC, p_std NUMERIC)
RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_z   NUMERIC;
  v_az  NUMERIC;                          -- |z|
  v_t   NUMERIC;
  v_phi NUMERIC;                          -- φ(z) PDF
  v_cdf NUMERIC;                          -- Φ(z) CDF
BEGIN
  -- p_margin IS NULL 가드: margin 미입력 시 50% 부적격 반환 (안전 기본값)
  IF p_margin IS NULL THEN
    RETURN 0.5;
  END IF;

  IF p_std IS NULL OR p_std <= 0 THEN
    RETURN CASE WHEN p_margin > 0 THEN 0 ELSE 0.5 END;
  END IF;

  v_z  := p_margin / p_std;
  v_az := ABS(v_z);

  -- Zelen & Severo (Abramowitz & Stegun 26.2.17) 표준정규 CDF 다항 근사
  -- 절대오차 < 7.5e-8. PG 17은 erf() 미제공이라 직접 구현.
  v_t   := 1.0 / (1.0 + 0.2316419 * v_az);
  v_phi := EXP(- v_az * v_az / 2.0) / SQRT(2 * PI());
  v_cdf := 1.0 - v_phi * (
              0.319381530   * v_t
           + (-0.356563782) * v_t * v_t
           +  1.781477937   * v_t * v_t * v_t
           + (-1.821255978) * v_t * v_t * v_t * v_t
           +  1.330274429   * v_t * v_t * v_t * v_t * v_t
          );

  -- z<0이면 대칭 반전
  IF v_z < 0 THEN v_cdf := 1.0 - v_cdf; END IF;

  -- 부적격 = P(actual > predicted + margin) = 1 - Φ(margin/std)
  RETURN GREATEST(0, LEAST(1, 1 - v_cdf));
END;
$$;
```
**PG 17.6 확인**: `erf()` 함수는 PG 18부터 도입(현재 미지원). 위 Zelen & Severo 다항 근사는
오차 < 7.5e-8로 부적격 확률 표시 정밀도에 충분.

### 4.4 `predict_with_history(...)` — 메인 예측 RPC
```sql
CREATE OR REPLACE FUNCTION predict_with_history(
  p_bid_no       TEXT,
  p_canonical_ag TEXT,
  p_industry     TEXT,
  p_base_amount  NUMERIC,
  p_a_value      NUMERIC,
  p_floor_rate   NUMERIC                          -- 낙찰하한율 % (예 88.25)
)
RETURNS TABLE (
  predicted_ratio          NUMERIC,
  predicted_floor_amount   NUMERIC,
  aggressive_bid           NUMERIC,
  balanced_bid             NUMERIC,
  safe_bid                 NUMERIC,
  aggressive_margin        NUMERIC,
  balanced_margin          NUMERIC,
  safe_margin              NUMERIC,
  disq_risk_aggressive     NUMERIC,
  disq_risk_balanced       NUMERIC,
  disq_risk_safe           NUMERIC,
  confidence_tier          TEXT,
  signal_stage             INTEGER,                -- 1/2/3
  sample_size_used         INTEGER
) LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE
  v_tier         TEXT  := amount_tier_of(p_base_amount);
  v_mean         NUMERIC;
  v_std          NUMERIC;
  v_n            INTEGER;
  v_ct           TEXT;
  v_stage        INTEGER;
  v_margin_b     NUMERIC;                          -- balanced base margin
  v_margin_a     NUMERIC;                          -- aggressive
  v_margin_s     NUMERIC;                          -- safe
  v_pred_floor   NUMERIC;
BEGIN
  -- 1단계: (canonical_ag, industry, amount_tier) 정확 매치
  SELECT mean_ratio, std_dev, sample_size, confidence_tier
    INTO v_mean, v_std, v_n, v_ct
  FROM agency_profile
  WHERE canonical_ag = p_canonical_ag AND industry = p_industry AND amount_tier = v_tier
    AND sample_size >= 5;
  IF FOUND THEN v_stage := 1;
  ELSE
    -- 2단계: (canonical_ag, industry, NULL)
    SELECT mean_ratio, std_dev, sample_size, confidence_tier
      INTO v_mean, v_std, v_n, v_ct
    FROM agency_profile
    WHERE canonical_ag = p_canonical_ag AND industry = p_industry AND amount_tier IS NULL;
    IF FOUND THEN v_stage := 2;
    ELSE
      -- 2.5단계: (canonical_ag, NULL, NULL)
      SELECT mean_ratio, std_dev, sample_size, confidence_tier
        INTO v_mean, v_std, v_n, v_ct
      FROM agency_profile
      WHERE canonical_ag = p_canonical_ag AND industry IS NULL AND amount_tier IS NULL;
      IF FOUND THEN v_stage := 2;
      ELSE
        -- 3단계: 글로벌 (전체 mean)
        SELECT AVG(mean_ratio), AVG(std_dev), SUM(sample_size)
          INTO v_mean, v_std, v_n
        FROM agency_profile WHERE industry IS NULL AND amount_tier IS NULL;
        v_ct := 'insufficient';
        v_stage := 3;
      END IF;
    END IF;
  END IF;

  -- 폴백 후에도 mean이 NULL이면 글로벌 상수 (ep/ba ≈ 90.91% 부근의 안전 추정)
  IF v_mean IS NULL THEN
    v_mean := 100.0;
    v_std  := 0.7;
    v_n    := 0;
    v_ct   := 'insufficient';
    v_stage := 3;
  END IF;

  v_margin_b := calculate_recommended_margin(v_std, v_n);
  v_margin_a := GREATEST(0.05, v_margin_b * 0.5);
  v_margin_s := v_margin_b * 1.5;

  v_pred_floor := p_a_value
                + (p_base_amount * v_mean / 100 - p_a_value) * (p_floor_rate / 100);

  RETURN QUERY SELECT
    v_mean,
    v_pred_floor,
    CEIL(v_pred_floor * (1 + v_margin_a / 100))::NUMERIC,
    CEIL(v_pred_floor * (1 + v_margin_b / 100))::NUMERIC,
    CEIL(v_pred_floor * (1 + v_margin_s / 100))::NUMERIC,
    v_margin_a, v_margin_b, v_margin_s,
    calculate_disq_risk(v_margin_a, v_std),
    calculate_disq_risk(v_margin_b, v_std),
    calculate_disq_risk(v_margin_s, v_std),
    v_ct, v_stage, v_n;
END;
$$;
```
보조 함수 `amount_tier_of(p_amount NUMERIC)`도 함께 정의 (`'~1억'` 등 표준 카테고리 반환).

## 5. 트리거 2개

### 5.1 `trigger_normalize_bh` — bid_history.canonical_ag 자동 채움
```sql
CREATE OR REPLACE FUNCTION fn_normalize_bh()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.canonical_ag IS NULL AND NEW.ag IS NOT NULL THEN
    NEW.canonical_ag := normalize_agency_name(NEW.ag);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_normalize_bh
  BEFORE INSERT OR UPDATE OF ag ON bid_history
  FOR EACH ROW EXECUTE FUNCTION fn_normalize_bh();
```

### 5.2 `bpv3_lifecycle` — 불변성 + 라이프사이클
```sql
CREATE OR REPLACE FUNCTION fn_bpv3_lifecycle()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- INSERT: expires_at 기본 30일
  IF TG_OP = 'INSERT' THEN
    IF NEW.expires_at IS NULL THEN
      NEW.expires_at := COALESCE(NEW.created_at, now()) + INTERVAL '30 days';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: 불변 컬럼 변경 차단
  IF NEW.predicted_ratio          IS DISTINCT FROM OLD.predicted_ratio          OR
     NEW.predicted_floor_amount   IS DISTINCT FROM OLD.predicted_floor_amount   OR
     NEW.aggressive_margin        IS DISTINCT FROM OLD.aggressive_margin        OR
     NEW.balanced_margin          IS DISTINCT FROM OLD.balanced_margin          OR
     NEW.safe_margin              IS DISTINCT FROM OLD.safe_margin              OR
     NEW.strategy_aggressive_bid  IS DISTINCT FROM OLD.strategy_aggressive_bid  OR
     NEW.strategy_balanced_bid    IS DISTINCT FROM OLD.strategy_balanced_bid    OR
     NEW.strategy_safe_bid        IS DISTINCT FROM OLD.strategy_safe_bid        OR
     NEW.disq_risk_aggressive     IS DISTINCT FROM OLD.disq_risk_aggressive     OR
     NEW.disq_risk_balanced       IS DISTINCT FROM OLD.disq_risk_balanced       OR
     NEW.disq_risk_safe           IS DISTINCT FROM OLD.disq_risk_safe           OR
     NEW.confidence_tier          IS DISTINCT FROM OLD.confidence_tier          OR
     NEW.signal_stage             IS DISTINCT FROM OLD.signal_stage             OR
     NEW.sample_size_used         IS DISTINCT FROM OLD.sample_size_used         OR
     NEW.model_version            IS DISTINCT FROM OLD.model_version            THEN
    RAISE EXCEPTION 'bid_predictions_v3 immutable columns cannot be updated (id=%)', OLD.id;
  END IF;

  -- match_status 'pending' → 'matched' 전환 시 matched_at 자동 설정
  IF OLD.match_status = 'pending' AND NEW.match_status = 'matched'
     AND NEW.matched_at IS NULL THEN
    NEW.matched_at := now();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER bpv3_lifecycle
  BEFORE INSERT OR UPDATE ON bid_predictions_v3
  FOR EACH ROW EXECUTE FUNCTION fn_bpv3_lifecycle();
```

## 6. 백필 SQL (62,365건 일괄)

> rev2: pn_no 중복 disambiguation. bid_records.pn_no가 고유하지 않아(2,011 중복 그룹) 첫 시도에서 4.5% 손실 발생. CASE 표현식으로 100% unique bid_no 보장.

```sql
INSERT INTO bid_history (
  bid_no, legacy_record_id, source,
  ag, canonical_ag,
  industry, work_cat, contract_method,
  opened_at, notice_title,
  base_amount, a_value, expected_price, floor_amount, floor_rate,
  rank1_company, rank1_biz_no, rank1_amount, rank1_ratio,
  competitor_count, is_excluded, excl_reason
)
SELECT
  CASE
    WHEN pn_no IS NULL                                        THEN 'legacy_' || id::TEXT
    WHEN ROW_NUMBER() OVER (PARTITION BY pn_no ORDER BY id) > 1
                                                              THEN pn_no || '_' || id::TEXT
    ELSE pn_no
  END                                            AS bid_no,
  id                                            AS legacy_record_id,
  'legacy_bid_records'                          AS source,
  ag,
  COALESCE(canonical_ag, normalize_agency_name(ag)) AS canonical_ag,
  cat AS industry, work_cat, contract_method,
  od AS opened_at, pn AS notice_title,
  ba, av, ep, floor_price, fr,
  co, co_no, bp, br1,
  pc, COALESCE(is_excluded, FALSE), excl_reason
FROM bid_records
ON CONFLICT (bid_no, source) DO NOTHING;
```

`price_ratio`, `win_window_pct`는 GENERATED ALWAYS AS이므로 자동 계산. `pn_no` NULL 행은
`'legacy_<id>'` 합성 키로 충돌 회피.

검증:
```sql
SELECT
  (SELECT COUNT(*) FROM bid_records)        AS legacy_total,
  (SELECT COUNT(*) FROM bid_history WHERE source='legacy_bid_records') AS imported,
  (SELECT COUNT(*) FROM bid_history WHERE source='legacy_bid_records' AND canonical_ag IS NULL) AS null_canon,
  (SELECT COUNT(*) FROM bid_history WHERE source='legacy_bid_records' AND price_ratio IS NOT NULL) AS with_ratio;
-- 기대: legacy_total ≈ imported, null_canon = 0 (트리거+함수로 모두 채움), with_ratio ≈ 50,753
```

## 7. `recalibrate_agency_profiles()` 로직

```sql
CREATE OR REPLACE FUNCTION recalibrate_agency_profiles()
RETURNS TABLE (rows_inserted INTEGER, agencies_distinct INTEGER, elapsed_ms INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  v_start TIMESTAMPTZ := clock_timestamp();
  v_inserted INTEGER;
  v_agencies INTEGER;
BEGIN
  TRUNCATE agency_profile;

  WITH base AS (
    SELECT canonical_ag, industry,
           amount_tier_of(base_amount) AS amount_tier,
           price_ratio, competitor_count, win_window_pct, rank1_company,
           opened_at
    FROM bid_history
    WHERE expected_price IS NOT NULL
      AND is_excluded = FALSE
      AND canonical_ag IS NOT NULL
      AND price_ratio BETWEEN 70 AND 110   -- V6A_14 hotfix (2026-05-14): outlier 1,297건(2.6%) 제외
  ),
  -- 4가지 grain 동시 집계: (ag, ind, tier), (ag, ind, NULL), (ag, NULL, tier), (ag, NULL, NULL)
  grouped AS (
    SELECT canonical_ag, industry,                amount_tier, price_ratio, competitor_count, win_window_pct, rank1_company FROM base
    UNION ALL
    SELECT canonical_ag, industry,                NULL,        price_ratio, competitor_count, win_window_pct, rank1_company FROM base
    UNION ALL
    SELECT canonical_ag, NULL,                    amount_tier, price_ratio, competitor_count, win_window_pct, rank1_company FROM base
    UNION ALL
    SELECT canonical_ag, NULL,                    NULL,        price_ratio, competitor_count, win_window_pct, rank1_company FROM base
  ),
  agg AS (
    SELECT canonical_ag, industry, amount_tier,
           COUNT(*)::INTEGER                                  AS sample_size,
           AVG(price_ratio)                                  AS mean_ratio,
           PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY price_ratio) AS median_ratio,
           STDDEV_SAMP(price_ratio)                          AS std_dev,
           PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY price_ratio) AS p25,
           PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY price_ratio) AS p75,
           MIN(price_ratio)                                  AS min_ratio,
           MAX(price_ratio)                                  AS max_ratio,
           AVG(competitor_count)::INTEGER                    AS avg_competitor,
           AVG(win_window_pct)                               AS avg_win_window
    FROM grouped
    GROUP BY canonical_ag, industry, amount_tier
  ),
  top_winners AS (
    SELECT canonical_ag, industry, amount_tier, rank1_company,
           COUNT(*) AS wins,
           ROW_NUMBER() OVER (
             PARTITION BY canonical_ag, industry, amount_tier
             ORDER BY COUNT(*) DESC
           ) AS rk,
           SUM(COUNT(*)) OVER (PARTITION BY canonical_ag, industry, amount_tier) AS total
    FROM grouped
    WHERE rank1_company IS NOT NULL
    GROUP BY canonical_ag, industry, amount_tier, rank1_company
  ),
  last_dates AS (
    SELECT canonical_ag, MAX(opened_at) AS last_bid_date FROM base GROUP BY canonical_ag
  )
  INSERT INTO agency_profile (
    canonical_ag, industry, amount_tier, display_name,
    sample_size, mean_ratio, median_ratio, std_dev, p25, p75, min_ratio, max_ratio,
    recommended_margin, confidence_tier,
    avg_competitor, avg_win_window, top_winner_company, top_winner_share,
    last_bid_date, last_recalc_at
  )
  SELECT
    a.canonical_ag, a.industry, a.amount_tier, a.canonical_ag,
    a.sample_size, a.mean_ratio, a.median_ratio, a.std_dev, a.p25, a.p75, a.min_ratio, a.max_ratio,
    calculate_recommended_margin(a.std_dev, a.sample_size),
    classify_confidence_tier(a.sample_size, a.std_dev),
    a.avg_competitor, a.avg_win_window,
    tw.rank1_company,
    CASE WHEN tw.total > 0 THEN tw.wins::NUMERIC / tw.total END,
    ld.last_bid_date, now()
  FROM agg a
  LEFT JOIN top_winners tw
    ON tw.canonical_ag = a.canonical_ag
   AND tw.industry IS NOT DISTINCT FROM a.industry
   AND tw.amount_tier IS NOT DISTINCT FROM a.amount_tier
   AND tw.rk = 1
  LEFT JOIN last_dates ld ON ld.canonical_ag = a.canonical_ag;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  SELECT COUNT(DISTINCT canonical_ag) INTO v_agencies FROM agency_profile;

  RETURN QUERY SELECT v_inserted, v_agencies,
    EXTRACT(MILLISECOND FROM (clock_timestamp() - v_start))::INTEGER;
END;
$$;
```

예상 결과: ~1,639 발주처 × 평균 3-4 grain ≈ **5,000~7,000행 / 1~3초**.

## 8. RLS 정책

```sql
ALTER TABLE bid_history          ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_profile       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bid_predictions_v3   ENABLE ROW LEVEL SECURITY;
ALTER TABLE upload_batches       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bid_notices_temp     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read" ON bid_history
  FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "authenticated_read" ON agency_profile
  FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "authenticated_read" ON bid_predictions_v3
  FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "authenticated_read" ON upload_batches
  FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "authenticated_read" ON bid_notices_temp
  FOR SELECT TO authenticated USING (TRUE);
-- INSERT/UPDATE/DELETE 정책 미선언 → service_role 만 가능
```

### 8.1 V6-B1 hotfix (2026-05-14, `V6A_13_rls_insert_v6b1_hotfix.sql`)

V6-B1이 클라이언트(authenticated)에서 `bid_history(file_upload)`와 `bid_predictions_v3`에 직접
INSERT하므로 §8의 "service_role만 INSERT"는 V6-B1 가동을 막는다. 다음 정책 2개를 추가한다.
`bid_history`는 `source='file_upload'`만 허용해 legacy/external_award 위변조를 차단하고,
`bid_predictions_v3`는 무제한 INSERT 허용하되 `bpv3_lifecycle` 트리거가 `expires_at` 자동 설정
및 UPDATE 시 불변 컬럼 보호 책임.

```sql
CREATE POLICY "authenticated_insert_upload" ON bid_history
  FOR INSERT TO authenticated WITH CHECK (source = 'file_upload');

CREATE POLICY "authenticated_insert" ON bid_predictions_v3
  FOR INSERT TO authenticated WITH CHECK (true);
```

`upload_batches`/`bid_notices_temp`는 V6-B2 파서 도입 시점에 동일 패턴으로 INSERT 정책 추가
예정 — V6-B1엔 미사용.

⚠️ 보안 알림 (Supabase advisory): 기존 17개 테이블이 RLS disabled 상태이며, V6-A는
이를 변경하지 않는다(00-COMPATIBILITY 원칙). 사용자가 별도로 정책을 추가하길 권장하나 본 spec
범위 밖.

## 9. 인덱스

```sql
-- bid_history (핫 경로: 발주처 조회, 정렬, 백필 매칭)
CREATE INDEX bh_canonical_industry_amount
  ON bid_history (canonical_ag, industry, base_amount DESC)
  WHERE expected_price IS NOT NULL;
CREATE INDEX bh_opened_desc ON bid_history (opened_at DESC NULLS LAST);
CREATE INDEX bh_rank1_company ON bid_history (rank1_company text_pattern_ops);
CREATE INDEX bh_legacy_id ON bid_history (legacy_record_id) WHERE legacy_record_id IS NOT NULL;
CREATE INDEX bh_canonical_only ON bid_history (canonical_ag);

-- agency_profile
CREATE INDEX ap_canonical ON agency_profile (canonical_ag);
CREATE INDEX ap_confidence ON agency_profile (confidence_tier);

-- bid_predictions_v3 (매칭/대시보드)
CREATE INDEX bpv3_match_status ON bid_predictions_v3 (match_status, created_at DESC);
CREATE INDEX bpv3_bid_no ON bid_predictions_v3 (bid_no);
CREATE INDEX bpv3_canonical ON bid_predictions_v3 (canonical_ag);

-- bid_notices_temp
CREATE INDEX bnt_batch_pending ON bid_notices_temp (batch_id) WHERE predicted = FALSE;
```

## 10. 엣지 케이스

| 케이스 | 처리 |
|---|---|
| `bid_records.canonical_ag` NULL (8,988건) | 트리거 + COALESCE로 자동 채움. 그래도 NULL이면 `'(unknown)'`로 폴백? — 현재는 NULL 허용 |
| `bid_records.ep` NULL (11,612건) | `price_ratio` GENERATED → NULL. `agency_profile`에서 자동 제외 |
| `bid_records.pn_no` NULL | `'legacy_<id>'` 합성 키 |
| 백필 중복 실행 | `ON CONFLICT (bid_no, source) DO NOTHING` |
| `predict_with_history` 발주처 없음 | 글로벌 폴백 → `confidence_tier='insufficient'`, `signal_stage=3` |
| `floor_rate` NULL | `predicted_floor_amount` NULL → bid 계산 NULL. 호출자가 검증 |
| `bid_predictions_v3` 같은 bid_no 재예측 | 새 행 INSERT (이전 행은 expires_at 도래 시 별도 RPC가 expired 처리, V6-D) |
| trigger normalize 호출 비용 | 백필 시 한 번만 (62K건). 이후는 INSERT 시점 매번이지만 단순 정규식 함수 |
| `bid_history.price_ratio_dev` | V6-A에선 항상 NULL. V6-C 분석 RPC가 동적 계산하거나 후속에서 별도 갱신 RPC 추가 |
| `amount_tier_of(NULL)` | NULL 반환. recalibrate에선 NULL을 "전체 합계" 의미로 GROUP BY |
| `bid_history.price_ratio` outlier (<70 또는 >110) | V6A_14 hotfix(2026-05-14)로 recalibrate WHERE 절에서 제외. 1,297건/2.6% 영향. 원본은 보존(legacy_record_id로 역추적 가능) |
| 글로벌 폴백 mean이 sane range 밖 | outlier 영향 가능성. confidence='insufficient'로 UI 차단 권장. V6-B에서 outlier 필터 도입 검토. |
| bid_records 원본 사정률 outlier (>110 등) | V6-A는 데이터를 그대로 백필. outlier 필터링은 V6-B/V6-C 책임. |

## 11. Phase 23-3 게이트 적용

| 단계 | 적용 |
|---|---|
| 1. Design | 본 spec = 완료. `predict-architect` 면제 — 신규 시스템은 다른 변수(`price_ratio = ep/ba×100`) 예측, 기존 핵심 영역(한전·고양시·군부대) `opt_adj` 예측 산식은 0줄 변경 |
| 2. Build | DB 객체만, `src/*` 미수정 → PostToolUse hook 트리거 대상 아님 |
| 3. Verify | `/evaluate` 면제 — `bid_predictions.opt_adj` 변경 0. V6 자체 KPI(부적격률·MAE)는 V6-D에서 별도 트래킹 |
| 4. Operate | `deploy-gate` 호출 (빌드 통과 + 기존 핵심 영역 MAE 보존 검증). DB 마이그레이션은 Supabase MCP `apply_migration` 직접 실행 (Vercel 배포와 무관) |
| 5. Predict | V6-A에는 예측 호출 UI 없음. `predict_with_history()` 직접 호출만 가능 (psql/MCP). 정책 부합 |

## 12. V6-A 작업 순서 (plan에서 task로 분해할 단위)

1. **마이그레이션 5개**: 테이블 → 인덱스 → RLS 순. 각 적용 후 `SELECT COUNT(*) FROM bid_records;` 등으로 기존 보호 확인.
2. **보조 함수 1개**: `amount_tier_of(NUMERIC) → TEXT`
3. **RPC 4개**: `classify_confidence_tier`, `calculate_recommended_margin`, `calculate_disq_risk`, `predict_with_history`
4. **트리거 2개 + 함수 2개**: `fn_normalize_bh`/`trigger_normalize_bh`, `fn_bpv3_lifecycle`/`bpv3_lifecycle`
5. **백필 SQL 실행** + 검증 쿼리 (legacy_total ≈ imported, null_canon = 0)
6. **`recalibrate_agency_profiles()` 정의 + 1회 실행** + 검증 (5K~7K 행, 1,639 발주처)
7. **smoke 호출**: `predict_with_history('test', '한국전력공사 경기북부본부', '전기', 656_000_000, 65_000_000, 88.25)` → 3-strategy bid + disq_risk 반환 확인
8. **회귀 보호 검증**: `bid_records`/`bid_predictions`/`bid_details` COUNT 변화 0, `predict_v6` 정상 호출, `v_system_health` 정상

## 13. V6-B 진입 조건 (V6-A 완료 정의)

- 신규 5개 테이블 모두 생성 + RLS enabled + 인덱스 모두 생성
- `bid_history`에 ≥ 60,000행 (백필)
- `agency_profile`에 ≥ 4,000행 (recalibrate)
- `predict_with_history()` smoke 호출 1건 이상 통과
- 기존 시스템 검증: `bid_records` COUNT 변화 0, `predict_v6` 정상

위 5개 모두 만족 시 V6-B (메인 탭 + 일괄 예측) 진입. 실패 시 V6-A에서 보강 후 재진입.

## 14. 보류된 결정 (V6-B 시작 시점에 처리)

- supabase-js SDK 도입 vs `authedFetch` 패턴 유지 (CLAUDE.md "SDK 금지" vs V6 design.md SDK 사용)
- recharts 도입 vs SVG 자체 구현 (V6-C 차트용)
- 외부 인포나·낙찰정보 시드 100건+100건 임포트 (파서 구현 후)
- 자사 사업자번호 매칭 로직 (V6-D)
- 기존 17개 테이블 RLS 활성화 정책 (V6-A 범위 밖, 별도 결정)
- recalibrate_agency_profiles()에 outlier 필터 (예: price_ratio BETWEEN 70 AND 130) 추가 검토. 현재 글로벌 폴백 mean이 일부 이상치 영향으로 sane range 밖일 수 있음.

---

본 spec 승인 후 `superpowers:writing-plans` 스킬로 task 단위 실행 plan 작성.
