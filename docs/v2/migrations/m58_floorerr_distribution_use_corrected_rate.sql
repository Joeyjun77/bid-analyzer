-- m58 (2026-10-12): refresh_floorerr_distribution이 저장된 pred_floor_rate 대신 정정된 요율 함수로 예상 하한을 다시 계산한다.
-- 배경: m57로 3억 미만 요율이 90.25 → 89.745가 되면 신규 예측의 예상 하한이 0.505%p 내려간다.
--   분포가 저장값(옛 요율) 기준으로 남으면 Mode A m_star가 옛 편향에 맞춰져 추천가 통과율이 85.0% → 63.0%로 떨어진다(n=300 실측).
--   과거 행은 수정할 수 없으므로(A안 INSERT-only) 함수가 계산 시점에 정정 요율을 쓴다.
-- 유형 인자는 저장 at이 아니라 리터럴 '군시설' — 이 함수는 classify_agency_type(ag)='군시설' 행만 다루고 저장 at에는 재분류 이전 값이 남아 있을 수 있다.
-- 전제: m57(get_floor_rate_db 정정)이 먼저 적용돼 있어야 한다. 적용 직후 SELECT refresh_floorerr_distribution(); 1회 실행.
-- 적용 후 달라지는 것(2026-10-13 사전 측정): current n 300 → 299(id 12789의 floor_err가 9.712 → 10.218%로 ±10% 필터 밖),
--   그래서 confidence가 medium → insufficient_sample(n>=300 경계). 추천가 계산은 n>=5만 보므로 영향 없고 b_pred_src 문자열의 표본 라벨만 바뀐다.
--   legacy(n=139)는 p85 −1.182 → +0.817%p — 구 시기 공고에 신요율이 저장돼 있던 것이 바로잡히는 방향. 라이브는 era_v2='current'만 쓴다.
-- pred_floor_rate IS NOT NULL 조건은 계산에 쓰이지 않지만 표본 집합을 이전 정의와 같게 두려고 남겼다.
-- 롤백: m36_create_refresh_floorerr_distribution.sql 을 재적용한 뒤 refresh 1회(요율 식만 되돌리면 src 라벨이 사실과 달라진다).

CREATE OR REPLACE FUNCTION public.refresh_floorerr_distribution()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rows INT := 0;
BEGIN
  WITH base AS (
    SELECT br.era_v2,
           (br.floor_price - bp.pred_expected_price
              * get_floor_rate_db('군시설', COALESCE(NULLIF(bp.ep,0), bp.ba), bp.open_date) / 100.0) / NULLIF(bp.ba,0) AS floor_err
    FROM bid_predictions bp
    JOIN bid_records br ON br.id = bp.matched_record_id
    WHERE bp.match_status = 'matched'
      AND bp.actual_adj_rate IS NOT NULL
      AND classify_agency_type(bp.ag) = '군시설'
      AND bp.pred_expected_price IS NOT NULL
      AND bp.pred_floor_rate IS NOT NULL
      AND br.floor_price IS NOT NULL
      AND bp.ba IS NOT NULL
      AND bp.open_date IS NOT NULL
      AND COALESCE(bp.actual_winner,'') NOT IN ('유찰','유찰(무)')
      AND COALESCE(br.is_joint_contract, false) != true
      AND br.era_v2 IS NOT NULL
  ),
  filt AS (
    SELECT * FROM base WHERE abs(floor_err) <= 0.10
  ),
  agg AS (
    SELECT
      era_v2,
      count(*) AS n,
      avg(floor_err)::numeric(9,6)                                        AS m_mean,
      stddev_samp(floor_err)::numeric(9,6)                                AS m_std,
      percentile_cont(0.10) WITHIN GROUP (ORDER BY floor_err)::numeric(9,6) AS m_p10,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY floor_err)::numeric(9,6) AS m_p25,
      percentile_cont(0.50) WITHIN GROUP (ORDER BY floor_err)::numeric(9,6) AS m_p50,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY floor_err)::numeric(9,6) AS m_p75,
      percentile_cont(0.80) WITHIN GROUP (ORDER BY floor_err)::numeric(9,6) AS m_p80,
      percentile_cont(0.85) WITHIN GROUP (ORDER BY floor_err)::numeric(9,6) AS m_p85,
      percentile_cont(0.90) WITHIN GROUP (ORDER BY floor_err)::numeric(9,6) AS m_p90,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY floor_err)::numeric(9,6) AS m_p95
    FROM filt
    GROUP BY era_v2
  )
  INSERT INTO floorerr_distribution
    (at, canonical_ag, ba_seg, era_v2, n,
     floorerr_mean, floorerr_std,
     floorerr_p10, floorerr_p25, floorerr_p50, floorerr_p75, floorerr_p80, floorerr_p85, floorerr_p90, floorerr_p95,
     confidence, src, updated_at)
  SELECT
    '군시설', NULL, NULL, era_v2, n,
    m_mean, m_std,
    m_p10, m_p25, m_p50, m_p75, m_p80, m_p85, m_p90, m_p95,
    CASE WHEN n >= 1000 THEN 'high' WHEN n >= 300 THEN 'medium' ELSE 'insufficient_sample' END,
    'live_matched_corrected_rate', NOW()
  FROM agg
  ON CONFLICT (at, canonical_ag, ba_seg, era_v2) DO UPDATE SET
    n            = EXCLUDED.n,
    floorerr_mean= EXCLUDED.floorerr_mean,
    floorerr_std = EXCLUDED.floorerr_std,
    floorerr_p10 = EXCLUDED.floorerr_p10,
    floorerr_p25 = EXCLUDED.floorerr_p25,
    floorerr_p50 = EXCLUDED.floorerr_p50,
    floorerr_p75 = EXCLUDED.floorerr_p75,
    floorerr_p80 = EXCLUDED.floorerr_p80,
    floorerr_p85 = EXCLUDED.floorerr_p85,
    floorerr_p90 = EXCLUDED.floorerr_p90,
    floorerr_p95 = EXCLUDED.floorerr_p95,
    confidence   = EXCLUDED.confidence,
    src          = EXCLUDED.src,
    updated_at   = NOW();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$function$;
