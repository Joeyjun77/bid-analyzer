-- m81: goyang_profile 첫 호출 시간 초과 수정 — 고양 기록 요약 표(goyang_base) (goyang-focus issue 04, 2026-11-10)
-- 증상: 고양 탭 조회가 8초 제한(authenticated statement_timeout)에 걸려 500 (11/10 22:46 KST 로그).
-- 원인: 호출마다 bid_records 2,451행(idx_bid_ag로 흩어진 페이지) + 행마다 bid_prelim_sets·bid_notices 색인 조회.
--       자료가 메모리에 없으면 한 번에 약 1만 페이지를 디스크에서 읽어 3~10초(실측: 첫 호출 4.9초·10.4초, 재호출 0.3초).
-- 수정: 그 조인 결과(약 2,400행)를 구체화 뷰로 두고 함수는 이 표만 읽는다. 3시간마다 갱신.
-- 화면 표시 전용(Neutral). 권한: anon·authenticated 회수 — SECURITY DEFINER 함수만 읽는다(스냅샷 표 잠금 규칙).
-- 되돌리기: m81_rollback.sql

CREATE MATERIALIZED VIEW public.goyang_base AS
WITH base0 AS (
  SELECT r.id, r.od, r.at, r.ag, r.pn, r.co, r.pc, r.bp::numeric AS bp, r.xp::numeric AS xp,
         r.br1 AS br1_raw, r.ar1 AS ar1_up, r.goyang_code, r.goyang_grp,
         split_part(r.pn_no, '-', 1) AS no,
         count(*) FILTER (WHERE r.ar1 IS NOT NULL) OVER (PARTITION BY split_part(r.pn_no, '-', 1)) AS up_n,
         row_number() OVER (PARTITION BY split_part(r.pn_no, '-', 1) ORDER BY (r.co IS NULL), (r.bp IS NULL), r.id DESC) AS api_rn,
         coalesce(r.ba, s.bssamt) AS ba,
         -- 자동 수집 기록은 ar1이 비어 예비가격 세트(예정가격÷기초금액)로 채운다(m79)
         coalesce(r.ar1, s.plnprc::numeric / NULLIF(s.bssamt, 0) * 100) AS ar1,
         s.drwt_yns,
         coalesce((SELECT bool_or(n.is_target) FROM bid_notices n WHERE n.bid_ntce_no = split_part(r.pn_no, '-', 1)),
                  r.cat ~ '(전기|통신|소방)', false) AS tgt
  FROM v_goyang_records r
  LEFT JOIN LATERAL (SELECT s.bssamt, s.plnprc, s.drwt_yns FROM bid_prelim_sets s
                     WHERE s.bid_ntce_no = split_part(r.pn_no, '-', 1) ORDER BY s.id DESC LIMIT 1) s ON true
)
-- 같은 공고가 두 번 있으면 한 줄만 쓴다(고양 46공고, 11/10 실측): 업로드분(-000)이 있으면 업로드분,
-- 자동 수집분끼리 겹치면 낙찰업체·금액이 있는 최신 1줄
SELECT id, od, at, ag, pn, co, pc, bp, xp, br1_raw, ar1_up, goyang_code, goyang_grp, no, ba, ar1, drwt_yns, tgt, now() AS refreshed_at
FROM base0 WHERE ar1_up IS NOT NULL OR (up_n = 0 AND api_rn = 1);

CREATE UNIQUE INDEX goyang_base_id ON public.goyang_base (id);
REVOKE ALL ON public.goyang_base FROM PUBLIC, anon, authenticated;

-- goyang_profile: base0·base·sets 세 CTE를 goyang_base 읽기로 바꾼다(나머지 본문은 m80 그대로)
DO $m$ DECLARE d text := pg_get_functiondef('public.goyang_profile(text,text,boolean,text)'::regprocedure);
  p1 int := position('WITH base0 AS (' in d); p2 int := position('), f AS (' in d);
  p3 int; p4 int; o5 text := '''first_od'', (SELECT min(od)::date FROM f),';
BEGIN
  IF p1 = 0 OR p2 <= p1 THEN RAISE EXCEPTION 'm81: base CTE 위치를 찾지 못함'; END IF;
  d := left(d, p1 - 1) || 'WITH base AS (' || E'\n  SELECT * FROM goyang_base  -- m81: 3시간마다 갱신되는 요약 표\n' || substr(d, p2);
  p3 := position('), sets AS (' in d); p4 := position('), ranks AS (' in d);
  IF p3 = 0 OR p4 <= p3 THEN RAISE EXCEPTION 'm81: sets CTE 위치를 찾지 못함'; END IF;
  d := left(d, p3 - 1) || '), sets AS (' || E'\n  SELECT DISTINCT ON (no) no AS bid_ntce_no, drwt_yns FROM f WHERE drwt_yns IS NOT NULL ORDER BY no, id DESC\n' || substr(d, p4);
  IF (length(d) - length(replace(d, o5, ''))) / length(o5) <> 1 THEN RAISE EXCEPTION 'm81: summary 위치를 찾지 못함'; END IF;
  d := replace(d, o5, '''as_of'', (SELECT max(refreshed_at) FROM base), ' || o5);
  EXECUTE d;
END $m$;

-- 3시간마다 갱신(UTC 매 3시간 40분 = KST 07:40 포함. 06:00 결과 수집·07:20 순위 수집 뒤)
SELECT cron.schedule('goyang_base_refresh', '40 */3 * * *', 'REFRESH MATERIALIZED VIEW CONCURRENTLY public.goyang_base');
