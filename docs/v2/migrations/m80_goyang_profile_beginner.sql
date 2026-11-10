-- m80: 고양 탭 초보자용 개편 — goyang_profile 출력 확장 + 순위 수집 빈 결과 재시도 제한
-- (goyang-focus issue 04 후속, 2026-11-10, 사용자 승인 "고쳐줘")
-- 1) goyang_profile: 화면 표시 전용(Neutral, 예측 경로 무관). 추가 키
--    hist(사정률 0.1 구간, 최근 24개월) · dist에 24개월 행·100 미만 비율 · bids(낙찰선 기준 투찰 위치) ·
--    anchor(안착안 하한 통과) · recent(최근 낙찰 50건, G2B 양식 열) · open(개찰 전 공고). firms(반복 참여 상위 10)는 삭제.
--    같은 공고의 업로드분·자동 수집분 중복은 업로드분만 집계(전 구간 수치가 소폭 줄어든다).
--    1위사정율(100%) = 발주처사정율 × 1위 금액 ÷ 낙찰하한가 (업로드 209건 평균 차이 0.0001, 11/10 실측).
--    자동 수집 기록은 A값이 없어 낙찰하한가를 못 구한다 → kind로 구분:
--      exact = 업로드 값 / rank = 순위 수집분(낙찰선이 미달 최고~유효 최저 사이, 중앙 0.003%p 폭) /
--      est = 발주처사정율 + 0.007 (업로드 413건의 1위−발주처 차이 중앙값, p90 0.046, 음수 0건)
-- 2) rank_targets: 결과 0건 응답이 3번 쌓인 공고는 대상에서 뺀다(유찰 등. 매일 재호출하며 LIMIT 자리를 차지하던 문제).
-- CREATE OR REPLACE라 권한 유지(goyang_profile: authenticated·service_role만). 되돌리기: m80_rollback.sql

CREATE OR REPLACE FUNCTION public.goyang_profile(p_grp text DEFAULT NULL, p_ag_code text DEFAULT NULL,
                                                 p_target_only boolean DEFAULT false, p_at text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH base0 AS (
  SELECT r.id, r.od, r.at, r.ag, r.pn, r.co, r.pc, r.bp::numeric AS bp, r.xp::numeric AS xp,
         r.br1 AS br1_raw, r.ar1 AS ar1_up, r.goyang_code, r.goyang_grp,
         split_part(r.pn_no, '-', 1) AS no,
         count(*) FILTER (WHERE r.ar1 IS NOT NULL) OVER (PARTITION BY split_part(r.pn_no, '-', 1)) AS up_n,
         row_number() OVER (PARTITION BY split_part(r.pn_no, '-', 1) ORDER BY (r.co IS NULL), (r.bp IS NULL), r.id DESC) AS api_rn,
         coalesce(r.ba, s.bssamt) AS ba,
         -- 자동 수집 기록은 ar1이 비어 예비가격 세트(예정가격÷기초금액)로 채운다(m79)
         coalesce(r.ar1, s.plnprc::numeric / NULLIF(s.bssamt, 0) * 100) AS ar1,
         coalesce((SELECT bool_or(n.is_target) FROM bid_notices n WHERE n.bid_ntce_no = split_part(r.pn_no, '-', 1)),
                  r.cat ~ '(전기|통신|소방)', false) AS tgt
  FROM v_goyang_records r
  LEFT JOIN LATERAL (SELECT s.bssamt, s.plnprc FROM bid_prelim_sets s
                     WHERE s.bid_ntce_no = split_part(r.pn_no, '-', 1) ORDER BY s.id DESC LIMIT 1) s ON true
), base AS (
  -- 같은 공고가 두 번 있으면 한 줄만 쓴다(고양 46공고, 11/10 실측): 업로드분(-000)이 있으면 업로드분,
  -- 자동 수집분끼리 겹치면 낙찰업체·금액이 있는 최신 1줄
  SELECT * FROM base0 WHERE ar1_up IS NOT NULL OR (up_n = 0 AND api_rn = 1)
), f AS (
  SELECT * FROM base
  WHERE (p_grp IS NULL OR goyang_grp = p_grp) AND (p_ag_code IS NULL OR goyang_code = p_ag_code)
    AND (NOT p_target_only OR tgt) AND (p_at IS NULL OR at = p_at)
), v AS (
  SELECT * FROM f WHERE ar1 BETWEEN 95 AND 105
), v24 AS (
  SELECT * FROM v WHERE od >= current_date - 730
), sets AS (
  SELECT DISTINCT ON (s.bid_ntce_no) s.bid_ntce_no, s.drwt_yns
  FROM bid_prelim_sets s WHERE s.bid_ntce_no IN (SELECT no FROM f)
  ORDER BY s.bid_ntce_no, s.id DESC
), ranks AS (
  SELECT * FROM api_bid_ranks WHERE bid_ntce_no IN (SELECT no FROM f)
), rk AS (
  -- 낙찰선 = 유효 투찰 중 최저(25공고 모두 1순위와 일치, 11/10 실측)
  SELECT bid_ntce_no, count(*) AS bidders,
         count(*) FILTER (WHERE rmrk = '낙찰하한선 미달') AS n_below,
         min(rate_vs_plnprc) FILTER (WHERE rmrk = '정상') AS line,
         max(rate_vs_plnprc) FILTER (WHERE rmrk = '낙찰하한선 미달') AS max_below
  FROM ranks GROUP BY 1
), gap AS (
  SELECT r.bid_ntce_no, r.rate_vs_plnprc - k.line AS g
  FROM ranks r JOIN rk k USING (bid_ntce_no)
  WHERE r.rmrk IN ('정상', '낙찰하한선 미달') AND k.line IS NOT NULL
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
      'first_od', (SELECT min(od)::date FROM f), 'last_od', (SELECT max(od)::date FROM f)),
  'dist', (SELECT jsonb_agg(jsonb_build_object('label', w.label, 'n', d.n, 'mean', d.mean, 'pct', d.pct, 'lt100', d.lt100) ORDER BY w.ord)
           FROM (VALUES (1, '전체', 100000), (2, '최근 24개월', 730), (3, '최근 180일', 180)) w(ord, label, days)
           CROSS JOIN LATERAL (
             SELECT count(*) AS n, round(avg(ar1), 4) AS mean,
                    percentile_cont(ARRAY[0.1, 0.25, 0.5, 0.75, 0.9]) WITHIN GROUP (ORDER BY ar1) AS pct,
                    round(100.0 * count(*) FILTER (WHERE ar1 < 100) / NULLIF(count(*), 0), 1) AS lt100
             FROM v WHERE od >= current_date - w.days) d),
  'hist', (SELECT jsonb_agg(jsonb_build_array(b, c) ORDER BY b)
           FROM (SELECT round(floor(ar1 * 10) / 10, 1) AS b, count(*) AS c FROM v24 GROUP BY 1) h),
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
      'near_med', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY c))::numeric)
                   FROM (SELECT count(*) FILTER (WHERE g >= 0 AND g < 0.05) AS c FROM gap GROUP BY bid_ntce_no) x),
      'lo', (SELECT count(*) FROM gap WHERE g < -1.5), 'hi', (SELECT count(*) FROM gap WHERE g >= 2.0),
      'hist', (SELECT jsonb_agg(jsonb_build_array(b, c) ORDER BY b)
               FROM (SELECT round(floor(g * 10) / 10, 1) AS b, count(*) AS c FROM gap WHERE g >= -1.5 AND g < 2.0 GROUP BY 1) h)),
  -- 안착안 하한 통과: 선택과 무관하게 고양 전체. 과거 매칭 행에 나중에 채운 b_pred 값이 섞여 있다
  'anchor', (SELECT jsonb_build_object('n', count(*), 'pass', count(*) FILTER (WHERE p.b_pred_bid_amount >= r.floor_price))
             FROM bid_predictions p JOIN bid_records r ON r.id = p.matched_record_id
             WHERE p.match_status = 'matched' AND r.floor_price > 0 AND p.b_pred_bid_amount > 0
               AND trim(p.ag) IN (SELECT a.ag_text FROM goyang_org_alias a JOIN goyang_org_master m USING (ag_code) WHERE m.include)),
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
           FROM (SELECT DISTINCT ON (n.bid_ntce_no) n.bid_ntce_no, n.od, n.ag, n.pn, n.ba, n.ep, n.is_target, n.prediction_id
                 FROM v_goyang_notices n
                 WHERE n.od >= now() AND (p_grp IS NULL OR n.goyang_grp = p_grp) AND (p_ag_code IS NULL OR n.ag_code = p_ag_code)
                   AND (NOT p_target_only OR n.is_target)
                 ORDER BY n.bid_ntce_no, n.updated_at DESC) o)
);
$$;

CREATE OR REPLACE FUNCTION public.rank_targets(p_since date DEFAULT '2026-04-01'::date, p_limit integer DEFAULT 20)
 RETURNS TABLE(bid_ntce_no text, od timestamp with time zone)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  SELECT n.bid_ntce_no, max(n.od)
  FROM v_goyang_notices n
  WHERE n.is_target AND n.od >= p_since AND n.od < now() - interval '2 hours'
    AND NOT EXISTS (SELECT 1 FROM api_bid_rank_notices d WHERE d.bid_ntce_no = n.bid_ntce_no)
    AND (SELECT count(*) FROM api_ingestion_log l
         WHERE l.operation = 'getOpengResultListInfoOpengCompt' AND l.total_count = 0
           AND l.params->>'bidNtceNo' = n.bid_ntce_no) < 3
  GROUP BY n.bid_ntce_no
  ORDER BY max(n.od)
  LIMIT p_limit;
$function$;
