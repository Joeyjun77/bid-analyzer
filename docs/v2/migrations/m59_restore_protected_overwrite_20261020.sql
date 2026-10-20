-- m59: 2026-10-20 업로드 upsert가 덮어쓴 사전 예측 18건의 보호값 원복 (사용자 승인 "원복은 A로", 2026-10-20)
--
-- 원인: sbSavePredictions(on_conflict=dedup_key, merge-duplicates)가 매칭 행을 match_status='pending'으로 되돌리며
--       opt_adj·opt_bid·bid1st_v2_* 를 개찰 후 재계산값(자기 결과가 이력에 포함된 값)으로 덮었다.
-- 대상: 10/20 감사 기록이 있는 file_upload 행 중 개찰일 이전(4/07~8/09)에 생성된 사전 예측 18건.
--       같은 날 생성·개찰된 10/20 생성분 14건은 처음부터 개찰 당일 예측이라 대상 아님.
-- 원복값: 행별 첫 감사 기록(bid_predictions_protected_audit)의 old_vals — 덮어쓰기 직전 값.
-- 복구 불가(감사에 원래 값 없음): pred_*, rec_*, own_score, disq_risk_* 스냅샷(m39), pc 스냅샷.
-- 멈춘 5건(15714·16506·16524·16526·16529): matched_record_id·actual_*·matched_at이 남아 있어 match_status만 복귀.
-- 매칭 행 보호값 UPDATE는 CLAUDE.md 금기(A안 INSERT-only)의 승인된 예외다 — /evaluate G-A안에 예외로 보고.

-- 1) 백업 (원복 전 현재 값 전체 + pred_bias_map 셀 스냅샷). 스냅샷 노출 금기: 생성 즉시 RLS + REVOKE.
CREATE TABLE public.bid_predictions_bak_m59 AS
SELECT * FROM public.bid_predictions
WHERE id IN (10261,14837,14845,15714,16506,16520,16521,16522,16523,16524,16525,16526,16527,16528,16529,16530,16533,16540);
ALTER TABLE public.bid_predictions_bak_m59 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bid_predictions_bak_m59 FROM anon, authenticated;

CREATE TABLE public.pred_bias_map_snap_m59 AS SELECT * FROM public.pred_bias_map;
ALTER TABLE public.pred_bias_map_snap_m59 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pred_bias_map_snap_m59 FROM anon, authenticated;

-- 2) 보호 8컬럼 원복
WITH first_a AS (
  SELECT DISTINCT ON (pred_id) pred_id, old_vals
  FROM public.bid_predictions_protected_audit
  WHERE changed_at >= '2026-10-20'
  ORDER BY pred_id, changed_at, id
)
UPDATE public.bid_predictions p SET
  opt_adj              = (f.old_vals->>'opt_adj')::numeric,
  opt_bid              = (f.old_vals->>'opt_bid')::numeric,
  bid1st_v2_adj        = (f.old_vals->>'bid1st_v2_adj')::numeric,
  bid1st_v2_bid        = (f.old_vals->>'bid1st_v2_bid')::numeric,
  bid1st_v2_win_prob   = (f.old_vals->>'bid1st_v2_win_prob')::numeric,
  bid1st_v2_floor_safe = (f.old_vals->>'bid1st_v2_floor_safe')::boolean,
  bid1st_v2_grain      = f.old_vals->>'bid1st_v2_grain',
  bid1st_v2_src        = f.old_vals->>'bid1st_v2_src'
FROM first_a f
WHERE p.id = f.pred_id
  AND p.id IN (SELECT id FROM public.bid_predictions_bak_m59);

-- 3) 멈춘 5건 매칭 상태 복귀 (matched_record_id·actual_*·matched_at은 남아 있음)
UPDATE public.bid_predictions SET match_status = 'matched'
WHERE id IN (15714,16506,16524,16526,16529)
  AND match_status = 'pending' AND matched_record_id IS NOT NULL AND actual_adj_rate IS NOT NULL;
