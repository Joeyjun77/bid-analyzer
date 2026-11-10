-- m83 되돌리기: 24개 함수의 실행 권한을 m83 이전 상태로(PUBLIC·anon 실행 가능)
-- get_participant_* 3개는 원래 PUBLIC 권한이 없었으므로 anon만 되돌린다.
DO $m$ DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'get_participant_company_trace(text,text,integer)', 'get_participant_distribution(text,integer,numeric)', 'get_participant_pnnos()']
  LOOP EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO anon', f); END LOOP;
  -- 원래 PUBLIC만 있고 anon 명시 권한은 없던 서버 전용 4개
  FOREACH f IN ARRAY ARRAY[
    'prepc_backfill_get()', 'prepc_backfill_report(integer,bigint,boolean)', 'upsert_prelim_sets_batch(jsonb)', 'weekly_db_cleanup()']
  LOOP EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO PUBLIC', f); END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'auto_predict_from_notices()', 'bp_divert_company_fields()', 'lookup_agency_mode(text,text,numeric)', 'mark_empty_duplicates()',
    'match_pending_predictions()', 'predict_notice(bigint)', 're_predict_null_pending()', 'refresh_agency_adj_range(integer)',
    'refresh_agency_predictor()', 'refresh_amount_band_correction()', 'refresh_floor_pass_daily(date,date,text,integer)',
    'refresh_floor_rate_distribution()', 'refresh_floorerr_distribution()', 'refresh_participant_count_distribution()',
    'refresh_participant_dist()', 'refresh_weekly_quality_recent(integer,text)', 'refresh_win_zone_daily(date,date)']
  LOOP EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO PUBLIC, anon', f); END LOOP;
END $m$;
