-- m84: 낙찰 결과 수집 cron(jobid 2) 조회 범위 8일 → 7일 (2026-11-12, 사용자 승인 "수정하고 실행")
-- 증상: 11/11·11/12 06:00 KST 결과 수집이 두 날 연속 0건. getOpengResultListInfoCnstwk·getScsbidListSttusCnstwk 모두
--       rc=07 "입력범위값 초과 에러". 11/10까지는 같은 폭(days=7 → 시작일 00:00~오늘 23:59, 달력 8일)이 통과했다.
-- 원인: 나라장터 API가 11/11부터 조회 범위를 7일 이하로 제한. 시험 호출(dry_run, 11/12 10시 KST):
--       days=7 거절 / days=6(달력 7일, total 2,124)·5·3·1 정상.
-- 수정: days 7 → 6. 나머지 인자는 그대로. 수집 구조(오래된 쪽부터 하루 1,000건)는 바뀌지 않는다.
-- 남는 구멍: 11/05 개찰분(API 행 1건뿐)은 새 창 밖이라 이 수정으로는 못 받는다 — 함수에 시작·종료일 지정이 필요(별도 작업).
-- 예측 산식 무관. 되돌리기: 아래 'days', 6 을 'days', 7 로 바꿔 실행.
SELECT cron.alter_job(
  job_id := 2,
  command := $c$
  SELECT public.invoke_edge_function(
    'fn-collect-results',
    jsonb_build_object('days', 6, 'fetch_details', true, 'detail_limit', 80, 'max_pages', 10)
  );
  $c$
);
