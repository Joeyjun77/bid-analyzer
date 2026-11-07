-- m70 되돌리기. 순서: cron 해제 → 대기 예측 복원 → (필요 시) 공고 값 비우기 → 함수·뷰 원복
-- 매칭된 행은 보호 가드 때문에 복원 대상이 아니다(문제는 매칭 전에 판단).

-- 0) cron 해제
-- SELECT cron.unschedule(jobid) FROM cron.job WHERE command ILIKE '%fn-collect-bssamt%';

-- 1) 아직 대기 중인 예측을 처음 백업본으로 복원 (같은 행이 여러 번 백업됐으면 가장 이른 것)
WITH b AS (
  SELECT DISTINCT ON (pred_id) pred_id, row_before FROM public.auto_pred_bssamt_backup ORDER BY pred_id, backed_at
)
UPDATE public.bid_predictions pr SET
  ba = (b.row_before->>'ba')::numeric, av = (b.row_before->>'av')::numeric,
  pred_expected_price = (b.row_before->>'pred_expected_price')::numeric,
  pred_bid_amount = (b.row_before->>'pred_bid_amount')::numeric,
  opt_bid = (b.row_before->>'opt_bid')::numeric, rec_bid_p50 = (b.row_before->>'rec_bid_p50')::numeric,
  benchmark_bid = (b.row_before->>'benchmark_bid')::numeric,
  b_pred_mode = b.row_before->>'b_pred_mode', b_pred_adj = (b.row_before->>'b_pred_adj')::numeric,
  b_pred_bid_amount = (b.row_before->>'b_pred_bid_amount')::numeric,
  b_pred_floor_pass_prob = (b.row_before->>'b_pred_floor_pass_prob')::numeric,
  b_pred_grain = b.row_before->>'b_pred_grain', b_pred_src = b.row_before->>'b_pred_src'
FROM b WHERE pr.id = b.pred_id AND pr.match_status = 'pending'
  AND pr.opt_adj = (b.row_before->>'opt_adj')::numeric; -- 백업 뒤 다시 예측된 행에 옛 금액을 덮지 않게

-- 2) (필요 시) 이 수집이 채운 공고 값 비우기
-- UPDATE public.bid_notices SET ba = NULL, av = NULL WHERE bssamt_checked_at IS NOT NULL;

-- 3) 함수·뷰 원복
DROP FUNCTION IF EXISTS public.apply_bssamt_batch(jsonb); -- m71 판도 함께 제거
DROP FUNCTION IF EXISTS public.bssamt_targets(integer);

DO $m$ DECLARE d text := pg_get_functiondef('public.auto_predict_from_notices'::regproc);
  o text := E'      SELECT f.xp, f.bid INTO v_xp, v_bid FROM auto_bid_from_adj(v_ba, n.av, v_final_adj, v_fr) f;';
BEGIN
  IF position(o IN d) = 0 THEN RAISE EXCEPTION 'rollback: 헬퍼 호출 줄 없음'; END IF;
  EXECUTE replace(d, o, E'      v_xp  := ROUND(v_ba * (1 + v_final_adj / 100), 0);\n      IF COALESCE(n.av, 0) > 0 THEN\n        v_bid := CEIL(n.av + (v_xp - n.av) * v_fr / 100);\n      ELSE\n        v_bid := CEIL(v_xp * v_fr / 100);\n      END IF;');
END $m$;
DROP FUNCTION IF EXISTS public.auto_bid_from_adj(numeric, numeric, numeric, numeric);

DO $m$ DECLARE d text := pg_get_functiondef('public.upsert_bid_notice'::regproc); o text := ' ba = COALESCE(EXCLUDED.ba, bid_notices.ba),';
BEGIN
  IF position(o IN d) = 0 THEN RAISE EXCEPTION 'rollback: upsert ba 줄 없음'; END IF;
  EXECUTE replace(d, o, ' ba = EXCLUDED.ba,');
END $m$;

DO $m$ DECLARE d text := pg_get_viewdef('public.v_collect_health'::regclass, true);
  o1 text := E', ''getBidPblancListInfoCnstwkBsisAmount''::text])';
  o2 text := E', (''bssamt''::text,''getBidPblancListInfoCnstwkBsisAmount''::text,''WARN''::text))';
BEGIN
  IF position(o1 IN d) = 0 OR position(o2 IN d) = 0 THEN RAISE EXCEPTION 'rollback: v_collect_health bssamt 줄 없음'; END IF;
  d := replace(replace(d, o1, E'])'), o2, E')');
  -- m69가 만든 security_invoker를 유지(OR REPLACE는 WITH 없으면 옵션을 지운다 — m71)
  EXECUTE 'CREATE OR REPLACE VIEW public.v_collect_health WITH (security_invoker = true) AS ' || d;
END $m$;

-- 컬럼·백업 표는 기록용으로 남긴다(지우려면 아래)
-- ALTER TABLE public.bid_notices DROP COLUMN bssamt_checked_at, DROP COLUMN bssamt_open_dt;
-- DROP TABLE public.auto_pred_bssamt_backup;
