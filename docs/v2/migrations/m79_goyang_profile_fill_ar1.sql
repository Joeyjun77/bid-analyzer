-- m79: goyang_profile 사정률 빈칸을 예비가격 세트로 채움 (goyang-focus issue 04 후속, 2026-11-08, 사용자 승인 "Yes, fill it")
-- 자동 수집 bid_records는 ar1(발주처사정율)이 비어 최근 180일 분포가 325건 중 41건으로만 계산됐다.
-- bid_prelim_sets.plnprc/bssamt*100 은 ar1과 같은 값(둘 다 있는 348건 차이 0, 11/8 실측) → coalesce(ar1, 계산값).
-- 화면 표시 전용 RPC만 바뀐다(예측 경로 무관, Neutral). CREATE OR REPLACE라 권한(authenticated만) 유지.
-- 되돌리기: m79_rollback.sql
DO $m$ DECLARE d text := pg_get_functiondef('public.goyang_profile(text,text,boolean,text)'::regprocedure);
  o text := 'SELECT r.id, r.od, r.ar1, r.at,';
  n text := 'SELECT r.id, r.od, coalesce(r.ar1, (SELECT s.plnprc::numeric / NULLIF(s.bssamt, 0) * 100 FROM bid_prelim_sets s WHERE s.bid_ntce_no = split_part(r.pn_no, ''-'', 1) ORDER BY s.id DESC LIMIT 1)) AS ar1, r.at,';
BEGIN
  IF (length(d) - length(replace(d, o, ''))) / length(o) <> 1 THEN RAISE EXCEPTION 'm79: goyang_profile 치환 위치를 정확히 1곳 찾지 못함'; END IF;
  EXECUTE replace(d, o, n);
END $m$;
