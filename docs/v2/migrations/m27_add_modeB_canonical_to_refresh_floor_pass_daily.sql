-- m27: refresh_floor_pass_daily에 v2_modeB_canonical model_version 분기 + era_v2 필터
-- 결함:
--   - 함수 본체에 era_v2 필터 없음 → cron jobid 10(daily) + jobid 11(weekly gate) 모두
--     'v2_modeB_real' 사용으로 mixed 데이터 기반 calibration 측정
--   - weekly gate(4주 PASS 누적 = V6 retire 종료 조건)가 mixed 기준 → V6 retire 판정 신뢰도 의심
--   - G-도메인 #0 부분 위반 (era_v2 미사용 SQL)
-- 정정 (옵션 B — predict-architect 권고):
--   - 함수 본체에 conditional WHERE 추가: p_model_version='v2_modeB_canonical'일 때만
--     era_v2='current' 적용 (그 외 model_version은 기존 동작 보존)
--   - 'v2_modeB_real' historical 측정값 의미 보존 (mixed)
--   - cron jobid 10·11 model_version을 'v2_modeB_canonical'로 갱신 → 정합 기준 카운터 신규 시작
-- 영향:
--   - 5/18·5/19 PASS 누적(mixed 기준)은 무효, 정합 기준 카운터 5/25(월) 첫 게이트부터 신규
--   - V6 retire ETA 4주 PASS 완성까지 ~6주 연장 (2026-06-22 무렵)
--   - predict-architect 검토: Evaluator 분류, /evaluate 면제, 핵심 영역 MAE 영향 없음
-- 적용: apply_migration, 2026-05-21

CREATE OR REPLACE FUNCTION refresh_floor_pass_daily(
  p_since date DEFAULT ((CURRENT_DATE - '30 days'::interval))::date,
  p_until date DEFAULT CURRENT_DATE,
  p_model_version text DEFAULT 'v2_modeB'::text,
  p_pred_min_age_hours integer DEFAULT 24
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inserted INT := 0;
  v_rows     INT;
BEGIN
  -- 1) 전체 집계
  INSERT INTO floor_pass_daily
    (measured_on, at, canonical_ag, model_version, n,
     pred_floor_pass_prob_avg, actual_floor_pass_rate, calibration_gap)
  SELECT
    p_until, NULL::text, NULL::text, p_model_version,
    COUNT(*)::int,
    ROUND(AVG(p.b_pred_floor_pass_prob)::numeric, 4),
    ROUND((SUM(CASE WHEN p.b_pred_adj >= p.actual_adj_rate THEN 1 ELSE 0 END)::numeric
           / NULLIF(COUNT(*),0))::numeric, 4),
    ROUND(ABS(AVG(p.b_pred_floor_pass_prob)
              - (SUM(CASE WHEN p.b_pred_adj >= p.actual_adj_rate THEN 1 ELSE 0 END)::numeric
                 / NULLIF(COUNT(*),0)))::numeric, 4)
  FROM bid_predictions p
  LEFT JOIN bid_records r ON r.id = p.matched_record_id
  WHERE p.match_status='matched' AND p.b_pred_mode='B'
    AND p.b_pred_adj IS NOT NULL AND p.actual_adj_rate IS NOT NULL AND p.b_pred_floor_pass_prob IS NOT NULL
    AND p.open_date BETWEEN p_since AND p_until
    AND COALESCE(p.actual_winner,'') NOT IN ('유찰','유찰(무)')
    AND ABS(p.b_pred_adj - p.actual_adj_rate) <= 5
    AND p.created_at < p.matched_at
    AND p.matched_at < NOW() - (p_pred_min_age_hours || ' hours')::interval
    -- ★ 공동도급 제외 (m20)
    AND COALESCE(r.is_joint_contract, false) != true
    -- ★ m27: v2_modeB_canonical 분기일 때만 era_v2='current' 적용
    AND (p_model_version != 'v2_modeB_canonical' OR COALESCE(r.era_v2, 'current') = 'current')
  HAVING COUNT(*) >= 5
  ON CONFLICT (measured_on, at, canonical_ag, model_version) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_inserted := v_inserted + v_rows;

  -- 2) at별 집계
  INSERT INTO floor_pass_daily
    (measured_on, at, canonical_ag, model_version, n,
     pred_floor_pass_prob_avg, actual_floor_pass_rate, calibration_gap)
  SELECT
    p_until, p.at, NULL::text, p_model_version,
    COUNT(*)::int,
    ROUND(AVG(p.b_pred_floor_pass_prob)::numeric, 4),
    ROUND((SUM(CASE WHEN p.b_pred_adj >= p.actual_adj_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0))::numeric, 4),
    ROUND(ABS(AVG(p.b_pred_floor_pass_prob) - (SUM(CASE WHEN p.b_pred_adj >= p.actual_adj_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0)))::numeric, 4)
  FROM bid_predictions p
  LEFT JOIN bid_records r ON r.id = p.matched_record_id
  WHERE p.match_status='matched' AND p.b_pred_mode='B'
    AND p.b_pred_adj IS NOT NULL AND p.actual_adj_rate IS NOT NULL AND p.b_pred_floor_pass_prob IS NOT NULL
    AND p.open_date BETWEEN p_since AND p_until AND p.at IS NOT NULL
    AND COALESCE(p.actual_winner,'') NOT IN ('유찰','유찰(무)')
    AND ABS(p.b_pred_adj - p.actual_adj_rate) <= 5
    AND p.created_at < p.matched_at
    AND p.matched_at < NOW() - (p_pred_min_age_hours || ' hours')::interval
    AND COALESCE(r.is_joint_contract, false) != true
    AND (p_model_version != 'v2_modeB_canonical' OR COALESCE(r.era_v2, 'current') = 'current')
  GROUP BY p.at
  HAVING COUNT(*) >= 3
  ON CONFLICT (measured_on, at, canonical_ag, model_version) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_inserted := v_inserted + v_rows;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION refresh_floor_pass_daily(date,date,text,integer) IS
  'V2 Mode B calibration 일별 측정 — 공동도급 제외 (m20) + v2_modeB_canonical 분기에서 era_v2=current (m27). G-도메인 #0·#7 정합.';

-- m27 cron 갱신: jobid 10 daily refresh model_version 전환
SELECT cron.alter_job(
  job_id := 10,
  command := ' SELECT refresh_floor_pass_daily(
       (CURRENT_DATE - INTERVAL ''30 days'')::date,
       CURRENT_DATE,
       ''v2_modeB_canonical'',
       24
     ); '
);

-- m27 cron 갱신: jobid 11 weekly gate model_version 전환
SELECT cron.alter_job(
  job_id := 11,
  command := ' INSERT INTO mode_gate_report
       (report_week, at, mode, primary_kpi_name, kpi_value, kpi_target, gate_status, dual_run_n, notes)
     SELECT
       date_trunc(''week'', CURRENT_DATE)::date,
       COALESCE(at, ''_overall_''),
       ''B'',
       ''actual_floor_pass_rate'',
       actual_floor_pass_rate,
       0.9000,
       CASE
         WHEN n < 5 THEN ''insufficient_sample''
         WHEN actual_floor_pass_rate >= 0.90 THEN ''pass''
         WHEN actual_floor_pass_rate >= 0.80 THEN ''warn''
         ELSE ''fail''
       END,
       n,
       ''weekly cron auto canonical — gap='' || calibration_gap::text || '' pred='' || pred_floor_pass_prob_avg::text
     FROM floor_pass_daily
     WHERE model_version=''v2_modeB_canonical''
       AND measured_on = (
         SELECT MAX(measured_on) FROM floor_pass_daily WHERE model_version=''v2_modeB_canonical''
       )
     ON CONFLICT (report_week, at, mode) DO NOTHING; '
);

-- m27 적용: 첫 v2_modeB_canonical 측정 1회 즉시 실행 (cron 다음 실행 대기 없이 정합 회복 확인)
SELECT refresh_floor_pass_daily(
  (CURRENT_DATE - INTERVAL '30 days')::date,
  CURRENT_DATE,
  'v2_modeB_canonical',
  24
) AS rows_updated;
