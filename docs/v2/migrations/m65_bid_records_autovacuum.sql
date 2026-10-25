-- m65: bid_records 자동 VACUUM 기준 낮춤 (2026-10-25)
-- 배경: 앱이 접속마다 bid_records_sync_meta()로 count(*)·max(updated_at)를 읽는다(idx_br_updated_at 인덱스 전용 스캔).
--       10/21 DB 강제 재시작 이후 통계가 초기화돼 자동 VACUUM이 한 번도 안 돌았고, 가시성 맵이 비어 인덱스 전용 스캔이
--       테이블 행을 다시 읽었다(Heap Fetches 49,300, 4.2초). 병렬 첫 로드와 겹치면 authenticated 시간 제한(8초)을 넘겨 실패 →
--       앱이 10만 건 전체를 다시 받아 첫 화면 17.5초.
-- 조치: 10/25 VACUUM (ANALYZE) 1회 수동 실행(→ 0.25초, Heap Fetches 0) + 아래 기준으로 자주 돌게 한다.
--       기본 20%(약 2만 행 변경) → 1%(약 1천 행). 하루 갱신 ~1,600행이라 대략 하루 1~2회.
ALTER TABLE public.bid_records SET (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_vacuum_insert_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.01
);
