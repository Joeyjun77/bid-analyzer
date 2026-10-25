-- m66: 예측 입력 뷰 2개를 물질화(미리 계산) — 접속마다 10만 건 집계 제거 (2026-10-25)
-- 배경: win1st_dist_map·pred_baseg_finetune은 VIEW라 클라 접속마다 bid_records 2024~ 행을 다시 집계했다.
--       작은 컴퓨트에서 0.6~7.8초, 첫 로드 병렬 요청과 겹치면 authenticated 시간 제한(8초) 초과 → 500 → 클라가 빈 객체를 받아
--       업로드 예측이 빈 1위 분포로 계산될 수 있었다(31f9720으로 순차 로드+재시도 완화).
-- 방식: 기존 VIEW를 *_live로 이름만 바꾸고(정의·의존 그대로 — prediction_corrected_eval은 OID로 live를 계속 참조),
--       같은 이름·같은 컬럼의 MATERIALIZED VIEW를 만든다 → 클라 코드 무변경. 매시 :50 UTC에 CONCURRENTLY 갱신(읽기 막지 않음).
-- 차이: 입력이 bid_records보다 최대 약 1시간 늦을 수 있다(새 업로드·수집분은 다음 갱신부터 반영). 생성 시점 내용은 live와 동일.
-- 롤백: m66_rollback.sql
-- 적용: apply_migration(한 트랜잭션) — RENAME과 CREATE 사이에 이름이 비는 순간이 없다. predict-architect 2026-10-25 검토(Generator·저위험) 반영.

ALTER VIEW public.win1st_dist_map RENAME TO win1st_dist_map_live;
ALTER VIEW public.pred_baseg_finetune RENAME TO pred_baseg_finetune_live;

CREATE MATERIALIZED VIEW public.win1st_dist_map AS SELECT * FROM public.win1st_dist_map_live;
CREATE UNIQUE INDEX win1st_dist_map_uk ON public.win1st_dist_map (grain, key1, key2) NULLS NOT DISTINCT;

CREATE MATERIALIZED VIEW public.pred_baseg_finetune AS SELECT * FROM public.pred_baseg_finetune_live;
CREATE UNIQUE INDEX pred_baseg_finetune_uk ON public.pred_baseg_finetune (canonical_ag, at, ba_seg);

-- 권한: 이전 VIEW와 같게(로그인 사용자 읽기만). MATERIALIZED VIEW는 RLS가 없어 GRANT로만 막는다.
REVOKE ALL ON public.win1st_dist_map, public.pred_baseg_finetune FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.win1st_dist_map, public.pred_baseg_finetune TO authenticated, service_role;
-- live 뷰는 갱신·검증용 — 클라 노출 불필요
REVOKE ALL ON public.win1st_dist_map_live, public.pred_baseg_finetune_live FROM PUBLIC, anon, authenticated;

-- 갱신은 2개 job으로 분리(하나가 실패해도 다른 하나는 돈다). :50·:52 — 기존 job(:03/:33·:05/:35·:15·:00/:20/:40·:00/:30)과 겹치지 않음.
SELECT cron.schedule('refresh_win1st_dist_map_hourly', '50 * * * *', $$ REFRESH MATERIALIZED VIEW CONCURRENTLY public.win1st_dist_map; $$);
SELECT cron.schedule('refresh_pred_baseg_finetune_hourly', '52 * * * *', $$ REFRESH MATERIALIZED VIEW CONCURRENTLY public.pred_baseg_finetune; $$);

-- PostgREST 스키마 캐시 갱신(같은 이름이 VIEW → MATERIALIZED VIEW로 바뀜)
NOTIFY pgrst, 'reload schema';
