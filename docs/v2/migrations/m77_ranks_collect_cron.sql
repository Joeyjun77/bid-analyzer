-- m77: 개찰 전체 순위 수집 하루 1회 (goyang-focus P3, 2026-11-08, 사용자 승인 "하루 1회 등록")
-- 07:20 KST(22:20 UTC) — 결과 수집(06:00 KST) 뒤. 대상 rank_targets(m76): 고양 include × 대상 업종 × 개찰 완료 × 미수집.
-- 신규 대상 하루 0~1공고, 공고당 API 1~4회 + 0건 공고 재조회. 키 prod_scsbid_info(일일 1,000).
-- 되돌리기: m77_rollback.sql
SELECT cron.schedule(
  'ranks_collect_0720kst',
  '20 22 * * *',
  $$ SELECT public.invoke_edge_function('fn-collect-ranks', jsonb_build_object('dry_run', false, 'limit', 30), 140000); $$
);
