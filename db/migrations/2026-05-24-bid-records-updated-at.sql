-- bid_records 증분 캐시용 updated_at 인프라
-- 설계: docs/superpowers/specs/2026-05-24-indexeddb-incremental-cache-design.md
-- 계획: docs/superpowers/plans/2026-05-24-indexeddb-incremental-cache.md
-- 적용: Supabase (service_role) — DB 객체는 git에 자동 반영 안 되므로 본 파일로 보존
--
-- 순서 주의: 백필 UPDATE는 반드시 트리거 생성 "전"에 실행한다.
--   트리거가 BEFORE UPDATE라 백필 중 NEW.updated_at=now()로 created_at 값을 덮어쓴다.
--   ALTER+백필(1) → 인덱스(2) → 트리거(3) → RPC(4) 순서를 지킬 것.

-- 1) 컬럼 + 기존행 백필 (트리거 생성 전)
ALTER TABLE bid_records ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
UPDATE bid_records SET updated_at = COALESCE(created_at, now());

-- 2) 델타 쿼리 인덱스
CREATE INDEX IF NOT EXISTS idx_br_updated_at ON bid_records(updated_at, id);

-- 3) BEFORE UPDATE 트리거 — upsert merge(ON CONFLICT DO UPDATE) 포함 모든 UPDATE에서 갱신
CREATE OR REPLACE FUNCTION set_br_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_br_updated_at ON bid_records;
CREATE TRIGGER trg_br_updated_at BEFORE UPDATE ON bid_records
  FOR EACH ROW EXECUTE FUNCTION set_br_updated_at();

-- 4) 싼 변경 게이트 RPC (count + max(updated_at) 한 번에)
CREATE OR REPLACE FUNCTION bid_records_sync_meta()
  RETURNS TABLE(cnt bigint, max_updated timestamptz)
  LANGUAGE sql STABLE AS $$ SELECT count(*), max(updated_at) FROM bid_records $$;
GRANT EXECUTE ON FUNCTION bid_records_sync_meta() TO authenticated;
