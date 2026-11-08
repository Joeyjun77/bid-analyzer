-- m78: 고양 화면 읽기 경로 + 순위 수집 모니터링 (goyang-focus P4 issue 04, 2026-11-08, 사용자 승인 "Yes, build it")
-- 1) goyang_profile: 고양 탭 집계 jsonb. SECURITY DEFINER, search_path 고정, authenticated EXECUTE만.
--    테이블(goyang_org_*, api_bid_ranks 등) 권한은 그대로 잠금 — 원본 행이 아니라 집계만 나간다.
--    사정률은 bid_records.ar1(100% 기준) 기술 통계만. adj_rate 공간 승률·WIN-zone 없음(V2 G-단위).
-- 2) goyang_ag_texts: '고양만' 목록 필터용 include 기관 표기 목록.
-- 3) v_collect_health에 ranks(getOpengResultListInfoOpengCompt) 줄 추가, 2026-11-09부터 판정. security_invoker 유지(m71 교훈).
-- 부하: 탭을 열 때만 호출(주기 조회 금지). 되돌리기: m78_rollback.sql

CREATE FUNCTION public.goyang_profile(p_grp text DEFAULT NULL, p_ag_code text DEFAULT NULL,
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

CREATE FUNCTION public.goyang_ag_texts()
RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.ag_text FROM goyang_org_alias a JOIN goyang_org_master m USING (ag_code) WHERE m.include ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION public.goyang_profile(text, text, boolean, text), public.goyang_ag_texts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.goyang_profile(text, text, boolean, text), public.goyang_ag_texts() TO authenticated, service_role;

-- v_collect_health: ranks 줄 (3곳 치환, 각 정확히 1곳)
DO $m$ DECLARE d text := pg_get_viewdef('public.v_collect_health'::regclass, true);
  o1 text := '''getBidPblancListInfoCnstwkBsisAmount''::text])';
  n1 text := '''getBidPblancListInfoCnstwkBsisAmount''::text, ''getOpengResultListInfoOpengCompt''::text])';
  o2 text := '(''bssamt''::text,''getBidPblancListInfoCnstwkBsisAmount''::text,''WARN''::text))';
  n2 text := '(''bssamt''::text,''getBidPblancListInfoCnstwkBsisAmount''::text,''WARN''::text), (''ranks''::text,''getOpengResultListInfoOpengCompt''::text,''WARN''::text))';
  o3 text := 'WHERE c.collector <> ''bssamt''::text OR d.d >= ''2026-11-07''::date) x';
  n3 text := 'WHERE (c.collector <> ''bssamt''::text OR d.d >= ''2026-11-07''::date) AND (c.collector <> ''ranks''::text OR d.d >= ''2026-11-09''::date)) x';
BEGIN
  IF (length(d) - length(replace(d, o1, ''))) / length(o1) <> 1
     OR (length(d) - length(replace(d, o2, ''))) / length(o2) <> 1
     OR (length(d) - length(replace(d, o3, ''))) / length(o3) <> 1 THEN
    RAISE EXCEPTION 'm78: v_collect_health 치환 위치를 정확히 1곳씩 찾지 못함';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.v_collect_health WITH (security_invoker = true) AS '
          || replace(replace(replace(d, o1, n1), o2, n2), o3, n3);
END $m$;
