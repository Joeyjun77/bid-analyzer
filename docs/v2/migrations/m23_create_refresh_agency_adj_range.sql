-- m23: agency_mode_lookup의 adj_range_min/max를 실측 분위수(p01/p99)로 갱신
-- 근거: 코덱스 라운드 10 권고 #2 + 라운드 11 권고 #3
-- 정책:
--   - at-level: bid_predictions.actual_adj_rate p01/p99 (era_v2='current' 필터, |adj|≤5)
--   - AG grain: n≥20 시 발주사별 산출, 그 미만은 at-level 디폴트 유지
--   - 공동도급 제외 (G-도메인 #7)
--   - UPSERT만 (INSERT 정책 활용)
-- 적용: apply_migration (Supabase MCP), 2026-05-21

CREATE OR REPLACE FUNCTION refresh_agency_adj_range(
  p_min_n INT DEFAULT 20
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INT := 0;
  v_rows    INT;
BEGIN
  -- 1) at-level (canonical_ag=NULL, ba_seg=NULL) 갱신
  WITH stats AS (
    SELECT
      p.at,
      percentile_cont(0.01) WITHIN GROUP (ORDER BY p.actual_adj_rate)::numeric(4,2) AS p01,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY p.actual_adj_rate)::numeric(4,2) AS p99,
      COUNT(*) AS n
    FROM bid_predictions p
    LEFT JOIN bid_records r ON r.id = p.matched_record_id
    WHERE p.match_status='matched'
      AND p.actual_adj_rate IS NOT NULL
      AND p.actual_adj_rate BETWEEN -10 AND 10
      AND COALESCE(p.actual_winner,'') NOT IN ('유찰','유찰(무)')
      AND COALESCE(r.is_joint_contract, false) != true
    GROUP BY p.at
    HAVING COUNT(*) >= p_min_n
  )
  UPDATE agency_mode_lookup aml
  SET adj_range_min = stats.p01,
      adj_range_max = stats.p99,
      updated_at = NOW()
  FROM stats
  WHERE aml.at = stats.at
    AND aml.canonical_ag IS NULL
    AND aml.ba_seg IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_updated := v_updated + v_rows;

  -- 2) AG grain (canonical_ag IS NOT NULL, ba_seg=NULL) 갱신 (n>=20)
  WITH stats AS (
    SELECT
      p.at,
      p.ag AS canonical_ag,
      percentile_cont(0.01) WITHIN GROUP (ORDER BY p.actual_adj_rate)::numeric(4,2) AS p01,
      percentile_cont(0.99) WITHIN GROUP (ORDER BY p.actual_adj_rate)::numeric(4,2) AS p99,
      COUNT(*) AS n
    FROM bid_predictions p
    LEFT JOIN bid_records r ON r.id = p.matched_record_id
    WHERE p.match_status='matched'
      AND p.actual_adj_rate IS NOT NULL
      AND p.actual_adj_rate BETWEEN -10 AND 10
      AND COALESCE(p.actual_winner,'') NOT IN ('유찰','유찰(무)')
      AND COALESCE(r.is_joint_contract, false) != true
      AND p.ag IS NOT NULL
    GROUP BY p.at, p.ag
    HAVING COUNT(*) >= p_min_n
  )
  UPDATE agency_mode_lookup aml
  SET adj_range_min = stats.p01,
      adj_range_max = stats.p99,
      updated_at = NOW()
  FROM stats
  WHERE aml.at = stats.at
    AND aml.canonical_ag = stats.canonical_ag
    AND aml.ba_seg IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_updated := v_updated + v_rows;

  RETURN v_updated;
END;
$$;

COMMENT ON FUNCTION refresh_agency_adj_range(INT) IS
  'V2_DOMAIN_RULES_CHECK #6 — agency_mode_lookup adj_range 실측 분위수 갱신 (라운드 11 권고). at-level + AG grain (n>=p_min_n). 공동도급 제외 (G-도메인 #7).';

-- 1회 즉시 실행 (n>=20 기준)
SELECT refresh_agency_adj_range(20) AS rows_updated;
