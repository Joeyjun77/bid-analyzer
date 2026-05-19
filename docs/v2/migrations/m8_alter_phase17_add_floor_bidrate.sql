-- m8: phase17_validation에 bid_rate 공간 하한 통과 컬럼 ADD (B0b)
-- 근거: docs/v2/V2_DDL_SPEC §5, docs/v2/HANDOFF_V2_DIAGNOSIS_RESULT §2, docs/v2/V2_MEASUREMENT_SPEC §1
-- 기존 passed_floor(adj_rate 공간)는 보조 강등, 신규 passed_floor_bid_rate가 V2 측정 단위
-- 적용: apply_migration (Supabase MCP), 2026-05-19

ALTER TABLE phase17_validation
  ADD COLUMN IF NOT EXISTS passed_floor_bid_rate BOOLEAN;

COMMENT ON COLUMN phase17_validation.passed_floor_bid_rate IS
  'V2 bid_rate 공간 하한 통과 — my_bid_rate >= floor_rate 기준. 기존 passed_floor(adj_rate 공간)는 보조 강등. 근거: HANDOFF_V2_DIAGNOSIS_RESULT §2, V2_MEASUREMENT_SPEC §1.';
