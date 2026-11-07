-- m70: 자동 예측(g2b_auto)에 개찰 전 기초금액·A값 반영 (스펙 .scratch/auto-pred-bssamt/spec.md)
-- 1) upsert_bid_notice: 재수집 때 ba를 NULL로 덮던 것 → 기존 값 유지
-- 2) bid_notices에 기초금액 확인·공개 시각 칸 (ba_open_dt는 저장 함수가 개찰일로 덮으므로 따로 둔다)
-- 3) 금액 헬퍼 auto_bid_from_adj — auto_predict_from_notices와 재계산이 같이 쓴다(식 두 벌 금지)
-- 4) 수집 대상 bssamt_targets, 저장·재계산 apply_bssamt_batch, 재계산 전 백업 표
-- 5) v_collect_health에 bssamt 줄
-- 함수 본문 일부만 바꾸는 곳(1·3·5)은 현재 정의에서 정확히 한 군데를 치환하고, 못 찾으면 실패한다.
-- 되돌리기: m70_rollback.sql

-- 1)
DO $m$ DECLARE d text := pg_get_functiondef('public.upsert_bid_notice'::regproc); o text := ' ba = EXCLUDED.ba,';
BEGIN
  IF (length(d) - length(replace(d, o, ''))) / length(o) <> 1 THEN RAISE EXCEPTION 'm70: upsert_bid_notice ba 줄을 정확히 1곳 찾지 못함'; END IF;
  EXECUTE replace(d, o, ' ba = COALESCE(EXCLUDED.ba, bid_notices.ba),');
END $m$;

-- 2)
ALTER TABLE public.bid_notices
  ADD COLUMN IF NOT EXISTS bssamt_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS bssamt_open_dt timestamptz;

-- 3) 예정가격 = 기초금액×(1+사정률/100), 투찰금 = A값 있으면 A+(예정가격−A)×하한율, 없으면 예정가격×하한율
CREATE OR REPLACE FUNCTION public.auto_bid_from_adj(p_ba numeric, p_av numeric, p_adj numeric, p_fr numeric, OUT xp numeric, OUT bid numeric)
LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT x, CASE WHEN COALESCE(p_av, 0) > 0 THEN CEIL(p_av + (x - p_av) * p_fr / 100) ELSE CEIL(x * p_fr / 100) END
  FROM (SELECT ROUND(p_ba * (1 + p_adj / 100), 0) AS x) s
$$;

DO $m$ DECLARE d text := pg_get_functiondef('public.auto_predict_from_notices'::regproc);
  o text := E'      v_xp  := ROUND(v_ba * (1 + v_final_adj / 100), 0);\n      IF COALESCE(n.av, 0) > 0 THEN\n        v_bid := CEIL(n.av + (v_xp - n.av) * v_fr / 100);\n      ELSE\n        v_bid := CEIL(v_xp * v_fr / 100);\n      END IF;';
BEGIN
  IF (length(d) - length(replace(d, o, ''))) / length(o) <> 1 THEN RAISE EXCEPTION 'm70: auto_predict_from_notices 금액 블록을 정확히 1곳 찾지 못함'; END IF;
  EXECUTE replace(d, o, E'      SELECT f.xp, f.bid INTO v_xp, v_bid FROM auto_bid_from_adj(v_ba, n.av, v_final_adj, v_fr) f;');
END $m$;

-- 4) 재계산 전 백업 — 만들 때 바로 잠근다
CREATE TABLE IF NOT EXISTS public.auto_pred_bssamt_backup (
  backed_at timestamptz NOT NULL DEFAULT now(),
  pred_id bigint NOT NULL,
  row_before jsonb NOT NULL
);
ALTER TABLE public.auto_pred_bssamt_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auto_pred_bssamt_backup FROM PUBLIC, anon, authenticated;

-- 대상: 예측이 있는 개찰 전 공고 중 ① 기초금액 미확인이고 20시간 넘게 안 봤거나 ② 확인 뒤 공고가 재수집됐거나(정정 가능성) ③ 개찰 2일 이내인데 그 전에만 확인한 것. 개찰 가까운 순
CREATE OR REPLACE FUNCTION public.bssamt_targets(p_limit integer)
RETURNS TABLE(id bigint, pn_no text, bid_ntce_ord text, od timestamptz, ep numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT n.id, n.pn_no, n.bid_ntce_ord, n.od, n.ep FROM bid_notices n
  WHERE n.is_target AND n.prediction_id IS NOT NULL AND n.od > now() AND n.pn_no IS NOT NULL
    AND (
      (n.ba IS NULL AND (n.bssamt_checked_at IS NULL OR n.bssamt_checked_at < now() - interval '20 hours'))
      OR n.updated_at > n.bssamt_checked_at
      OR (n.od < now() + interval '2 days' AND n.bssamt_checked_at < n.od - interval '2 days')
    )
  ORDER BY n.od, n.id LIMIT LEAST(GREATEST(p_limit, 1), 100)
$$;

-- p = [{notice_id, ba, av, ba_open_dt}] — ba NULL은 아직 미공개: 확인 시각만 남기고 기존 값은 그대로
-- 재계산은 연결된 개찰 전 대기 g2b_auto 예측만(매칭 행·업로드 행 제외), opt_adj·하한율은 그대로 두고 금액만 다시 계산
CREATE OR REPLACE FUNCTION public.apply_bssamt_batch(p jsonb)
RETURNS TABLE(notices_checked integer, notices_filled integer, preds_recomputed integer, bpred_reset integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_ids bigint[];
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
    SELECT pr.id, n.ba AS nba, COALESCE(n.av, 0) AS nav, pr.opt_adj, pr.pred_floor_rate AS fr
    FROM bid_predictions pr JOIN bid_notices n ON n.prediction_id = pr.id
    WHERE n.id = ANY(v_ids) AND n.ba IS NOT NULL
      AND pr.source = 'g2b_auto' AND pr.match_status = 'pending' AND pr.open_date > CURRENT_DATE
      AND NOT COALESCE(pr.is_cancelled, false) AND pr.opt_adj IS NOT NULL AND pr.pred_floor_rate IS NOT NULL
      AND (pr.ba IS DISTINCT FROM n.ba OR COALESCE(pr.av, 0) <> COALESCE(n.av, 0))
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

REVOKE ALL ON FUNCTION public.bssamt_targets(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_bssamt_batch(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.auto_bid_from_adj(numeric, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bssamt_targets(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_bssamt_batch(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.auto_bid_from_adj(numeric, numeric, numeric, numeric) TO service_role;

-- 5) 감시: 기초금액 수집 일별 호출·오류 (미실행이면 WARN)
DO $m$ DECLARE d text := pg_get_viewdef('public.v_collect_health'::regclass, true);
  o1 text := E'''getOpengResultListInfoCnstwkPreparPcDetail''::text])';
  o2 text := E'(''prepc''::text,''getOpengResultListInfoCnstwkPreparPcDetail''::text,''WARN''::text))';
BEGIN
  IF position(o1 IN d) = 0 OR position(o2 IN d) = 0 THEN RAISE EXCEPTION 'm70: v_collect_health 치환 위치를 찾지 못함'; END IF;
  d := replace(d, o1, E'''getOpengResultListInfoCnstwkPreparPcDetail''::text, ''getBidPblancListInfoCnstwkBsisAmount''::text])');
  d := replace(d, o2, E'(''prepc''::text,''getOpengResultListInfoCnstwkPreparPcDetail''::text,''WARN''::text), (''bssamt''::text,''getBidPblancListInfoCnstwkBsisAmount''::text,''WARN''::text))');
  EXECUTE 'CREATE OR REPLACE VIEW public.v_collect_health AS ' || d;
END $m$;
