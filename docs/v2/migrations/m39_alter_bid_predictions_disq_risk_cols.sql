-- m39: bid_predictions 실격위험 스냅샷 컬럼 4개 (Mode B 실격위험 Phase 1)
-- 근거: .scratch/mode-b-disqual-risk/spec.md v2 §DB 변경
-- INSERT 시점 기록 전용 — 매칭 행/과거 행 UPDATE·backfill 절대 금지 (A안 INSERT-only)
-- 전 컬럼 nullable ADD (테이블 재작성 없음)
-- 적용: apply_migration (Supabase MCP), 2026-07-17

ALTER TABLE bid_predictions
  ADD COLUMN disq_risk_pct   NUMERIC,  -- 표시된 실격위험% (0~100)
  ADD COLUMN safe_bid        NUMERIC,  -- 표시된 안전투찰선 금액 (Mode A/종심제/표본부족 NULL)
  ADD COLUMN floor_risk_n    INT,      -- 사용된 분포 표본 수
  ADD COLUMN floor_risk_grain TEXT;    -- 'AG_BA' | 'AT_BA' | NULL

COMMENT ON COLUMN bid_predictions.disq_risk_pct IS
  'Mode B 실격위험 Phase 1 — INSERT 시점 표시값 스냅샷. UPDATE 금지. floor_rate_distribution 기반 P(실현하한 > 추천투찰금).';
COMMENT ON COLUMN bid_predictions.safe_bid IS
  'Mode B 실격위험 Phase 1 — 탈락 회피 하한선(통과확률 95%, p95×ba). Mode A/종심제/표본부족 NULL. UPDATE 금지.';

-- PostgREST 스키마 캐시 리로드 (미실행 시 신규 컬럼 INSERT 에러 — 검토 위험#5)
NOTIFY pgrst, 'reload schema';
