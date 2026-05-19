-- m16: V2 Mode A cron 자동화 (B3.7)
-- 근거: docs/v2/HANDOFF_V2_MASTER_PLAN §4 B3+B5
-- ① 일간 win_zone_daily 적재 (매일 00:15 UTC, Mode B 일간 15분 후)
-- ② 주간 mode_gate_report Mode A 게이트 자동 판정 (매주 월 01:15 UTC)
-- gate_status (Mode A): pass(≥15%) / warn(10-15%) / fail(<10%) / insufficient_sample(n<10)
-- 적용: apply_migration (Supabase MCP), 2026-05-20

SELECT cron.schedule(
  'v2_modeA_daily_winzone',
  '15 0 * * *',
  $$ SELECT refresh_win_zone_daily(
       (CURRENT_DATE - INTERVAL '90 days')::date,
       CURRENT_DATE
     ); $$
);

SELECT cron.schedule(
  'v2_modeA_weekly_gate',
  '15 1 * * 1',
  $$ INSERT INTO mode_gate_report
       (report_week, at, mode, primary_kpi_name, kpi_value, kpi_target, gate_status, dual_run_n, notes)
     SELECT
       date_trunc('week', CURRENT_DATE)::date,
       at,
       'A',
       'pct_in_win_zone',
       (pct_in_win_zone / 100.0)::numeric(6,4),
       0.1500,
       CASE
         WHEN n < 10 THEN 'insufficient_sample'
         WHEN pct_in_win_zone >= 15.0 THEN 'pass'
         WHEN pct_in_win_zone >= 10.0 THEN 'warn'
         ELSE 'fail'
       END,
       n,
       'weekly cron auto Mode A — gap_p90=' || p90_gap::text || ' median=' || median_gap::text
     FROM win_zone_daily
     WHERE at = '군시설'
       AND measured_on = (
         SELECT MAX(measured_on) FROM win_zone_daily WHERE at = '군시설'
       )
     ON CONFLICT (report_week, at, mode) DO NOTHING; $$
);

-- 등록 해제 (필요 시):
-- SELECT cron.unschedule('v2_modeA_daily_winzone');
-- SELECT cron.unschedule('v2_modeA_weekly_gate');
