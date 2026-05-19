-- m17: era_v2 컬럼 추가 (V2_DOMAIN_RULES_CHECK 정정 #0)
-- 근거: 낙찰하한율 두 차례 개정 (2025.07.01 지자체·교육청 / 2026.01.30 그 외)
-- 기존 era 컬럼은 보존 (A안 원칙), era_v2가 정확한 발주유형별 이중 경계
-- 적용: apply_migration (Supabase MCP), 2026-05-20

ALTER TABLE bid_records
  ADD COLUMN IF NOT EXISTS era_v2 TEXT
    CHECK (era_v2 IN ('legacy', 'current') OR era_v2 IS NULL);

ALTER TABLE bid_details
  ADD COLUMN IF NOT EXISTS era_v2 TEXT
    CHECK (era_v2 IN ('legacy', 'current') OR era_v2 IS NULL);

CREATE INDEX IF NOT EXISTS idx_brec_era_v2 ON bid_records (era_v2, at, od);
CREATE INDEX IF NOT EXISTS idx_bdet_era_v2 ON bid_details (era_v2, at, od);

COMMENT ON COLUMN bid_records.era_v2 IS
  'V2 낙찰하한율 시대 분류 (V2_DOMAIN_RULES_CHECK #0). legacy/current. 발주유형별 이중 경계: 지자체·교육청 2025-07-01 / 그 외 2026-01-30.';
COMMENT ON COLUMN bid_details.era_v2 IS
  'V2 낙찰하한율 시대 분류 (V2_DOMAIN_RULES_CHECK #0). bid_records.era_v2와 동일 규칙.';

-- 적재 (일회성, m17 적용 직후 실행):
-- UPDATE bid_records SET era_v2 = CASE
--   WHEN at IN ('지자체','교육청') AND od < '2025-07-01' THEN 'legacy'
--   WHEN at IN ('지자체','교육청') AND od >= '2025-07-01' THEN 'current'
--   WHEN at NOT IN ('지자체','교육청') AND od < '2026-01-30' THEN 'legacy'
--   ELSE 'current'
-- END WHERE od IS NOT NULL AND at IS NOT NULL;
-- (bid_details도 동일 규칙 적용)
--
-- 적재 결과 (2026-05-20):
--   bid_records: legacy 50,632 / current 13,045
--   bid_details: legacy 209 / current 671 (자사 데이터는 신 하한율 시대에 쏠림)
