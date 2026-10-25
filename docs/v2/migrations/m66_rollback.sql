-- m66 롤백: 물질화 이전(VIEW) 상태로 되돌린다.
SELECT cron.unschedule('refresh_win1st_dist_map_hourly');
SELECT cron.unschedule('refresh_pred_baseg_finetune_hourly');
DROP MATERIALIZED VIEW IF EXISTS public.win1st_dist_map;
DROP MATERIALIZED VIEW IF EXISTS public.pred_baseg_finetune;
ALTER VIEW public.win1st_dist_map_live RENAME TO win1st_dist_map;
ALTER VIEW public.pred_baseg_finetune_live RENAME TO pred_baseg_finetune;
GRANT SELECT ON public.win1st_dist_map, public.pred_baseg_finetune TO authenticated;
NOTIFY pgrst, 'reload schema';
