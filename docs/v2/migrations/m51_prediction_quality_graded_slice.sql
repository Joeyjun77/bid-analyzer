-- m51: prediction_quality_daily 채점 대상 선택 슬라이스 (P1 평가층 정렬, 2026-09-24)
--
-- 배경: 화면 메인 추천은 bid1st_v2(App.jsx:541)인데 품질 게이트(v6.2)는 opt_adj를 채점한다.
--   메인안을 채점하는 게이트가 없었다. 스펙: .scratch/p1-eval-alignment/spec.md
--
-- 설계:
--   · 기존 4인자 함수는 무변경. 5인자 함수를 오버로드로 신설한다.
--   · 5인자 함수는 어떤 인자에도 DEFAULT를 두지 않는다. 4인자 함수가 전 인자 DEFAULT를
--     가지므로, 0~4인자 호출은 4인자 함수로만, 5인자 호출은 5인자 함수로만 해석된다.
--   · DROP을 쓰지 않는 이유: plpgsql 본문·cron 명령 텍스트는 의존성 추적 대상이 아니라
--     DROP이 조용히 성공하고 호출자는 실행 시점에야 깨진다.
--   · p_graded='opt'   → 4인자 함수와 결과 동일 (등가성 검증 완료 후 적용)
--     p_graded='shown' → bid1st_v2_adj/bid1st_v2_bid 기준 채점, 두 값이 있는 행만 대상
--
-- 롤백: DROP FUNCTION public.refresh_prediction_quality_daily(date,date,text,text,text);
--       cron jobid 8을 m51b 이전 두 줄로 되돌림(아래 m51b 주석);
--       DELETE FROM prediction_quality_daily WHERE model_version='v6.2_shown';

-- ── m51a: 5인자 함수 ─────────────────────────────────────────────
CREATE FUNCTION public.refresh_prediction_quality_daily(
  p_since date, p_until date, p_model_version text, p_source text, p_graded text)
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
  v_rows int := 0;
BEGIN
  IF p_graded IS NULL OR p_graded NOT IN ('opt','shown') THEN
    RAISE EXCEPTION 'p_graded must be ''opt'' or ''shown'', got %', p_graded;
  END IF;

  DELETE FROM prediction_quality_daily
  WHERE measured_on BETWEEN p_since AND p_until AND model_version = p_model_version;

  WITH base AS (
    SELECT
      p.open_date::date AS measured_on,
      p.opt_adj_router AS route,
      p.at,
      (g.adj - p.actual_adj_rate) AS residual,
      ABS(g.adj - p.actual_adj_rate) AS err,
      -- m42a 비율 공간 규약 유지 — ba 단위(부가세) 불일치에 불변
      CASE WHEN g.bid IS NULL OR r.floor_price IS NULL
                OR COALESCE(p.ba,0) <= 0 OR COALESCE(r.ba,0) <= 0 THEN NULL
           WHEN g.bid / p.ba >= r.floor_price / r.ba THEN 1 ELSE 0 END AS floor_safe,
      CASE WHEN SIGN(g.adj) = SIGN(p.actual_adj_rate) THEN 1 ELSE 0 END AS dir_ok,
      CASE WHEN p.rec_1st_possible IS NOT NULL THEN 1 ELSE 0 END AS has_rec1,
      COALESCE(((p.rec_1st_possible::jsonb) ->> 'existing')::boolean, false)     AS t1_existing,
      COALESCE(((p.rec_1st_possible::jsonb) ->> 'aggressive')::boolean, false)   AS t1_aggressive,
      COALESCE(((p.rec_1st_possible::jsonb) ->> 'balanced')::boolean, false)     AS t1_balanced,
      COALESCE(((p.rec_1st_possible::jsonb) ->> 'conservative')::boolean, false) AS t1_conservative
    FROM bid_predictions p
    LEFT JOIN bid_records r ON r.id = p.matched_record_id
    CROSS JOIN LATERAL (
      SELECT
        CASE WHEN p_graded = 'shown' THEN p.bid1st_v2_adj ELSE p.opt_adj END AS adj,
        CASE WHEN p_graded = 'shown' THEN p.bid1st_v2_bid ELSE p.opt_bid END AS bid
    ) g
    WHERE p.match_status='matched'
      AND p.opt_adj IS NOT NULL
      AND p.actual_adj_rate IS NOT NULL
      AND COALESCE(p.is_cancelled,false)=false
      AND p.open_date BETWEEN p_since AND p_until
      AND p.source = p_source
      AND (p_graded = 'opt' OR (p.bid1st_v2_adj IS NOT NULL AND p.bid1st_v2_bid IS NOT NULL))
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
$function$;

COMMENT ON FUNCTION public.refresh_prediction_quality_daily(date,date,text,text,text) IS
  'P1(m51) 채점 대상 선택: p_graded=opt → 4인자 함수와 동일, shown → 메인 추천(bid1st_v2) 채점. 인자 DEFAULT 없음(4인자 오버로드와 모호성 방지). model_version v6.2_shown 슬라이스 생성용.';

-- ── m51b: cron jobid 8 + 백필 (m51a 등가성 검증 통과 후 별도 실행) ──
-- 롤백 시 cron 원복 명령:
--   SELECT cron.alter_job(8, command := $c$
--     SELECT refresh_prediction_quality_daily((CURRENT_DATE - INTERVAL '7 days')::date, CURRENT_DATE, 'v6.2', 'file_upload');
--     SELECT refresh_prediction_quality_daily((CURRENT_DATE - INTERVAL '7 days')::date, CURRENT_DATE, 'v6.2_g2b', 'g2b_auto');
--   $c$);
SELECT cron.alter_job(8, command := $c$
  SELECT refresh_prediction_quality_daily((CURRENT_DATE - INTERVAL '7 days')::date, CURRENT_DATE, 'v6.2', 'file_upload');
  SELECT refresh_prediction_quality_daily((CURRENT_DATE - INTERVAL '7 days')::date, CURRENT_DATE, 'v6.2_g2b', 'g2b_auto');
  SELECT refresh_prediction_quality_daily((CURRENT_DATE - INTERVAL '7 days')::date, CURRENT_DATE, 'v6.2_shown', 'file_upload', 'shown');
$c$);

SELECT refresh_prediction_quality_daily('2026-01-01'::date, CURRENT_DATE, 'v6.2_shown', 'file_upload', 'shown');
