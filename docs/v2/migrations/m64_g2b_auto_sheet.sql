-- m64: G2B 양식 자동 수집 1차 — 표시 전용 테이블 + 후보·대조 함수 (2026-10-23)
-- 스펙: docs/superpowers/specs/2026-10-23-g2b-auto-collect-design.md
-- bid_records·bid_predictions에는 쓰지 않는다(예측 엔진 격리). 읽기만.

CREATE TABLE public.g2b_auto_sheet (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bid_ntce_no     text NOT NULL UNIQUE,
  bid_ntce_ord    text NOT NULL DEFAULT '000',
  status          text NOT NULL CHECK (status IN ('complete','pending','not_target','gave_up')),
  missing         text[],
  purpose         text CHECK (purpose IN ('display','compare')),
  excel_record_id bigint,
  api_record_id   bigint,
  od date, pn text, ag text, canonical_ag text, at text, reg text,
  trade_elec boolean, trade_source text,
  ba numeric, av numeric, a_applies boolean, a_items jsonb, xp numeric, fr numeric,
  bp numeric, co text, co_no text, pc int,
  ar1 numeric, br1 numeric, floor_price numeric,
  attempts int NOT NULL DEFAULT 0,
  computed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX g2b_auto_sheet_status_od ON public.g2b_auto_sheet (status, od);
CREATE INDEX g2b_auto_sheet_excel ON public.g2b_auto_sheet (excel_record_id) WHERE excel_record_id IS NOT NULL;

-- 만들자마자 잠금(2026-10 스냅샷 노출 사고 교훈): 로그인 사용자 읽기만, 쓰기는 service_role
ALTER TABLE public.g2b_auto_sheet ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.g2b_auto_sheet FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.g2b_auto_sheet TO authenticated;
GRANT ALL ON public.g2b_auto_sheet TO service_role;
CREATE POLICY g2b_auto_sheet_read ON public.g2b_auto_sheet FOR SELECT TO authenticated USING (true);

-- 후보: 개찰일 범위의 나라장터 공고 중 경기·참여·업로드 공고. 이미 끝난 것(complete·not_target·gave_up) 제외.
-- p_mode: 'compare' = 엑셀 행 있음, 'fill' = 없음, 'daily' = 둘 다. 키 이름 = g2b_auto_sheet 컬럼명(+ cat·main_cnstty·participated).
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
  ), u AS (
    SELECT n.* FROM n
    WHERE n.reg ILIKE '%경기%' OR n.participated IS TRUE
       OR n.bid_ntce_no IN (SELECT split_part(p.pn_no, '-', 1) FROM bid_predictions p
                            WHERE p.source = 'file_upload' AND p.pn_no ~ '^R')
  ), j AS (
    SELECT u.*, g.status AS cur_status, COALESCE(g.attempts, 0) AS attempts,
           (SELECT e.id FROM bid_records e
             WHERE e.pn_no ~>=~ (u.bid_ntce_no || '-') AND e.pn_no ~<~ (u.bid_ntce_no || '.')
               AND e.g2b IS NOT NULL LIMIT 1) AS excel_record_id,  -- ORDER BY 넣으면 pkey 전수 스캔으로 바뀜(2026-10-23 실측 80s)
           r.id AS api_record_id, r.pn AS r_pn, r.ag AS r_ag, r.canonical_ag AS r_cag, r.at AS r_at,
           r.co, r.co_no, r.bp, r.pc,
           s.bssamt AS ba, s.plnprc AS xp
    FROM u
    LEFT JOIN g2b_auto_sheet g ON g.bid_ntce_no = u.bid_ntce_no
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
    'reg', reg, 'cat', cat, 'main_cnstty', main_cnstty, 'participated', participated, 'fr', fr,
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
REVOKE EXECUTE ON FUNCTION public.g2b_auto_candidates(text, date, date, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.g2b_auto_candidates(text, date, date, int) TO service_role;

-- 대조 보고: 자동 계산값 vs 엑셀 행. pass=NULL은 참고 지표(기준 없음).
-- trade_recall = 기간 내 엑셀 나라장터 경기 전기 공고 중 자동 판별이 전기로 잡은 비율(수집 누락 포함).
CREATE OR REPLACE FUNCTION public.g2b_auto_compare_report(p_from date DEFAULT '2026-04-01', p_to date DEFAULT CURRENT_DATE)
RETURNS TABLE(metric text, n int, ok int, pct numeric, pass boolean)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '8s'
AS $$
  WITH c AS (
    SELECT g.ar1, g.br1, g.floor_price, g.ba, g.av, g.xp,
           e.ar1 AS e_ar1, e.br1 AS e_br1, e.floor_price AS e_floor, e.ba AS e_ba, e.av AS e_av, e.xp AS e_xp
    FROM g2b_auto_sheet g JOIN bid_records e ON e.id = g.excel_record_id
    WHERE g.status = 'complete' AND g.purpose = 'compare' AND g.od BETWEEN p_from AND p_to
  ), ex AS (
    SELECT e.id FROM bid_records e
    WHERE e.od BETWEEN p_from AND p_to AND e.g2b IS NOT NULL AND e.ar1 IS NOT NULL
      AND e.pn_no ~ '^R' AND e.reg ILIKE '%경기%'
  ), m AS (
    SELECT 'ar1' AS metric, count(*) AS n, count(*) FILTER (WHERE abs(ar1 - e_ar1) <= 0.0001) AS ok, 99.0 AS th FROM c WHERE e_ar1 IS NOT NULL
    UNION ALL SELECT 'br1', count(*), count(*) FILTER (WHERE abs(br1 - e_br1) <= 0.001), 98.0 FROM c WHERE e_br1 IS NOT NULL
    UNION ALL SELECT 'floor_price', count(*), count(*) FILTER (WHERE abs(floor_price - e_floor) <= 10), 98.0 FROM c WHERE e_floor IS NOT NULL
    UNION ALL SELECT 'ba', count(*), count(*) FILTER (WHERE ba = e_ba), NULL FROM c WHERE e_ba IS NOT NULL
    UNION ALL SELECT 'av', count(*), count(*) FILTER (WHERE av = e_av), NULL FROM c WHERE e_av IS NOT NULL
    UNION ALL SELECT 'xp', count(*), count(*) FILTER (WHERE xp = e_xp), NULL FROM c WHERE e_xp IS NOT NULL
    UNION ALL SELECT 'trade_recall', count(*),
                     count(*) FILTER (WHERE EXISTS (SELECT 1 FROM g2b_auto_sheet g WHERE g.excel_record_id = ex.id AND g.trade_elec IS TRUE)),
                     95.0 FROM ex
  )
  SELECT metric, n::int, ok::int, round(100.0 * ok / NULLIF(n, 0), 2),
         CASE WHEN th IS NULL THEN NULL ELSE n > 0 AND 100.0 * ok / n >= th END
  FROM m
$$;
REVOKE EXECUTE ON FUNCTION public.g2b_auto_compare_report(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.g2b_auto_compare_report(date, date) TO authenticated, service_role;
