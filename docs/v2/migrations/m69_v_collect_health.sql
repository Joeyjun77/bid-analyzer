-- m69: 수집 결과 기반 실패 감지 뷰. cron "succeeded"는 pg_net 호출 성공만 뜻해 함수 실패(546·500)와 빈 응답이 보이지 않는다.
-- 2026-11-05. 신호: api_ingestion_log(결과·공고·예비가격), g2b_auto_sheet 갱신 건수. net._http_response는 약 6시간만 보관돼 쓰지 않음.
-- 양성 대조(14일 창 기준): 11/5 낙찰목록 7/10쪽·G2B 타임아웃, 10/31·11/1 빈 응답, 10/30·11/2 G2B 타임아웃을 잡고 11/3·11/4는 OK여야 한다.
-- 읽기 전용, 예측 경로 무관(Evaluator). 롤백은 m69_rollback.sql.
CREATE OR REPLACE VIEW public.v_collect_health WITH (security_invoker = true) AS
WITH now_k AS (
  SELECT (now() AT TIME ZONE 'Asia/Seoul') AS t
), days AS (
  SELECT generate_series((SELECT t FROM now_k)::date - 13, (SELECT t FROM now_k)::date, interval '1 day')::date AS d
), log AS (
  SELECT (ingested_at AT TIME ZONE 'Asia/Seoul')::date AS d, (ingested_at AT TIME ZONE 'Asia/Seoul')::time AS tm,
         operation, status, page_no, total_count, rows_saved
  FROM api_ingestion_log
  WHERE ingested_at >= now() - interval '15 days'
), results AS (
  SELECT d, operation, count(*) AS calls, count(DISTINCT page_no) FILTER (WHERE status <> 'error') AS pages,
         count(*) FILTER (WHERE status = 'error') AS errs, max(total_count) AS total, sum(rows_saved) AS saved
  FROM log
  WHERE operation IN ('getOpengResultListInfoCnstwk', 'getScsbidListSttusCnstwk') AND tm BETWEEN '05:55' AND '06:30'
  GROUP BY 1, 2
), daily AS (
  SELECT d, operation, count(*) AS calls, count(*) FILTER (WHERE status = 'error') AS errs, sum(rows_saved) AS saved
  FROM log
  WHERE operation IN ('getBidPblancListInfoCnstwk', 'getOpengResultListInfoCnstwkPreparPcDetail')
  GROUP BY 1, 2
), sheet AS (
  SELECT (updated_at AT TIME ZONE 'Asia/Seoul')::date AS d, count(*) AS n
  FROM g2b_auto_sheet
  WHERE updated_at >= now() - interval '15 days' AND (updated_at AT TIME ZONE 'Asia/Seoul')::time BETWEEN '07:00' AND '08:30'
  GROUP BY 1
)
SELECT x.d AS kst_day, x.collector, x.verdict, x.calls, x.pages, x.expected, x.errors, x.saved, x.detail
FROM (
  SELECT d.d, c.collector, r.calls, r.pages, LEAST(10, ceil(r.total / 100.0))::int AS expected, r.errs AS errors, r.saved,
    CASE WHEN d.d = (SELECT t FROM now_k)::date AND (SELECT t FROM now_k)::time < '06:10' THEN 'PENDING'
         WHEN r.calls IS NULL THEN 'FAIL'
         WHEN r.errs > 0 THEN 'FAIL'
         WHEN r.pages < LEAST(10, ceil(r.total / 100.0)) THEN 'WARN'
         ELSE 'OK' END AS verdict,
    CASE WHEN d.d = (SELECT t FROM now_k)::date AND (SELECT t FROM now_k)::time < '06:10' THEN '06:00 실행 전'
         WHEN r.calls IS NULL THEN '실행 기록 없음'
         WHEN r.errs > 0 THEN 'API 오류·빈 응답'
         WHEN r.pages < LEAST(10, ceil(r.total / 100.0)) THEN '중간에 끊김(함수 시간 제한 의심)'
         ELSE '' END AS detail
  FROM days d
  CROSS JOIN (VALUES ('results_open', 'getOpengResultListInfoCnstwk'), ('results_final', 'getScsbidListSttusCnstwk')) c(collector, operation)
  LEFT JOIN results r ON r.d = d.d AND r.operation = c.operation
  UNION ALL
  SELECT d.d, 'g2b_sheet', NULL, NULL, NULL, NULL, s.n,
    CASE WHEN d.d = (SELECT t FROM now_k)::date AND (SELECT t FROM now_k)::time < '07:10' THEN 'PENDING'
         WHEN s.n IS NULL THEN 'FAIL' ELSE 'OK' END,
    CASE WHEN d.d = (SELECT t FROM now_k)::date AND (SELECT t FROM now_k)::time < '07:10' THEN '07:00 실행 전'
         WHEN s.n IS NULL THEN '아침 갱신 0건(후보 쿼리·함수 실패 의심)' ELSE '' END
  FROM days d LEFT JOIN sheet s ON s.d = d.d
  UNION ALL
  SELECT d.d, c.collector, r.calls, NULL, NULL, r.errs, r.saved,
    CASE WHEN r.calls IS NULL THEN c.no_rows
         WHEN r.errs * 2 >= r.calls THEN 'FAIL'
         WHEN r.errs > 0 THEN 'WARN'
         ELSE 'OK' END,
    CASE WHEN r.calls IS NULL THEN '실행 기록 없음' WHEN r.errs > 0 THEN 'API 오류·빈 응답' ELSE '' END
  FROM days d
  CROSS JOIN (VALUES ('notices', 'getBidPblancListInfoCnstwk', 'FAIL'), ('prepc', 'getOpengResultListInfoCnstwkPreparPcDetail', 'WARN')) c(collector, operation, no_rows)
  LEFT JOIN daily r ON r.d = d.d AND r.operation = c.operation
) x;

COMMENT ON VIEW public.v_collect_health IS '수집기별 일별 실제 결과 판정(FAIL/WARN/OK/PENDING). cron 성공 여부와 별개. /accuracy에서 확인.';

REVOKE ALL ON public.v_collect_health FROM PUBLIC, anon, authenticated;
