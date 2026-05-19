-- m5: win_zone_daily 테이블 생성 (B0b — Mode A 1차 KPI 집계)
-- 근거: docs/v2/HANDOFF_V2_DIAGNOSIS_RESULT §3 + §6 Step3, docs/v2/V2_DDL_SPEC §2, docs/v2/V2_MEASUREMENT_SPEC §7
-- 적용: apply_migration (Supabase MCP), 2026-05-19

CREATE TABLE win_zone_daily (
  id              BIGSERIAL PRIMARY KEY,
  measured_on     DATE NOT NULL,
  at              TEXT,
  canonical_ag    TEXT,
  n               INT,
  pct_pass_floor  NUMERIC(5,2),
  pct_pass_top1   NUMERIC(5,2),
  pct_in_win_zone NUMERIC(5,2),
  avg_gap         NUMERIC(6,4),
  median_gap      NUMERIC(6,4),
  p90_gap         NUMERIC(6,4),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE NULLS NOT DISTINCT (measured_on, at, canonical_ag)
);

CREATE INDEX idx_wzd_date ON win_zone_daily (measured_on, at);

ALTER TABLE win_zone_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY win_zone_daily_anon_select
  ON win_zone_daily FOR SELECT TO anon USING (true);
CREATE POLICY win_zone_daily_auth_select
  ON win_zone_daily FOR SELECT TO authenticated USING (true);
CREATE POLICY win_zone_daily_service_insert
  ON win_zone_daily FOR INSERT TO service_role WITH CHECK (true);
-- UPDATE 정책 의도적 미생성 — A안 INSERT-only (일배치 누적)

COMMENT ON TABLE win_zone_daily IS
  'V2 Mode A 1차 KPI — bid_rate 공간 WIN-zone 진입률 + gap median/p90. 일배치 INSERT-only. 운용 주체: service_role. 근거: HANDOFF_V2_DIAGNOSIS_RESULT §3 + §6 Step3, V2_DDL_SPEC §2, V2_MEASUREMENT_SPEC §7. WIN-zone 정의: floor_rate ≤ my_bid_rate < win_bid_rate.';
