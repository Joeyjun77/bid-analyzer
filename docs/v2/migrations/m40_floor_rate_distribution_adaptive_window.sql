-- m40: refresh_floor_rate_distribution 드리프트 적응 윈도우 (Mode B 실격위험 Phase 1 보정)
-- 근거: 백테스트 캘리브레이션 (2026-07-17) — 군시설 S1 floor_frac 2026-02 +2.4%p 계단 변화
--   (era_v2 cutoff 이후 신규 구조 변화, 0.878→0.902) → 365d 고정 윈도우가 두 레짐 혼합,
--   walk-forward 통과율 68%로 붕괴 (지자체 92.65%·교육청 100%는 정상).
-- 처방: grain별 |mean180 − mean365| > 0.4×σ365 AND n180>=60 이면 해당 grain만 180d 분포 사용.
--   검증: 적응 규칙 walk-forward 68%→75%(전환기 포함), 최근 60일 평가 100%(n=15 소표본) —
--   실패는 전환기(2026-02~04, 어떤 방법도 미래 레짐 인지 불가) 국한 확인.
-- window_days 컬럼에 실제 사용 윈도우(365/180) 기록 — 클라이언트 근거 표시용.
-- 적용: apply_migration (Supabase MCP), 2026-07-17

CREATE OR REPLACE FUNCTION refresh_floor_rate_distribution()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INT := 0;
BEGIN
  DELETE FROM floor_rate_distribution;

  WITH base AS (
    SELECT at, canonical_ag,
      CASE WHEN ba<1e8 THEN 'S1' WHEN ba<3e8 THEN 'S2' WHEN ba<1e9 THEN 'S3'
           WHEN ba<3e9 THEN 'S4' ELSE 'S5' END AS ba_seg,
      od,
      floor_price/NULLIF(ba,0) AS floor_frac
    FROM bid_records
    WHERE floor_price IS NOT NULL AND ba > 0
      AND era_v2 = 'current'
      AND od >= current_date - interval '365 days'
      AND floor_price/NULLIF(ba,0) BETWEEN 0.5 AND 1.0
  ),
  grains AS (
    -- AG_BA + AT_BA 두 grain을 한 번에: canonical_ag NULL = AT_BA
    SELECT at, canonical_ag, ba_seg, od, floor_frac FROM base WHERE canonical_ag IS NOT NULL
    UNION ALL
    SELECT at, NULL, ba_seg, od, floor_frac FROM base
  ),
  agg AS (
    SELECT at, canonical_ag, ba_seg,
      count(*) AS n365,
      avg(floor_frac) AS mean365,
      stddev_samp(floor_frac) AS std365,
      count(*) FILTER (WHERE od >= current_date - interval '180 days') AS n180,
      avg(floor_frac) FILTER (WHERE od >= current_date - interval '180 days') AS mean180
    FROM grains
    GROUP BY at, canonical_ag, ba_seg
    HAVING count(*) >= 30
  ),
  chosen AS (
    SELECT a.at, a.canonical_ag, a.ba_seg,
      CASE WHEN a.std365 > 0 AND a.n180 >= 60
                AND abs(a.mean180 - a.mean365) > 0.4 * a.std365
           THEN 180 ELSE 365 END AS win_days
    FROM agg a
  ),
  stats AS (
    SELECT c.at, c.canonical_ag, c.ba_seg, c.win_days,
      count(*) AS n,
      avg(g.floor_frac)::numeric(9,6) AS m_mean,
      stddev_samp(g.floor_frac)::numeric(9,6) AS m_std,
      percentile_disc(0.05) WITHIN GROUP (ORDER BY g.floor_frac)::numeric(9,6) AS p05,
      percentile_disc(0.10) WITHIN GROUP (ORDER BY g.floor_frac)::numeric(9,6) AS p10,
      percentile_disc(0.25) WITHIN GROUP (ORDER BY g.floor_frac)::numeric(9,6) AS p25,
      percentile_disc(0.50) WITHIN GROUP (ORDER BY g.floor_frac)::numeric(9,6) AS p50,
      percentile_disc(0.75) WITHIN GROUP (ORDER BY g.floor_frac)::numeric(9,6) AS p75,
      percentile_disc(0.80) WITHIN GROUP (ORDER BY g.floor_frac)::numeric(9,6) AS p80,
      percentile_disc(0.85) WITHIN GROUP (ORDER BY g.floor_frac)::numeric(9,6) AS p85,
      percentile_disc(0.90) WITHIN GROUP (ORDER BY g.floor_frac)::numeric(9,6) AS p90,
      percentile_disc(0.95) WITHIN GROUP (ORDER BY g.floor_frac)::numeric(9,6) AS p95,
      percentile_disc(0.97) WITHIN GROUP (ORDER BY g.floor_frac)::numeric(9,6) AS p97,
      percentile_disc(0.99) WITHIN GROUP (ORDER BY g.floor_frac)::numeric(9,6) AS p99
    FROM chosen c
    JOIN grains g
      ON g.at = c.at AND g.ba_seg = c.ba_seg
     AND g.canonical_ag IS NOT DISTINCT FROM c.canonical_ag
     AND g.od >= current_date - (c.win_days || ' days')::interval
    GROUP BY c.at, c.canonical_ag, c.ba_seg, c.win_days
    HAVING count(*) >= 30
  )
  INSERT INTO floor_rate_distribution
    (at, canonical_ag, ba_seg, era_v2, window_days, n, frac_mean, frac_std,
     frac_p05, frac_p10, frac_p25, frac_p50, frac_p75, frac_p80, frac_p85, frac_p90,
     frac_p95, frac_p97, frac_p99, confidence, src, updated_at)
  SELECT at, canonical_ag, ba_seg, 'current', win_days, n, m_mean, m_std,
    p05, p10, p25, p50, p75, p80, p85, p90, p95, p97, p99,
    CASE WHEN n >= 300 THEN 'high' WHEN n >= 100 THEN 'medium'
         WHEN n >= 60 THEN 'low' ELSE 'insufficient_sample' END,
    'bid_records_adaptive_current', NOW()
  FROM stats;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION refresh_floor_rate_distribution() IS
  'Mode B 실격위험 Phase 1 — 실현 낙찰하한율 분포 재계산 (드리프트 적응: |mean180−mean365|>0.4σ & n180>=60 → 180d, 아니면 365d). 전량 DELETE+INSERT, current era. jobid 7 편입. 근거: spec v2 + 2026-07-17 백테스트(군시설 2026-02 레짐 변화).';

SELECT refresh_floor_rate_distribution();
