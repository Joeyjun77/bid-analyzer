-- m29: refresh_win_zone_daily 함수 outlier sanity check 추가
-- 결함:
--   - bid_details.win_bid_rate 입력 오류 row가 win_zone_daily 측정값을 단독으로 왜곡
--   - 발견 사례: id=348193 / pn_no=202603935 (한국도로공사 광지원터널 전기공사)
--     win_bid_rate=66.4059 vs floor_rate=88.745 → gap=-22.3391pp (정상 ±1pp 수준 대비 22배 outlier)
--     이 1건이 m26 win_zone_daily 지자체 p90_gap 0.2345 측정값을 단독으로 끌어올림
--   - JIJACHE_MODE_A_REVIEW §2.3 outlier 추적 + M28_APPLY_RESULT §4.2 후속
-- 정정 (옵션 B — predict-architect 권고):
--   - WHERE 절 2곳 (전체 집계, at별 집계)에 sanity check 추가
--   - ABS(d.win_bid_rate - d.floor_rate) <= 5 (정상 데이터 ±1pp 대비 안전 마진 3.91pp)
--   - m25 ABS(actual_adj_rate) <= 5와 수치 일관성 (다른 공간, 동일 임계 패턴)
-- 영향 분류 (predict-architect):
--   - Evaluator (m25/m26 패턴 동일, 예측 산출 함수 무수정)
--   - 핵심 영역 MAE 영향: PASS (한전·고양시·군부대 모두 0건 미통과)
--   - 90일 전체 n=199, n_fail=1 (0.50%) → 미세 영향
--   - 정상 최대 gap = 1.0860pp (성남시 분당구) → ±5pp 임계 안전
--   - /evaluate 면제 가능 (조건부: 사전 SELECT + 사후 비교)
-- 적용: apply_migration, 2026-05-21

-- 사전 SELECT (baseline) — 마이그레이션 적용 전 확인:
-- SELECT COUNT(*) FROM bid_details d
-- WHERE d.my_bid_rate IS NOT NULL AND d.win_bid_rate IS NOT NULL AND d.floor_rate IS NOT NULL
--   AND ABS(d.win_bid_rate - d.floor_rate) > 5
--   AND d.od >= (CURRENT_DATE - INTERVAL '90 days')::date;
-- 예상: 1건 (id=348193, gap=-22.3391)

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
    AND COALESCE(r.is_joint_contract, false) != true
    AND COALESCE(r.era_v2, 'current') = 'current'
    -- ★ m29 sanity check: |win - floor| ≤ 5pp (outlier 자동 차단)
    AND ABS(d.win_bid_rate - d.floor_rate) <= 5
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
    AND COALESCE(r.era_v2, 'current') = 'current'
    AND ABS(d.win_bid_rate - d.floor_rate) <= 5  -- m29 sanity check
  GROUP BY d.at
  HAVING COUNT(*) >= 3
  ON CONFLICT (measured_on, at, canonical_ag) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_inserted := v_inserted + v_rows;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION refresh_win_zone_daily(date,date) IS
  'V2 Mode A WIN-zone 일별 측정 — 공동도급 제외 (m20) + era_v2=current (m26) + outlier sanity check ABS(win-floor)≤5 (m29). G-도메인 #0·#7 정합 + 입력 오류 자동 차단.';

-- m29 적용: 즉시 재측정으로 outlier 차단 효과 확인
SELECT refresh_win_zone_daily() AS rows_updated;
