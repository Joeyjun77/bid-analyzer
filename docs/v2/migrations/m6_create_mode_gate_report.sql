-- m6: mode_gate_report 테이블 생성 (B0b — 영역별 주간 게이트)
-- 근거: docs/v2/HANDOFF_V2_DIAGNOSIS_RESULT §5, docs/v2/HANDOFF_V2_MASTER_PLAN §4 B5, docs/v2/V2_DDL_SPEC §4
-- 적용: apply_migration (Supabase MCP), 2026-05-19

CREATE TABLE mode_gate_report (
  id               BIGSERIAL PRIMARY KEY,
  report_week      DATE NOT NULL,
  at               TEXT NOT NULL,
  mode             CHAR(1) NOT NULL CHECK (mode IN ('A','B')),
  primary_kpi_name TEXT NOT NULL,
  kpi_value        NUMERIC(6,4),
  kpi_target       NUMERIC(6,4),
  gate_status      TEXT NOT NULL
                   CHECK (gate_status IN ('pass','warn','fail','insufficient_sample')),
  dual_run_n       INT,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE NULLS NOT DISTINCT (report_week, at, mode)
);

CREATE INDEX idx_mgr_week ON mode_gate_report (report_week, at, mode);

ALTER TABLE mode_gate_report ENABLE ROW LEVEL SECURITY;

CREATE POLICY mode_gate_report_anon_select
  ON mode_gate_report FOR SELECT TO anon USING (true);
CREATE POLICY mode_gate_report_auth_select
  ON mode_gate_report FOR SELECT TO authenticated USING (true);
CREATE POLICY mode_gate_report_service_insert
  ON mode_gate_report FOR INSERT TO service_role WITH CHECK (true);
-- UPDATE 정책 의도적 미생성 — 주간 집계 INSERT-only

COMMENT ON TABLE mode_gate_report IS
  'V2 영역별 주간 게이트 (집계). gate_status enum: pass/warn/fail/insufficient_sample (n<40 영역). dual_run_n: 영역별 분리 카운터 — Mode B 먼저 n>=500 도달 시 V6 retire 후보. 운용 주체: service_role. INSERT-only. 근거: HANDOFF_V2_DIAGNOSIS_RESULT §5, HANDOFF_V2_MASTER_PLAN §4 B5, V2_DDL_SPEC §4.';
