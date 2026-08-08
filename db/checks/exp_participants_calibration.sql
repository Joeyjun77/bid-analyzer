-- exp_participants 캘리브레이션 점검 (Phase ① 예상 참가자수)
-- 근거: .scratch/pwin-participants/spec.md §2-4 — 개찰 후 bid_records.pc(실측)와 대조
-- 실행 조건: Phase ① 배포 이후 file_upload 예측이 개찰 매칭된 뒤. read-only.
-- 해석: |오차비율| 중앙값이 작을수록 양호. grain별로 분리 확인.

-- ── 0) 표본 현황 ─────────────────────────────────────────────
SELECT
  count(*)                                                  AS preds_with_exp,
  count(*) FILTER (WHERE p.matched_record_id IS NOT NULL)   AS matched,
  count(*) FILTER (WHERE r.pc > 0)                          AS with_actual_pc
FROM bid_predictions p
LEFT JOIN bid_records r ON r.id = p.matched_record_id
WHERE p.exp_participants IS NOT NULL AND p.source = 'file_upload';

-- ── 1) 예측 vs 실측 (grain별) ────────────────────────────────
WITH base AS (
  SELECT p.exp_participants AS pred_pc, p.exp_participants_grain AS grain, r.pc AS actual_pc
  FROM bid_predictions p
  JOIN bid_records r ON r.id = p.matched_record_id
  WHERE p.exp_participants IS NOT NULL AND p.source = 'file_upload' AND r.pc > 0
)
SELECT
  COALESCE(grain, '(전체)') AS grain,
  count(*) AS n,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(actual_pc - pred_pc)::float / actual_pc)::numeric, 3) AS med_abs_err_ratio,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY (actual_pc - pred_pc)::float / actual_pc)::numeric, 3)   AS med_bias_ratio, -- +면 과소예측
  round(avg(pred_pc)) AS avg_pred, round(avg(actual_pc)) AS avg_actual
FROM base
GROUP BY ROLLUP (grain)
ORDER BY grain;

-- ── 2) 버킷 일치율 — 필터 유용성 (예측 버킷 = 실측 버킷 비율) ──
WITH base AS (
  SELECT
    CASE WHEN p.exp_participants < 1000 THEN 'small' WHEN p.exp_participants < 3000 THEN 'mid' ELSE 'large' END AS pred_bucket,
    CASE WHEN r.pc < 1000 THEN 'small' WHEN r.pc < 3000 THEN 'mid' ELSE 'large' END AS actual_bucket
  FROM bid_predictions p
  JOIN bid_records r ON r.id = p.matched_record_id
  WHERE p.exp_participants IS NOT NULL AND p.source = 'file_upload' AND r.pc > 0
)
SELECT pred_bucket, count(*) AS n,
  round(100.0 * avg((pred_bucket = actual_bucket)::int), 1) AS bucket_match_pct
FROM base
GROUP BY pred_bucket
ORDER BY pred_bucket;
