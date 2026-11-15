-- m89: DB 용량 3단계 정리 (2026-11-15, 사용자 승인 "1·3번 먼저 진행") — m88 뒤 503MiB, 무료 한도 0.5GB(약 477MiB)
-- ① bid_notices.raw_json(공고 API 원본 응답, 1.8만 행·41MB)을 읽는 곳이 쓰는 두 값만 남긴다.
--    읽는 곳: g2b_auto_candidates 하나 — raw_json->>'mainCnsttyNm', raw_json->>'sucsfbidLwltRate'만 쓴다
--    (없으면 g2b_auto_notice_meta 값으로 대체). v_goyang_notices는 열을 넘기기만 하고, 이를 읽는 rank_targets·goyang_open은
--    raw_json을 쓰지 않는다. 앱·Edge 함수 코드에도 raw_json 사용처 없음(2026-11-15 grep).
--    upsert_bid_notice가 앞으로도 두 값만 저장하도록 바꾸고, 기존 행도 같은 모양으로 줄인다. 두 값 다 없으면 NULL.
--    잃는 것: 그 밖의 원본 응답 항목(되돌릴 수 없음 — 필요하면 그때부터 다시 저장).
-- ② 소소한 정리
--    - idx_bid_records_pn_no 삭제: 같은 열의 idx_bid_records_pn_no_pattern(text_pattern_ops)이 = 조회도 처리한다.
--    - api_ingestion_log 90일 경과 행 삭제 + weekly_db_cleanup에 같은 정리 추가 (v_collect_health 15일, rank_targets 2시간만 본다).
--    - snap20260923_erav2_null_ids(9/23 era_v2 작업용 일회용 스냅샷, 의존 객체 없음) 삭제.
-- CREATE OR REPLACE라 m83/m86에서 정리한 실행 권한은 그대로 유지된다.
-- 적용 뒤 수동: VACUUM (FULL, ANALYZE) bid_notices, api_ingestion_log;  (UPDATE/DELETE만으로는 용량이 줄지 않는다)
--
-- 되돌리기:
--   ① upsert_bid_notice의 VALUES 마지막 v_raw를 p로 되돌린다(이미 줄인 기존 행은 복구 불가).
--   ② CREATE INDEX idx_bid_records_pn_no ON public.bid_records USING btree (pn_no);
--      weekly_db_cleanup은 m87 정의로 재생성.

CREATE OR REPLACE FUNCTION public.upsert_bid_notice(p jsonb)
 RETURNS TABLE(id bigint, action text, is_target boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bid_ntce_no text := COALESCE(NULLIF(p->>'bidNtceNo',''), NULLIF(p->>'bid_ntce_no',''));
  v_ord  text := COALESCE(NULLIF(p->>'bidNtceOrd',''), NULLIF(p->>'bid_ntce_ord',''), '00');
  v_clsfc text := COALESCE(NULLIF(p->>'bidClsfcNo',''), NULLIF(p->>'bid_clsfc_no',''), '0');
  v_rbid text := COALESCE(NULLIF(p->>'rbidNo',''), NULLIF(p->>'rbid_no',''), '0');
  v_dedup text;
  v_main_cat text := COALESCE(NULLIF(p->>'mainCnsttyNm',''), NULLIF(p->>'cat',''));
  v_subsi_all text := COALESCE(p->>'subsiCnsttyNm1','') || '|' || COALESCE(p->>'subsiCnsttyNm2','') || '|' ||
                      COALESCE(p->>'subsiCnsttyNm3','') || '|' || COALESCE(p->>'subsiCnsttyNm4','') || '|' ||
                      COALESCE(p->>'subsiCnsttyNm5','');
  v_cat_any text;
  v_ep  numeric := NULLIF(REGEXP_REPLACE(COALESCE(p->>'presmptPrce', p->>'ep',''),'[^0-9.\-]','','g'),'')::numeric;
  v_ba  numeric := NULLIF(REGEXP_REPLACE(COALESCE(p->>'bssamt', p->>'ba',''),'[^0-9.\-]','','g'),'')::numeric;
  v_reg text := COALESCE(NULLIF(p->>'prtcptLmtRgnNm',''), NULLIF(p->>'cnstrtsiteRgnNm',''), NULLIF(p->>'reg',''));
  v_cm  text := COALESCE(NULLIF(p->>'cntrctCnclsMthdNm',''), NULLIF(p->>'contract_method',''));
  v_ag  text := COALESCE(NULLIF(p->>'ntceInsttNm',''), NULLIF(p->>'ag',''));
  v_at  text;
  v_is_target boolean := false;
  v_existed   boolean;
  v_id        bigint;
  -- m89: 원본 응답 전체 대신 g2b_auto_candidates가 읽는 두 값만 저장 (용량)
  v_raw jsonb := NULLIF(jsonb_strip_nulls(jsonb_build_object(
                   'mainCnsttyNm', p->'mainCnsttyNm', 'sucsfbidLwltRate', p->'sucsfbidLwltRate')), '{}'::jsonb);
BEGIN
  IF v_bid_ntce_no IS NULL THEN RAISE EXCEPTION 'bid_ntce_no is required'; END IF;
  v_dedup := v_bid_ntce_no || '-' || v_ord || '-' || v_clsfc || '-' || v_rbid;
  v_cat_any := COALESCE(v_main_cat,'') || '|' || v_subsi_all;
  -- [버그 수정] at: 공고명 대신 ag 기반 기관유형 분류
  v_at := classify_agency_type(COALESCE(v_ag, ''));

  SELECT bool_or(
    (cat_keywords IS NULL OR EXISTS (
      SELECT 1 FROM unnest(cat_keywords) kw
      WHERE (CASE WHEN main_cat_only THEN COALESCE(v_main_cat,'') ELSE v_cat_any END) ILIKE '%'||kw||'%'))
    AND (ep_min IS NULL OR v_ep >= ep_min)
    AND (ep_max IS NULL OR v_ep <= ep_max)
    AND (contract_methods IS NULL OR v_cm = ANY(contract_methods))
    AND (reg_whitelist IS NULL OR v_reg = ANY(reg_whitelist))
    AND NOT (exclude_keywords IS NOT NULL AND EXISTS (
      SELECT 1 FROM unnest(exclude_keywords) xk
      WHERE COALESCE(p->>'bidNtceNm','') ILIKE '%'||xk||'%'))
  ) INTO v_is_target FROM api_collection_rules WHERE enabled = true;

  SELECT bn.id INTO v_id FROM bid_notices bn WHERE bn.dedup_key = v_dedup;
  v_existed := v_id IS NOT NULL;

  INSERT INTO bid_notices (
    bid_ntce_no, bid_ntce_ord, bid_clsfc_no, rbid_no, dedup_key,
    pn, pn_no, ag, ag_code, notice_inst, notice_inst_cd,
    at, cat, reg, ep, ba, bdgt_amt,
    rsrvtn_prce_rng_bgn, rsrvtn_prce_rng_end,
    notice_dt, bid_begin_dt, bid_close_dt, od, ba_open_dt,
    contract_method, bid_method, industry_eval_rt, re_ntce_yn, is_target, raw_json
  ) VALUES (
    v_bid_ntce_no, v_ord, v_clsfc, v_rbid, v_dedup,
    NULLIF(p->>'bidNtceNm',''), v_bid_ntce_no,
    v_ag, NULLIF(p->>'ntceInsttCd',''),
    NULLIF(p->>'dminsttNm',''), NULLIF(p->>'dminsttCd',''),
    v_at, v_main_cat, v_reg, v_ep, v_ba,
    NULLIF(REGEXP_REPLACE(COALESCE(p->>'bdgtAmt',''),'[^0-9.\-]','','g'),'')::numeric,
    NULLIF(p->>'rsrvtnPrceRngBgnRate',''), NULLIF(p->>'rsrvtnPrceRngEndRate',''),
    NULLIF(p->>'bidNtceDt','')::timestamptz, NULLIF(p->>'bidBeginDt','')::timestamptz,
    NULLIF(p->>'bidClseDt','')::timestamptz, NULLIF(p->>'opengDt','')::timestamptz,
    NULLIF(p->>'opengDt','')::timestamptz,
    v_cm, NULLIF(p->>'bidMethdNm',''),
    NULLIF(REGEXP_REPLACE(COALESCE(p->>'indstrytyEvlRt',''),'[^0-9.\-]','','g'),'')::numeric,
    COALESCE(NULLIF(p->>'reNtceYn','')::bpchar, 'N'::bpchar),
    COALESCE(v_is_target, false), v_raw
  )
  ON CONFLICT (dedup_key) DO UPDATE SET
    pn = EXCLUDED.pn, ag = EXCLUDED.ag, ag_code = EXCLUDED.ag_code,
    notice_inst = EXCLUDED.notice_inst, notice_inst_cd = EXCLUDED.notice_inst_cd,
    at = EXCLUDED.at, cat = EXCLUDED.cat, reg = EXCLUDED.reg,
    ep = EXCLUDED.ep, ba = COALESCE(EXCLUDED.ba, bid_notices.ba), bdgt_amt = EXCLUDED.bdgt_amt,
    rsrvtn_prce_rng_bgn = EXCLUDED.rsrvtn_prce_rng_bgn,
    rsrvtn_prce_rng_end = EXCLUDED.rsrvtn_prce_rng_end,
    bid_begin_dt = EXCLUDED.bid_begin_dt, bid_close_dt = EXCLUDED.bid_close_dt,
    od = EXCLUDED.od, ba_open_dt = EXCLUDED.ba_open_dt,
    contract_method = EXCLUDED.contract_method, bid_method = EXCLUDED.bid_method,
    industry_eval_rt = EXCLUDED.industry_eval_rt,
    is_target = EXCLUDED.is_target, raw_json = EXCLUDED.raw_json, updated_at = now()
  RETURNING bid_notices.id, bid_notices.is_target INTO v_id, v_is_target;

  id := v_id; action := CASE WHEN v_existed THEN 'update' ELSE 'insert' END;
  is_target := v_is_target; RETURN NEXT;
END;
$function$;

-- ① 기존 행도 두 값만 남긴다 (bid_notices에는 트리거가 없어 updated_at은 바뀌지 않는다)
UPDATE public.bid_notices
SET raw_json = NULLIF(jsonb_strip_nulls(jsonb_build_object(
                 'mainCnsttyNm', raw_json->'mainCnsttyNm', 'sucsfbidLwltRate', raw_json->'sucsfbidLwltRate')), '{}'::jsonb)
WHERE raw_json IS NOT NULL;

-- ② 소소한 정리
DROP INDEX IF EXISTS public.idx_bid_records_pn_no;
DELETE FROM public.api_ingestion_log WHERE ingested_at < now() - interval '90 days';
DROP TABLE IF EXISTS public.snap20260923_erav2_null_ids;

CREATE OR REPLACE FUNCTION public.weekly_db_cleanup()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net', 'cron'
AS $function$
DECLARE
  v_raw int; v_raw_nt int; v_part int; v_part2 int; v_log int; v_net int; v_cron int;
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

  -- m89: 수집 로그 90일 (v_collect_health 15일, rank_targets 2시간만 본다)
  DELETE FROM public.api_ingestion_log WHERE ingested_at < now() - interval '90 days';
  GET DIAGNOSTICS v_log = ROW_COUNT;

  DELETE FROM net._http_response WHERE created < now() - interval '2 days';
  GET DIAGNOSTICS v_net = ROW_COUNT;

  DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days';
  GET DIAGNOSTICS v_cron = ROW_COUNT;

  RETURN format('raw_json90=%s raw_json_nontarget30=%s participants_pruned=%s participants_pruned_open90=%s api_log90=%s net=%s cron=%s',
                v_raw, v_raw_nt, v_part, v_part2, v_log, v_net, v_cron);
END;
$function$;
