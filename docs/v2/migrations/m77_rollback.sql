-- m77 되돌리기: 순위 수집 cron 해제(테이블·함수는 m76_rollback.sql)
SELECT cron.unschedule('ranks_collect_0720kst');
