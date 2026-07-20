-- disq_risk 캘리브레이션 점검 (Mode B 실격위험% Phase 1 후속)
-- 근거: src/lib/floorRisk.js — disq_risk_pct = P(실현 floor_price > 투찰금)
-- 기준 투찰금 = INSERT 시점 COALESCE(bid1st_v2_bid, opt_bid, pred_bid_amount) (App.jsx:906,981)
-- 실행 조건: 2026-07-17 배포 이후 file_upload 예측이 개찰 매칭된 뒤 (matched + floor_price 존재)
-- read-only. 표본 권장: 전체 n>=30부터 해석, bin별 n>=10부터 신뢰.

-- ── 0) 표본 현황 ─────────────────────────────────────────────
SELECT
  count(*)                                                        AS preds_with_risk,
  count(*) FILTER (WHERE p.matched_record_id IS NOT NULL)         AS matched,
  count(*) FILTER (WHERE r.floor_price IS NOT NULL)               AS with_actual_floor
FROM bid_predictions p
LEFT JOIN bid_records r ON r.id = p.matched_record_id
WHERE p.disq_risk_pct IS NOT NULL AND p.source = 'file_upload';

-- ── 1) 신뢰도(reliability) 빈별 예측 vs 실측 ──────────────────
-- 예측 disq_risk_pct 빈 평균 ≈ 실측 실격률이면 캘리브레이션 양호
WITH base AS (
  SELECT
    p.disq_risk_pct,
    p.floor_risk_grain,
    p.at,
    COALESCE(p.bid1st_v2_bid, p.opt_bid, p.pred_bid_amount) AS ref_bid,
    r.floor_price
  FROM bid_predictions p
  JOIN bid_records r ON r.id = p.matched_record_id
  WHERE p.disq_risk_pct IS NOT NULL
    AND p.source = 'file_upload'
    AND r.floor_price IS NOT NULL
), scored AS (
  SELECT *,
    (floor_price > ref_bid)::int AS actual_disq,
    CASE
      WHEN disq_risk_pct < 1  THEN '0. <1%'
      WHEN disq_risk_pct < 5  THEN '1. 1-5%'
      WHEN disq_risk_pct < 10 THEN '2. 5-10%'
      WHEN disq_risk_pct < 25 THEN '3. 10-25%'
      WHEN disq_risk_pct < 50 THEN '4. 25-50%'
      ELSE '5. >=50%'
    END AS bin
  FROM base
)
SELECT
  bin,
  count(*)                                   AS n,
  round(avg(disq_risk_pct)::numeric, 1)      AS pred_risk_avg,
  round(100.0 * avg(actual_disq), 1)         AS actual_disq_pct,
  round((avg(actual_disq) - avg(disq_risk_pct) / 100.0)::numeric, 3) AS gap  -- +면 과소예측(위험 저평가)
FROM scored
GROUP BY bin
ORDER BY bin;

-- ── 2) Brier score (전체 / grain별) — 낮을수록 좋음, 0.25=무정보 ──
WITH base AS (
  SELECT
    p.disq_risk_pct / 100.0 AS pred_p,
    p.floor_risk_grain,
    (r.floor_price > COALESCE(p.bid1st_v2_bid, p.opt_bid, p.pred_bid_amount))::int AS actual_disq
  FROM bid_predictions p
  JOIN bid_records r ON r.id = p.matched_record_id
  WHERE p.disq_risk_pct IS NOT NULL AND p.source = 'file_upload' AND r.floor_price IS NOT NULL
)
SELECT
  COALESCE(floor_risk_grain, '(전체)') AS grain,
  count(*) AS n,
  round(avg(power(pred_p - actual_disq, 2))::numeric, 4) AS brier,
  round(100.0 * avg(actual_disq), 1) AS actual_disq_pct
FROM base
GROUP BY ROLLUP (floor_risk_grain)
ORDER BY grain;

-- ── 3) 안전투찰선(safe_bid) 검증 — Mode B q95 목표: 실격률 <=5% ──
WITH base AS (
  SELECT
    p.at,
    (r.floor_price > p.safe_bid)::int AS safe_line_disq
  FROM bid_predictions p
  JOIN bid_records r ON r.id = p.matched_record_id
  WHERE p.safe_bid IS NOT NULL AND p.source = 'file_upload' AND r.floor_price IS NOT NULL
)
SELECT
  COALESCE(at, '(전체)') AS at,
  count(*) AS n,
  round(100.0 * avg(safe_line_disq), 1) AS safe_bid_disq_pct  -- 목표 <=5%
FROM base
GROUP BY ROLLUP (at)
ORDER BY at;
