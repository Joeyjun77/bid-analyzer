-- m50: refresh_floor_rate_distribution 적응 윈도우 규칙 v2 (m40 임계 결함 수정)
--
-- ■ m40 규칙의 결함
--   (1) 중첩 비교: |mean180 − mean365| 에서 mean365 가 mean180 을 포함 → 레짐 갭이 희석.
--       실측(2026-09-23, era_v2 정정 후): 군시설/S1 중첩갭 0.318%p vs 분리갭 1.252%p (3.9배 축소),
--       군시설/S2 0.364 vs 1.416, 한전/S3 0.131 vs 0.316. 결과적으로 전 grain 이 365d 로 고정되어
--       m40 이 잡으려던 군시설 레짐 변화를 실제로는 한 번도 잡지 못하고 있었음.
--   (2) σ 팽창: 기준 σ365 가 두 레짐 혼합 분산이라 임계 자체가 과대 → 탐지 추가 둔화.
--
-- ■ v2 규칙 (분리 윈도우 + 이중 임계 + 절대 하한 + 히스테리시스)
--   경과일 기준 recent = [0, 180],  older = (180, 365]   ← 서로 겹치지 않고 합이 n365 와 정확히 일치
--   gap = |mean_recent − mean_older|
--   thr = GREATEST(0.4 × std_recent, 2 × SE),  SE = sqrt(s_r²/n_r + s_o²/n_o)
--   flip-in : n_rec>=60 AND n_old>=20 AND gap > 1.25×thr AND gap >= 1.0%p
--   hold    : 직전 윈도우가 180 이면 gap > 0.80×thr AND gap >= 0.8%p 인 동안 유지 (플립플롭 방지)
--   안전투찰선 보호: n365>=100 인데 n_rec<100 이면 전환 금지 (아래 keeps_safe_bid)
--   그 외 365d.  std365>0 가드는 제거(분리 σ 사용), NULL 경로는 eligible 게이트로 명시 차단.
--   gap 은 선택된 윈도우와 무관하게 고정 180/365 분할로 계산 → 결정 통계에 피드백 루프 없음(멱등).
--
-- ■ 측정 근거 (전부 실측, 2026-09-23)
--   M1 전 grain 드라이런(AG_BA 포함): 플립 대상은 군시설/(AT_BA)/S1 단 1건.
--     · 고양시 AG_BA 2 grain 영향 0 — 지자체/경기도 고양시/S1 마진 0.18배,
--       교육청/경기도고양교육지원청/S2 n_rec=1. 핵심영역 고양시 무영향 확인.
--     · 한전 전 grain 영향 0. 군시설/S2 는 n_rec=52 < 60 게이트로 보류(표본 축적 대기).
--   M2 60일 안정성: 군시설/S1 60/60일 성립·전환 0회. 한전/S3 는 비율 조건만으로는
--     21/60일 성립·45일 내 전환 4회(플립플롭)였으나, 절대 하한 1.0%p 추가 시 0/60일·전환 0회로
--     완전 차단. (gap 이 큰 날은 thr 도 동반 상승해 두 조건이 동시 성립하지 않음.)
--   M3 워크포워드 floor-pass(최근 90일, 선행 365d 대비 180d):
--     · 군시설/S1 n=81 → 92.59% → 93.83% (+1.24%p), 안전선 비용 +0.099%p  ← 순이익
--     · 한전/S3   n=11 → 81.82% → 81.82% (변동 없음), 비용 +0.008%p        ← 실익 0
--     실익이 확인된 grain 만 전환하고 실익 0 인 grain 은 배제하는 분할과 일치.
--
-- ■ 미해결 (범위 밖, m50 결함 아님 — 별도 마이그레이션 필요)
--   floor_rate_distribution 은 m38 이래 bid_records 를 is_joint_contract 필터 없이 집계한다.
--   저장소의 다른 refresh 함수(m20·m23·m25~m30)는 전부 공동도급을 제외하며
--   V2_DOMAIN_RULES_CHECK #7 도 이를 요구하지만, /evaluate G-도메인 #7 은
--   floor_pass_daily / win_zone_daily 만 검사해 이 테이블이 게이트를 빠져나간다.
--   하한 분포 오염 가능성 → 영향도 측정 후 별건 처리.
--
-- ■ 롤백
--   docs/v2/migrations/m40_floor_rate_distribution_adaptive_window.sql 의 11~99행으로
--   함수 본문을 **먼저** 복구한 뒤 refresh 를 재실행할 것. (함수를 되돌리지 않고 데이터만
--   되돌리면 jobid 7 야간 배치가 새 규칙을 다시 적용한다.)
--
-- 적용: apply_migration (Supabase MCP), 2026-09-23

CREATE OR REPLACE FUNCTION refresh_floor_rate_distribution()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INT := 0;
BEGIN
  -- 직전 윈도우 선택을 히스테리시스 판정용으로 보존 (DELETE 이전에 스냅샷).
  -- era_v2='current' 필터 필수: UNIQUE 키가 (at, canonical_ag, ba_seg, era_v2) 라
  -- legacy 행이 존재하면 아래 LEFT JOIN 이 grain 당 2행을 뽑아 chosen/stats 가 중복되고,
  -- win_days 가 갈리면 UNIQUE 위반으로 jobid 7 전체가 abort 한다 (jobid 7 과거 인시던트와 동형).
  DROP TABLE IF EXISTS pg_temp._frd_prev;
  CREATE TEMP TABLE _frd_prev AS
    SELECT at, canonical_ag, ba_seg, window_days
    FROM floor_rate_distribution
    WHERE era_v2 = 'current';

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
    -- AG_BA + AT_BA 두 grain 을 한 번에: canonical_ag NULL = AT_BA
    SELECT at, canonical_ag, ba_seg, od, floor_frac FROM base WHERE canonical_ag IS NOT NULL
    UNION ALL
    SELECT at, NULL, ba_seg, od, floor_frac FROM base
  ),
  agg AS (
    SELECT at, canonical_ag, ba_seg,
      count(*) AS n365,
      -- recent: 최근 180일
      count(*)                FILTER (WHERE od >= current_date - interval '180 days') AS n_rec,
      avg(floor_frac)         FILTER (WHERE od >= current_date - interval '180 days') AS m_rec,
      stddev_samp(floor_frac) FILTER (WHERE od >= current_date - interval '180 days') AS s_rec,
      -- older: 180~365일 (recent 와 분리)
      count(*)                FILTER (WHERE od <  current_date - interval '180 days') AS n_old,
      avg(floor_frac)         FILTER (WHERE od <  current_date - interval '180 days') AS m_old,
      stddev_samp(floor_frac) FILTER (WHERE od <  current_date - interval '180 days') AS s_old
    FROM grains
    GROUP BY at, canonical_ag, ba_seg
    HAVING count(*) >= 30
  ),
  scored AS (
    SELECT a.*,
      abs(a.m_rec - a.m_old) AS gap,
      GREATEST(
        0.4 * a.s_rec,
        2 * sqrt(a.s_rec^2 / NULLIF(a.n_rec,0) + a.s_old^2 / NULLIF(a.n_old,0))
      ) AS thr,
      -- 게이트: 양쪽 표본 충분 + 평균/표준편차 정의됨.
      -- 이 게이트가 thr 의 NULL·0분모 경로를 전담한다. GREATEST 는 NULL 인자를 무시하므로
      -- 스스로 안전하지 않다 — eligible 을 완화하면 thr 이 조용히 한쪽 임계로 퇴화한다.
      (a.n_rec >= 60 AND a.n_old >= 20
       AND a.m_rec IS NOT NULL AND a.m_old IS NOT NULL
       AND a.s_rec IS NOT NULL AND a.s_old IS NOT NULL) AS eligible,
      -- 소비자 보호: floorRisk.js 안전투찰선(q95)은 n>=100 을 요구한다.
      -- 365d 로는 100 을 넘던 grain 이 180d 전환으로 100 미만이 되면 안전투찰선이
      -- 조용히 사라지거나 AT_BA 로 성기게 fallback 한다 → 그런 전환은 금지.
      (a.n365 < 100 OR a.n_rec >= 100) AS keeps_safe_bid
    FROM agg a
  ),
  chosen AS (
    SELECT s.at, s.canonical_ag, s.ba_seg,
      CASE
        WHEN NOT s.eligible OR NOT s.keeps_safe_bid
             OR s.thr IS NULL OR s.thr <= 0 THEN 365
        -- flip-in: 새로 180d 로 전환
        WHEN s.gap > 1.25 * s.thr AND s.gap >= 0.010 THEN 180
        -- hold: 이미 180d 였으면 완화된 임계로 유지 (경계 진동 흡수)
        WHEN COALESCE(p.window_days, 365) = 180
             AND s.gap > 0.80 * s.thr AND s.gap >= 0.008 THEN 180
        ELSE 365
      END AS win_days
    FROM scored s
    LEFT JOIN pg_temp._frd_prev p
      ON p.at = s.at AND p.ba_seg = s.ba_seg
     AND p.canonical_ag IS NOT DISTINCT FROM s.canonical_ag
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
    'bid_records_adaptive_v2_current', NOW()
  FROM stats;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  DROP TABLE IF EXISTS pg_temp._frd_prev;
  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION refresh_floor_rate_distribution() IS
  'Mode B 실격위험 Phase 1 — 실현 낙찰하한율 분포 재계산 (적응 윈도우 v2, m50): 경과일 기준 recent[0,180] vs older(180,365] 분리 비교, gap > 1.25×GREATEST(0.4σ_rec, 2SE) AND gap >= 1.0%p 이면 180d, 직전이 180d면 0.80×/0.8%p 히스테리시스로 유지, 그 외 365d. 게이트 n_rec>=60 AND n_old>=20, 그리고 안전투찰선 보호(n365>=100 인데 n_rec<100 이면 전환 금지). 전량 DELETE+INSERT, era_v2=''current'' 한정. jobid 7 편입. 근거: m40 중첩 비교 결함(갭 3.9배 희석) 실측 + M1/M2/M3 검증.';

SELECT refresh_floor_rate_distribution();
