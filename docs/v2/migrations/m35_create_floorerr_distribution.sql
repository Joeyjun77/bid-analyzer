-- m35: floorerr_distribution 테이블 (군부대 Mode A Phase 1)
-- 근거: docs/v2/A_MODE_A_MILITARY_WIN_DESIGN_2026-05-23.md §3~§6, §14 Phase 1
-- 정의: floorErr = (actual_floor_amount − predicted_floor_amount)/base_amount  [bid_rate 공간, 분수]
--   predicted_floor_amount = 마진 제거 (pred_expected_price × pred_floor_rate/100)
-- era_v2 NOT NULL — current/legacy floorErr p50 1.86%p 차이로 분리 필수
-- 적용: apply_migration (Supabase MCP), 2026-05-23

CREATE TABLE floorerr_distribution (
  id               BIGSERIAL PRIMARY KEY,
  at               TEXT NOT NULL,
  canonical_ag     TEXT,
  ba_seg           TEXT,
  era_v2           TEXT NOT NULL CHECK (era_v2 IN ('legacy','current','mixed')),
  n                INT  NOT NULL,
  floorerr_mean    NUMERIC(9,6),
  floorerr_std     NUMERIC(9,6),
  floorerr_p10     NUMERIC(9,6),
  floorerr_p25     NUMERIC(9,6),
  floorerr_p50     NUMERIC(9,6),
  floorerr_p75     NUMERIC(9,6),
  floorerr_p80     NUMERIC(9,6),
  floorerr_p85     NUMERIC(9,6),
  floorerr_p90     NUMERIC(9,6),
  floorerr_p95     NUMERIC(9,6),
  confidence       TEXT NOT NULL CHECK (confidence IN ('high','medium','low','insufficient_sample')),
  src              TEXT NOT NULL DEFAULT 'live_matched_margin_removed',
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE NULLS NOT DISTINCT (at, canonical_ag, ba_seg, era_v2)
);

CREATE INDEX idx_fed_lookup ON floorerr_distribution (at, canonical_ag, ba_seg, era_v2);

ALTER TABLE floorerr_distribution ENABLE ROW LEVEL SECURITY;

CREATE POLICY floorerr_distribution_anon_select
  ON floorerr_distribution FOR SELECT TO anon USING (true);
CREATE POLICY floorerr_distribution_auth_select
  ON floorerr_distribution FOR SELECT TO authenticated USING (true);
CREATE POLICY floorerr_distribution_service_insert
  ON floorerr_distribution FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY floorerr_distribution_service_update
  ON floorerr_distribution FOR UPDATE TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE floorerr_distribution IS
  '군부대 Mode A Phase 1 — floorErr 경험분포. floorErr=(actual_floor−predicted_floor)/base (분수, 마진 제거 predicted_floor=pred_expected_price×pred_floor_rate/100). era_v2 NOT NULL 필수 분리. 라이브 소비는 current만. 운용: service_role. 근거: A_MODE_A_MILITARY_WIN_DESIGN_2026-05-23 §3~§6.';
