-- m78 되돌리기
DROP FUNCTION IF EXISTS public.goyang_profile(text, text, boolean, text);
DROP FUNCTION IF EXISTS public.goyang_ag_texts();
-- v_collect_health ranks 줄 제거(m78 치환의 역방향, security_invoker 유지)
DO $m$ DECLARE d text := pg_get_viewdef('public.v_collect_health'::regclass, true);
BEGIN
  d := replace(d, ', ''getOpengResultListInfoOpengCompt''::text])', '])');
  d := replace(d, ', (''ranks''::text,''getOpengResultListInfoOpengCompt''::text,''WARN''::text))', ')');
  d := replace(d, 'WHERE (c.collector <> ''bssamt''::text OR d.d >= ''2026-11-07''::date) AND (c.collector <> ''ranks''::text OR d.d >= ''2026-11-09''::date)) x',
                  'WHERE c.collector <> ''bssamt''::text OR d.d >= ''2026-11-07''::date) x');
  EXECUTE 'CREATE OR REPLACE VIEW public.v_collect_health WITH (security_invoker = true) AS ' || d;
END $m$;
