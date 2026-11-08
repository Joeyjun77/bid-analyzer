-- m73 되돌리기: 새 객체만 지운다. 기존 테이블·함수는 m73이 바꾸지 않았다.
DROP VIEW IF EXISTS public.v_goyang_org_candidates;
DROP VIEW IF EXISTS public.v_goyang_notices;
DROP VIEW IF EXISTS public.v_goyang_records;
DROP TABLE IF EXISTS public.goyang_org_alias;
DROP TABLE IF EXISTS public.goyang_org_master;
