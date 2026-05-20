-- m25: refresh_agency_adj_range 함수 결함 수정 (라운드 12 critical fix #2)
-- 결함:
--   - m23 원본은 era_v2='current' 필터 누락 → legacy/mixed 데이터 혼입
--   - |adj|≤5 명시 의도 vs BETWEEN -10 AND 10 불일치
--   - G-도메인 #0 위반 위험
-- 정정:
--   - bid_predictions JOIN bid_details d ON ... + d.era_v2='current' 필터 추가
--   - BETWEEN -10 AND 10 → ABS(actual_adj_rate) <= 5 정합
--   - 공동도급 제외 그대로 유지 (G-도메인 #7)
-- 적용: apply_migration, 2026-05-21

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
  -- 1) at-level (canonical_ag=NULL, ba_seg=NULL) 갱신 — current era + 공동도급 제외 + |adj|≤5
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
      AND ABS(p.actual_adj_rate) <= 5  -- m25 정정: BETWEEN -10 AND 10 → |adj|≤5
      AND COALESCE(p.actual_winner,'') NOT IN ('유찰','유찰(무)')
      AND COALESCE(r.is_joint_contract, false) != true
      AND COALESCE(r.era_v2, 'current') = 'current'  -- m25 정정: era_v2 필터
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

  -- 2) AG grain (canonical_ag IS NOT NULL, ba_seg=NULL) 갱신
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
      AND ABS(p.actual_adj_rate) <= 5
      AND COALESCE(p.actual_winner,'') NOT IN ('유찰','유찰(무)')
      AND COALESCE(r.is_joint_contract, false) != true
      AND COALESCE(r.era_v2, 'current') = 'current'
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
  'V2_DOMAIN_RULES_CHECK #6 — agency_mode_lookup adj_range 실측 분위수 갱신 (m25 정정: era_v2=current + |adj|≤5). 공동도급 제외 (G-도메인 #7), G-도메인 #0 정합.';
