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

-- 2026-10-23 임시: 카운터 초기화(15:05 UTC) 전까지 남은 키 한도로 과거분을 앞당긴다(10/23 16:00~23:58 KST, 2분 간격, 60회 남김).
-- 10/23에만 도는 일정. 과거분이 끝나면 cron.unschedule('g2b_auto_backfill_daytime_20261023')로 지운다.
SELECT cron.schedule('g2b_auto_backfill_daytime_20261023', '*/2 7-14 23 10 *',
  $$ SELECT public.invoke_edge_function('fn-collect-g2b-sheet', jsonb_build_object('mode','backfill','max_calls',300,'reserve',60), 140000); $$);

-- 2026-10-24 정정: 키 사용 카운터(api_key_config.calls_today)는 get_api_key()가 UTC 날짜 바뀔 때(00:00 UTC = 09:00 KST) 0으로 돌린다.
-- 위의 '15:05 UTC 초기화' 가정은 틀렸다. 15~21 UTC 백필은 전날 카운터가 쌓인 상태라 남은 수 ≤ 예약분(350)이 되어 10/23 밤 전 실행이 호출 0으로 끝났다.
-- 백필을 카운터 초기화 직후(00~12 UTC = 09~21 KST)로 옮긴다. daily(22:00 UTC)는 같은 UTC 날 뒤쪽이라 예약분 350이 그대로 지킨다.
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'g2b_auto_backfill_nightly'), schedule := '*/20 0-12 * * *');
SELECT cron.unschedule('g2b_auto_backfill_daytime_20261023'); -- 10/23 전용 임시 일정 만료
