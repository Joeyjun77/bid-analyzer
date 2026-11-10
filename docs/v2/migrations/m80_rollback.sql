-- m80 되돌리기: goyang_profile을 m78 정의 + m79 치환 상태로, rank_targets를 m76 정의로
CREATE OR REPLACE FUNCTION public.goyang_profile(p_grp text DEFAULT NULL, p_ag_code text DEFAULT NULL,
                                      p_target_only boolean DEFAULT false, p_at text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH base AS (
  SELECT r.id, r.od, r.ar1, r.at, r.goyang_code, r.goyang_grp, split_part(r.pn_no, '-', 1) AS no,
         -- 업종: 2026-04~ 공고는 bid_notices.is_target, 그 전 업로드분은 cat(전기·통신·소방)
         coalesce((SELECT bool_or(n.is_target) FROM bid_notices n WHERE n.bid_ntce_no = split_part(r.pn_no, '-', 1)),
                  r.cat ~ '(전기|통신|소방)', false) AS tgt
  FROM v_goyang_records r
), f AS (
  SELECT * FROM base
  WHERE (p_grp IS NULL OR goyang_grp = p_grp) AND (p_ag_code IS NULL OR goyang_code = p_ag_code)
    AND (NOT p_target_only OR tgt) AND (p_at IS NULL OR at = p_at)
), v AS (
  SELECT * FROM f WHERE ar1 BETWEEN 95 AND 105
), sets AS (
  SELECT DISTINCT ON (s.bid_ntce_no) s.bid_ntce_no, s.drwt_yns
  FROM bid_prelim_sets s WHERE s.bid_ntce_no IN (SELECT no FROM f)
  ORDER BY s.bid_ntce_no, s.id DESC
), ranks AS (
  SELECT * FROM api_bid_ranks WHERE bid_ntce_no IN (SELECT no FROM f)
)
SELECT jsonb_build_object(
  'orgs', (SELECT jsonb_agg(jsonb_build_object('code', m.ag_code, 'name', m.ag_name, 'grp', m.grp,
                                               'n', (SELECT count(*) FROM base b WHERE b.goyang_code = m.ag_code))
                            ORDER BY m.grp, m.ag_name)
           FROM goyang_org_master m WHERE m.include),
  'summary', jsonb_build_object(
      'n', (SELECT count(*) FROM f),
      'n_180', (SELECT count(*) FROM f WHERE od >= current_date - 180),
      'n_ar1', (SELECT count(*) FROM v),
      'n_target', (SELECT count(*) FROM f WHERE tgt),
      'prelim_sets', (SELECT count(*) FROM sets),
      'rank_notices', (SELECT count(DISTINCT bid_ntce_no) FROM ranks),
      'first_od', (SELECT min(od)::date FROM f), 'last_od', (SELECT max(od)::date FROM f)),
  'dist', jsonb_build_array(
      (SELECT jsonb_build_object('label', '전체', 'n', count(*), 'mean', round(avg(ar1), 4),
              'pct', percentile_cont(ARRAY[0.1, 0.25, 0.5, 0.75, 0.9]) WITHIN GROUP (ORDER BY ar1)) FROM v),
      (SELECT jsonb_build_object('label', '최근 180일', 'n', count(*), 'mean', round(avg(ar1), 4),
              'pct', percentile_cont(ARRAY[0.1, 0.25, 0.5, 0.75, 0.9]) WITHIN GROUP (ORDER BY ar1))
       FROM v WHERE od >= current_date - 180)),
  'monthly', (SELECT jsonb_agg(jsonb_build_object('ym', ym, 'n', n, 'p50', p50) ORDER BY ym)
              FROM (SELECT to_char(od, 'YYYY-MM') AS ym, count(*) AS n,
                           round((percentile_cont(0.5) WITHIN GROUP (ORDER BY ar1))::numeric, 4) AS p50
                    FROM v WHERE od >= date_trunc('month', current_date) - interval '23 months'
                    GROUP BY 1) mm),
  'draws', jsonb_build_object(
      'n_sets', (SELECT count(*) FROM sets),
      'counts', (SELECT jsonb_agg(c ORDER BY i)
                 FROM (SELECT g.i, (SELECT count(*) FROM sets s WHERE s.drwt_yns[g.i]) AS c
                       FROM generate_series(1, 15) g(i)) d)),
  'firms', jsonb_build_object(
      'n_notices', (SELECT count(DISTINCT bid_ntce_no) FROM ranks),
      'top', (SELECT jsonb_agg(t) FROM (
                SELECT bizno, max(co_name) AS name, count(DISTINCT bid_ntce_no) AS notices,
                       count(*) FILTER (WHERE openg_rank = 1) AS rank1,
                       round(avg(rate_vs_plnprc), 3) AS avg_rate_vs_plnprc
                FROM ranks GROUP BY bizno
                ORDER BY count(DISTINCT bid_ntce_no) DESC, count(*) FILTER (WHERE openg_rank = 1) DESC, bizno
                LIMIT 10) t))
);
$$;

DO $m$ DECLARE d text := pg_get_functiondef('public.goyang_profile(text,text,boolean,text)'::regprocedure);
  o text := 'SELECT r.id, r.od, r.ar1, r.at,';
  n text := 'SELECT r.id, r.od, coalesce(r.ar1, (SELECT s.plnprc::numeric / NULLIF(s.bssamt, 0) * 100 FROM bid_prelim_sets s WHERE s.bid_ntce_no = split_part(r.pn_no, ''-'', 1) ORDER BY s.id DESC LIMIT 1)) AS ar1, r.at,';
BEGIN
  IF (length(d) - length(replace(d, o, ''))) / length(o) <> 1 THEN RAISE EXCEPTION 'm79: goyang_profile 치환 위치를 정확히 1곳 찾지 못함'; END IF;
  EXECUTE replace(d, o, n);
END $m$;

CREATE OR REPLACE FUNCTION public.rank_targets(p_since date DEFAULT '2026-04-01'::date, p_limit integer DEFAULT 20)
 RETURNS TABLE(bid_ntce_no text, od timestamp with time zone)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  SELECT n.bid_ntce_no, max(n.od)
  FROM v_goyang_notices n
  WHERE n.is_target AND n.od >= p_since AND n.od < now() - interval '2 hours'
    AND NOT EXISTS (SELECT 1 FROM api_bid_rank_notices d WHERE d.bid_ntce_no = n.bid_ntce_no)
  GROUP BY n.bid_ntce_no
  ORDER BY max(n.od)
  LIMIT p_limit;
$function$;
