-- m1: agency_mode_lookup 테이블 생성 (B0a)
-- 근거: docs/v2/HANDOFF_V2_DIAGNOSIS_RESULT §3, docs/v2/V2_DDL_SPEC §1, docs/v2/V2_MEASUREMENT_SPEC §7
-- 적용: apply_migration (Supabase MCP), 2026-05-19

CREATE TABLE agency_mode_lookup (
  id                 BIGSERIAL PRIMARY KEY,
  at                 TEXT NOT NULL,
  canonical_ag       TEXT,
  ba_seg             TEXT,
  n                  INT  NOT NULL,
  median_gap         NUMERIC(6,4),
  p90_gap            NUMERIC(6,4),
  mode_recommend     CHAR(1) NOT NULL CHECK (mode_recommend IN ('A','B')),
  confidence         TEXT    NOT NULL CHECK (confidence IN ('high','medium','low')),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  sample_window_days INT DEFAULT 180,
  UNIQUE (at, canonical_ag, ba_seg)
);

CREATE INDEX idx_aml_lookup ON agency_mode_lookup (at, canonical_ag, ba_seg);

ALTER TABLE agency_mode_lookup ENABLE ROW LEVEL SECURITY;

CREATE POLICY agency_mode_lookup_anon_select
  ON agency_mode_lookup FOR SELECT TO anon USING (true);

CREATE POLICY agency_mode_lookup_auth_select
  ON agency_mode_lookup FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE agency_mode_lookup IS
  'V2 영역별 모드 판정 (정적 캐시, 일배치 갱신). Mode A/B 선택 + gap median/p90 분포. 근거: HANDOFF_V2_DIAGNOSIS_RESULT §3, V2_DDL_SPEC §1, V2_MEASUREMENT_SPEC §7. confidence 산식: high(n>=50)/medium(20<=n<50)/low(n<20). fallback: (at, NULL, NULL) row.';

-- 주의: 본 m1은 일반 UNIQUE로 생성. m3에서 UNIQUE NULLS NOT DISTINCT로 교체.
