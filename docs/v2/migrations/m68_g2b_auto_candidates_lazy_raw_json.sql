-- m68: g2b_auto_candidates가 후보 전체(14일 약 6,500행)의 raw_json을 먼저 펼쳐 캐시가 빈 아침에 8초 제한을 넘던 문제 수정.
-- 2026-11-05: 실측 첫 실행 7.53초, 재실행 3.09초. 11/4 22:00 UTC 일일 실행이 statement timeout으로 500.
-- raw_json은 상태 필터를 통과한 행에서만 읽는다. 시그니처·권한·8초 제한·출력은 그대로. 롤백은 m68_rollback.sql.
CREATE OR REPLACE FUNCTION public.g2b_auto_candidates(p_mode text, p_from date, p_to date, p_limit integer)
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '8s'
AS $function$
  WITH n AS (
    SELECT DISTINCT ON (x.bid_ntce_no)
           x.id AS notice_id, x.bid_ntce_no, x.bid_ntce_ord, x.od, x.pn, x.ag, x.reg, x.cat, x.participated
    FROM bid_notices x
    WHERE x.od >= p_from AND x.od < p_to + 1 AND x.bid_ntce_no ~ '^R'
    ORDER BY x.bid_ntce_no, x.bid_ntce_ord DESC
  ), m AS (
    SELECT n.*, (n.participated IS TRUE
             OR n.bid_ntce_no IN (SELECT split_part(p.pn_no, '-', 1) FROM bid_predictions p
                                  WHERE p.source = 'file_upload' AND p.pn_no ~ '^R')) AS mine
    FROM n
  ), u AS (
    SELECT m.* FROM m WHERE m.reg ILIKE '%경기%' OR m.mine
  ), j AS (
    SELECT u.*, g.status AS cur_status, COALESCE(g.attempts, 0) AS attempts,
           (SELECT e.id FROM bid_records e
             WHERE e.pn_no ~>=~ (u.bid_ntce_no || '-') AND e.pn_no ~<~ (u.bid_ntce_no || '.')
               AND e.g2b IS NOT NULL LIMIT 1) AS excel_record_id,  -- ORDER BY 넣으면 pkey 전수 스캔으로 바뀜(2026-10-23 실측 80s)
           r.id AS api_record_id, r.pn AS r_pn, r.ag AS r_ag, r.canonical_ag AS r_cag, r.at AS r_at,
           r.co, r.co_no, r.bp, r.pc,
           s.bssamt AS ba, s.plnprc AS xp,
           COALESCE(NULLIF(z.main_cnstty, ''), mt.main_cnstty) AS main_cnstty2, COALESCE(z.fr, mt.fr) AS fr2, mt.licenses
    FROM u
    LEFT JOIN g2b_auto_sheet g ON g.bid_ntce_no = u.bid_ntce_no
    LEFT JOIN g2b_auto_notice_meta mt ON mt.bid_ntce_no = u.bid_ntce_no
    LEFT JOIN LATERAL (SELECT r.* FROM bid_records r WHERE r.pn_no = u.bid_ntce_no AND r.g2b IS NULL
                       ORDER BY r.id DESC LIMIT 1) r ON true
    LEFT JOIN LATERAL (SELECT s.bssamt, s.plnprc FROM bid_prelim_sets s WHERE s.bid_ntce_no = u.bid_ntce_no
                       ORDER BY s.bid_ntce_ord DESC LIMIT 1) s ON true
    LEFT JOIN LATERAL (SELECT y.raw_json->>'mainCnsttyNm' AS main_cnstty, NULLIF(y.raw_json->>'sucsfbidLwltRate', '') AS fr
                       FROM bid_notices y WHERE y.id = u.notice_id) z ON true
    WHERE g.status IS NULL OR g.status = 'pending'
  )
  SELECT jsonb_build_object(
    'bid_ntce_no', bid_ntce_no, 'bid_ntce_ord', bid_ntce_ord, 'od', od::date,
    'pn', COALESCE(r_pn, pn), 'ag', COALESCE(r_ag, ag),
    'canonical_ag', COALESCE(r_cag, normalize_agency_name(COALESCE(r_ag, ag))),
    'at', COALESCE(r_at, classify_agency_type(COALESCE(r_ag, ag))),
    'reg', reg, 'cat', cat, 'main_cnstty', main_cnstty2, 'participated', participated, 'mine', mine, 'fr', fr2, 'licenses', licenses,
    'excel_record_id', excel_record_id, 'api_record_id', api_record_id,
    'co', co, 'co_no', co_no, 'bp', bp, 'pc', pc, 'ba', ba, 'xp', xp,
    'attempts', attempts, 'cur_status', cur_status)
  FROM j
  WHERE p_mode = 'daily'
     OR (p_mode = 'compare' AND excel_record_id IS NOT NULL)
     OR (p_mode = 'fill' AND excel_record_id IS NULL)
  ORDER BY od, bid_ntce_no
  LIMIT p_limit
$function$;
