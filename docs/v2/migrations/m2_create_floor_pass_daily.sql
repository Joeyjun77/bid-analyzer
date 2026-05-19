-- m2: floor_pass_daily 테이블 생성 (B0a — Mode B 1차 KPI 측정 코어)
-- 근거: docs/v2/HANDOFF_V2_DIAGNOSIS_RESULT §6 Step2, docs/v2/V2_DDL_SPEC §3, docs/v2/V2_MEASUREMENT_SPEC §7
-- 적용: apply_migration (Supabase MCP), 2026-05-19

CREATE TABLE floor_pass_daily (
  id                       BIGSERIAL PRIMARY KEY,
  measured_on              DATE NOT NULL,
  at                       TEXT,
  canonical_ag             TEXT,
  model_version            TEXT,
  n                        INT,
  pred_floor_pass_prob_avg NUMERIC(5,4),
  actual_floor_pass_rate   NUMERIC(5,4),
  calibration_gap          NUMERIC(5,4),
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (measured_on, at, canonical_ag, model_version)
);

CREATE INDEX idx_fpd_date  ON floor_pass_daily (measured_on, at);
CREATE INDEX idx_fpd_calib ON floor_pass_daily (model_version, calibration_gap);

ALTER TABLE floor_pass_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY floor_pass_daily_anon_select
  ON floor_pass_daily FOR SELECT TO anon USING (true);

CREATE POLICY floor_pass_daily_auth_select
  ON floor_pass_daily FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE floor_pass_daily IS
  'V2 Mode B 1차 KPI — bid_rate 공간 하한 통과율 + calibration_gap. 일배치 누적. 근거: HANDOFF_V2_DIAGNOSIS_RESULT §6 Step2, V2_DDL_SPEC §3, V2_MEASUREMENT_SPEC §7. calibration_gap = abs(pred_floor_pass_prob_avg - actual_floor_pass_rate).';

-- 주의: 본 m2는 일반 UNIQUE로 생성. m3에서 UNIQUE NULLS NOT DISTINCT로 교체.
-- INSERT 정책은 m4에서 추가.
