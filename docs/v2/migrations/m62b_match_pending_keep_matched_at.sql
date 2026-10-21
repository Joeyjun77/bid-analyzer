-- m62b: match_pending_predictions — 같은 레코드로 복귀·백필할 때 원래 matched_at 유지 (2026-10-21, 코드 리뷰 Minor 6)
-- m61이 덮어쓰기로 pending에 멈춘 행을 matched로 되돌릴 때 matched_at = now()가 원래 매칭 시각을 지웠다.
-- 같은 레코드(matched_record_id 동일)면 기존 matched_at을 유지하고, 다른 레코드로 새로 매칭될 때만 now().
-- 나머지 정의는 m61과 같다. 롤백 = m61 파일 재실행.

CREATE OR REPLACE FUNCTION public.match_pending_predictions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count int := 0;
BEGIN
  WITH targets AS (
    SELECT p.id AS pred_id, p.pn_no, p.matched_record_id AS old_rec,
           p.open_date, p.ag AS pred_ag, p.source AS pred_source,
           p.pred_adj_rate, p.pred_bid_amount, p.rec_bid_p25, p.rec_bid_p50, p.rec_bid_p75,
           regexp_replace(p.pn_no, '-\d{1,3}$', '') AS pn_prefix
    FROM bid_predictions p
    WHERE p.pn_no IS NOT NULL AND p.open_date IS NOT NULL
      AND (p.match_status = 'pending' OR (p.match_status = 'matched' AND p.actual_adj_rate IS NULL))
  ),
  cands AS (
    SELECT t.pred_id, t.pred_ag, t.pred_adj_rate, t.pred_bid_amount,
      t.rec_bid_p25, t.rec_bid_p50, t.rec_bid_p75,
      r.id AS new_rec, r.ar1, r.bp, r.xp, r.co, r.pc, r.fr, r.floor_price,
      (r.pn_no = t.pn_no) AS exact_match,
      ABS(EXTRACT(EPOCH FROM (r.od::timestamp - t.open_date::timestamp))) AS dt_sec,
      (t.pred_ag IS NOT NULL AND r.ag IS NOT NULL
       AND left(regexp_replace(t.pred_ag,'\s','','g'),4) = left(regexp_replace(r.ag,'\s','','g'),4)) AS ag_match
    FROM targets t
    JOIN bid_records r
      -- 인덱스 range bound (text_pattern_ops) — 동적 prefix로 idx_bid_records_pn_no_pattern 사용 유도
      ON r.pn_no ~>=~ t.pn_prefix
     AND r.pn_no ~<~ (t.pn_prefix || E'\U0010FFFF')
      -- 원본 의미 보존 recheck
     AND r.pn_no LIKE t.pn_prefix || '%'
    WHERE r.od IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM bid_predictions u
        WHERE u.match_status = 'matched' AND u.actual_adj_rate IS NOT NULL
          AND u.matched_record_id = r.id
          AND u.source = t.pred_source  -- m47: same-source 한정 (cross-source 다중 매칭 허용)
      )
  ),
  filtered AS (SELECT * FROM cands WHERE dt_sec <= 30*86400 AND (exact_match OR ag_match)),
  ranked AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY pred_id ORDER BY (ar1 IS NOT NULL) DESC, exact_match DESC, dt_sec ASC) AS rk
    FROM filtered
  ),
  selected AS (
    SELECT pred_id, new_rec, ar1, bp, xp, co, pc, fr, floor_price,
      pred_adj_rate, pred_bid_amount, rec_bid_p25, rec_bid_p50, rec_bid_p75,
      CASE WHEN ar1 IS NULL THEN NULL WHEN ar1 >= 50 THEN ROUND((ar1-100)::numeric, 4) ELSE ROUND(ar1::numeric, 4) END AS new_actual_adj
    FROM ranked WHERE rk=1
  )
  UPDATE bid_predictions p SET
    match_status = 'matched', matched_record_id = s.new_rec,
    matched_at = CASE WHEN p.matched_record_id IS NOT DISTINCT FROM s.new_rec THEN COALESCE(p.matched_at, now()) ELSE now() END,  -- m62b
    actual_adj_rate = s.new_actual_adj, actual_expected_price = s.xp, actual_bid_amount = s.bp,
    actual_winner = s.co, actual_participant_count = s.pc,
    adj_rate_error = CASE WHEN s.pred_adj_rate IS NOT NULL AND s.new_actual_adj IS NOT NULL THEN ROUND((s.pred_adj_rate - s.new_actual_adj)::numeric, 4) END,
    bid_amount_error = CASE WHEN s.pred_bid_amount IS NOT NULL AND s.bp IS NOT NULL THEN ROUND((s.pred_bid_amount - s.bp)::numeric, 0) END,
    -- v8 #2: 상한 < bp (동가 보수화). 하한 >= floor_price 유지.
    rec_1st_possible = CASE WHEN s.bp IS NOT NULL AND s.floor_price IS NOT NULL
      THEN jsonb_build_object(
        'existing', (s.pred_bid_amount IS NOT NULL AND s.pred_bid_amount < s.bp AND s.pred_bid_amount >= s.floor_price),
        'aggressive', (s.rec_bid_p25 IS NOT NULL AND s.rec_bid_p25 < s.bp AND s.rec_bid_p25 >= s.floor_price),
        'balanced', (s.rec_bid_p50 IS NOT NULL AND s.rec_bid_p50 < s.bp AND s.rec_bid_p50 >= s.floor_price),
        'conservative', (s.rec_bid_p75 IS NOT NULL AND s.rec_bid_p75 < s.bp AND s.rec_bid_p75 >= s.floor_price)
      )::text END
  FROM selected s
  WHERE p.id = s.pred_id
    AND (p.matched_record_id IS DISTINCT FROM s.new_rec OR p.actual_adj_rate IS DISTINCT FROM s.new_actual_adj
         OR p.match_status <> 'matched');  -- m61: 덮어쓰기로 pending에 멈춘 행 복귀
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
