-- m30: bid_records.is_duplicate flag 추가 + 중복 113건 마킹 + refresh_win_zone_daily 필터 추가
-- 결함:
--   - bid_records.pn_no UNIQUE 위반 113건 (current era 90일 윈도우)
--   - 동일 pn_no 2~3 row 중복 적재, LEFT JOIN 시 측정 카운트 증폭
--   - M29 §3.1 군시설 n=60→30 변동 정밀 진단 결과 (BID_RECORDS_DUPLICATE_DIAGNOSIS_2026-05-21.md)
-- 정정 (사용자 옵션 C 채택 — DELETE 회피, CLAUDE.md "bid_records DELETE 금지" 준수):
--   - bid_records.is_duplicate BOOLEAN 컬럼 추가
--   - 중복 row 마킹 (master 선정 우선순위: d→c→a 복합)
--   - refresh_win_zone_daily에 `AND COALESCE(r.is_duplicate, false) = false` 추가
-- 영향 분류 (predict-architect):
--   - Evaluator (예측 산출 함수 무수정)
--   - 핵심 영역 MAE 영향: PASS (bid_predictions.matched_record_id 무영향, dry-run duplicate_referenced=0)
--   - 113건 current era 한정, legacy 2,578건은 별도 m31 (1주 모니터링 후)
-- master 선정 우선순위 (predict-architect 권고):
--   1. matched_record_id가 참조하는 row (참조 무결성 보호 — 옵션 d)
--   2. canonical_ag IS NOT NULL (정규화 row — 옵션 c)
--   3. ar1/br1/base_ratio 비어있지 않은 row (데이터 충실도)
--   4. MIN(id) (가장 먼저 INSERT된 row — 옵션 a 폴백)
-- 적용: apply_migration, 2026-05-21

-- Step 1: is_duplicate 컬럼 추가
ALTER TABLE bid_records
  ADD COLUMN IF NOT EXISTS is_duplicate BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_bid_records_is_duplicate
  ON bid_records (is_duplicate) WHERE is_duplicate = true;

-- Step 2: 중복 마킹 (current era 한정, 113건)
WITH dup_groups AS (
  SELECT pn_no FROM bid_records
  WHERE COALESCE(era_v2, 'current') = 'current'
  GROUP BY pn_no HAVING COUNT(*) > 1
),
master_candidates AS (
  SELECT
    r.id,
    ROW_NUMBER() OVER (
      PARTITION BY r.pn_no
      ORDER BY
        (EXISTS (SELECT 1 FROM bid_predictions p WHERE p.matched_record_id = r.id))::int DESC,
        (r.canonical_ag IS NOT NULL)::int DESC,
        (CASE WHEN r.ar1 IS NOT NULL OR r.br1 IS NOT NULL OR r.base_ratio IS NOT NULL THEN 1 ELSE 0 END) DESC,
        r.id ASC
    ) AS rn
  FROM bid_records r
  JOIN dup_groups d ON d.pn_no = r.pn_no
  WHERE COALESCE(r.era_v2, 'current') = 'current'
)
UPDATE bid_records
SET is_duplicate = true
WHERE id IN (SELECT id FROM master_candidates WHERE rn > 1);

-- Step 3: refresh_win_zone_daily 갱신 (is_duplicate 필터 추가)
CREATE OR REPLACE FUNCTION refresh_win_zone_daily(
  p_since date DEFAULT ((CURRENT_DATE - '90 days'::interval))::date,
  p_until date DEFAULT CURRENT_DATE
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inserted INT := 0;
  v_rows     INT;
BEGIN
  INSERT INTO win_zone_daily
    (measured_on, at, canonical_ag, n,
     pct_pass_floor, pct_pass_top1, pct_in_win_zone,
     avg_gap, median_gap, p90_gap)
  SELECT
    p_until, NULL::text, NULL::text,
    COUNT(*)::int,
    ROUND(100.0 * SUM(CASE WHEN d.my_bid_rate >= d.floor_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(100.0 * SUM(CASE WHEN d.my_bid_rate < d.win_bid_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(100.0 * SUM(CASE WHEN d.my_bid_rate >= d.floor_rate AND d.my_bid_rate < d.win_bid_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(AVG(d.win_bid_rate - d.floor_rate)::numeric, 4),
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.win_bid_rate - d.floor_rate)::numeric, 4),
    ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY d.win_bid_rate - d.floor_rate)::numeric, 4)
  FROM bid_details d
  LEFT JOIN bid_records r ON r.pn_no = d.pn_no
  WHERE d.my_bid_rate IS NOT NULL AND d.win_bid_rate IS NOT NULL AND d.floor_rate IS NOT NULL
    AND d.od BETWEEN p_since AND p_until
    AND COALESCE(r.is_joint_contract, false) != true
    AND COALESCE(r.era_v2, 'current') = 'current'
    AND ABS(d.win_bid_rate - d.floor_rate) <= 5
    AND COALESCE(r.is_duplicate, false) = false  -- ★ m30: 중복 row 제외
  HAVING COUNT(*) >= 5
  ON CONFLICT (measured_on, at, canonical_ag) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_inserted := v_inserted + v_rows;

  INSERT INTO win_zone_daily
    (measured_on, at, canonical_ag, n,
     pct_pass_floor, pct_pass_top1, pct_in_win_zone,
     avg_gap, median_gap, p90_gap)
  SELECT
    p_until, d.at, NULL::text,
    COUNT(*)::int,
    ROUND(100.0 * SUM(CASE WHEN d.my_bid_rate >= d.floor_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(100.0 * SUM(CASE WHEN d.my_bid_rate < d.win_bid_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(100.0 * SUM(CASE WHEN d.my_bid_rate >= d.floor_rate AND d.my_bid_rate < d.win_bid_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(AVG(d.win_bid_rate - d.floor_rate)::numeric, 4),
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.win_bid_rate - d.floor_rate)::numeric, 4),
    ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY d.win_bid_rate - d.floor_rate)::numeric, 4)
  FROM bid_details d
  LEFT JOIN bid_records r ON r.pn_no = d.pn_no
  WHERE d.my_bid_rate IS NOT NULL AND d.win_bid_rate IS NOT NULL AND d.floor_rate IS NOT NULL
    AND d.at IS NOT NULL AND d.od BETWEEN p_since AND p_until
    AND COALESCE(r.is_joint_contract, false) != true
    AND COALESCE(r.era_v2, 'current') = 'current'
    AND ABS(d.win_bid_rate - d.floor_rate) <= 5
    AND COALESCE(r.is_duplicate, false) = false  -- ★ m30
  GROUP BY d.at
  HAVING COUNT(*) >= 3
  ON CONFLICT (measured_on, at, canonical_ag) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_inserted := v_inserted + v_rows;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION refresh_win_zone_daily(date,date) IS
  'V2 Mode A WIN-zone 일별 측정 — 공동도급 제외 (m20) + era_v2=current (m26) + outlier sanity check (m29) + is_duplicate 제외 (m30). G-도메인 #0·#7 + 데이터 무결성 정합.';

-- Step 4: 검증 + 재측정 (cron jobid 12 자동 갱신 외 즉시 효과 확인)
SELECT
  COUNT(*) FILTER (WHERE is_duplicate = true) AS duplicates_marked,
  COUNT(*) FILTER (WHERE is_duplicate = false) AS masters_kept
FROM bid_records
WHERE COALESCE(era_v2, 'current') = 'current';

-- 측정값 갱신 (DELETE 후 재실행)
DELETE FROM win_zone_daily WHERE measured_on = CURRENT_DATE;
SELECT refresh_win_zone_daily() AS rows_updated;
