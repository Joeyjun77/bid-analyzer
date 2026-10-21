-- m63: 개찰 전 대기 예측의 메인 추천을 안착안으로 일회성 재적재 (2026-10-21, 사용자 승인 "둘 다 승인")
-- 스펙: .scratch/main-rec-anchor/spec.md §3. 코드(recommendMain)는 새 업로드·자동채움부터 적용되므로,
-- 이미 저장된 대기 행은 이미 계산돼 있는 안착안(b_pred_*, 같은 recommendV2 Mode B)으로 옮긴다.
-- 대상: file_upload · pending · 군시설 외(Mode B) · 안착안 보유 · 자사 20점 · 개찰일이 오늘 이후. 대기 행이라 m60/m62 가드 대상 아님.
-- disq_risk_pct는 옛 투찰금 기준 스냅샷이라 비워 5-b 캘리브레이션에서 뺀다(App.jsx 데이터 탭 경로와 같은 처리).
-- bid1st_v2_grain은 1위 분포 단위인데 b_pred_grain은 모드 조회 단위라 옮기지 않고 'm63'으로 표시한다.
-- 롤백: bid_predictions_bak_m63에서 6컬럼 + disq_risk_pct 복원.

CREATE TABLE public.bid_predictions_bak_m63 AS
SELECT id, bid1st_v2_adj, bid1st_v2_bid, bid1st_v2_win_prob, bid1st_v2_floor_safe, bid1st_v2_grain, bid1st_v2_src, disq_risk_pct, now() AS backed_up_at
FROM public.bid_predictions
WHERE source='file_upload' AND match_status='pending' AND at IS DISTINCT FROM '군시설'
  AND b_pred_mode='B' AND b_pred_bid_amount IS NOT NULL AND b_pred_adj IS NOT NULL
  AND COALESCE(own_score,20)=20 AND open_date >= CURRENT_DATE;
ALTER TABLE public.bid_predictions_bak_m63 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bid_predictions_bak_m63 FROM anon, authenticated;

UPDATE public.bid_predictions p SET
  bid1st_v2_adj        = p.b_pred_adj,
  bid1st_v2_bid        = p.b_pred_bid_amount,
  bid1st_v2_win_prob   = NULL,
  bid1st_v2_floor_safe = (COALESCE(p.av,0) <= 0 OR p.ba*(1+p.b_pred_adj/100) >= p.av),
  bid1st_v2_grain      = 'm63',
  bid1st_v2_src        = p.b_pred_src,
  disq_risk_pct        = NULL
WHERE p.id IN (SELECT id FROM public.bid_predictions_bak_m63)
  AND p.match_status='pending';
