-- m18: agency_gap_distribution에 era_v2 컬럼 추가 (V2_DOMAIN_RULES_CHECK 정정 #4 — B3 보류)
-- 기존 군시설 12 row는 시대 혼입 (legacy 155 + current 31) → 'mixed' 마킹
-- UNIQUE 제약에 era_v2 포함 — 같은 키에 legacy/current/mixed 별도 row 가능
-- 적용: apply_migration (Supabase MCP), 2026-05-20

ALTER TABLE agency_gap_distribution
  ADD COLUMN IF NOT EXISTS era_v2 TEXT
    CHECK (era_v2 IN ('legacy', 'current', 'mixed') OR era_v2 IS NULL);

-- 기존 row 'mixed' 마킹 (B3.1 적재값 — 시대 혼입 폐기)
UPDATE agency_gap_distribution SET era_v2 = 'mixed' WHERE era_v2 IS NULL;

-- UNIQUE 제약 갱신
ALTER TABLE agency_gap_distribution
  DROP CONSTRAINT IF EXISTS agency_gap_distribution_at_canonical_ag_ba_seg_key;

ALTER TABLE agency_gap_distribution
  ADD CONSTRAINT agency_gap_distribution_at_canonical_ag_ba_seg_era_v2_key
  UNIQUE NULLS NOT DISTINCT (at, canonical_ag, ba_seg, era_v2);

COMMENT ON COLUMN agency_gap_distribution.era_v2 IS
  'V2 시대 분류 — current(현행 낙찰하한율 환경)만 운영 엔진 사용. legacy/mixed는 보존만. 근거: V2_DOMAIN_RULES_CHECK #0+#4.';

-- 적재 후속 (m18 적용 직후 실행):
-- INSERT INTO agency_gap_distribution (... era_v2='current' ...)
-- SELECT ... FROM bid_details WHERE at='군시설' AND era_v2='current' GROUP BY ...
--
-- 적재 결과 (2026-05-20):
--   current at-level: n=31 (군시설 전체)
--   current AG grain: 0 (모든 발주사 n<5)
--   → B3 사실상 보류 — 종형 fallback 동작
