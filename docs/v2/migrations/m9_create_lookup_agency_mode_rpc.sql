-- m9: lookup_agency_mode RPC — V2 Mode A/B 판정 3단계 fallback (B1)
-- 근거: docs/v2/HANDOFF_V2_MASTER_PLAN §4 B1, docs/v2/V2_MEASUREMENT_SPEC §7
-- LATERAL JOIN 금지 — 정적 캐시 lookup만
-- baSeg 분할: predictV5와 동일 (S1<1e8, S2<3e8, S3<1e9, S4<3e9, S5)
-- 적용: apply_migration (Supabase MCP), 2026-05-19

CREATE OR REPLACE FUNCTION lookup_agency_mode(
  p_at           TEXT,
  p_canonical_ag TEXT DEFAULT NULL,
  p_ba           NUMERIC DEFAULT NULL
)
RETURNS TABLE (
  matched_grain  TEXT,
  mode_recommend CHAR(1),
  confidence     TEXT,
  n              INT,
  median_gap     NUMERIC,
  p90_gap        NUMERIC
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
      SELECT 'AG_BA'::text, l.mode_recommend, l.confidence, l.n, l.median_gap, l.p90_gap
      FROM agency_mode_lookup l
      WHERE l.at = p_at
        AND l.canonical_ag = p_canonical_ag
        AND l.ba_seg = v_ba_seg
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- 2단: AG grain (ba_seg IS NULL)
  IF p_canonical_ag IS NOT NULL THEN
    RETURN QUERY
      SELECT 'AG'::text, l.mode_recommend, l.confidence, l.n, l.median_gap, l.p90_gap
      FROM agency_mode_lookup l
      WHERE l.at = p_at
        AND l.canonical_ag = p_canonical_ag
        AND l.ba_seg IS NULL
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- 3단: AT-level fallback (canonical_ag IS NULL AND ba_seg IS NULL)
  RETURN QUERY
    SELECT 'AT'::text, l.mode_recommend, l.confidence, l.n, l.median_gap, l.p90_gap
    FROM agency_mode_lookup l
    WHERE l.at = p_at
      AND l.canonical_ag IS NULL
      AND l.ba_seg IS NULL
    LIMIT 1;
END;
$$;

COMMENT ON FUNCTION lookup_agency_mode IS
  'V2 영역별 Mode A/B 판정 RPC. 3단계 fallback: AG_BA → AG → AT. LATERAL JOIN 미사용 (정적 캐시 lookup). baSeg 분할: S1<1e8, S2<3e8, S3<1e9, S4<3e9, S5. 근거: HANDOFF_V2_MASTER_PLAN §4 B1, V2_MEASUREMENT_SPEC §7.';

GRANT EXECUTE ON FUNCTION lookup_agency_mode(TEXT, TEXT, NUMERIC) TO anon, authenticated;
