-- m28: near-floor exposure 가드 (하한 마진 밀집도)
-- 설계: docs/superpowers/specs/2026-05-24-near-floor-exposure-guard-design.md
-- 계획: docs/superpowers/plans/2026-05-24-near-floor-exposure-guard.md
-- bid_rate 공간 (my_bid_rate − floor_rate, pp). /evaluate G-단위 PASS. 예측 로직 무관.
-- 적용: Supabase apply_migration / execute_sql (service_role). 가산적·되돌리기 가능.
-- 순서: (1)(2) ALTER → (3) 함수 → (4) 최신행 활성화 → (5)(6) cron (execute_sql).

-- ── (1) win_zone_daily 컬럼 추가 ────────────────────────────
ALTER TABLE win_zone_daily
  ADD COLUMN IF NOT EXISTS near_floor_qual_n        int,
  ADD COLUMN IF NOT EXISTS pct_below_floor          numeric(6,2),
  ADD COLUMN IF NOT EXISTS pct_near_floor_001       numeric(6,2),
  ADD COLUMN IF NOT EXISTS pct_near_floor_003       numeric(6,2),
  ADD COLUMN IF NOT EXISTS pct_near_floor_005       numeric(6,2),
  ADD COLUMN IF NOT EXISTS floor_margin_avg_pp      numeric(10,6),
  ADD COLUMN IF NOT EXISTS floor_margin_median_pp   numeric(10,6),
  ADD COLUMN IF NOT EXISTS floor_margin_p10_pp      numeric(10,6),
  ADD COLUMN IF NOT EXISTS pct_floor_margin_neg_001 numeric(6,2);

-- ── (2) mode_gate_report 컬럼 추가 ──────────────────────────
ALTER TABLE mode_gate_report
  ADD COLUMN IF NOT EXISTS near_floor_pct_005      numeric(6,4),  -- 0~1 (kpi_value 스케일)
  ADD COLUMN IF NOT EXISTS near_floor_qual_n       int,
  ADD COLUMN IF NOT EXISTS near_floor_guard_status text
    CHECK (near_floor_guard_status IN ('pass','warn','insufficient_sample'));

-- ── (3) refresh_win_zone_daily 재정의 (near-floor 9컬럼 추가) ──
CREATE OR REPLACE FUNCTION public.refresh_win_zone_daily(
    p_since date DEFAULT ((CURRENT_DATE - '90 days'::interval))::date,
    p_until date DEFAULT CURRENT_DATE)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_inserted INT := 0;
  v_rows     INT;
BEGIN
  -- 슬라이스 1: overall (at=NULL)
  INSERT INTO win_zone_daily
    (measured_on, at, canonical_ag, n,
     pct_pass_floor, pct_pass_top1, pct_in_win_zone,
     avg_gap, median_gap, p90_gap,
     near_floor_qual_n, pct_below_floor,
     pct_near_floor_001, pct_near_floor_003, pct_near_floor_005,
     floor_margin_avg_pp, floor_margin_median_pp, floor_margin_p10_pp,
     pct_floor_margin_neg_001)
  SELECT
    p_until, NULL::text, NULL::text,
    COUNT(*)::int,
    ROUND(100.0 * SUM(CASE WHEN d.my_bid_rate >= d.floor_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(100.0 * SUM(CASE WHEN d.my_bid_rate < d.win_bid_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(100.0 * SUM(CASE WHEN d.my_bid_rate >= d.floor_rate AND d.my_bid_rate < d.win_bid_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(AVG(d.win_bid_rate - d.floor_rate)::numeric, 4),
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.win_bid_rate - d.floor_rate)::numeric, 4),
    ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY d.win_bid_rate - d.floor_rate)::numeric, 4),
    COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate >= 0)::int,
    ROUND(100.0 * COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate < 0)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(100.0 * COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate BETWEEN 0 AND 0.001)::numeric / NULLIF(COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate >= 0),0), 2),
    ROUND(100.0 * COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate BETWEEN 0 AND 0.003)::numeric / NULLIF(COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate >= 0),0), 2),
    ROUND(100.0 * COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate BETWEEN 0 AND 0.005)::numeric / NULLIF(COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate >= 0),0), 2),
    ROUND(AVG(d.my_bid_rate - d.floor_rate)::numeric, 6),
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.my_bid_rate - d.floor_rate)::numeric, 6),
    ROUND(PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY d.my_bid_rate - d.floor_rate)::numeric, 6),
    ROUND(100.0 * COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate < 0 AND d.my_bid_rate - d.floor_rate >= -0.001)::numeric / NULLIF(COUNT(*),0), 2)
  FROM bid_details d
  LEFT JOIN bid_records r ON r.pn_no = d.pn_no
  WHERE d.my_bid_rate IS NOT NULL AND d.win_bid_rate IS NOT NULL AND d.floor_rate IS NOT NULL
    AND d.od BETWEEN p_since AND p_until
    AND COALESCE(r.is_joint_contract, false) != true
    AND COALESCE(r.era_v2, 'current') = 'current'
    AND ABS(d.win_bid_rate - d.floor_rate) <= 5
    AND COALESCE(r.is_duplicate, false) = false
  HAVING COUNT(*) >= 5
  ON CONFLICT (measured_on, at, canonical_ag) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_inserted := v_inserted + v_rows;

  -- 슬라이스 2: per-at
  INSERT INTO win_zone_daily
    (measured_on, at, canonical_ag, n,
     pct_pass_floor, pct_pass_top1, pct_in_win_zone,
     avg_gap, median_gap, p90_gap,
     near_floor_qual_n, pct_below_floor,
     pct_near_floor_001, pct_near_floor_003, pct_near_floor_005,
     floor_margin_avg_pp, floor_margin_median_pp, floor_margin_p10_pp,
     pct_floor_margin_neg_001)
  SELECT
    p_until, d.at, NULL::text,
    COUNT(*)::int,
    ROUND(100.0 * SUM(CASE WHEN d.my_bid_rate >= d.floor_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(100.0 * SUM(CASE WHEN d.my_bid_rate < d.win_bid_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(100.0 * SUM(CASE WHEN d.my_bid_rate >= d.floor_rate AND d.my_bid_rate < d.win_bid_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(AVG(d.win_bid_rate - d.floor_rate)::numeric, 4),
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.win_bid_rate - d.floor_rate)::numeric, 4),
    ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY d.win_bid_rate - d.floor_rate)::numeric, 4),
    COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate >= 0)::int,
    ROUND(100.0 * COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate < 0)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(100.0 * COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate BETWEEN 0 AND 0.001)::numeric / NULLIF(COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate >= 0),0), 2),
    ROUND(100.0 * COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate BETWEEN 0 AND 0.003)::numeric / NULLIF(COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate >= 0),0), 2),
    ROUND(100.0 * COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate BETWEEN 0 AND 0.005)::numeric / NULLIF(COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate >= 0),0), 2),
    ROUND(AVG(d.my_bid_rate - d.floor_rate)::numeric, 6),
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.my_bid_rate - d.floor_rate)::numeric, 6),
    ROUND(PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY d.my_bid_rate - d.floor_rate)::numeric, 6),
    ROUND(100.0 * COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate < 0 AND d.my_bid_rate - d.floor_rate >= -0.001)::numeric / NULLIF(COUNT(*),0), 2)
  FROM bid_details d
  LEFT JOIN bid_records r ON r.pn_no = d.pn_no
  WHERE d.my_bid_rate IS NOT NULL AND d.win_bid_rate IS NOT NULL AND d.floor_rate IS NOT NULL
    AND d.at IS NOT NULL AND d.od BETWEEN p_since AND p_until
    AND COALESCE(r.is_joint_contract, false) != true
    AND COALESCE(r.era_v2, 'current') = 'current'
    AND ABS(d.win_bid_rate - d.floor_rate) <= 5
    AND COALESCE(r.is_duplicate, false) = false
  GROUP BY d.at
  HAVING COUNT(*) >= 3
  ON CONFLICT (measured_on, at, canonical_ag) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_inserted := v_inserted + v_rows;

  RETURN v_inserted;
END;
$function$;

-- ── (4) 최신 행 즉시 활성화 (ON CONFLICT DO NOTHING 우회) ──
DELETE FROM win_zone_daily WHERE measured_on = CURRENT_DATE;
SELECT refresh_win_zone_daily();

-- ── (5) cron 재정의: Mode A 주간 게이트 (near-floor 가드 A>40%) ──
-- execute_sql로 실행 (cron.schedule은 트랜잭션 밖 권장)
SELECT cron.unschedule('v2_modeA_weekly_gate');
SELECT cron.schedule(
  'v2_modeA_weekly_gate',
  '15 1 * * 1',
  $$ INSERT INTO mode_gate_report
       (report_week, at, mode, primary_kpi_name, kpi_value, kpi_target, gate_status, dual_run_n, notes,
        near_floor_pct_005, near_floor_qual_n, near_floor_guard_status)
     SELECT
       date_trunc('week', CURRENT_DATE)::date, at, 'A', 'pct_in_win_zone',
       (pct_in_win_zone / 100.0)::numeric(6,4), 0.1500,
       CASE
         WHEN n < 10 THEN 'insufficient_sample'
         WHEN pct_in_win_zone >= 15.0 AND near_floor_qual_n >= 30 AND pct_near_floor_005 > 40.0 THEN 'warn'
         WHEN pct_in_win_zone >= 15.0 THEN 'pass'
         WHEN pct_in_win_zone >= 10.0 THEN 'warn'
         ELSE 'fail'
       END,
       n,
       'weekly cron auto Mode A — gap_p90=' || p90_gap::text || ' nf005=' || COALESCE(pct_near_floor_005::text,'NA'),
       (pct_near_floor_005 / 100.0)::numeric(6,4), near_floor_qual_n,
       CASE WHEN near_floor_qual_n IS NULL OR near_floor_qual_n < 30 THEN 'insufficient_sample'
            WHEN pct_near_floor_005 > 40.0 THEN 'warn' ELSE 'pass' END
     FROM win_zone_daily
     WHERE at = '군시설'
       AND measured_on = (SELECT MAX(measured_on) FROM win_zone_daily WHERE at = '군시설')
     ON CONFLICT (report_week, at, mode) DO NOTHING; $$
);

-- ── (6) cron 재정의: Mode B 주간 게이트 (near-floor 가드 B>25%, win_zone 조인) ──
SELECT cron.unschedule('v2_modeB_weekly_gate');
SELECT cron.schedule(
  'v2_modeB_weekly_gate',
  '0 1 * * 1',
  $$ INSERT INTO mode_gate_report
       (report_week, at, mode, primary_kpi_name, kpi_value, kpi_target, gate_status, dual_run_n, notes,
        near_floor_pct_005, near_floor_qual_n, near_floor_guard_status)
     SELECT
       date_trunc('week', CURRENT_DATE)::date,
       COALESCE(fpd.at, '_overall_'), 'B', 'actual_floor_pass_rate',
       fpd.actual_floor_pass_rate, 0.9000,
       CASE
         WHEN fpd.n < 5 THEN 'insufficient_sample'
         WHEN fpd.actual_floor_pass_rate >= 0.90 AND wz.near_floor_qual_n >= 30 AND wz.pct_near_floor_005 > 25.0 THEN 'warn'
         WHEN fpd.actual_floor_pass_rate >= 0.90 THEN 'pass'
         WHEN fpd.actual_floor_pass_rate >= 0.80 THEN 'warn'
         ELSE 'fail'
       END,
       fpd.n,
       'weekly cron auto — gap=' || fpd.calibration_gap::text || ' nf005=' || COALESCE(wz.pct_near_floor_005::text,'NA'),
       (wz.pct_near_floor_005 / 100.0)::numeric(6,4), wz.near_floor_qual_n,
       CASE WHEN wz.near_floor_qual_n IS NULL OR wz.near_floor_qual_n < 30 THEN 'insufficient_sample'
            WHEN wz.pct_near_floor_005 > 25.0 THEN 'warn' ELSE 'pass' END
     FROM floor_pass_daily fpd
     LEFT JOIN win_zone_daily wz
       ON wz.at IS NOT DISTINCT FROM fpd.at
      AND wz.measured_on = (SELECT MAX(measured_on) FROM win_zone_daily)
     WHERE fpd.model_version = 'v2_modeB_real'
       AND fpd.measured_on = (SELECT MAX(measured_on) FROM floor_pass_daily WHERE model_version = 'v2_modeB_real')
     ON CONFLICT (report_week, at, mode) DO NOTHING; $$
);
