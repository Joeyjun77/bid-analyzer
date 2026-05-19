-- m19: lookup_gap_distribution RPC era_v2='current' 필터 (V2_DOMAIN_RULES_CHECK #0+#4)
-- 기존 m14 함수를 정정 — current 표본만 조회 (legacy/mixed 보존되나 운영 미사용)
-- 적용: apply_migration (Supabase MCP), 2026-05-20

CREATE OR REPLACE FUNCTION lookup_gap_distribution(
  p_at           TEXT,
  p_canonical_ag TEXT DEFAULT NULL,
  p_ba           NUMERIC DEFAULT NULL
)
RETURNS TABLE (
  matched_grain TEXT, n INT,
  gap_mean NUMERIC, gap_std NUMERIC,
  gap_p10 NUMERIC, gap_p25 NUMERIC, gap_p50 NUMERIC, gap_p75 NUMERIC, gap_p90 NUMERIC,
  ci_low NUMERIC, ci_high NUMERIC
)
LANGUAGE plpgsql STABLE
AS $$
DECLARE v_ba_seg TEXT;
BEGIN
  v_ba_seg := CASE
    WHEN p_ba IS NULL THEN NULL
    WHEN p_ba < 100000000   THEN 'S1'
    WHEN p_ba < 300000000   THEN 'S2'
    WHEN p_ba < 1000000000  THEN 'S3'
    WHEN p_ba < 3000000000  THEN 'S4'
    ELSE 'S5'
  END;

  IF v_ba_seg IS NOT NULL AND p_canonical_ag IS NOT NULL THEN
    RETURN QUERY
      SELECT 'AG_BA'::text, d.n, d.gap_mean, d.gap_std, d.gap_p10, d.gap_p25, d.gap_p50, d.gap_p75, d.gap_p90, d.ci_low, d.ci_high
      FROM agency_gap_distribution d
      WHERE d.at = p_at AND d.canonical_ag = p_canonical_ag AND d.ba_seg = v_ba_seg
        AND d.era_v2 = 'current'
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  IF p_canonical_ag IS NOT NULL THEN
    RETURN QUERY
      SELECT 'AG'::text, d.n, d.gap_mean, d.gap_std, d.gap_p10, d.gap_p25, d.gap_p50, d.gap_p75, d.gap_p90, d.ci_low, d.ci_high
      FROM agency_gap_distribution d
      WHERE d.at = p_at AND d.canonical_ag = p_canonical_ag AND d.ba_seg IS NULL
        AND d.era_v2 = 'current'
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  RETURN QUERY
    SELECT 'AT'::text, d.n, d.gap_mean, d.gap_std, d.gap_p10, d.gap_p25, d.gap_p50, d.gap_p75, d.gap_p90, d.ci_low, d.ci_high
    FROM agency_gap_distribution d
    WHERE d.at = p_at AND d.canonical_ag IS NULL AND d.ba_seg IS NULL
      AND d.era_v2 = 'current'
    LIMIT 1;
END;
$$;

COMMENT ON FUNCTION lookup_gap_distribution IS
  'V2 Mode A gap 분포 RPC — current 시대만 (m19 정정). 3단계 fallback: AG_BA → AG → AT. legacy/mixed row는 보존되나 미사용. 근거: V2_DOMAIN_RULES_CHECK #0+#4.';

GRANT EXECUTE ON FUNCTION lookup_gap_distribution(TEXT, TEXT, NUMERIC) TO anon, authenticated;
