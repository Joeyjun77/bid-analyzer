-- m64e: 대조 보고 업종 재현율 정정 (2026-10-23, 리뷰 M8)
-- 분모를 엑셀 업종 '전기' 행으로 한정(통신·소방 엑셀 행 제외), 자동 행 연결은 excel_record_id(임의 1행) 대신 공고번호 본체.
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
    SELECT DISTINCT split_part(e.pn_no, '-', 1) AS no FROM bid_records e
    WHERE e.od BETWEEN p_from AND p_to AND e.g2b IS NOT NULL AND e.ar1 IS NOT NULL
      AND e.pn_no ~ '^R' AND e.reg ILIKE '%경기%' AND e.cat LIKE '%전기%'
  ), m AS (
    SELECT 'ar1' AS metric, count(*) AS n, count(*) FILTER (WHERE abs(ar1 - e_ar1) <= 0.0001) AS ok, 99.0 AS th FROM c WHERE e_ar1 IS NOT NULL
    UNION ALL SELECT 'br1', count(*), count(*) FILTER (WHERE abs(br1 - e_br1) <= 0.001), 98.0 FROM c WHERE e_br1 IS NOT NULL
    UNION ALL SELECT 'floor_price', count(*), count(*) FILTER (WHERE abs(floor_price - e_floor) <= 10), 98.0 FROM c WHERE e_floor IS NOT NULL
    UNION ALL SELECT 'ba', count(*), count(*) FILTER (WHERE ba = e_ba), NULL FROM c WHERE e_ba IS NOT NULL
    UNION ALL SELECT 'av', count(*), count(*) FILTER (WHERE av = e_av), NULL FROM c WHERE e_av IS NOT NULL
    UNION ALL SELECT 'xp', count(*), count(*) FILTER (WHERE xp = e_xp), NULL FROM c WHERE e_xp IS NOT NULL
    UNION ALL SELECT 'trade_recall', count(*),
                     count(*) FILTER (WHERE EXISTS (SELECT 1 FROM g2b_auto_sheet g WHERE g.bid_ntce_no = ex.no AND g.trade_elec IS TRUE)),
                     95.0 FROM ex
  )
  SELECT metric, n::int, ok::int, round(100.0 * ok / NULLIF(n, 0), 2),
         CASE WHEN th IS NULL THEN NULL ELSE n > 0 AND 100.0 * ok / n >= th END
  FROM m
$$;
