-- m10: refresh_floor_pass_daily — V2 Mode B calibration 일배치 함수 (B2.6)
-- 근거: docs/v2/HANDOFF_V2_MASTER_PLAN §4 B2, docs/v2/V2_PREDICTION_DEFINITION §3.2
-- 정의:
--   pred_floor_pass_prob_avg : 예측이 약속한 평균 통과확률 (AVG(b_pred_floor_pass_prob))
--   actual_floor_pass_rate   : 실측 통과율 = (b_pred_adj >= actual_adj_rate인 row 수) / 전체
--   calibration_gap          : abs(pred - actual)
-- A안 INSERT-only — ON CONFLICT DO NOTHING (같은 날짜 중복 방지)
-- 적용: apply_migration (Supabase MCP), 2026-05-19

CREATE OR REPLACE FUNCTION refresh_floor_pass_daily(
  p_since         DATE DEFAULT (CURRENT_DATE - INTERVAL '30 days')::date,
  p_until         DATE DEFAULT CURRENT_DATE,
  p_model_version TEXT DEFAULT 'v2_modeB'
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inserted INT := 0;
  v_rows     INT;
BEGIN
  -- 1) 전체 집계 (at=NULL, canonical_ag=NULL)
  INSERT INTO floor_pass_daily
    (measured_on, at, canonical_ag, model_version, n,
     pred_floor_pass_prob_avg, actual_floor_pass_rate, calibration_gap)
  SELECT
    p_until,
    NULL::text,
    NULL::text,
    p_model_version,
    COUNT(*)::int,
    ROUND(AVG(b_pred_floor_pass_prob)::numeric, 4),
    ROUND((SUM(CASE WHEN b_pred_adj >= actual_adj_rate THEN 1 ELSE 0 END)::numeric
           / NULLIF(COUNT(*),0))::numeric, 4),
    ROUND(ABS(
      AVG(b_pred_floor_pass_prob)
      - (SUM(CASE WHEN b_pred_adj >= actual_adj_rate THEN 1 ELSE 0 END)::numeric
         / NULLIF(COUNT(*),0))
    )::numeric, 4)
  FROM bid_predictions
  WHERE match_status='matched'
    AND b_pred_mode='B'
    AND b_pred_adj IS NOT NULL
    AND actual_adj_rate IS NOT NULL
    AND b_pred_floor_pass_prob IS NOT NULL
    AND open_date BETWEEN p_since AND p_until
    AND COALESCE(actual_winner,'') NOT IN ('유찰','유찰(무)')
    AND ABS(b_pred_adj - actual_adj_rate) <= 5
  HAVING COUNT(*) >= 5
  ON CONFLICT (measured_on, at, canonical_ag, model_version) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_inserted := v_inserted + v_rows;

  -- 2) at별 집계
  INSERT INTO floor_pass_daily
    (measured_on, at, canonical_ag, model_version, n,
     pred_floor_pass_prob_avg, actual_floor_pass_rate, calibration_gap)
  SELECT
    p_until,
    at,
    NULL::text,
    p_model_version,
    COUNT(*)::int,
    ROUND(AVG(b_pred_floor_pass_prob)::numeric, 4),
    ROUND((SUM(CASE WHEN b_pred_adj >= actual_adj_rate THEN 1 ELSE 0 END)::numeric
           / NULLIF(COUNT(*),0))::numeric, 4),
    ROUND(ABS(
      AVG(b_pred_floor_pass_prob)
      - (SUM(CASE WHEN b_pred_adj >= actual_adj_rate THEN 1 ELSE 0 END)::numeric
         / NULLIF(COUNT(*),0))
    )::numeric, 4)
  FROM bid_predictions
  WHERE match_status='matched'
    AND b_pred_mode='B'
    AND b_pred_adj IS NOT NULL
    AND actual_adj_rate IS NOT NULL
    AND b_pred_floor_pass_prob IS NOT NULL
    AND open_date BETWEEN p_since AND p_until
    AND at IS NOT NULL
    AND COALESCE(actual_winner,'') NOT IN ('유찰','유찰(무)')
    AND ABS(b_pred_adj - actual_adj_rate) <= 5
  GROUP BY at
  HAVING COUNT(*) >= 3
  ON CONFLICT (measured_on, at, canonical_ag, model_version) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_inserted := v_inserted + v_rows;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION refresh_floor_pass_daily IS
  'V2 Mode B calibration 일배치 — floor_pass_daily 적재. 정의: actual = (b_pred_adj >= actual_adj_rate 비율). A안 INSERT-only (ON CONFLICT DO NOTHING). 운용 주체: service_role/edge function. 근거: HANDOFF_V2_MASTER_PLAN §4 B2, V2_PREDICTION_DEFINITION §3.2.';

GRANT EXECUTE ON FUNCTION refresh_floor_pass_daily(DATE, DATE, TEXT) TO service_role;
