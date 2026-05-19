-- m13: agency_gap_distribution 테이블 (B3.1 — Mode A 군시설 경쟁 분포 추정 기반)
-- 근거: docs/v2/HANDOFF_V2_MASTER_PLAN §4 B3, docs/v2/HANDOFF_V2_DIAGNOSIS_RESULT §3
-- 정의: gap = win_bid_rate - floor_rate (1위 vs 낙찰하한율 — bid_rate 공간)
-- 적용: apply_migration (Supabase MCP), 2026-05-20

CREATE TABLE agency_gap_distribution (
  id               BIGSERIAL PRIMARY KEY,
  at               TEXT NOT NULL,
  canonical_ag     TEXT,
  ba_seg           TEXT,
  n                INT  NOT NULL,
  gap_mean         NUMERIC(6,4),
  gap_std          NUMERIC(6,4),
  gap_p10          NUMERIC(6,4),
  gap_p25          NUMERIC(6,4),
  gap_p50          NUMERIC(6,4),
  gap_p75          NUMERIC(6,4),
  gap_p90          NUMERIC(6,4),
  ci_low           NUMERIC(6,4),   -- 95% 신뢰구간 하한 (평균에 대한)
  ci_high          NUMERIC(6,4),   -- 95% 신뢰구간 상한
  ci_method        TEXT NOT NULL CHECK (ci_method IN ('normal_se','bootstrap','none')),
  bootstrap_iter   INT,
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE NULLS NOT DISTINCT (at, canonical_ag, ba_seg)
);

CREATE INDEX idx_agd_lookup ON agency_gap_distribution (at, canonical_ag, ba_seg);

ALTER TABLE agency_gap_distribution ENABLE ROW LEVEL SECURITY;

CREATE POLICY agency_gap_distribution_anon_select
  ON agency_gap_distribution FOR SELECT TO anon USING (true);
CREATE POLICY agency_gap_distribution_auth_select
  ON agency_gap_distribution FOR SELECT TO authenticated USING (true);
CREATE POLICY agency_gap_distribution_service_insert
  ON agency_gap_distribution FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY agency_gap_distribution_service_update
  ON agency_gap_distribution FOR UPDATE TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE agency_gap_distribution IS
  'V2 Mode A (군시설) 경쟁 gap 분포 — gap = win_bid_rate - floor_rate. p10~p90 분위수 + 정규근사 95% CI. 운용 주체: service_role. 근거: HANDOFF_V2_MASTER_PLAN §4 B3, HANDOFF_V2_DIAGNOSIS_RESULT §3, V2_MEASUREMENT_SPEC §1.';

-- ※ 초기 적재 SQL은 별도 (m13 마이그레이션은 DDL만, 데이터는 일회성 INSERT).
-- 군시설 12개 row (at-level 1 + AG 5 + AG_BA 6) 적재됨 — 2026-05-20.
