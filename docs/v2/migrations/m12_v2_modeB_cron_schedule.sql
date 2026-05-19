-- m12: V2 Mode B dual-run cron 자동화 (B5)
-- 근거: docs/v2/HANDOFF_V2_MASTER_PLAN §4 B5, 코덱스 라운드 5 권고 #2 대응
-- pg_cron extension 사용 (Supabase 1.6.4 활성화 확인됨)
-- 적용: apply_migration (Supabase MCP), 2026-05-19

-- ① 일간 calibration: refresh_floor_pass_daily 매일 00:00 UTC (09:00 KST)
-- 최근 30일 window + window 분리(24h)로 자기충족예언 방지
SELECT cron.schedule(
  'v2_modeB_daily_calibration',
  '0 0 * * *',
  $$ SELECT refresh_floor_pass_daily(
       (CURRENT_DATE - INTERVAL '30 days')::date,
       CURRENT_DATE,
       'v2_modeB_real',
       24
     ); $$
);

-- ② 주간 게이트: mode_gate_report 매주 월요일 01:00 UTC (10:00 KST)
-- 가장 최근 floor_pass_daily 측정값 기반 자동 게이트 판정
-- gate_status: pass(≥90%) / warn(80-90%) / fail(<80%) / insufficient_sample(n<5)
SELECT cron.schedule(
  'v2_modeB_weekly_gate',
  '0 1 * * 1',
  $$ INSERT INTO mode_gate_report
       (report_week, at, mode, primary_kpi_name, kpi_value, kpi_target, gate_status, dual_run_n, notes)
     SELECT
       date_trunc('week', CURRENT_DATE)::date,
       COALESCE(at, '_overall_'),
       'B',
       'actual_floor_pass_rate',
       actual_floor_pass_rate,
       0.9000,
       CASE
         WHEN n < 5 THEN 'insufficient_sample'
         WHEN actual_floor_pass_rate >= 0.90 THEN 'pass'
         WHEN actual_floor_pass_rate >= 0.80 THEN 'warn'
         ELSE 'fail'
       END,
       n,
       'weekly cron auto — gap=' || calibration_gap::text || ' pred=' || pred_floor_pass_prob_avg::text
     FROM floor_pass_daily
     WHERE model_version='v2_modeB_real'
       AND measured_on = (
         SELECT MAX(measured_on) FROM floor_pass_daily WHERE model_version='v2_modeB_real'
       )
     ON CONFLICT (report_week, at, mode) DO NOTHING; $$
);

-- 등록된 job 확인 쿼리 (검증용)
-- SELECT jobid, schedule, jobname, active FROM cron.job WHERE jobname LIKE 'v2_modeB%';
--
-- 등록 해제 (필요 시):
-- SELECT cron.unschedule('v2_modeB_daily_calibration');
-- SELECT cron.unschedule('v2_modeB_weekly_gate');
