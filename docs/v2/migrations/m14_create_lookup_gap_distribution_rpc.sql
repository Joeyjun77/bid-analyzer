-- m14: lookup_gap_distribution RPC (B3.2)
-- 근거: docs/v2/HANDOFF_V2_MASTER_PLAN §4 B3
-- agency_gap_distribution 3단계 fallback (AG_BA → AG → AT)
-- Mode A 군시설 한정 사용 — 다른 영역은 적재 안 됨 (Mode B만 사용)
-- 적용: apply_migration (Supabase MCP), 2026-05-20

CREATE OR REPLACE FUNCTION lookup_gap_distribution(
  p_at           TEXT,
  p_canonical_ag TEXT DEFAULT NULL,
  p_ba           NUMERIC DEFAULT NULL
)
RETURNS TABLE (
  matched_grain TEXT,
  n             INT,
  gap_mean      NUMERIC,
  gap_std       NUMERIC,
  gap_p10       NUMERIC,
  gap_p25       NUMERIC,
  gap_p50       NUMERIC,
  gap_p75       NUMERIC,
  gap_p90       NUMERIC,
  ci_low        NUMERIC,
  ci_high       NUMERIC
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_ba_seg TEXT;
BEGIN
  v_ba_seg := CASE
    WHEN p_ba IS NULL THEN NULL
    WHEN p_ba < 100000000   THEN 'S1'
    WHEN p_ba < 300000000   THEN 'S2'
    WHEN p_ba < 1000000000  THEN 'S3'
    WHEN p_ba < 3000000000  THEN 'S4'
    ELSE 'S5'
  END;

  -- 1단: AG_BA grain
  IF v_ba_seg IS NOT NULL AND p_canonical_ag IS NOT NULL THEN
    RETURN QUERY
      SELECT 'AG_BA'::text, d.n, d.gap_mean, d.gap_std, d.gap_p10, d.gap_p25, d.gap_p50, d.gap_p75, d.gap_p90, d.ci_low, d.ci_high
      FROM agency_gap_distribution d
      WHERE d.at = p_at AND d.canonical_ag = p_canonical_ag AND d.ba_seg = v_ba_seg
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- 2단: AG grain
  IF p_canonical_ag IS NOT NULL THEN
    RETURN QUERY
      SELECT 'AG'::text, d.n, d.gap_mean, d.gap_std, d.gap_p10, d.gap_p25, d.gap_p50, d.gap_p75, d.gap_p90, d.ci_low, d.ci_high
      FROM agency_gap_distribution d
      WHERE d.at = p_at AND d.canonical_ag = p_canonical_ag AND d.ba_seg IS NULL
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- 3단: AT-level fallback
  RETURN QUERY
    SELECT 'AT'::text, d.n, d.gap_mean, d.gap_std, d.gap_p10, d.gap_p25, d.gap_p50, d.gap_p75, d.gap_p90, d.ci_low, d.ci_high
    FROM agency_gap_distribution d
    WHERE d.at = p_at AND d.canonical_ag IS NULL AND d.ba_seg IS NULL
    LIMIT 1;
END;
$$;

COMMENT ON FUNCTION lookup_gap_distribution IS
  'V2 Mode A (군시설) 경쟁 gap 분포 RPC. 3단계 fallback: AG_BA → AG → AT. agency_gap_distribution 정적 캐시. 근거: HANDOFF_V2_MASTER_PLAN §4 B3, V2_MEASUREMENT_SPEC §7.';

GRANT EXECUTE ON FUNCTION lookup_gap_distribution(TEXT, TEXT, NUMERIC) TO anon, authenticated;
