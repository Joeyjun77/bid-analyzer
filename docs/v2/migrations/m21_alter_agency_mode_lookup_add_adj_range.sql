-- m21: agency_mode_lookup에 adj_range_min/max 메타 컬럼 추가 (V2_DOMAIN_RULES_CHECK #6)
-- 근거: 발주사별 복수예비가격 작성 범위(±N%) 명시. recommendV2 grid 동적 적용의 기반.
-- 도메인 표준: ±3% (대부분), ±2% (일부 소액), +0~-6% (특수 비대칭)
-- 적재: 41 row 일률 ±3% 디폴트. 비대칭 예외는 NULL 유지 → 사용자 입력 시 UPDATE.
-- 적용: apply_migration (Supabase MCP), 2026-05-21

ALTER TABLE agency_mode_lookup
  ADD COLUMN IF NOT EXISTS adj_range_min NUMERIC(4,2)
    CHECK (adj_range_min IS NULL OR adj_range_min BETWEEN -10.0 AND 0.0);

ALTER TABLE agency_mode_lookup
  ADD COLUMN IF NOT EXISTS adj_range_max NUMERIC(4,2)
    CHECK (adj_range_max IS NULL OR adj_range_max BETWEEN 0.0 AND 10.0);

ALTER TABLE agency_mode_lookup
  ADD CONSTRAINT adj_range_min_le_max
    CHECK (adj_range_min IS NULL OR adj_range_max IS NULL OR adj_range_min <= adj_range_max);

COMMENT ON COLUMN agency_mode_lookup.adj_range_min IS
  'V2_DOMAIN_RULES_CHECK #6 — 발주사가 복수예비가격 작성 시 사정률 최저 경계 (%). 표준 -3.0, 비대칭 발주처는 사용자 입력 시 UPDATE.';
COMMENT ON COLUMN agency_mode_lookup.adj_range_max IS
  'V2_DOMAIN_RULES_CHECK #6 — 발주사가 복수예비가격 작성 시 사정률 최고 경계 (%). 표준 +3.0, 비대칭 발주처는 사용자 입력 시 UPDATE.';

-- 도메인 표준 ±3% 일률 적용 (41 row 전체)
UPDATE agency_mode_lookup
SET adj_range_min = -3.0,
    adj_range_max = +3.0,
    updated_at = NOW()
WHERE adj_range_min IS NULL OR adj_range_max IS NULL;

-- 적재 결과 검증 (적용 후 수동 실행):
-- SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE adj_range_min IS NOT NULL AND adj_range_max IS NOT NULL) AS filled
-- FROM agency_mode_lookup;
-- 기대: total=41, filled=41
