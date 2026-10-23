-- m64d: G2B 양식 자동 수집 cron (2026-10-23)
-- 매일 07:00 KST(22:00 UTC) — 최근 7일 개찰 공고. 개찰결과 수집(jobid 2, 06:00 KST) 뒤.
SELECT cron.schedule('g2b_auto_daily_07kst', '0 22 * * *',
  $$ SELECT public.invoke_edge_function('fn-collect-g2b-sheet', jsonb_build_object('mode','daily','max_calls',300), 140000); $$);
-- 매일 05:15 KST(20:15 UTC) — 과거분(2026-04~). done 단계가 되면 호출 0으로 즉시 반환.
SELECT cron.schedule('g2b_auto_backfill_nightly', '15 20 * * *',
  $$ SELECT public.invoke_edge_function('fn-collect-g2b-sheet', jsonb_build_object('mode','backfill','max_calls',300), 140000); $$);
