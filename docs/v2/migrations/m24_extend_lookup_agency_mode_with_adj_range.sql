-- m24: lookup_agency_mode RPC에 adj_range_min/max 반환 컬럼 추가
-- 근거: 코덱스 라운드 11 권고 #3 — m21 operational화. recommendV2 grid 동적 설정용.
-- 정책: 기존 6개 컬럼(matched_grain, mode_recommend, confidence, n, median_gap, p90_gap) + 2개 추가
-- 적용: apply_migration, 2026-05-21

CREATE OR REPLACE FUNCTION lookup_agency_mode(
  p_at TEXT,
  p_canonical_ag TEXT DEFAULT NULL,
  p_ba NUMERIC DEFAULT NULL
)
RETURNS TABLE(
  matched_grain TEXT,
  mode_recommend CHAR,
  confidence TEXT,
  n INT,
  median_gap NUMERIC,
  p90_gap NUMERIC,
  adj_range_min NUMERIC,
  adj_range_max NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ba_seg TEXT;
BEGIN
  -- BA segment 매핑 (V2_DDL_SPEC §1과 일치)
  v_ba_seg := CASE
    WHEN p_ba IS NULL THEN NULL
    WHEN p_ba < 100000000 THEN 'S1'
    WHEN p_ba < 300000000 THEN 'S2'
    WHEN p_ba < 500000000 THEN 'S3'
    WHEN p_ba < 1000000000 THEN 'S4'
    ELSE 'S5'
  END;

  -- 1) AG_BA grain 시도
  IF p_canonical_ag IS NOT NULL AND v_ba_seg IS NOT NULL THEN
    RETURN QUERY
    SELECT 'AG_BA'::TEXT,
           aml.mode_recommend, aml.confidence, aml.n, aml.median_gap, aml.p90_gap,
           aml.adj_range_min, aml.adj_range_max
    FROM agency_mode_lookup aml
    WHERE aml.at = p_at AND aml.canonical_ag = p_canonical_ag AND aml.ba_seg = v_ba_seg
    LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- 2) AG grain 시도
  IF p_canonical_ag IS NOT NULL THEN
    RETURN QUERY
    SELECT 'AG'::TEXT,
           aml.mode_recommend, aml.confidence, aml.n, aml.median_gap, aml.p90_gap,
           aml.adj_range_min, aml.adj_range_max
    FROM agency_mode_lookup aml
    WHERE aml.at = p_at AND aml.canonical_ag = p_canonical_ag AND aml.ba_seg IS NULL
    LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- 3) AT grain (canonical_ag=NULL, ba_seg=NULL) — 항상 fallback
  RETURN QUERY
  SELECT 'AT'::TEXT,
         aml.mode_recommend, aml.confidence, aml.n, aml.median_gap, aml.p90_gap,
         aml.adj_range_min, aml.adj_range_max
  FROM agency_mode_lookup aml
  WHERE aml.at = p_at AND aml.canonical_ag IS NULL AND aml.ba_seg IS NULL
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION lookup_agency_mode(TEXT, TEXT, NUMERIC) IS
  'V2 모드 판정 RPC (3단계 fallback AG_BA→AG→AT). m24 확장: adj_range_min/max 메타 반환 (라운드 11 권고).';
