-- m20: refresh_floor_pass_daily + refresh_win_zone_daily 공동도급 제외 (V2_DOMAIN_RULES_CHECK #7)
-- 근거: 공동이행/분담이행/의무공동도급은 적격심사 계산식 달라 학습·예측 대상 아님
-- bid_records.is_joint_contract = true 인 row 제외
-- 적용: apply_migration (Supabase MCP), 2026-05-20

-- refresh_floor_pass_daily 재정의 (m11 4-param + 공동도급 필터)
DROP FUNCTION IF EXISTS refresh_floor_pass_daily(DATE, DATE, TEXT, INT);

CREATE OR REPLACE FUNCTION refresh_floor_pass_daily(
  p_since              DATE DEFAULT (CURRENT_DATE - INTERVAL '30 days')::date,
  p_until              DATE DEFAULT CURRENT_DATE,
  p_model_version      TEXT DEFAULT 'v2_modeB',
  p_pred_min_age_hours INT  DEFAULT 24
)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE v_inserted INT := 0; v_rows INT;
BEGIN
  INSERT INTO floor_pass_daily
    (measured_on, at, canonical_ag, model_version, n,
     pred_floor_pass_prob_avg, actual_floor_pass_rate, calibration_gap)
  SELECT
    p_until, NULL::text, NULL::text, p_model_version,
    COUNT(*)::int,
    ROUND(AVG(p.b_pred_floor_pass_prob)::numeric, 4),
    ROUND((SUM(CASE WHEN p.b_pred_adj >= p.actual_adj_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0))::numeric, 4),
    ROUND(ABS(AVG(p.b_pred_floor_pass_prob) - (SUM(CASE WHEN p.b_pred_adj >= p.actual_adj_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0)))::numeric, 4)
  FROM bid_predictions p
  LEFT JOIN bid_records r ON r.id = p.matched_record_id
  WHERE p.match_status='matched' AND p.b_pred_mode='B'
    AND p.b_pred_adj IS NOT NULL AND p.actual_adj_rate IS NOT NULL AND p.b_pred_floor_pass_prob IS NOT NULL
    AND p.open_date BETWEEN p_since AND p_until
    AND COALESCE(p.actual_winner,'') NOT IN ('유찰','유찰(무)')
    AND ABS(p.b_pred_adj - p.actual_adj_rate) <= 5
    AND p.created_at < p.matched_at
    AND p.matched_at < NOW() - (p_pred_min_age_hours || ' hours')::interval
    AND COALESCE(r.is_joint_contract, false) != true  -- m20 추가
  HAVING COUNT(*) >= 5
  ON CONFLICT (measured_on, at, canonical_ag, model_version) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_inserted := v_inserted + v_rows;

  INSERT INTO floor_pass_daily
    (measured_on, at, canonical_ag, model_version, n,
     pred_floor_pass_prob_avg, actual_floor_pass_rate, calibration_gap)
  SELECT
    p_until, p.at, NULL::text, p_model_version,
    COUNT(*)::int,
    ROUND(AVG(p.b_pred_floor_pass_prob)::numeric, 4),
    ROUND((SUM(CASE WHEN p.b_pred_adj >= p.actual_adj_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0))::numeric, 4),
    ROUND(ABS(AVG(p.b_pred_floor_pass_prob) - (SUM(CASE WHEN p.b_pred_adj >= p.actual_adj_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0)))::numeric, 4)
  FROM bid_predictions p
  LEFT JOIN bid_records r ON r.id = p.matched_record_id
  WHERE p.match_status='matched' AND p.b_pred_mode='B'
    AND p.b_pred_adj IS NOT NULL AND p.actual_adj_rate IS NOT NULL AND p.b_pred_floor_pass_prob IS NOT NULL
    AND p.open_date BETWEEN p_since AND p_until AND p.at IS NOT NULL
    AND COALESCE(p.actual_winner,'') NOT IN ('유찰','유찰(무)')
    AND ABS(p.b_pred_adj - p.actual_adj_rate) <= 5
    AND p.created_at < p.matched_at
    AND p.matched_at < NOW() - (p_pred_min_age_hours || ' hours')::interval
    AND COALESCE(r.is_joint_contract, false) != true  -- m20 추가
  GROUP BY p.at
  HAVING COUNT(*) >= 3
  ON CONFLICT (measured_on, at, canonical_ag, model_version) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_inserted := v_inserted + v_rows;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION refresh_floor_pass_daily(DATE, DATE, TEXT, INT) IS
  'V2 Mode B calibration 일배치 (m20 — 공동도급 제외). matched_record_id JOIN으로 bid_records.is_joint_contract 필터. 근거: V2_DOMAIN_RULES_CHECK #7.';

GRANT EXECUTE ON FUNCTION refresh_floor_pass_daily(DATE, DATE, TEXT, INT) TO service_role;

-- refresh_win_zone_daily 재정의 (m15 + 공동도급 필터)
DROP FUNCTION IF EXISTS refresh_win_zone_daily(DATE, DATE);

CREATE OR REPLACE FUNCTION refresh_win_zone_daily(
  p_since DATE DEFAULT (CURRENT_DATE - INTERVAL '90 days')::date,
  p_until DATE DEFAULT CURRENT_DATE
)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE v_inserted INT := 0; v_rows INT;
BEGIN
  INSERT INTO win_zone_daily
    (measured_on, at, canonical_ag, n,
     pct_pass_floor, pct_pass_top1, pct_in_win_zone,
     avg_gap, median_gap, p90_gap)
  SELECT
    p_until, NULL::text, NULL::text,
    COUNT(*)::int,
    ROUND(100.0 * SUM(CASE WHEN d.my_bid_rate >= d.floor_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(100.0 * SUM(CASE WHEN d.my_bid_rate < d.win_bid_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(100.0 * SUM(CASE WHEN d.my_bid_rate >= d.floor_rate AND d.my_bid_rate < d.win_bid_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(AVG(d.win_bid_rate - d.floor_rate)::numeric, 4),
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.win_bid_rate - d.floor_rate)::numeric, 4),
    ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY d.win_bid_rate - d.floor_rate)::numeric, 4)
  FROM bid_details d
  LEFT JOIN bid_records r ON r.pn_no = d.pn_no
  WHERE d.my_bid_rate IS NOT NULL AND d.win_bid_rate IS NOT NULL AND d.floor_rate IS NOT NULL
    AND d.od BETWEEN p_since AND p_until
    AND COALESCE(r.is_joint_contract, false) != true  -- m20 추가
  HAVING COUNT(*) >= 5
  ON CONFLICT (measured_on, at, canonical_ag) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_inserted := v_inserted + v_rows;

  INSERT INTO win_zone_daily
    (measured_on, at, canonical_ag, n,
     pct_pass_floor, pct_pass_top1, pct_in_win_zone,
     avg_gap, median_gap, p90_gap)
  SELECT
    p_until, d.at, NULL::text,
    COUNT(*)::int,
    ROUND(100.0 * SUM(CASE WHEN d.my_bid_rate >= d.floor_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(100.0 * SUM(CASE WHEN d.my_bid_rate < d.win_bid_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(100.0 * SUM(CASE WHEN d.my_bid_rate >= d.floor_rate AND d.my_bid_rate < d.win_bid_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(AVG(d.win_bid_rate - d.floor_rate)::numeric, 4),
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.win_bid_rate - d.floor_rate)::numeric, 4),
    ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY d.win_bid_rate - d.floor_rate)::numeric, 4)
  FROM bid_details d
  LEFT JOIN bid_records r ON r.pn_no = d.pn_no
  WHERE d.my_bid_rate IS NOT NULL AND d.win_bid_rate IS NOT NULL AND d.floor_rate IS NOT NULL
    AND d.at IS NOT NULL AND d.od BETWEEN p_since AND p_until
    AND COALESCE(r.is_joint_contract, false) != true  -- m20 추가
  GROUP BY d.at
  HAVING COUNT(*) >= 3
  ON CONFLICT (measured_on, at, canonical_ag) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_inserted := v_inserted + v_rows;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION refresh_win_zone_daily(DATE, DATE) IS
  'V2 Mode A KPI 누적 (m20 — 공동도급 제외). pn_no JOIN으로 bid_records.is_joint_contract 필터. 근거: V2_DOMAIN_RULES_CHECK #7.';

GRANT EXECUTE ON FUNCTION refresh_win_zone_daily(DATE, DATE) TO service_role;
