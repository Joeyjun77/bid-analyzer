-- m3: UNIQUE 제약을 NULLS NOT DISTINCT로 교체 (B0a — 코덱스 라운드 1 결함 #1 정정)
-- 근거: 코덱스 검증 — PostgreSQL 기본 UNIQUE는 NULL을 distinct로 봐서 (at, NULL, NULL) fallback row 중복 삽입 가능
-- PostgreSQL 15+ NULLS NOT DISTINCT로 강제 차단
-- 적용: apply_migration (Supabase MCP), 2026-05-19

ALTER TABLE agency_mode_lookup
  DROP CONSTRAINT agency_mode_lookup_at_canonical_ag_ba_seg_key;

ALTER TABLE agency_mode_lookup
  ADD CONSTRAINT agency_mode_lookup_at_canonical_ag_ba_seg_key
  UNIQUE NULLS NOT DISTINCT (at, canonical_ag, ba_seg);

ALTER TABLE floor_pass_daily
  DROP CONSTRAINT floor_pass_daily_measured_on_at_canonical_ag_model_version_key;

ALTER TABLE floor_pass_daily
  ADD CONSTRAINT floor_pass_daily_measured_on_at_canonical_ag_model_version_key
  UNIQUE NULLS NOT DISTINCT (measured_on, at, canonical_ag, model_version);
