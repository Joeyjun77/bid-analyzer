-- m64c: G2B 양식 자동 수집 과거분 — 공고 메타(업종·하한율·면허) 보조 테이블 + 진행 상태 + 후보 함수가 메타를 읽게 (2026-10-23)
-- 배경: 과거 공고는 raw_json이 정리돼 주공종·하한율이 없고, 소액수의견적은 업종이 면허 제한 목록에만 있다.
--       공고별 조회(약 5,600회) 대신 날짜별 목록 조회(약 520회)로 모아 둔다.

CREATE TABLE public.g2b_auto_notice_meta (
  bid_ntce_no text PRIMARY KEY,
  main_cnstty text,
  fr text,
  licenses text[],          -- NULL = 면허 목록 아직 안 받음, '{}' = 받았는데 제한 없음
  fetched_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.g2b_auto_notice_meta ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.g2b_auto_notice_meta FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.g2b_auto_notice_meta TO service_role;

CREATE TABLE public.g2b_auto_backfill_state (
  id int PRIMARY KEY CHECK (id = 1),
  phase text NOT NULL DEFAULT 'notice' CHECK (phase IN ('notice','license','compute','done')),
  next_dt date NOT NULL DEFAULT '2026-03-01',   -- 목록 조회 다음 게시일
  next_page int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.g2b_auto_backfill_state (id) VALUES (1);
ALTER TABLE public.g2b_auto_backfill_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.g2b_auto_backfill_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.g2b_auto_backfill_state TO service_role;

-- 후보 함수: 공고 원본이 없으면 메타 테이블 값을 쓴다(licenses 키 추가)
CREATE OR REPLACE FUNCTION public.g2b_auto_candidates(p_mode text, p_from date, p_to date, p_limit int)
RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '8s'
AS $$
  WITH n AS (
    SELECT DISTINCT ON (x.bid_ntce_no)
           x.bid_ntce_no, x.bid_ntce_ord, x.od, x.pn, x.ag, x.reg, x.cat, x.participated,
           x.raw_json->>'mainCnsttyNm' AS main_cnstty,
           NULLIF(x.raw_json->>'sucsfbidLwltRate', '') AS fr
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
           COALESCE(NULLIF(u.main_cnstty, ''), mt.main_cnstty) AS main_cnstty2, COALESCE(u.fr, mt.fr) AS fr2, mt.licenses
    FROM u
    LEFT JOIN g2b_auto_sheet g ON g.bid_ntce_no = u.bid_ntce_no
    LEFT JOIN g2b_auto_notice_meta mt ON mt.bid_ntce_no = u.bid_ntce_no
    LEFT JOIN LATERAL (SELECT r.* FROM bid_records r WHERE r.pn_no = u.bid_ntce_no AND r.g2b IS NULL
                       ORDER BY r.id DESC LIMIT 1) r ON true
    LEFT JOIN LATERAL (SELECT s.bssamt, s.plnprc FROM bid_prelim_sets s WHERE s.bid_ntce_no = u.bid_ntce_no
                       ORDER BY s.bid_ntce_ord DESC LIMIT 1) s ON true
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
$$;
