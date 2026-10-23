-- m64d: G2B 양식 자동 수집 cron (2026-10-23)
-- 매일 07:00 KST(22:00 UTC) — 최근 7일 개찰 공고. 개찰결과 수집(jobid 2, 06:00 KST) 뒤.
SELECT cron.schedule('g2b_auto_daily_07kst', '0 22 * * *',
  $$ SELECT public.invoke_edge_function('fn-collect-g2b-sheet', jsonb_build_object('mode','daily','max_calls',300), 140000); $$);
-- 매일 05:15 KST(20:15 UTC) — 과거분(2026-04~). done 단계가 되면 호출 0으로 즉시 반환.
SELECT cron.schedule('g2b_auto_backfill_nightly', '15 20 * * *',
  $$ SELECT public.invoke_edge_function('fn-collect-g2b-sheet', jsonb_build_object('mode','backfill','max_calls',300), 140000); $$);

-- 2026-10-23 조정: 공고·면허 목록 한 쪽(999건)이 약 5초라 실행 1회(100s)에 ~20쪽. 과거분을 밤 00:00~06:59 KST에 20분마다,
-- 키 하루 한도 중 350회(daily 300 + 공고 수집 ~50)는 남겨 둔다.
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'g2b_auto_backfill_nightly'), schedule := '*/20 15-21 * * *',
  command := $$ SELECT public.invoke_edge_function('fn-collect-g2b-sheet', jsonb_build_object('mode','backfill','max_calls',300,'reserve',350), 140000); $$);
