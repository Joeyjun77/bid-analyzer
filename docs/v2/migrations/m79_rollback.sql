-- m79 되돌리기: goyang_profile 사정률을 ar1만 쓰던 m78 상태로
DO $m$ DECLARE d text := pg_get_functiondef('public.goyang_profile(text,text,boolean,text)'::regprocedure);
  o text := 'SELECT r.id, r.od, coalesce(r.ar1, (SELECT s.plnprc::numeric / NULLIF(s.bssamt, 0) * 100 FROM bid_prelim_sets s WHERE s.bid_ntce_no = split_part(r.pn_no, ''-'', 1) ORDER BY s.id DESC LIMIT 1)) AS ar1, r.at,';
  n text := 'SELECT r.id, r.od, r.ar1, r.at,';
BEGIN
  IF (length(d) - length(replace(d, o, ''))) / length(o) <> 1 THEN RAISE EXCEPTION 'm79_rollback: 치환 위치를 정확히 1곳 찾지 못함'; END IF;
  EXECUTE replace(d, o, n);
END $m$;
