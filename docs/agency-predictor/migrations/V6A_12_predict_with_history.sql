-- V6-A Migration 12: 메인 예측 RPC (3단계 폴백)
-- spec §4.4

CREATE OR REPLACE FUNCTION predict_with_history(
  p_bid_no       TEXT,
  p_canonical_ag TEXT,
  p_industry     TEXT,
  p_base_amount  NUMERIC,
  p_a_value      NUMERIC,
  p_floor_rate   NUMERIC
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
  signal_stage             INTEGER,
  sample_size_used         INTEGER
) LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE
  v_tier       TEXT := amount_tier_of(p_base_amount);
  v_mean       NUMERIC;
  v_std        NUMERIC;
  v_n          INTEGER;
  v_ct         TEXT;
  v_stage      INTEGER;
  v_margin_b   NUMERIC;
  v_margin_a   NUMERIC;
  v_margin_s   NUMERIC;
  v_pred_floor NUMERIC;
BEGIN
  -- 1단계: (canonical_ag, industry, amount_tier) 정확 매치
  SELECT mean_ratio, std_dev, sample_size, confidence_tier
    INTO v_mean, v_std, v_n, v_ct
  FROM agency_profile
  WHERE canonical_ag = p_canonical_ag
    AND industry = p_industry
    AND amount_tier = v_tier
    AND sample_size >= 5;
  IF FOUND THEN
    v_stage := 1;
  ELSE
    -- 2단계: (canonical_ag, industry, NULL)
    SELECT mean_ratio, std_dev, sample_size, confidence_tier
      INTO v_mean, v_std, v_n, v_ct
    FROM agency_profile
    WHERE canonical_ag = p_canonical_ag
      AND industry = p_industry
      AND amount_tier IS NULL;
    IF FOUND THEN
      v_stage := 2;
    ELSE
      -- 2.5단계: (canonical_ag, NULL, NULL)
      SELECT mean_ratio, std_dev, sample_size, confidence_tier
        INTO v_mean, v_std, v_n, v_ct
      FROM agency_profile
      WHERE canonical_ag = p_canonical_ag
        AND industry IS NULL
        AND amount_tier IS NULL;
      IF FOUND THEN
        v_stage := 2;
      ELSE
        -- 3단계: 글로벌 평균
        SELECT AVG(mean_ratio), AVG(std_dev), SUM(sample_size)
          INTO v_mean, v_std, v_n
        FROM agency_profile WHERE industry IS NULL AND amount_tier IS NULL;
        v_ct := 'insufficient';
        v_stage := 3;
      END IF;
    END IF;
  END IF;

  -- 마지막 폴백 (글로벌도 NULL이면 상수)
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
