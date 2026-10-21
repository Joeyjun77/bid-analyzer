-- m62: 매칭 행 가드 보호 범위 확대 + 복귀 시 원래 매칭 시각 유지 (2026-10-21, 코드 리뷰 Important 1·Minor 6)
--
-- 배경: m60은 보호 8컬럼 + match_status + matched_*만 지켰다. 업로드 upsert 페이로드에 함께 실리는
--       예측·추천·스냅샷 컬럼(pred_*, rec_*, benchmark_*, own_score, 실격위험 스냅샷 m39, 참가자 스냅샷 m41b)은
--       매칭 행에서도 감사 없이 바뀔 수 있었다(새로고침 안 한 옛 번들 탭, 저장 전 확인과 저장 사이 cron 매칭 경쟁).
--       이 값들이 바뀌면 매칭 시점에 계산된 adj_rate_error·rec_1st_possible·캘리브레이션 표본과 어긋난다.
-- 확인: 이 컬럼들을 쓰는 DB 함수는 auto_predict_from_notices·predict_notice(새 공고 예측)·re_predict_null_pending(대기 행)뿐 —
--       매칭 행을 정당하게 고치는 경로가 없다. 매처가 쓰는 actual_*·adj_rate_error·bid_amount_error·rec_1st_possible,
--       v7_*, b_pred_* NULL 채움, canonical_ag, is_cancelled, ai_advice 등은 보호 대상이 아니다.
-- 동작은 m60과 같다: OLD 값 유지 + WARNING + 감사 BLOCKED 행. 예외는 SET LOCAL app.allow_protected_update='on'.
-- 롤백: docs/v2/migrations/m60_bid_predictions_guard_matched.sql 재실행(가드 m60 정의) + m61 파일 재실행(매처).

CREATE OR REPLACE FUNCTION public.fn_bid_predictions_guard_matched()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- m56 감사 8컬럼 + 업로드 페이로드의 예측·추천·스냅샷 컬럼 (m62)
  cols constant text[] := ARRAY[
    'opt_adj','opt_bid','bid1st_v2_adj','bid1st_v2_bid','bid1st_v2_win_prob','bid1st_v2_floor_safe','bid1st_v2_grain','bid1st_v2_src',
    'pred_adj_rate','pred_expected_price','pred_floor_rate','pred_bid_amount','pred_source','pred_base_adj','opt_adj_router',
    'benchmark_bid','benchmark_rate','benchmark_n',
    'rec_adj_p25','rec_adj_p50','rec_adj_p75','rec_bid_p25','rec_bid_p50','rec_bid_p75','rec_strategy',
    'own_score','disq_risk_pct','safe_bid','floor_risk_n','floor_risk_grain',
    'exp_participants','exp_participants_n','exp_participants_grain'];
  oj jsonb; nj jsonb;
  keep jsonb := '{}'::jsonb; tried jsonb := '{}'::jsonb;
  blocked text[] := ARRAY[]::text[];
  c text;
BEGIN
  IF OLD.match_status IS DISTINCT FROM 'matched' THEN RETURN NEW; END IF;
  IF current_setting('app.allow_protected_update', true) = 'on' THEN RETURN NEW; END IF;

  oj := to_jsonb(OLD); nj := to_jsonb(NEW);
  FOREACH c IN ARRAY cols LOOP
    IF (nj -> c) IS DISTINCT FROM (oj -> c) THEN
      blocked := array_append(blocked, c);
      keep := keep || jsonb_build_object(c, oj -> c);
      tried := tried || jsonb_build_object(c, nj -> c);
    END IF;
  END LOOP;
  IF NEW.match_status IS DISTINCT FROM 'matched' THEN
    blocked := array_append(blocked, 'match_status');
    keep := keep || jsonb_build_object('match_status', 'matched');
    tried := tried || jsonb_build_object('match_status', NEW.match_status);
  END IF;
  IF OLD.actual_adj_rate IS NOT NULL THEN
    IF NEW.matched_record_id IS DISTINCT FROM OLD.matched_record_id THEN
      blocked := array_append(blocked, 'matched_record_id');
      keep := keep || jsonb_build_object('matched_record_id', OLD.matched_record_id);
      tried := tried || jsonb_build_object('matched_record_id', NEW.matched_record_id);
    END IF;
    IF NEW.matched_at IS DISTINCT FROM OLD.matched_at THEN
      blocked := array_append(blocked, 'matched_at');
      keep := keep || jsonb_build_object('matched_at', OLD.matched_at);
      tried := tried || jsonb_build_object('matched_at', NEW.matched_at);
    END IF;
  END IF;

  IF array_length(blocked, 1) IS NOT NULL THEN
    NEW := jsonb_populate_record(NEW, keep);
    RAISE WARNING 'bid_predictions 매칭 행 보호값 변경 차단 (id=%): %', OLD.id, blocked;
    BEGIN
      INSERT INTO public.bid_predictions_protected_audit (pred_id, jwt_role, changed_cols, old_vals, new_vals)
      VALUES (OLD.id, NULLIF(current_setting('request.jwt.claim.role', true), ''), array_prepend('BLOCKED', blocked), keep, tried);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '차단 기록 실패 (pred_id=%): % %', OLD.id, SQLSTATE, SQLERRM;  -- 기록 실패가 차단 자체를 무르지 않게 한다
    END;
  END IF;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.fn_bid_predictions_guard_matched() FROM PUBLIC, anon, authenticated;
