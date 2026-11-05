-- m69 롤백: 수집 실패 감지 뷰 제거. 다른 객체가 의존하지 않는다.
DROP VIEW IF EXISTS public.v_collect_health;
