-- m15: refresh_win_zone_daily — V2 Mode A KPI 누적 함수 (B3.6)
-- 근거: docs/v2/HANDOFF_V2_MASTER_PLAN §4 B3+B5, docs/v2/V2_MEASUREMENT_SPEC §1
-- 정의: WIN-zone = floor_rate ≤ my_bid_rate < win_bid_rate (bid_rate 공간)
-- 데이터 출처: bid_details (자사 참여 데이터)
-- A안 INSERT-only — ON CONFLICT DO NOTHING
-- 적용: apply_migration (Supabase MCP), 2026-05-20

CREATE OR REPLACE FUNCTION refresh_win_zone_daily(
  p_since DATE DEFAULT (CURRENT_DATE - INTERVAL '90 days')::date,
  p_until DATE DEFAULT CURRENT_DATE
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
  INSERT INTO win_zone_daily
    (measured_on, at, canonical_ag, n,
     pct_pass_floor, pct_pass_top1, pct_in_win_zone,
     avg_gap, median_gap, p90_gap)
  SELECT
    p_until, NULL::text, NULL::text,
    COUNT(*)::int,
    ROUND(100.0 * SUM(CASE WHEN my_bid_rate >= floor_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(100.0 * SUM(CASE WHEN my_bid_rate < win_bid_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(100.0 * SUM(CASE WHEN my_bid_rate >= floor_rate AND my_bid_rate < win_bid_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(AVG(win_bid_rate - floor_rate)::numeric, 4),
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY win_bid_rate - floor_rate)::numeric, 4),
    ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY win_bid_rate - floor_rate)::numeric, 4)
  FROM bid_details
  WHERE my_bid_rate IS NOT NULL AND win_bid_rate IS NOT NULL AND floor_rate IS NOT NULL
    AND od BETWEEN p_since AND p_until
  HAVING COUNT(*) >= 5
  ON CONFLICT (measured_on, at, canonical_ag) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_inserted := v_inserted + v_rows;

  -- 2) at별 집계
  INSERT INTO win_zone_daily
    (measured_on, at, canonical_ag, n,
     pct_pass_floor, pct_pass_top1, pct_in_win_zone,
     avg_gap, median_gap, p90_gap)
  SELECT
    p_until, at, NULL::text,
    COUNT(*)::int,
    ROUND(100.0 * SUM(CASE WHEN my_bid_rate >= floor_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(100.0 * SUM(CASE WHEN my_bid_rate < win_bid_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(100.0 * SUM(CASE WHEN my_bid_rate >= floor_rate AND my_bid_rate < win_bid_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(AVG(win_bid_rate - floor_rate)::numeric, 4),
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY win_bid_rate - floor_rate)::numeric, 4),
    ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY win_bid_rate - floor_rate)::numeric, 4)
  FROM bid_details
  WHERE my_bid_rate IS NOT NULL AND win_bid_rate IS NOT NULL AND floor_rate IS NOT NULL
    AND at IS NOT NULL AND od BETWEEN p_since AND p_until
  GROUP BY at
  HAVING COUNT(*) >= 3
  ON CONFLICT (measured_on, at, canonical_ag) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_inserted := v_inserted + v_rows;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION refresh_win_zone_daily IS
  'V2 Mode A KPI 누적 (B3.6). bid_details 자사 참여 데이터로 WIN-zone 진입률 산출. A안 INSERT-only. 운용 주체: service_role. 근거: HANDOFF_V2_MASTER_PLAN §4 B3+B5, V2_MEASUREMENT_SPEC §1.';

GRANT EXECUTE ON FUNCTION refresh_win_zone_daily(DATE, DATE) TO service_role;
