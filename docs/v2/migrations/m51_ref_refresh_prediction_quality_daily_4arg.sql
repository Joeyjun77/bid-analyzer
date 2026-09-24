-- m51 참조본: refresh_prediction_quality_daily 4인자 (m42a floor_safe 비율공간 + m43 source 슬라이스 반영)
-- 이 본문은 m42a/m43 적용 당시 git 파일로 남지 않았다. m51 적용 직전(2026-09-24) pg_get_functiondef로 추출.
-- m51은 이 함수를 변경하지 않는다(5인자 함수를 별도 신설). 이 파일은 감사·재구축용 기록이다.
CREATE OR REPLACE FUNCTION public.refresh_prediction_quality_daily(p_since date DEFAULT ((CURRENT_DATE - '90 days'::interval))::date, p_until date DEFAULT CURRENT_DATE, p_model_version text DEFAULT 'v6.2'::text, p_source text DEFAULT 'file_upload'::text)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_rows int := 0;
BEGIN
  DELETE FROM prediction_quality_daily
  WHERE measured_on BETWEEN p_since AND p_until AND model_version = p_model_version;

  WITH base AS (
    SELECT
      p.open_date::date AS measured_on,
      p.opt_adj_router AS route,
      p.at,
      (p.opt_adj - p.actual_adj_rate) AS residual,
      ABS(p.opt_adj - p.actual_adj_rate) AS err,
      -- v8 #5: 상관 서브쿼리 → bid_records JOIN 1회. floor_safe = 실제 floor_price 기준(없으면 NULL→집계 제외).
      -- m42a: 비율 공간 비교 — ba 단위(부가세) 불일치에 불변
      CASE WHEN p.opt_bid IS NULL OR r.floor_price IS NULL
                OR COALESCE(p.ba,0) <= 0 OR COALESCE(r.ba,0) <= 0 THEN NULL
           WHEN p.opt_bid / p.ba >= r.floor_price / r.ba THEN 1 ELSE 0 END AS floor_safe,
      CASE WHEN SIGN(p.opt_adj) = SIGN(p.actual_adj_rate) THEN 1 ELSE 0 END AS dir_ok,
      CASE WHEN p.rec_1st_possible IS NOT NULL THEN 1 ELSE 0 END AS has_rec1,
      COALESCE(((p.rec_1st_possible::jsonb) ->> 'existing')::boolean, false)     AS t1_existing,
      COALESCE(((p.rec_1st_possible::jsonb) ->> 'aggressive')::boolean, false)   AS t1_aggressive,
      COALESCE(((p.rec_1st_possible::jsonb) ->> 'balanced')::boolean, false)     AS t1_balanced,
      COALESCE(((p.rec_1st_possible::jsonb) ->> 'conservative')::boolean, false) AS t1_conservative
    FROM bid_predictions p
    LEFT JOIN bid_records r ON r.id = p.matched_record_id
    WHERE p.match_status='matched'
      AND p.opt_adj IS NOT NULL
      AND p.actual_adj_rate IS NOT NULL
      AND COALESCE(p.is_cancelled,false)=false
      AND p.open_date BETWEEN p_since AND p_until
      AND p.source = p_source  -- m43: 슬라이스 분리 (v6.2=file_upload / v6.2_g2b=g2b_auto)
  ), slices AS (
    SELECT measured_on, NULL::text AS route, NULL::text AS at, residual, err, floor_safe, dir_ok, has_rec1, t1_existing, t1_aggressive, t1_balanced, t1_conservative FROM base
    UNION ALL
    SELECT measured_on, route, NULL::text, residual, err, floor_safe, dir_ok, has_rec1, t1_existing, t1_aggressive, t1_balanced, t1_conservative FROM base
    UNION ALL
    SELECT measured_on, NULL::text, at, residual, err, floor_safe, dir_ok, has_rec1, t1_existing, t1_aggressive, t1_balanced, t1_conservative FROM base
    UNION ALL
    SELECT measured_on, route, at, residual, err, floor_safe, dir_ok, has_rec1, t1_existing, t1_aggressive, t1_balanced, t1_conservative FROM base
  ), agg AS (
    SELECT measured_on, route, at,
      COUNT(*)::int n,
      ROUND(AVG(err)::numeric, 4) mae,
      ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY err)::numeric, 4) median_err,
      ROUND(percentile_cont(0.9) WITHIN GROUP (ORDER BY err)::numeric, 4) p90_err,
      ROUND(MAX(err)::numeric, 4) max_err,
      ROUND(AVG(CASE WHEN err<=0.5 THEN 1 ELSE 0 END)::numeric*100, 1) hit_0_5_pct,
      ROUND(AVG(CASE WHEN err<=0.3 THEN 1 ELSE 0 END)::numeric*100, 1) hit_0_3_pct,
      ROUND(AVG(floor_safe)::numeric*100, 1) floor_safe_pct,
      ROUND(AVG(dir_ok)::numeric*100, 1) direction_pct,
      ROUND(AVG(residual)::numeric, 4) residual_mean,
      SUM(has_rec1)::int AS top1_n,
      ROUND((AVG(CASE WHEN t1_existing THEN 1.0 ELSE 0.0 END) FILTER (WHERE has_rec1=1))::numeric*100, 1) AS top1_hit_existing,
      ROUND((AVG(CASE WHEN t1_balanced THEN 1.0 ELSE 0.0 END) FILTER (WHERE has_rec1=1))::numeric*100, 1) AS top1_hit_balanced,
      ROUND((AVG(CASE WHEN t1_aggressive THEN 1.0 ELSE 0.0 END) FILTER (WHERE has_rec1=1))::numeric*100, 1) AS top1_hit_aggressive,
      ROUND((AVG(CASE WHEN t1_conservative THEN 1.0 ELSE 0.0 END) FILTER (WHERE has_rec1=1))::numeric*100, 1) AS top1_hit_conservative
    FROM slices GROUP BY measured_on, route, at
  )
  INSERT INTO prediction_quality_daily
    (measured_on, model_version, route, at, n, mae, median_err, p90_err, max_err,
     hit_0_5_pct, hit_0_3_pct, floor_safe_pct, direction_pct, residual_mean,
     top1_n, top1_hit_existing, top1_hit_balanced, top1_hit_aggressive, top1_hit_conservative)
  SELECT measured_on, p_model_version, route, at, n, mae, median_err, p90_err, max_err,
         hit_0_5_pct, hit_0_3_pct, floor_safe_pct, direction_pct, residual_mean,
         top1_n, top1_hit_existing, top1_hit_balanced, top1_hit_aggressive, top1_hit_conservative
  FROM agg;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$function$
;
