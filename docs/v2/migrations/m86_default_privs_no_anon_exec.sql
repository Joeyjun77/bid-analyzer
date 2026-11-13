-- m86: public 스키마 새 함수의 기본 실행 권한에서 anon(비로그인) 제거 (2026-11-13, 사용자 승인 "운영 정리 먼저")
-- 배경: m83에서 SECURITY DEFINER 함수 24개의 anon 실행 권한을 회수했지만, 기본 권한(pg_default_acl)이
--       postgres가 public에 만드는 새 함수마다 anon EXECUTE를 자동으로 붙였다 → 새 함수를 만들 때마다 같은 문제가 재발.
-- 조치: postgres 소유 새 함수의 기본 권한에서 anon EXECUTE를 뺀다. authenticated·service_role은 그대로.
--   기존 함수 권한은 바뀌지 않는다(기본 권한은 새로 만드는 객체에만 적용).
--   주의: 앞으로 로그인 전 화면에서 호출할 함수가 생기면 GRANT EXECUTE ... TO anon 을 명시해야 한다(현재 그런 함수 없음 — 앱은 로그인 뒤에만 RPC를 부른다).
--   1줄만으로는 부족했다(적용 직후 시험 함수 실측): PostgreSQL 내장 기본값이 함수에 PUBLIC EXECUTE를 붙이고 anon이 PUBLIC을
--   통해 실행할 수 있었다(proacl {=X/postgres,...}). 그래서 postgres 소유 새 함수의 PUBLIC 기본 권한도 뺀다(스키마 지정 없이 —
--   PUBLIC 회수는 스키마 단위로 할 수 없다). public 스키마의 authenticated·service_role 권한은 위 스키마 기본값이 계속 붙인다.
--   영향: postgres가 다른 스키마에 만드는 새 함수도 PUBLIC 실행이 빠진다(소유자·cron은 그대로, 트리거 실행은 EXECUTE 검사 없음).
-- 되돌리기:
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
