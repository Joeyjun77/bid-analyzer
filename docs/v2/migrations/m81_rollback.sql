-- m81 되돌리기: 갱신 cron 해제 → m80_goyang_profile_beginner.sql을 다시 실행(goyang_profile을 요약 표 없이 직접 계산하던 상태로) → 요약 표 삭제
-- 순서 주의: 함수가 goyang_base를 읽는 동안에는 표를 지우지 말 것(SQL 함수라 의존성 검사가 없어 호출 시 오류가 난다).
SELECT cron.unschedule('goyang_base_refresh');
-- 여기서 m80_goyang_profile_beginner.sql 실행
DROP MATERIALIZED VIEW IF EXISTS public.goyang_base;
