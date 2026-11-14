-- m87: 참여업체 원시행 90일 정리를 '업로드 시각'에서 '개찰일' 기준으로도 지우게 바꾼다 (2026-11-14, 사용자 승인 "1단계 진행")
-- 배경: weekly_db_cleanup이 bid_participants를 created_at(업로드 시각) 90일로만 지웠다.
--       11/8 SUCVIEW 재업로드(156건)가 시계를 리셋해, 개찰 90일 지난 327공고 92만 행(원시의 95%)이 남았다.
--       DB 781MB, 무료 요금제 한도 500MB 초과.
-- 조치: 두 기준 중 하나라도 맞고 participant_dist_meta(영구 분포층)가 있는 공고만 지운다.
--   ① 기존: 업로드 90일 경과(created_at) — 날짜를 모르는 고아 공고는 이 기준으로만 정리된다
--   ② 신규: 개찰 90일 경과(bid_records의 해당 pn_no 최신 od)
--   분포 그래프는 participant_dist에서 읽어 영향 없음. 경쟁사 추적(company_trace)은 원래 설계대로 최근 90일 공고만.
--   CREATE OR REPLACE라 m83/m86에서 정리한 실행 권한은 그대로 유지된다.
-- 1회 정리: 적용 직후 같은 DELETE ②를 수동 실행 + VACUUM FULL bid_participants (DELETE만으로는 용량이 줄지 않는다).
-- 되돌리기: 아래 함수에서 '② 개찰 90일' DELETE 블록을 빼고 v_part2 관련 부분을 지운 m48 정의로 재생성.
--   (지운 원시행은 되돌릴 수 없다 — 원본 SUCVIEW 파일 재업로드로만 복구, 분포는 participant_dist에 보존)
CREATE OR REPLACE FUNCTION public.weekly_db_cleanup()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net', 'cron'
AS $function$
DECLARE
  v_raw int; v_raw_nt int; v_part int; v_part2 int; v_net int; v_cron int;
BEGIN
  -- 기존: 전체 raw_json 90일
  UPDATE public.bid_notices SET raw_json = NULL
  WHERE raw_json IS NOT NULL
    AND COALESCE(api_fetched_at, created_at) < now() - interval '90 days';
  GET DIAGNOSTICS v_raw = ROW_COUNT;

  -- m48-①: 비대상 공고는 개찰 30일 경과 시 raw_json 조기 정리
  UPDATE public.bid_notices SET raw_json = NULL
  WHERE raw_json IS NOT NULL AND is_target = false
    AND od IS NOT NULL AND od < now() - interval '30 days';
  GET DIAGNOSTICS v_raw_nt = ROW_COUNT;

  -- m48-②: 참여 원시행 90일 윈도우 (meta에 구워진 공고만 — 영구층 보장 후 prune)
  DELETE FROM public.bid_participants bp
  WHERE bp.created_at < now() - interval '90 days'
    AND EXISTS (SELECT 1 FROM public.participant_dist_meta m WHERE m.pn_no = bp.pn_no);
  GET DIAGNOSTICS v_part = ROW_COUNT;

  -- m87: 개찰 90일 경과 공고도 정리 (재업로드로 created_at이 새로 찍혀도 남지 않게)
  DELETE FROM public.bid_participants bp
  USING (
    SELECT d.pn_no FROM (SELECT DISTINCT pn_no FROM public.bid_participants) d
    WHERE EXISTS (SELECT 1 FROM public.participant_dist_meta m WHERE m.pn_no = d.pn_no)
      AND (SELECT max(r.od) FROM public.bid_records r WHERE r.pn_no = d.pn_no) < CURRENT_DATE - 90
  ) old
  WHERE bp.pn_no = old.pn_no;
  GET DIAGNOSTICS v_part2 = ROW_COUNT;

  DELETE FROM net._http_response WHERE created < now() - interval '2 days';
  GET DIAGNOSTICS v_net = ROW_COUNT;

  DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days';
  GET DIAGNOSTICS v_cron = ROW_COUNT;

  RETURN format('raw_json90=%s raw_json_nontarget30=%s participants_pruned=%s participants_pruned_open90=%s net=%s cron=%s',
                v_raw, v_raw_nt, v_part, v_part2, v_net, v_cron);
END;
$function$;
