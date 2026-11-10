-- m82: goyang_profile에 사정률 원래 값(vals) 추가 — 그래프 1을 0.01·0.001·0.0001 단위로도 묶어 보기 위함
-- (goyang-focus issue 04, 2026-11-10, 사용자 요청 "소수점 4자리까지 작업해보고 검토")
-- 최근 24개월 사정률을 소수 4자리 절삭(G2B 양식 탭과 같은 절삭 규칙)으로 내려 준다(약 600개, 5KB).
-- 화면 표시 전용(Neutral). 기존 키는 그대로. 되돌리기: 아래 o·n을 바꿔 같은 블록 실행.
DO $m$ DECLARE d text := pg_get_functiondef('public.goyang_profile(text,text,boolean,text)'::regprocedure);
  o text := '''monthly'', (SELECT';
  n text := '''vals'', (SELECT jsonb_agg(trunc(ar1, 4) ORDER BY ar1) FROM v24),' || E'\n  ' || '''monthly'', (SELECT';
BEGIN
  IF (length(d) - length(replace(d, o, ''))) / length(o) <> 1 THEN RAISE EXCEPTION 'm82: goyang_profile 치환 위치를 정확히 1곳 찾지 못함'; END IF;
  EXECUTE replace(d, o, n);
END $m$;
