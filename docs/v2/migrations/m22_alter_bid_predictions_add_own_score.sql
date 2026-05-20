-- m22: bid_predictions에 own_score 컬럼 추가 (V2_DOMAIN_RULES_CHECK #1, 코덱스 라운드 11 권고)
-- 근거: 적재 시점 자사 비가격 점수 보존 → materialized-value invalidation + KPI 측정 정확도
-- 정책:
--   - DEFAULT NULL 유지 (A안 INSERT-only 원칙 — DEFAULT 20은 backfill UPDATE 유도하므로 금지)
--   - NULL은 코드에서 ownScore=20과 동치 처리 (Math.max(20, p.own_score ?? 20))
--   - 신규 INSERT 시점에 ownScore 함께 적재
--   - matched row는 UPDATE 안 함 (NULL 영구 유지)
-- 적용: apply_migration (Supabase MCP), 2026-05-21

ALTER TABLE bid_predictions
  ADD COLUMN IF NOT EXISTS own_score SMALLINT
    CHECK (own_score IS NULL OR own_score BETWEEN 0 AND 20);

COMMENT ON COLUMN bid_predictions.own_score IS
  'V2_DOMAIN_RULES_CHECK #1 — 적재 시점 자사 비가격 점수 (0~20). NULL=score 미적용(legacy/디폴트 만점 20과 동치). 라운드 11 권고.';

-- 적재 후속 (코드에서 처리):
-- INSERT INTO bid_predictions (..., own_score) VALUES (..., 20)
-- UPDATE bid_predictions SET own_score=:ownScore WHERE id=:id AND match_status='pending'
