-- refresh_agency_win_stats() — agency_win_stats(예측 탭 "타깃" P1~P5 등급) 재계산 함수
-- 생성: 2026-05-24. Supabase 직접 적용(apply_migration) — git 자동추적 아님, 재배포 시 본 파일로 재적용.
--
-- 검증된 산식(2026-05-24): 입력 불변 56개 기관에서 tier·n_perfect_win 56/56 원본(4월 ad-hoc 적재) 일치.
-- 출처: docs/skills/02-data-architecture.md (패턴2 소스필터 / 패턴3 perfect_bid·legal_floor / 패턴6 tier CASE).
--
-- 보존 규칙(재현 불가 → UPSERT에서 미갱신/덮어쓰기 방지):
--   1) n_actual_win / actual_win_rate (자사 실제 1위): 원본 판정식 불명(현 sum=6, actual_winner LIKE 자사명은 2건뿐).
--      → ON CONFLICT DO UPDATE SET 절에서 제외해 기존 행 보존. 신규 기관만 0.
--   2) canonical 수동 승격(recommendation ILIKE '%canonical%'/'%승격%', 현재 4건: 경기도김포·부천·화성오산교육지원청, 서울지방조달청):
--      공식이면 P5 강등 → is_canon이면 tier/label/recommendation을 cur값으로 보존.
--
-- 예측 게이트 무관: opt_adj/추천투찰금이 아닌 표시용 P등급. /evaluate·deploy-gate 대상 아님.
-- 실행: SELECT * FROM refresh_agency_win_stats();  (service_role/cron 전용 — anon/authenticated EXECUTE 회수)

CREATE OR REPLACE FUNCTION refresh_agency_win_stats()
RETURNS TABLE(total_rows int, p1 int, p2 int, p3 int, p4 int, p5 int, refreshed_at timestamptz)
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO agency_win_stats
    (ag, at, n_total, n_perfect_win, n_actual_win, theoretical_win_rate, actual_win_rate,
     median_adj_rate, std_adj_rate, mae, mean_bias, avg_participants, avg_amount_eok,
     priority_tier, priority_label, recommendation, confidence, updated_at)
  WITH src AS (
    SELECT ag, at, ba, av, actual_expected_price AS axp, pred_floor_rate AS fr,
           actual_adj_rate AS aadj, actual_bid_amount AS abid, adj_rate_error AS err,
           actual_participant_count AS pc
    FROM bid_predictions
    WHERE match_status='matched' AND actual_adj_rate IS NOT NULL
      AND actual_bid_amount IS NOT NULL AND actual_expected_price IS NOT NULL
      AND ABS(adj_rate_error::numeric) < 5
      AND (actual_winner IS NULL OR actual_winner NOT LIKE '%유찰%')
  ),
  calc AS (
    SELECT *,
      CEIL(CASE WHEN av>0 THEN av+(axp-av)*(fr/100.0) ELSE axp*(fr/100.0) END)::bigint AS legal_floor,
      CEIL(CASE WHEN av>0 THEN av+(ba*(1+aadj/100.0)-av)*(fr/100.0) ELSE ba*(1+aadj/100.0)*(fr/100.0) END)::bigint AS perfect_bid
    FROM src
  ),
  agg AS (
    SELECT ag,
      mode() WITHIN GROUP (ORDER BY at) AS at,
      count(*) AS n_total,
      count(*) FILTER (WHERE perfect_bid BETWEEN legal_floor AND abid) AS n_perfect_win,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY aadj::numeric)::numeric AS median_adj,
      stddev_samp(aadj::numeric)::numeric AS std_adj,
      avg(abs(err::numeric))::numeric AS mae_v,
      avg(err::numeric)::numeric AS bias_v,
      round(avg(pc))::int AS avg_participants,
      round((avg(ba)/1e8)::numeric,2) AS avg_amount_eok
    FROM calc GROUP BY ag HAVING count(*) >= 3
  ),
  prep AS (
    SELECT a.*,
      round(a.n_perfect_win*100.0/a.n_total,4) AS twr,
      CASE WHEN a.n_perfect_win*100.0/a.n_total>=30 THEN 1
           WHEN a.n_perfect_win*100.0/a.n_total>=18 THEN 2
           WHEN a.n_perfect_win*100.0/a.n_total>=10 THEN 3
           WHEN a.n_perfect_win*100.0/a.n_total>=3 THEN 4 ELSE 5 END AS formula_tier,
      cur.priority_tier AS cur_tier, cur.priority_label AS cur_label, cur.recommendation AS cur_rec,
      (cur.recommendation ILIKE '%canonical%' OR cur.recommendation ILIKE '%승격%') AS is_canon
    FROM agg a LEFT JOIN agency_win_stats cur ON cur.ag=a.ag
  )
  SELECT ag, at, n_total, n_perfect_win, 0, twr, 0,
    round(median_adj,4), round(std_adj,4), round(mae_v,4), round(bias_v,4),
    avg_participants, avg_amount_eok,
    CASE WHEN is_canon THEN cur_tier ELSE formula_tier END,
    CASE WHEN is_canon THEN cur_label
      ELSE (CASE formula_tier WHEN 1 THEN '🏆 P1 주력 타깃' WHEN 2 THEN '⭐ P2 우선 투찰'
            WHEN 3 THEN '📊 P3 선택 투찰' WHEN 4 THEN '⚠️ P4 신중 검토' ELSE '⛔ P5 회피' END) END,
    CASE WHEN is_canon THEN cur_rec
      ELSE (CASE formula_tier WHEN 1 THEN '집중 투찰' WHEN 2 THEN '집중 투찰'
            WHEN 3 THEN '선택 투찰' WHEN 4 THEN '선택 투찰' ELSE '회피' END) END,
    LEAST(1, round(n_total/20.0,4)),
    now()
  FROM prep
  ON CONFLICT (ag) DO UPDATE SET
    at=EXCLUDED.at, n_total=EXCLUDED.n_total, n_perfect_win=EXCLUDED.n_perfect_win,
    theoretical_win_rate=EXCLUDED.theoretical_win_rate, median_adj_rate=EXCLUDED.median_adj_rate,
    std_adj_rate=EXCLUDED.std_adj_rate, mae=EXCLUDED.mae, mean_bias=EXCLUDED.mean_bias,
    avg_participants=EXCLUDED.avg_participants, avg_amount_eok=EXCLUDED.avg_amount_eok,
    priority_tier=EXCLUDED.priority_tier, priority_label=EXCLUDED.priority_label,
    recommendation=EXCLUDED.recommendation, confidence=EXCLUDED.confidence, updated_at=now();
  -- NOTE: n_actual_win, actual_win_rate 미갱신 → 기존 행 보존.

  RETURN QUERY
  SELECT count(*)::int,
    count(*) FILTER (WHERE priority_tier=1)::int,
    count(*) FILTER (WHERE priority_tier=2)::int,
    count(*) FILTER (WHERE priority_tier=3)::int,
    count(*) FILTER (WHERE priority_tier=4)::int,
    count(*) FILTER (WHERE priority_tier=5)::int,
    now()
  FROM agency_win_stats;
END;
$$;

REVOKE EXECUTE ON FUNCTION refresh_agency_win_stats() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION refresh_agency_win_stats() IS 'agency_win_stats P1~P5 재계산. n_actual_win/canonical 승격 보존. 표시용(예측게이트 무관). 산식 출처: docs/skills/02-data-architecture.md + project_agency_win_stats_recompute 메모리.';
