-- m67: api_collection_rules·api_ingestion_log의 anon 전체 권한 차단 (2026-11-05, 사용자 승인)
-- 문제: anon ALL(true) 정책으로 앱에 공개된 키만으로 수집 규칙·수집 로그를 읽고 고치고 지울 수 있었다.
-- 의존성 확인: 수집 Edge Function은 서비스 키로 RPC만 호출, upsert_bid_notice·log_api_ingestion은 SECDEF(소유자 RLS 우회),
--   앱 코드는 두 테이블 미사용, 24시간 로그에 직접 요청 0건.
-- 유지: rules_service(service_role), rules_select_own·rules_write_own(authenticated).
-- 되돌리기: m67_rollback.sql
DROP POLICY IF EXISTS anon_all_rules ON public.api_collection_rules;
DROP POLICY IF EXISTS anon_all_api_log ON public.api_ingestion_log;
REVOKE ALL ON TABLE public.api_collection_rules FROM anon;
REVOKE ALL ON TABLE public.api_ingestion_log FROM anon;
