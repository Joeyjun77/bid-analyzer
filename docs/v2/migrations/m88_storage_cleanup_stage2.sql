-- m88: DB 용량 2단계 정리 (2026-11-14, 사용자 승인 "2단계 정리 진행") — m87 뒤 587MB, 무료 한도 500MB
-- ① bid_history의 legacy_bid_records 행(62,365행, bid_records 사본) 삭제. file_upload 행(앱 업로드 기록)은 유지.
--    읽는 곳: recalibrate_agency_profiles 하나뿐(호출처·cron 없음). FK(bid_predictions_v3.matched_history_id) 참조 0건.
--    복구: docs/agency-predictor/migrations/V6A_10_backfill.sql 재실행(bid_records에서 다시 만든다, bid_records는 삭제 금지라 원본 보존).
-- ② 미사용 인덱스 8개 삭제(누적 스캔 0~3회). 되돌리기는 아래 CREATE INDEX.
-- 제외: 개찰 60일 지난 비대상 공고 정리(~20MB) — 함수 8개·뷰 3개(고양 기관 후보, G2B 비교 리포트 등)가 bid_notices를 읽고
--       user_notice_favorites FK가 있어 화면이 조용히 바뀔 위험 대비 이득이 작아 보류.
-- 적용 뒤 수동: VACUUM (FULL, ANALYZE) bid_history, bid_notices;  (DELETE만으로는 용량이 줄지 않는다)
--
-- 되돌리기(인덱스):
--   CREATE INDEX idx_bps_openg ON public.bid_prelim_sets USING btree (openg_dt);
--   CREATE INDEX idx_bid_records_not_excluded ON public.bid_records USING btree (od) WHERE (is_excluded = false);
--   CREATE INDEX idx_bid_at ON public.bid_records USING btree (at);
--   CREATE INDEX idx_bid_era ON public.bid_records USING btree (era);
--   CREATE INDEX idx_bid_records_work_cat ON public.bid_records USING btree (work_cat);
--   CREATE INDEX idx_notices_cat ON public.bid_notices USING btree (cat);
--   CREATE INDEX idx_notices_status ON public.bid_notices USING btree (status);
--   CREATE INDEX idx_notices_status_od ON public.bid_notices USING btree (status, od DESC);

DELETE FROM public.bid_history WHERE source = 'legacy_bid_records';

DROP INDEX IF EXISTS public.idx_bps_openg;
DROP INDEX IF EXISTS public.idx_bid_records_not_excluded;
DROP INDEX IF EXISTS public.idx_bid_at;
DROP INDEX IF EXISTS public.idx_bid_era;
DROP INDEX IF EXISTS public.idx_bid_records_work_cat;
DROP INDEX IF EXISTS public.idx_notices_cat;
DROP INDEX IF EXISTS public.idx_notices_status;
DROP INDEX IF EXISTS public.idx_notices_status_od;
