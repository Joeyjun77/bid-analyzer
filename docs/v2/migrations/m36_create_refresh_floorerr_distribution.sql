-- m36: refresh_floorerr_distribution() — 군부대 Mode A Phase 1 floorErr 적재
-- 근거: A_MODE_A_MILITARY_WIN_DESIGN_2026-05-23 §3~§6
-- 소스: 매칭 bid_predictions 라이브 출력 (predict_v6가 그 시점 산출 = 설계 §5 동일 캘리브레이션)
-- predicted_floor = pred_expected_price × pred_floor_rate/100 (마진 제거)
-- 필터: 군시설(classify_agency_type) + 공동도급 제외(G-도메인#7) + 유찰 제외 + |floorErr|≤0.10
-- grain: 군부대-전체(canonical_ag=NULL, ba_seg=NULL), era별 1행. UPSERT.
-- 적용: apply_migration (Supabase MCP), 2026-05-23

CREATE OR REPLACE FUNCTION refresh_floorerr_distribution()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INT := 0;
BEGIN
  WITH base AS (
    SELECT br.era_v2,
           (br.floor_price - bp.pred_expected_price * bp.pred_floor_rate / 100.0) / NULLIF(bp.ba,0) AS floor_err
    FROM bid_predictions bp
    JOIN bid_records br ON br.id = bp.matched_record_id
    WHERE bp.match_status = 'matched'
      AND bp.actual_adj_rate IS NOT NULL
      AND classify_agency_type(bp.ag) = '군시설'
      AND bp.pred_expected_price IS NOT NULL
      AND bp.pred_floor_rate IS NOT NULL
      AND br.floor_price IS NOT NULL
      AND bp.ba IS NOT NULL
      AND COALESCE(bp.actual_winner,'') NOT IN ('유찰','유찰(무)')
      AND COALESCE(br.is_joint_contract, false) != true
      AND br.era_v2 IS NOT NULL
  ),
  filt AS (
    SELECT * FROM base WHERE abs(floor_err) <= 0.10
  ),
  agg AS (
    SELECT
      era_v2,
      count(*) AS n,
      avg(floor_err)::numeric(9,6)                                        AS m_mean,
      stddev_samp(floor_err)::numeric(9,6)                                AS m_std,
      percentile_cont(0.10) WITHIN GROUP (ORDER BY floor_err)::numeric(9,6) AS m_p10,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY floor_err)::numeric(9,6) AS m_p25,
      percentile_cont(0.50) WITHIN GROUP (ORDER BY floor_err)::numeric(9,6) AS m_p50,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY floor_err)::numeric(9,6) AS m_p75,
      percentile_cont(0.80) WITHIN GROUP (ORDER BY floor_err)::numeric(9,6) AS m_p80,
      percentile_cont(0.85) WITHIN GROUP (ORDER BY floor_err)::numeric(9,6) AS m_p85,
      percentile_cont(0.90) WITHIN GROUP (ORDER BY floor_err)::numeric(9,6) AS m_p90,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY floor_err)::numeric(9,6) AS m_p95
    FROM filt
    GROUP BY era_v2
  )
  INSERT INTO floorerr_distribution
    (at, canonical_ag, ba_seg, era_v2, n,
     floorerr_mean, floorerr_std,
     floorerr_p10, floorerr_p25, floorerr_p50, floorerr_p75, floorerr_p80, floorerr_p85, floorerr_p90, floorerr_p95,
     confidence, src, updated_at)
  SELECT
    '군시설', NULL, NULL, era_v2, n,
    m_mean, m_std,
    m_p10, m_p25, m_p50, m_p75, m_p80, m_p85, m_p90, m_p95,
    CASE WHEN n >= 1000 THEN 'high' WHEN n >= 300 THEN 'medium' ELSE 'insufficient_sample' END,
    'live_matched_margin_removed', NOW()
  FROM agg
  ON CONFLICT (at, canonical_ag, ba_seg, era_v2) DO UPDATE SET
    n            = EXCLUDED.n,
    floorerr_mean= EXCLUDED.floorerr_mean,
    floorerr_std = EXCLUDED.floorerr_std,
    floorerr_p10 = EXCLUDED.floorerr_p10,
    floorerr_p25 = EXCLUDED.floorerr_p25,
    floorerr_p50 = EXCLUDED.floorerr_p50,
    floorerr_p75 = EXCLUDED.floorerr_p75,
    floorerr_p80 = EXCLUDED.floorerr_p80,
    floorerr_p85 = EXCLUDED.floorerr_p85,
    floorerr_p90 = EXCLUDED.floorerr_p90,
    floorerr_p95 = EXCLUDED.floorerr_p95,
    confidence   = EXCLUDED.confidence,
    src          = EXCLUDED.src,
    updated_at   = NOW();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION refresh_floorerr_distribution() IS
  '군부대 Mode A Phase 1 — floorErr 분포 적재. 매칭 bid_predictions 라이브 출력 기반(설계 §5 동일 캘리브레이션). era별 군부대-전체 grain UPSERT. 근거: A_MODE_A_MILITARY_WIN_DESIGN_2026-05-23 §3~§6.';

-- 1회 즉시 실행
SELECT refresh_floorerr_distribution() AS rows_upserted;
