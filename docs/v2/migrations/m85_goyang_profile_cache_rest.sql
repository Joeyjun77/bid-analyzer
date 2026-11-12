-- m85: 고양 탭 첫 접속 시간 초과 수정 — 순위 집계·안착안·개찰 전 공고도 미리 계산한 표에서 읽기
-- (goyang-focus issue 04 후속, 2026-11-13)
-- 증상: 11/13 08:53 KST 첫 접속에서 goyang_profile이 첫 호출·재시도 모두 8초 제한(authenticated statement_timeout)에 걸려 500
--       → 화면에 "고양 데이터를 불러오지 못했습니다". m81은 고양 기록 조인만 요약 표(goyang_base)로 옮겼다.
-- 원인: 남은 원본 읽기 3곳이 자료가 메모리에 없을 때 디스크에서 읽힌다. 11/13 08:5x 실측(반쯤 데워진 상태에서도 2.9초):
--       순위 api_bid_ranks 전체 54,685행 0.6초+임시 파일, 안착안 bid_predictions 전체 5,850행 0.7초,
--       개찰 전 공고 bid_notices 2,991행 0.66초. 순위 표는 매일 늘어난다.
-- 수정: 세 부분을 구체화 뷰로 옮기고 goyang_profile은 그 뷰만 읽는다(출력 형식·값은 그대로, 적용 전후 대조).
--   goyang_rank_notice — 공고별 참여 수·탈락 수·낙찰선·낙찰선 기준 0.1 구간 건수(순위 수집 07:20 뒤 3시간 갱신에 함께)
--   goyang_anchor      — 안착안 하한 통과(고양 전체 한 줄, 3시간 갱신에 함께)
--   goyang_open        — 개찰 전 고양 공고(30분 갱신: 공고 수집 :00/:30, 자동 예측 :03/:33 뒤 :12/:42)
-- 화면 표시 전용(Neutral). 권한: 세 뷰 모두 anon·authenticated 회수 — SECURITY DEFINER 함수만 읽는다.
-- 되돌리기: m85_rollback.sql

CREATE MATERIALIZED VIEW public.goyang_rank_notice AS
WITH k AS (
  -- 낙찰선 = 유효 투찰 중 최저(25공고 모두 1순위와 일치, 11/10 실측)
  SELECT bid_ntce_no, count(*) AS bidders,
         count(*) FILTER (WHERE rmrk = '낙찰하한선 미달') AS n_below,
         min(rate_vs_plnprc) FILTER (WHERE rmrk = '정상') AS line,
         max(rate_vs_plnprc) FILTER (WHERE rmrk = '낙찰하한선 미달') AS max_below
  FROM api_bid_ranks GROUP BY 1
), g AS (
  SELECT r.bid_ntce_no, r.rate_vs_plnprc - k.line AS g
  FROM api_bid_ranks r JOIN k USING (bid_ntce_no)
  WHERE r.rmrk IN ('정상', '낙찰하한선 미달') AND k.line IS NOT NULL
), gs AS (
  SELECT bid_ntce_no, count(*) FILTER (WHERE g >= 0 AND g < 0.05) AS near005,
         count(*) FILTER (WHERE g < -1.5) AS lo, count(*) FILTER (WHERE g >= 2.0) AS hi
  FROM g GROUP BY 1
), gb AS (
  SELECT bid_ntce_no, jsonb_object_agg(b::text, c) AS bins
  FROM (SELECT bid_ntce_no, round(floor(g * 10) / 10, 1) AS b, count(*) AS c FROM g WHERE g >= -1.5 AND g < 2.0 GROUP BY 1, 2) x
  GROUP BY 1
)
SELECT k.bid_ntce_no, k.bidders, k.n_below, k.line, k.max_below, gs.near005, gs.lo, gs.hi, gb.bins, now() AS refreshed_at
FROM k LEFT JOIN gs USING (bid_ntce_no) LEFT JOIN gb USING (bid_ntce_no);
CREATE UNIQUE INDEX goyang_rank_notice_no ON public.goyang_rank_notice (bid_ntce_no);

-- 안착안 하한 통과: 선택과 무관하게 고양 전체. 과거 매칭 행에 나중에 채운 b_pred 값이 섞여 있다
CREATE MATERIALIZED VIEW public.goyang_anchor AS
SELECT 1 AS k, count(*) AS n, count(*) FILTER (WHERE p.b_pred_bid_amount >= r.floor_price) AS pass, now() AS refreshed_at
FROM bid_predictions p JOIN bid_records r ON r.id = p.matched_record_id
WHERE p.match_status = 'matched' AND r.floor_price > 0 AND p.b_pred_bid_amount > 0
  AND trim(p.ag) IN (SELECT a.ag_text FROM goyang_org_alias a JOIN goyang_org_master m USING (ag_code) WHERE m.include);
CREATE UNIQUE INDEX goyang_anchor_k ON public.goyang_anchor (k);

-- 개찰 전 공고: 갱신 시점 기준 하루 전부터 담아 두고, 함수에서 지금 시각으로 다시 거른다
CREATE MATERIALIZED VIEW public.goyang_open AS
SELECT DISTINCT ON (n.bid_ntce_no) n.bid_ntce_no, n.od, n.ag, n.pn, n.ba, n.ep, n.is_target, n.prediction_id, n.goyang_grp, n.ag_code
FROM v_goyang_notices n
WHERE n.od >= now() - interval '1 day'
ORDER BY n.bid_ntce_no, n.updated_at DESC;
CREATE UNIQUE INDEX goyang_open_no ON public.goyang_open (bid_ntce_no);

REVOKE ALL ON public.goyang_rank_notice, public.goyang_anchor, public.goyang_open FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.goyang_profile(p_grp text DEFAULT NULL::text, p_ag_code text DEFAULT NULL::text, p_target_only boolean DEFAULT false, p_at text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH base AS (
  SELECT * FROM goyang_base  -- m81: 3시간마다 갱신되는 요약 표
), f AS (
  SELECT * FROM base
  WHERE (p_grp IS NULL OR goyang_grp = p_grp) AND (p_ag_code IS NULL OR goyang_code = p_ag_code)
    AND (NOT p_target_only OR tgt) AND (p_at IS NULL OR at = p_at)
), v AS (
  SELECT * FROM f WHERE ar1 BETWEEN 95 AND 105
), v24 AS (
  SELECT * FROM v WHERE od >= current_date - 730
), sets AS (
  SELECT DISTINCT ON (no) no AS bid_ntce_no, drwt_yns FROM f WHERE drwt_yns IS NOT NULL ORDER BY no, id DESC
), rk AS (
  SELECT * FROM goyang_rank_notice WHERE bid_ntce_no IN (SELECT no FROM f)  -- m85: 공고별 순위 집계
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
      'rank_notices', (SELECT count(*) FROM rk),
      'as_of', (SELECT max(refreshed_at) FROM base), 'first_od', (SELECT min(od)::date FROM f), 'last_od', (SELECT max(od)::date FROM f)),
  'dist', (SELECT jsonb_agg(jsonb_build_object('label', w.label, 'n', d.n, 'mean', d.mean, 'pct', d.pct, 'lt100', d.lt100) ORDER BY w.ord)
           FROM (VALUES (1, '전체', 100000), (2, '최근 24개월', 730), (3, '최근 180일', 180)) w(ord, label, days)
           CROSS JOIN LATERAL (
             SELECT count(*) AS n, round(avg(ar1), 4) AS mean,
                    percentile_cont(ARRAY[0.1, 0.25, 0.5, 0.75, 0.9]) WITHIN GROUP (ORDER BY ar1) AS pct,
                    round(100.0 * count(*) FILTER (WHERE ar1 < 100) / NULLIF(count(*), 0), 1) AS lt100
             FROM v WHERE od >= current_date - w.days) d),
  'hist', (SELECT jsonb_agg(jsonb_build_array(b, c) ORDER BY b)
           FROM (SELECT round(floor(ar1 * 10) / 10, 1) AS b, count(*) AS c FROM v24 GROUP BY 1) h),
  'vals', (SELECT jsonb_agg(trunc(ar1, 4) ORDER BY ar1) FROM v24),
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
  'bids', jsonb_build_object(
      'n_notices', (SELECT count(*) FROM rk),
      'n', (SELECT coalesce(sum(bidders), 0) FROM rk),
      'n_below', (SELECT coalesce(sum(n_below), 0) FROM rk),
      'bidders_med', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY bidders))::numeric) FROM rk),
      'bidders_min', (SELECT min(bidders) FROM rk), 'bidders_max', (SELECT max(bidders) FROM rk),
      'near_med', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY near005))::numeric) FROM rk WHERE line IS NOT NULL),
      'lo', (SELECT coalesce(sum(lo), 0) FROM rk), 'hi', (SELECT coalesce(sum(hi), 0) FROM rk),
      'hist', (SELECT jsonb_agg(jsonb_build_array(b, c) ORDER BY b)
               FROM (SELECT e.key::numeric AS b, sum(e.value::bigint) AS c FROM rk, jsonb_each(rk.bins) e GROUP BY 1) h)),
  'anchor', (SELECT jsonb_build_object('n', n, 'pass', pass) FROM goyang_anchor),  -- m85: 3시간 갱신
  'recent', (SELECT jsonb_agg(jsonb_build_object(
                 'od', t.od::date, 'pn', t.pn, 'ag', t.ag, 'ba', t.ba, 'ar1', round(t.ar1, 4),
                 'br1', round(CASE WHEN t.ar1_up IS NOT NULL AND t.br1_raw BETWEEN 95 AND 105 THEN t.br1_raw
                                   WHEN t.ar1 IS NULL THEN NULL
                                   WHEN k.line IS NOT NULL AND k.max_below IS NOT NULL THEN t.ar1 * k.line / ((k.line + k.max_below) / 2)
                                   ELSE t.ar1 + 0.007 END, 4),
                 'br1_kind', CASE WHEN t.ar1_up IS NOT NULL AND t.br1_raw BETWEEN 95 AND 105 THEN 'exact'
                                  WHEN t.ar1 IS NULL THEN NULL
                                  WHEN k.line IS NOT NULL AND k.max_below IS NOT NULL THEN 'rank'
                                  ELSE 'est' END,
                 -- 자동 수집 기록의 br1 칸은 예정가격 대비 투찰률(90.x)이다
                 'r1_rate', coalesce(k.line, CASE WHEN t.br1_raw < 95 THEN t.br1_raw END,
                                     CASE WHEN t.bp > 0 AND t.xp > 0 THEN round(t.bp / t.xp * 100, 3) END),
                 'co', t.co, 'bidders', coalesce(k.bidders, NULLIF(t.pc, 0)))
               ORDER BY t.od DESC, t.id DESC)
             FROM (SELECT * FROM f ORDER BY od DESC, id DESC LIMIT 50) t LEFT JOIN rk k ON k.bid_ntce_no = t.no),
  'open', (SELECT jsonb_agg(jsonb_build_object('od', o.od::date, 'ag', o.ag, 'pn', o.pn, 'amt', coalesce(o.ba, o.ep),
                                               'ba_known', o.ba IS NOT NULL, 'tgt', coalesce(o.is_target, false),
                                               'pred', o.prediction_id IS NOT NULL)
                            ORDER BY o.od, o.bid_ntce_no)
           FROM goyang_open o  -- m85: 30분 갱신
           WHERE o.od >= now() AND (p_grp IS NULL OR o.goyang_grp = p_grp) AND (p_ag_code IS NULL OR o.ag_code = p_ag_code)
             AND (NOT p_target_only OR o.is_target))
);
$function$;

-- 3시간 갱신(cron 34)에 순위·안착안을 함께, 개찰 전 공고는 30분마다
SELECT cron.alter_job(job_id := 34, command := $c$
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.goyang_base;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.goyang_rank_notice;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.goyang_anchor;
$c$);
SELECT cron.schedule('goyang_open_refresh', '12,42 * * * *', 'REFRESH MATERIALIZED VIEW CONCURRENTLY public.goyang_open');
