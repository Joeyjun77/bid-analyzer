-- Phase 23-6: refresh_prediction_bias() legacy artifact no-op 교체
--
-- 원인: 옛 'prediction_bias' 테이블 참조로 cron jobid=7 (refresh-analysis-assets-daily)
--       이 2026-04-17부터 9일 연속 실패. 같은 트랜잭션의 다른 12개 refresh 함수도 롤백.
-- 효과: cron 트랜잭션 통과 → chain 전체 정상 commit.
--       agency_predictor / amount_band_correction 등 보정 학습 인프라 복구.
-- 'at' grain 보정 자동학습은 별도 안건 (predict-architect 검토 결과 권고).
--
-- 적용일: 2026-04-26
-- 검증: evaluate_model_release('v6.2','v6.2',14) 3/3 PASS
--       핵심 영역(한전·고양시·군부대) MAE 변동 없음 (누적 데이터)
--       agency_predictor 변동 폭 |Δ| < 0.05 (architect 예상 부합)
CREATE OR REPLACE FUNCTION public.refresh_prediction_bias()
RETURNS integer LANGUAGE plpgsql AS $$
BEGIN
  RETURN 0;
END;
$$;
