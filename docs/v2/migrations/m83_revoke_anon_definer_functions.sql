-- m83: 로그인 없이 호출되던 SECURITY DEFINER 함수 24개의 실행 권한 회수 (2026-11-11, 사용자 승인 "권한 회수 진행")
-- 문제: 테이블은 RLS로 잠겨 있지만(읽기·쓰기 = 로그인 필요, 삭제 = 관리자), 소유자 권한으로 도는 함수 24개는
--       anon(비로그인)도 /rest/v1/rpc/… 로 호출 가능했다(11/11 실측: get_participant_pnnos·prepc_backfill_get 200).
--       그중 19개는 쓰기 — 예비가격 저장(upsert_prelim_sets_batch), 정리(weekly_db_cleanup), 예측 생성·재매칭 등.
-- 호출처 확인(11/11): cron은 postgres로 직접 실행 또는 invoke_edge_function(service_role JWT),
--   Edge Function(fn-collect-notices·fn-auto-predict·fn-collect-prepc 등)은 SUPABASE_SERVICE_ROLE_KEY,
--   앱은 로그인 사용자 JWT(authenticated)로 predict_notice·get_participant_* 3개·lookup_agency_mode(modeResolver.js)를 호출.
--   적용 후 로그인 앱에서 lookup_agency_mode 200(source=rpc)·get_participant_pnnos 200 실측.
-- 조치: PUBLIC·anon의 EXECUTE 회수. authenticated·service_role의 기존 명시적 권한은 그대로 둔다.
--   서버 전용 4개(prepc_backfill_get/report, upsert_prelim_sets_batch, weekly_db_cleanup)는 authenticated가
--   PUBLIC을 통해서만 실행할 수 있었으므로 이번에 함께 닫힌다(앱은 호출하지 않음).
-- 예측 산식 무관(권한만 변경). 되돌리기: m83_rollback.sql
DO $m$ DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'auto_predict_from_notices()', 'bp_divert_company_fields()',
    'get_participant_company_trace(text,text,integer)', 'get_participant_distribution(text,integer,numeric)', 'get_participant_pnnos()',
    'lookup_agency_mode(text,text,numeric)', 'mark_empty_duplicates()', 'match_pending_predictions()', 'predict_notice(bigint)',
    'prepc_backfill_get()', 'prepc_backfill_report(integer,bigint,boolean)', 're_predict_null_pending()',
    'refresh_agency_adj_range(integer)', 'refresh_agency_predictor()', 'refresh_amount_band_correction()',
    'refresh_floor_pass_daily(date,date,text,integer)', 'refresh_floor_rate_distribution()', 'refresh_floorerr_distribution()',
    'refresh_participant_count_distribution()', 'refresh_participant_dist()', 'refresh_weekly_quality_recent(integer,text)',
    'refresh_win_zone_daily(date,date)', 'upsert_prelim_sets_batch(jsonb)', 'weekly_db_cleanup()']
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', f);
  END LOOP;
END $m$;
