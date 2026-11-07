-- m71: m70 코드 리뷰 반영 (2026-11-07)
-- 1) m70의 CREATE OR REPLACE VIEW가 v_collect_health의 security_invoker를 지웠다(실측 reloptions NULL) → 복구
-- 2) apply_bssamt_batch: "오늘"을 KST 날짜로(DB 시간대 UTC라 KST 00~09시 실행이면 오늘 개찰 행까지 리셋됐다),
--    한 예측에 공고가 여럿 붙으면 가장 최근 공고 한 줄만(중복 백업·임의 갱신 방지)
-- 3) 기록: cron 등록(m70 적용 직후 실행, jobid 31·32)
--    SELECT cron.schedule('bssamt_collect_0830kst', '30 23 * * *', $c$ SELECT public.invoke_edge_function('fn-collect-bssamt', jsonb_build_object('dry_run', false, 'limit', 100), 140000); $c$);
--    SELECT cron.schedule('bssamt_collect_1900kst', '0 10 * * *',  $c$ SELECT public.invoke_edge_function('fn-collect-bssamt', jsonb_build_object('dry_run', false, 'limit', 100), 140000); $c$);

ALTER VIEW public.v_collect_health SET (security_invoker = true);

CREATE OR REPLACE FUNCTION public.apply_bssamt_batch(p jsonb)
RETURNS TABLE(notices_checked integer, notices_filled integer, preds_recomputed integer, bpred_reset integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_ids bigint[]; v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  WITH e AS (
    SELECT (x->>'notice_id')::bigint AS nid, NULLIF(x->>'ba','')::numeric AS ba, NULLIF(x->>'av','')::numeric AS av,
           NULLIF(x->>'ba_open_dt','')::timestamp AT TIME ZONE 'Asia/Seoul' AS odt
    FROM jsonb_array_elements(p) x
  ), u AS (
    UPDATE bid_notices n SET bssamt_checked_at = now(),
      ba = COALESCE(e.ba, n.ba),
      av = CASE WHEN e.ba IS NOT NULL THEN COALESCE(e.av, 0) ELSE n.av END,
      bssamt_open_dt = COALESCE(e.odt, n.bssamt_open_dt)
    FROM e WHERE n.id = e.nid
    RETURNING n.id, e.ba IS NOT NULL AS filled
  )
  SELECT array_agg(u.id), count(*)::int, count(*) FILTER (WHERE u.filled)::int INTO v_ids, notices_checked, notices_filled FROM u;

  WITH t AS (
    SELECT DISTINCT ON (pr.id) pr.id, n.ba AS nba, COALESCE(n.av, 0) AS nav, pr.opt_adj, pr.pred_floor_rate AS fr
    FROM bid_predictions pr JOIN bid_notices n ON n.prediction_id = pr.id
    WHERE n.id = ANY(v_ids) AND n.ba IS NOT NULL
      AND pr.source = 'g2b_auto' AND pr.match_status = 'pending' AND pr.open_date > v_today
      AND NOT COALESCE(pr.is_cancelled, false) AND pr.opt_adj IS NOT NULL AND pr.pred_floor_rate IS NOT NULL
      AND (pr.ba IS DISTINCT FROM n.ba OR COALESCE(pr.av, 0) <> COALESCE(n.av, 0))
    ORDER BY pr.id, n.updated_at DESC, n.id DESC
  ), bk AS (
    INSERT INTO auto_pred_bssamt_backup(pred_id, row_before)
    SELECT pr.id, to_jsonb(pr) FROM bid_predictions pr JOIN t ON t.id = pr.id
    RETURNING pred_id
  ), up AS (
    UPDATE bid_predictions pr SET ba = t.nba, av = t.nav,
      pred_expected_price = c.xp, pred_bid_amount = c.bid, opt_bid = c.bid, rec_bid_p50 = c.bid,
      -- benchmark_rate는 소수 4자리로 저장돼 있어 원래 식과 몇 원 차이 날 수 있다
      benchmark_bid = CASE WHEN pr.benchmark_rate IS NOT NULL THEN CEIL(t.nba * pr.benchmark_rate / 100) END,
      -- 안착안(B)만 비워 앱이 새 기초금액·A값으로 다시 채우게 한다. 군시설 A행은 서버 금액만 갱신
      b_pred_mode            = CASE WHEN pr.b_pred_mode = 'B' THEN NULL ELSE pr.b_pred_mode END,
      b_pred_adj             = CASE WHEN pr.b_pred_mode = 'B' THEN NULL ELSE pr.b_pred_adj END,
      b_pred_bid_amount      = CASE WHEN pr.b_pred_mode = 'B' THEN NULL ELSE pr.b_pred_bid_amount END,
      b_pred_floor_pass_prob = CASE WHEN pr.b_pred_mode = 'B' THEN NULL ELSE pr.b_pred_floor_pass_prob END,
      b_pred_grain           = CASE WHEN pr.b_pred_mode = 'B' THEN NULL ELSE pr.b_pred_grain END,
      b_pred_src             = CASE WHEN pr.b_pred_mode = 'B' THEN NULL ELSE pr.b_pred_src END
    FROM t CROSS JOIN LATERAL auto_bid_from_adj(t.nba, t.nav, t.opt_adj, t.fr) c
    WHERE pr.id = t.id AND EXISTS (SELECT 1 FROM bk WHERE bk.pred_id = t.id)
    RETURNING pr.id, pr.b_pred_mode IS NULL AS reset
  )
  SELECT count(*)::int, count(*) FILTER (WHERE up.reset)::int INTO preds_recomputed, bpred_reset FROM up;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_bssamt_batch(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_bssamt_batch(jsonb) TO service_role;
