-- m60: 매칭 행 보호 BEFORE UPDATE 가드 (2026-10-20, 사용자 승인 "수정 진행")
--
-- 배경: 업로드 upsert(sbSavePredictions, merge-duplicates)가 매칭 행을 pending으로 되돌리며 보호값을 덮었다(m59 원복).
--       클라 가드(263c60d)는 PATCH 경로에만 있어 경로마다 막는 방식으로는 새 경로가 생길 때마다 구멍이 난다 → DB에서 일괄 차단.
-- 규칙 (OLD.match_status='matched'일 때):
--   - 보호 8컬럼(m56 감사 대상과 동일)은 OLD 값 유지
--   - match_status는 'matched'에서 벗어나지 못함
--   - matched_record_id·matched_at은 실측이 채워진 행(OLD.actual_adj_rate NOT NULL)에서 OLD 유지
--     (실측 NULL인 matched 행은 매처가 재매칭·백필하는 정상 경로라 허용)
-- 막은 시도는 조용히 넘기지 않는다: RAISE WARNING + 감사 테이블에 changed_cols[1]='BLOCKED' 행을 남긴다.
--   (값이 OLD로 되돌아가므로 AFTER 감사 트리거는 변경을 보지 못한다 — 차단 흔적은 이 행이 유일)
-- 승인된 예외(원복 등)는 같은 트랜잭션에서 SET LOCAL app.allow_protected_update = 'on' 후 실행한다.

CREATE OR REPLACE FUNCTION public.fn_bid_predictions_guard_matched()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  blocked text[] := ARRAY[]::text[];
  attempted jsonb;
BEGIN
  IF OLD.match_status IS DISTINCT FROM 'matched' THEN RETURN NEW; END IF;
  IF current_setting('app.allow_protected_update', true) = 'on' THEN RETURN NEW; END IF;

  attempted := jsonb_build_object(
    'opt_adj', NEW.opt_adj, 'opt_bid', NEW.opt_bid, 'bid1st_v2_adj', NEW.bid1st_v2_adj, 'bid1st_v2_bid', NEW.bid1st_v2_bid,
    'bid1st_v2_win_prob', NEW.bid1st_v2_win_prob, 'bid1st_v2_floor_safe', NEW.bid1st_v2_floor_safe,
    'bid1st_v2_grain', NEW.bid1st_v2_grain, 'bid1st_v2_src', NEW.bid1st_v2_src,
    'match_status', NEW.match_status, 'matched_record_id', NEW.matched_record_id, 'matched_at', NEW.matched_at);

  IF NEW.opt_adj              IS DISTINCT FROM OLD.opt_adj              THEN NEW.opt_adj := OLD.opt_adj;                           blocked := array_append(blocked, 'opt_adj'); END IF;
  IF NEW.opt_bid              IS DISTINCT FROM OLD.opt_bid              THEN NEW.opt_bid := OLD.opt_bid;                           blocked := array_append(blocked, 'opt_bid'); END IF;
  IF NEW.bid1st_v2_adj        IS DISTINCT FROM OLD.bid1st_v2_adj        THEN NEW.bid1st_v2_adj := OLD.bid1st_v2_adj;               blocked := array_append(blocked, 'bid1st_v2_adj'); END IF;
  IF NEW.bid1st_v2_bid        IS DISTINCT FROM OLD.bid1st_v2_bid        THEN NEW.bid1st_v2_bid := OLD.bid1st_v2_bid;               blocked := array_append(blocked, 'bid1st_v2_bid'); END IF;
  IF NEW.bid1st_v2_win_prob   IS DISTINCT FROM OLD.bid1st_v2_win_prob   THEN NEW.bid1st_v2_win_prob := OLD.bid1st_v2_win_prob;     blocked := array_append(blocked, 'bid1st_v2_win_prob'); END IF;
  IF NEW.bid1st_v2_floor_safe IS DISTINCT FROM OLD.bid1st_v2_floor_safe THEN NEW.bid1st_v2_floor_safe := OLD.bid1st_v2_floor_safe; blocked := array_append(blocked, 'bid1st_v2_floor_safe'); END IF;
  IF NEW.bid1st_v2_grain      IS DISTINCT FROM OLD.bid1st_v2_grain      THEN NEW.bid1st_v2_grain := OLD.bid1st_v2_grain;           blocked := array_append(blocked, 'bid1st_v2_grain'); END IF;
  IF NEW.bid1st_v2_src        IS DISTINCT FROM OLD.bid1st_v2_src        THEN NEW.bid1st_v2_src := OLD.bid1st_v2_src;               blocked := array_append(blocked, 'bid1st_v2_src'); END IF;
  IF NEW.match_status         IS DISTINCT FROM 'matched'                THEN NEW.match_status := 'matched';                        blocked := array_append(blocked, 'match_status'); END IF;
  IF OLD.actual_adj_rate IS NOT NULL THEN
    IF NEW.matched_record_id  IS DISTINCT FROM OLD.matched_record_id    THEN NEW.matched_record_id := OLD.matched_record_id;       blocked := array_append(blocked, 'matched_record_id'); END IF;
    IF NEW.matched_at         IS DISTINCT FROM OLD.matched_at           THEN NEW.matched_at := OLD.matched_at;                     blocked := array_append(blocked, 'matched_at'); END IF;
  END IF;

  IF array_length(blocked, 1) IS NOT NULL THEN
    RAISE WARNING 'bid_predictions 매칭 행 보호값 변경 차단 (id=%): %', OLD.id, blocked;
    BEGIN
      INSERT INTO public.bid_predictions_protected_audit (pred_id, jwt_role, changed_cols, old_vals, new_vals)
      VALUES (OLD.id, NULLIF(current_setting('request.jwt.claim.role', true), ''), array_prepend('BLOCKED', blocked),
        jsonb_build_object(
          'opt_adj', OLD.opt_adj, 'opt_bid', OLD.opt_bid, 'bid1st_v2_adj', OLD.bid1st_v2_adj, 'bid1st_v2_bid', OLD.bid1st_v2_bid,
          'bid1st_v2_win_prob', OLD.bid1st_v2_win_prob, 'bid1st_v2_floor_safe', OLD.bid1st_v2_floor_safe,
          'bid1st_v2_grain', OLD.bid1st_v2_grain, 'bid1st_v2_src', OLD.bid1st_v2_src,
          'match_status', OLD.match_status, 'matched_record_id', OLD.matched_record_id, 'matched_at', OLD.matched_at),
        attempted);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '차단 기록 실패 (pred_id=%): % %', OLD.id, SQLSTATE, SQLERRM;  -- 기록 실패가 차단 자체를 무르지 않게 한다
    END;
  END IF;
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public.fn_bid_predictions_guard_matched() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_bid_predictions_guard_matched ON public.bid_predictions;
CREATE TRIGGER trg_bid_predictions_guard_matched
  BEFORE UPDATE ON public.bid_predictions
  FOR EACH ROW EXECUTE FUNCTION public.fn_bid_predictions_guard_matched();
