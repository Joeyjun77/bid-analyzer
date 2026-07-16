-- m38: floor_rate_distribution — Mode B 실격위험% + 안전투찰선 (Phase 1, 표시 전용)
-- 근거: .scratch/mode-b-disqual-risk/spec.md v2 (predict-architect 검토 반영)
-- 정의: floor_frac = floor_price / ba  [실현 낙찰하한율, bid_rate 공간]
--   실격위험% = P(floor_frac > 투찰금/ba), 안전투찰선 = p95(floor_frac) × ba
-- grain: AG_BA(canonical_ag×ba_seg) + AT_BA(at×ba_seg). ba_seg 필수 — 낙찰하한율이 금액대별로
--   달라 seg 혼합 시 이봉분포 (AT뿐 아니라 AG도 동일, 검토 위험#7 확장 적용)
-- era_v2='current'만 (검토 위험#2 — legacy 혼입 시 과보수), 윈도우 365일 롤링
-- 분위수: percentile_disc (보간 없는 실표본 상위값 = 보수 방향)
-- 갱신: refresh_floor_rate_distribution() — jobid 7(refresh-analysis-assets-daily) 편입
-- 적용: apply_migration (Supabase MCP), 2026-07-17

CREATE TABLE floor_rate_distribution (
  id            BIGSERIAL PRIMARY KEY,
  at            TEXT NOT NULL,
  canonical_ag  TEXT,              -- NULL = AT_BA grain
  ba_seg        TEXT NOT NULL CHECK (ba_seg IN ('S1','S2','S3','S4','S5')),
  era_v2        TEXT NOT NULL CHECK (era_v2 IN ('legacy','current')),
  window_days   INT  NOT NULL DEFAULT 365,
  n             INT  NOT NULL,
  frac_mean     NUMERIC(9,6),
  frac_std      NUMERIC(9,6),
  frac_p05      NUMERIC(9,6),
  frac_p10      NUMERIC(9,6),
  frac_p25      NUMERIC(9,6),
  frac_p50      NUMERIC(9,6),
  frac_p75      NUMERIC(9,6),
  frac_p80      NUMERIC(9,6),
  frac_p85      NUMERIC(9,6),
  frac_p90      NUMERIC(9,6),
  frac_p95      NUMERIC(9,6),
  frac_p97      NUMERIC(9,6),
  frac_p99      NUMERIC(9,6),
  confidence    TEXT NOT NULL CHECK (confidence IN ('high','medium','low','insufficient_sample')),
  src           TEXT NOT NULL DEFAULT 'bid_records_365d_current',
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE NULLS NOT DISTINCT (at, canonical_ag, ba_seg, era_v2)
);

CREATE INDEX idx_frd_lookup ON floor_rate_distribution (at, canonical_ag, ba_seg, era_v2);

ALTER TABLE floor_rate_distribution ENABLE ROW LEVEL SECURITY;

CREATE POLICY frd_anon_select ON floor_rate_distribution FOR SELECT TO anon USING (true);
CREATE POLICY frd_auth_select ON floor_rate_distribution FOR SELECT TO authenticated USING (true);
CREATE POLICY frd_service_all ON floor_rate_distribution FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE floor_rate_distribution IS
  'Mode B 실격위험 Phase 1 — 실현 낙찰하한율(floor_price/ba) 경험분포. grain=AG_BA/AT_BA(ba_seg 필수), era current만, 365d 롤링. 실격위험%=P(frac>투찰금/ba), 안전투찰선=p95×ba. 표시 전용(Evaluator), 소비 규칙: 위험% n>=60, 안전선 n>=100. 근거: .scratch/mode-b-disqual-risk/spec.md v2.';

CREATE OR REPLACE FUNCTION refresh_floor_rate_distribution()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INT := 0;
BEGIN
  -- 롤링 윈도우라 사라진 grain의 stale 행 방지 위해 전량 재계산 (함수 트랜잭션 내 원자적)
  DELETE FROM floor_rate_distribution;

  WITH base AS (
    SELECT at, canonical_ag,
      CASE WHEN ba<1e8 THEN 'S1' WHEN ba<3e8 THEN 'S2' WHEN ba<1e9 THEN 'S3'
           WHEN ba<3e9 THEN 'S4' ELSE 'S5' END AS ba_seg,
      floor_price/NULLIF(ba,0) AS floor_frac
    FROM bid_records
    WHERE floor_price IS NOT NULL AND ba > 0
      AND era_v2 = 'current'
      AND od >= current_date - interval '365 days'
      AND floor_price/NULLIF(ba,0) BETWEEN 0.5 AND 1.0   -- 데이터 오류 sanity 필터
  ),
  ag_ba AS (
    SELECT at, canonical_ag, ba_seg, count(*) AS n,
      avg(floor_frac)::numeric(9,6) AS m_mean, stddev_samp(floor_frac)::numeric(9,6) AS m_std,
      percentile_disc(0.05) WITHIN GROUP (ORDER BY floor_frac)::numeric(9,6) AS p05,
      percentile_disc(0.10) WITHIN GROUP (ORDER BY floor_frac)::numeric(9,6) AS p10,
      percentile_disc(0.25) WITHIN GROUP (ORDER BY floor_frac)::numeric(9,6) AS p25,
      percentile_disc(0.50) WITHIN GROUP (ORDER BY floor_frac)::numeric(9,6) AS p50,
      percentile_disc(0.75) WITHIN GROUP (ORDER BY floor_frac)::numeric(9,6) AS p75,
      percentile_disc(0.80) WITHIN GROUP (ORDER BY floor_frac)::numeric(9,6) AS p80,
      percentile_disc(0.85) WITHIN GROUP (ORDER BY floor_frac)::numeric(9,6) AS p85,
      percentile_disc(0.90) WITHIN GROUP (ORDER BY floor_frac)::numeric(9,6) AS p90,
      percentile_disc(0.95) WITHIN GROUP (ORDER BY floor_frac)::numeric(9,6) AS p95,
      percentile_disc(0.97) WITHIN GROUP (ORDER BY floor_frac)::numeric(9,6) AS p97,
      percentile_disc(0.99) WITHIN GROUP (ORDER BY floor_frac)::numeric(9,6) AS p99
    FROM base
    WHERE canonical_ag IS NOT NULL
    GROUP BY at, canonical_ag, ba_seg
    HAVING count(*) >= 30   -- 저장 최소선 (소비는 60/100 규칙)
  ),
  at_ba AS (
    SELECT at, NULL::text AS canonical_ag, ba_seg, count(*) AS n,
      avg(floor_frac)::numeric(9,6), stddev_samp(floor_frac)::numeric(9,6),
      percentile_disc(0.05) WITHIN GROUP (ORDER BY floor_frac)::numeric(9,6),
      percentile_disc(0.10) WITHIN GROUP (ORDER BY floor_frac)::numeric(9,6),
      percentile_disc(0.25) WITHIN GROUP (ORDER BY floor_frac)::numeric(9,6),
      percentile_disc(0.50) WITHIN GROUP (ORDER BY floor_frac)::numeric(9,6),
      percentile_disc(0.75) WITHIN GROUP (ORDER BY floor_frac)::numeric(9,6),
      percentile_disc(0.80) WITHIN GROUP (ORDER BY floor_frac)::numeric(9,6),
      percentile_disc(0.85) WITHIN GROUP (ORDER BY floor_frac)::numeric(9,6),
      percentile_disc(0.90) WITHIN GROUP (ORDER BY floor_frac)::numeric(9,6),
      percentile_disc(0.95) WITHIN GROUP (ORDER BY floor_frac)::numeric(9,6),
      percentile_disc(0.97) WITHIN GROUP (ORDER BY floor_frac)::numeric(9,6),
      percentile_disc(0.99) WITHIN GROUP (ORDER BY floor_frac)::numeric(9,6)
    FROM base
    GROUP BY at, ba_seg
    HAVING count(*) >= 30
  ),
  unioned AS (
    SELECT * FROM ag_ba UNION ALL SELECT * FROM at_ba
  )
  INSERT INTO floor_rate_distribution
    (at, canonical_ag, ba_seg, era_v2, window_days, n, frac_mean, frac_std,
     frac_p05, frac_p10, frac_p25, frac_p50, frac_p75, frac_p80, frac_p85, frac_p90,
     frac_p95, frac_p97, frac_p99, confidence, src, updated_at)
  SELECT at, canonical_ag, ba_seg, 'current', 365, n, m_mean, m_std,
    p05, p10, p25, p50, p75, p80, p85, p90, p95, p97, p99,
    CASE WHEN n >= 300 THEN 'high' WHEN n >= 100 THEN 'medium'
         WHEN n >= 60 THEN 'low' ELSE 'insufficient_sample' END,
    'bid_records_365d_current', NOW()
  FROM unioned;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION refresh_floor_rate_distribution() IS
  'Mode B 실격위험 Phase 1 — 실현 낙찰하한율 분포 재계산 (전량 DELETE+INSERT, 365d 롤링·current era). jobid 7 일배치 편입. 근거: .scratch/mode-b-disqual-risk/spec.md v2.';

CREATE OR REPLACE FUNCTION lookup_floor_rate_distribution(
  p_at           TEXT,
  p_canonical_ag TEXT    DEFAULT NULL,
  p_ba           NUMERIC DEFAULT NULL,
  p_era          TEXT    DEFAULT 'current'
)
RETURNS TABLE (
  matched_grain TEXT, n INT, confidence TEXT,
  frac_mean NUMERIC, frac_std NUMERIC,
  frac_p05 NUMERIC, frac_p10 NUMERIC, frac_p25 NUMERIC, frac_p50 NUMERIC,
  frac_p75 NUMERIC, frac_p80 NUMERIC, frac_p85 NUMERIC, frac_p90 NUMERIC,
  frac_p95 NUMERIC, frac_p97 NUMERIC, frac_p99 NUMERIC
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_ba_seg TEXT;
BEGIN
  IF p_ba IS NULL THEN RETURN; END IF;
  v_ba_seg := CASE
    WHEN p_ba < 100000000  THEN 'S1'
    WHEN p_ba < 300000000  THEN 'S2'
    WHEN p_ba < 1000000000 THEN 'S3'
    WHEN p_ba < 3000000000 THEN 'S4'
    ELSE 'S5' END;

  -- 1단: AG_BA
  IF p_canonical_ag IS NOT NULL THEN
    RETURN QUERY
      SELECT 'AG_BA'::text, d.n, d.confidence, d.frac_mean, d.frac_std,
             d.frac_p05, d.frac_p10, d.frac_p25, d.frac_p50, d.frac_p75,
             d.frac_p80, d.frac_p85, d.frac_p90, d.frac_p95, d.frac_p97, d.frac_p99
      FROM floor_rate_distribution d
      WHERE d.at = p_at AND d.canonical_ag = p_canonical_ag AND d.ba_seg = v_ba_seg
        AND d.era_v2 = p_era AND d.n >= 60
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- 2단: AT_BA
  RETURN QUERY
    SELECT 'AT_BA'::text, d.n, d.confidence, d.frac_mean, d.frac_std,
           d.frac_p05, d.frac_p10, d.frac_p25, d.frac_p50, d.frac_p75,
           d.frac_p80, d.frac_p85, d.frac_p90, d.frac_p95, d.frac_p97, d.frac_p99
    FROM floor_rate_distribution d
    WHERE d.at = p_at AND d.canonical_ag IS NULL AND d.ba_seg = v_ba_seg
      AND d.era_v2 = p_era AND d.n >= 60
    LIMIT 1;
END;
$$;

COMMENT ON FUNCTION lookup_floor_rate_distribution IS
  'Mode B 실격위험 Phase 1 — 실현 낙찰하한율 분포 RPC. 2단 fallback AG_BA→AT_BA (n>=60), ba_seg 필수. 근거: .scratch/mode-b-disqual-risk/spec.md v2.';

GRANT EXECUTE ON FUNCTION lookup_floor_rate_distribution(TEXT, TEXT, NUMERIC, TEXT) TO anon, authenticated;

-- 1회 즉시 적재
SELECT refresh_floor_rate_distribution();

-- jobid 7 편입 (별도 실행됨): cron.alter_job(7, command := ... + 'SELECT refresh_floor_rate_distribution();')
