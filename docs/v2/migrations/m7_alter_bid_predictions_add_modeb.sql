-- m7: bid_predictions에 V2 Mode B/A 출력 컬럼 6개 ADD (B2.1)
-- 근거: docs/v2/V2_DDL_SPEC §5, docs/v2/HANDOFF_V2_MASTER_PLAN §4 B2
-- A안 INSERT-only — 기존 row UPDATE 금지, 신규 컬럼 NULL 허용
-- 적용: apply_migration (Supabase MCP), 2026-05-19

ALTER TABLE bid_predictions
  ADD COLUMN IF NOT EXISTS b_pred_mode             CHAR(1)
    CHECK (b_pred_mode IN ('A','B') OR b_pred_mode IS NULL),
  ADD COLUMN IF NOT EXISTS b_pred_adj              NUMERIC,
  ADD COLUMN IF NOT EXISTS b_pred_bid_amount       NUMERIC,
  ADD COLUMN IF NOT EXISTS b_pred_floor_pass_prob  NUMERIC(5,4)
    CHECK (b_pred_floor_pass_prob IS NULL OR (b_pred_floor_pass_prob >= 0 AND b_pred_floor_pass_prob <= 1)),
  ADD COLUMN IF NOT EXISTS b_pred_grain            TEXT
    CHECK (b_pred_grain IN ('AG_BA','AG','AT') OR b_pred_grain IS NULL),
  ADD COLUMN IF NOT EXISTS b_pred_src              TEXT;

COMMENT ON COLUMN bid_predictions.b_pred_mode IS
  'V2 모드 판정 결과 — A(군시설 공략) / B(나머지 안착). lookup_agency_mode RPC 출력.';
COMMENT ON COLUMN bid_predictions.b_pred_adj IS
  'V2 추천 사정률. Mode B: 하한 통과율 ≥95% 만족하는 가장 공격적 X. Mode A: P(낙찰|X) 곡선 최대점.';
COMMENT ON COLUMN bid_predictions.b_pred_bid_amount IS
  'V2 추천 투찰금액 = ba × (1 + b_pred_adj/100) × floor_rate.';
COMMENT ON COLUMN bid_predictions.b_pred_floor_pass_prob IS
  'V2 예측 하한 통과확률 (0~1). Mode B 1차 KPI. floor_pass_daily.calibration_gap과 정합.';
COMMENT ON COLUMN bid_predictions.b_pred_grain IS
  'lookup_agency_mode 매칭 grain (AG_BA → AG → AT fallback).';
COMMENT ON COLUMN bid_predictions.b_pred_src IS
  'V2 추천 소스 메타데이터 (분포 출처·신뢰도 표시용 자유 텍스트).';
