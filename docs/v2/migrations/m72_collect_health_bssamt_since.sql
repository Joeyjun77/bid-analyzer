-- m72: v_collect_health의 bssamt 줄은 수집기 시작일(2026-11-07 KST) 이후만 판정
-- m70이 줄을 붙이면서 그 전 날짜(수집기 없던 날)까지 '실행 기록 없음' WARN으로 보였다(11/8 /accuracy 체크 12-b 잘못된 경고).
-- 마지막 UNION 갈래(공고·예비가격·기초금액 일별)에 시작일 조건만 더한다. security_invoker 유지(m71 교훈).
-- 되돌리기: 아래 o·n을 바꿔 같은 블록 실행.
DO $m$ DECLARE d text := pg_get_viewdef('public.v_collect_health'::regclass, true);
  o text := 'LEFT JOIN daily r ON r.d = d.d AND r.operation = c.operation) x';
  n text := 'LEFT JOIN daily r ON r.d = d.d AND r.operation = c.operation WHERE c.collector <> ''bssamt''::text OR d.d >= ''2026-11-07''::date) x';
BEGIN
  IF (length(d) - length(replace(d, o, ''))) / length(o) <> 1 THEN RAISE EXCEPTION 'm72: v_collect_health 치환 위치를 정확히 1곳 찾지 못함'; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.v_collect_health WITH (security_invoker = true) AS ' || replace(d, o, n);
END $m$;
