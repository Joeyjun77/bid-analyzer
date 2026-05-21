-- m26: refresh_win_zone_daily 함수 era_v2 필터 추가 (G-도메인 #0 정합 회복)
-- 결함:
--   - 본체에 era_v2 필터 없음 → mixed (legacy + current) 데이터로 win-zone 측정
--   - 군시설 12.42% WARN의 mixed 영향이 함수 본체 결함
--   - G-도메인 #0 부분 위반 (era_v2 미사용 신규 SQL 금지)
-- 정정:
--   - bid_records LEFT JOIN ... + r.era_v2='current' 필터 추가
--   - 공동도급 제외 그대로 유지 (m20)
-- 영향:
--   - cron jobid 12(매일 00:15 UTC) 다음 실행부터 모든 영역 current-only 측정
--   - 군시설 win_zone_daily 5/22부터 current-only 기준
--   - jobid 13 weekly gate(매주 월 01:15)도 5/25부터 정합 기준
--   - predict-architect 검토: Evaluator 분류, /evaluate 면제, 핵심 영역 MAE 영향 없음
-- 적용: apply_migration, 2026-05-21

CREATE OR REPLACE FUNCTION refresh_win_zone_daily(
  p_since date DEFAULT ((CURRENT_DATE - '90 days'::interval))::date,
  p_until date DEFAULT CURRENT_DATE
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inserted INT := 0;
  v_rows     INT;
BEGIN
  -- 1) 전체 집계
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
    -- ★ 공동도급 제외 (m20)
    AND COALESCE(r.is_joint_contract, false) != true
    -- ★ era_v2='current' (m26)
    AND COALESCE(r.era_v2, 'current') = 'current'
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
    AND COALESCE(r.is_joint_contract, false) != true
    AND COALESCE(r.era_v2, 'current') = 'current'  -- m26
  GROUP BY d.at
  HAVING COUNT(*) >= 3
  ON CONFLICT (measured_on, at, canonical_ag) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_inserted := v_inserted + v_rows;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION refresh_win_zone_daily(date,date) IS
  'V2 Mode A WIN-zone 일별 측정 — 공동도급 제외 (m20) + era_v2=current (m26). G-도메인 #0·#7 정합.';

-- m26 적용: cron jobid 12 다음 실행 시 자동 반영. 즉시 효과 확인용 1회 수동 실행.
SELECT refresh_win_zone_daily() AS rows_updated;
