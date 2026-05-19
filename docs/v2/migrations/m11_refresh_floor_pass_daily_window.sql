-- m11: refresh_floor_pass_daily window 분리 (B2.6 보강 — 코덱스 라운드 3 권고 #2)
-- 근거: 코덱스 검증 — 같은 row에서 예측·실측 산출 시 자기충족예언(선택 편향) 위험
-- 해결: 예측 생성일(created_at)과 실측 매칭일(matched_at) window 분리
--   - created_at < matched_at  → 예측이 실측보다 먼저 생성됨 보장
--   - matched_at < NOW() - p_pred_min_age_hours(기본 24h) → 사후 매칭 완료 보장
-- 기존 m10 함수 (3 params) DROP 후 새 시그니처 (4 params)로 재생성
-- 적용: apply_migration (Supabase MCP), 2026-05-19

DROP FUNCTION IF EXISTS refresh_floor_pass_daily(DATE, DATE, TEXT);

CREATE OR REPLACE FUNCTION refresh_floor_pass_daily(
  p_since              DATE DEFAULT (CURRENT_DATE - INTERVAL '30 days')::date,
  p_until              DATE DEFAULT CURRENT_DATE,
  p_model_version      TEXT DEFAULT 'v2_modeB',
  p_pred_min_age_hours INT  DEFAULT 24
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
    p_until, NULL::text, NULL::text, p_model_version,
    COUNT(*)::int,
    ROUND(AVG(b_pred_floor_pass_prob)::numeric, 4),
    ROUND((SUM(CASE WHEN b_pred_adj >= actual_adj_rate THEN 1 ELSE 0 END)::numeric
           / NULLIF(COUNT(*),0))::numeric, 4),
    ROUND(ABS(AVG(b_pred_floor_pass_prob)
              - (SUM(CASE WHEN b_pred_adj >= actual_adj_rate THEN 1 ELSE 0 END)::numeric
                 / NULLIF(COUNT(*),0)))::numeric, 4)
  FROM bid_predictions
  WHERE match_status='matched' AND b_pred_mode='B'
    AND b_pred_adj IS NOT NULL AND actual_adj_rate IS NOT NULL AND b_pred_floor_pass_prob IS NOT NULL
    AND open_date BETWEEN p_since AND p_until
    AND COALESCE(actual_winner,'') NOT IN ('유찰','유찰(무)')
    AND ABS(b_pred_adj - actual_adj_rate) <= 5
    -- window 분리 조건 (자기충족예언 방지)
    AND created_at < matched_at
    AND matched_at < NOW() - (p_pred_min_age_hours || ' hours')::interval
  HAVING COUNT(*) >= 5
  ON CONFLICT (measured_on, at, canonical_ag, model_version) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_inserted := v_inserted + v_rows;

  -- 2) at별 집계 (동일 window 조건)
  INSERT INTO floor_pass_daily
    (measured_on, at, canonical_ag, model_version, n,
     pred_floor_pass_prob_avg, actual_floor_pass_rate, calibration_gap)
  SELECT
    p_until, at, NULL::text, p_model_version,
    COUNT(*)::int,
    ROUND(AVG(b_pred_floor_pass_prob)::numeric, 4),
    ROUND((SUM(CASE WHEN b_pred_adj >= actual_adj_rate THEN 1 ELSE 0 END)::numeric
           / NULLIF(COUNT(*),0))::numeric, 4),
    ROUND(ABS(AVG(b_pred_floor_pass_prob)
              - (SUM(CASE WHEN b_pred_adj >= actual_adj_rate THEN 1 ELSE 0 END)::numeric
                 / NULLIF(COUNT(*),0)))::numeric, 4)
  FROM bid_predictions
  WHERE match_status='matched' AND b_pred_mode='B'
    AND b_pred_adj IS NOT NULL AND actual_adj_rate IS NOT NULL AND b_pred_floor_pass_prob IS NOT NULL
    AND open_date BETWEEN p_since AND p_until AND at IS NOT NULL
    AND COALESCE(actual_winner,'') NOT IN ('유찰','유찰(무)')
    AND ABS(b_pred_adj - actual_adj_rate) <= 5
    AND created_at < matched_at
    AND matched_at < NOW() - (p_pred_min_age_hours || ' hours')::interval
  GROUP BY at
  HAVING COUNT(*) >= 3
  ON CONFLICT (measured_on, at, canonical_ag, model_version) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_inserted := v_inserted + v_rows;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION refresh_floor_pass_daily(DATE, DATE, TEXT, INT) IS
  'V2 Mode B calibration 일배치 (m11 window 분리). 자기충족예언 방지: created_at < matched_at AND matched_at 후 최소 p_pred_min_age_hours(기본 24h) 경과. A안 INSERT-only. 운용 주체: service_role. 근거: HANDOFF_V2_MASTER_PLAN §4 B2, V2_PREDICTION_DEFINITION §3.2, 코덱스 라운드 3 권고 #2.';

GRANT EXECUTE ON FUNCTION refresh_floor_pass_daily(DATE, DATE, TEXT, INT) TO service_role;
