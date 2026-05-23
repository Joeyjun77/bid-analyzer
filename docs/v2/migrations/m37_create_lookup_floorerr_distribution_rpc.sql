-- m37: lookup_floorerr_distribution RPC — 군부대 Mode A Phase 1
-- 근거: A_MODE_A_MILITARY_WIN_DESIGN_2026-05-23 §4, §6
-- era 인자 필수(p_era 디폴트 'current' — 라이브 소비). 3단 fallback: AG_BA → AG → AT.
-- ba_seg 버킷은 lookup_gap_distribution(m14)과 동일 경계.
-- 적용: apply_migration (Supabase MCP), 2026-05-23

CREATE OR REPLACE FUNCTION lookup_floorerr_distribution(
  p_at           TEXT,
  p_canonical_ag TEXT    DEFAULT NULL,
  p_ba           NUMERIC DEFAULT NULL,
  p_era          TEXT    DEFAULT 'current'
)
RETURNS TABLE (
  matched_grain TEXT,
  era_v2        TEXT,
  n             INT,
  confidence    TEXT,
  floorerr_mean NUMERIC,
  floorerr_std  NUMERIC,
  floorerr_p10  NUMERIC,
  floorerr_p25  NUMERIC,
  floorerr_p50  NUMERIC,
  floorerr_p75  NUMERIC,
  floorerr_p80  NUMERIC,
  floorerr_p85  NUMERIC,
  floorerr_p90  NUMERIC,
  floorerr_p95  NUMERIC
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
      SELECT 'AG_BA'::text, d.era_v2, d.n, d.confidence,
             d.floorerr_mean, d.floorerr_std,
             d.floorerr_p10, d.floorerr_p25, d.floorerr_p50, d.floorerr_p75,
             d.floorerr_p80, d.floorerr_p85, d.floorerr_p90, d.floorerr_p95
      FROM floorerr_distribution d
      WHERE d.at = p_at AND d.canonical_ag = p_canonical_ag AND d.ba_seg = v_ba_seg AND d.era_v2 = p_era
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- 2단: AG grain
  IF p_canonical_ag IS NOT NULL THEN
    RETURN QUERY
      SELECT 'AG'::text, d.era_v2, d.n, d.confidence,
             d.floorerr_mean, d.floorerr_std,
             d.floorerr_p10, d.floorerr_p25, d.floorerr_p50, d.floorerr_p75,
             d.floorerr_p80, d.floorerr_p85, d.floorerr_p90, d.floorerr_p95
      FROM floorerr_distribution d
      WHERE d.at = p_at AND d.canonical_ag = p_canonical_ag AND d.ba_seg IS NULL AND d.era_v2 = p_era
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- 3단: AT-level fallback
  RETURN QUERY
    SELECT 'AT'::text, d.era_v2, d.n, d.confidence,
           d.floorerr_mean, d.floorerr_std,
           d.floorerr_p10, d.floorerr_p25, d.floorerr_p50, d.floorerr_p75,
           d.floorerr_p80, d.floorerr_p85, d.floorerr_p90, d.floorerr_p95
    FROM floorerr_distribution d
    WHERE d.at = p_at AND d.canonical_ag IS NULL AND d.ba_seg IS NULL AND d.era_v2 = p_era
    LIMIT 1;
END;
$$;

COMMENT ON FUNCTION lookup_floorerr_distribution IS
  '군부대 Mode A Phase 1 — floorErr 분포 RPC. 3단 fallback AG_BA→AG→AT, p_era 필수(디폴트 current, 라이브 소비). 근거: A_MODE_A_MILITARY_WIN_DESIGN_2026-05-23 §4·§6.';

GRANT EXECUTE ON FUNCTION lookup_floorerr_distribution(TEXT, TEXT, NUMERIC, TEXT) TO anon, authenticated;
