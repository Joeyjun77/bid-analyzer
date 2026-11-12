-- m85 되돌리기 순서(함수가 새 뷰를 읽는 동안 뷰를 지우면 호출이 실패한다 — SQL 함수라 의존성 검사가 없음):
-- 1) cron 원복
SELECT cron.unschedule('goyang_open_refresh');
SELECT cron.alter_job(job_id := 34, command := 'REFRESH MATERIALIZED VIEW CONCURRENTLY public.goyang_base');
-- 2) goyang_profile을 m85 이전 정의로: m80_goyang_profile_beginner.sql → m81_goyang_base_mv.sql의 DO 블록 → m82_goyang_profile_vals.sql 순으로 실행
--    (m81의 CREATE MATERIALIZED VIEW·cron.schedule 부분은 이미 있으므로 건너뛴다)
-- 3) 새 뷰 삭제
DROP MATERIALIZED VIEW IF EXISTS public.goyang_rank_notice;
DROP MATERIALIZED VIEW IF EXISTS public.goyang_anchor;
DROP MATERIALIZED VIEW IF EXISTS public.goyang_open;
