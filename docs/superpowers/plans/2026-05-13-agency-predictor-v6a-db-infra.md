# 발주처사정율 예측 시스템 V6-A — DB 인프라 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** bid-analyzer Supabase에 V6 신규 예측 시스템의 DB 인프라(테이블 5개 + RPC 4개 + 트리거 2개 + 백필 + recalibrate)를 구축해 V6-B 메인 탭 진입 조건을 충족한다.

**Architecture:** 기존 시스템(`bid_records`, `predict_v6` 등 v6.2)과 완전 분리된 신규 DB 객체만 생성한다. 모든 마이그레이션은 Supabase MCP `apply_migration`으로 적용하고 동일 SQL을 `docs/agency-predictor/migrations/V6A_<NN>_<name>.sql`에도 보존해 git에서 재현 가능하게 한다. 백필은 `bid_records → bid_history` 62K건을 한 번에 옮기고 `recalibrate_agency_profiles()`로 (`canonical_ag`, `industry`, `amount_tier`) grain의 분포 캐시를 생성한다. 자세한 설계 근거는 `docs/superpowers/specs/2026-05-13-agency-predictor-v6a-db-infra-design.md`.

**Tech Stack:** PostgreSQL 17.6 (Supabase 호스팅), Supabase MCP (`apply_migration`/`execute_sql`), 기존 `normalize_agency_name()` RPC. 클라이언트 코드/의존성 변경 0.

---

## 사전 컨벤션 (모든 Task 공통)

- Windows PowerShell 환경. CRLF 경고는 무시.
- 마이그레이션 적용: Supabase MCP `apply_migration({name, query})` — DDL/RPC/트리거 정의용.
- 데이터 INSERT (백필 등): Supabase MCP `execute_sql({query})` — 큰 결과를 반환하므로 마이그레이션 트랜잭션 부적합.
- 검증 쿼리: `execute_sql` 호출 후 반환값 그대로 본문에 인용.
- 각 Task 끝에 **기존 시스템 무손상 확인** (회귀 보호):
  ```sql
  SELECT
    (SELECT COUNT(*) FROM bid_records) AS records_count,    -- 62,365 유지
    (SELECT COUNT(*) FROM bid_predictions) AS preds_count;  -- 1,940 유지
  ```
- 커밋 prefix: `feat(agency-predictor-v6a):` 또는 `chore(agency-predictor-v6a):`. main 직접 작업.
- SQL 파일 위치: `docs/agency-predictor/migrations/V6A_<NN>_<name>.sql` (없으면 생성). 가져온 V6 문서 권장 위치와 일치.
- Phase 23-3 게이트: DB만 변경(src/* 미수정) → PostToolUse hook 비트리거. `/evaluate` 면제 — 기존 `bid_predictions.opt_adj` 미변경. `deploy-gate`는 main push 시점에만(본 plan은 DB만 변경되므로 Vercel 배포와 무관).

---

## File Structure (변경 매트릭스)

| 파일 | 변경 유형 | 책임 |
|---|---|---|
| `docs/agency-predictor/migrations/V6A_01_create_tables.sql` | 생성 | 5개 신규 테이블 |
| `docs/agency-predictor/migrations/V6A_02_indexes.sql` | 생성 | 인덱스 일괄 |
| `docs/agency-predictor/migrations/V6A_03_rls.sql` | 생성 | RLS enable + SELECT 정책 |
| `docs/agency-predictor/migrations/V6A_04_amount_tier_of.sql` | 생성 | 보조 함수 |
| `docs/agency-predictor/migrations/V6A_05_classify_confidence_tier.sql` | 생성 | RPC #1 |
| `docs/agency-predictor/migrations/V6A_06_calculate_recommended_margin.sql` | 생성 | RPC #2 |
| `docs/agency-predictor/migrations/V6A_07_calculate_disq_risk.sql` | 생성 | RPC #3 (Zelen-Severo 근사) |
| `docs/agency-predictor/migrations/V6A_08_trigger_normalize_bh.sql` | 생성 | 트리거 #1 + 함수 |
| `docs/agency-predictor/migrations/V6A_09_trigger_bpv3_lifecycle.sql` | 생성 | 트리거 #2 + 함수 |
| `docs/agency-predictor/migrations/V6A_10_backfill.sql` | 생성 | bid_records → bid_history 백필 |
| `docs/agency-predictor/migrations/V6A_11_recalibrate_function.sql` | 생성 | recalibrate_agency_profiles 본문 |
| `docs/agency-predictor/migrations/V6A_12_predict_with_history.sql` | 생성 | RPC #4 (메인 예측) |
| `src/*` | 변경 없음 | 클라이언트 코드 미수정 |
| 기존 DB 객체 | 변경 없음 | `bid_records`/`bid_predictions`/`predict_v6` 등 일체 미수정 |

---

## Task 1: Migration 01 — 5개 테이블 일괄 생성

**Files:**
- Create: `docs/agency-predictor/migrations/V6A_01_create_tables.sql`
- DB: 신규 테이블 `bid_history`, `agency_profile`, `bid_predictions_v3`, `upload_batches`, `bid_notices_temp`

**Why this task first:** 모든 후속 객체(인덱스, RLS, 트리거, RPC, 백필)가 이 5개 테이블을 참조. 의존 순서: `bid_history` → `agency_profile` → `bid_predictions_v3`(bid_history 참조) → `upload_batches` → `bid_notices_temp`(upload_batches, bid_predictions_v3 참조).

- [ ] **Step 1-1: SQL 파일 생성**

폴더 없으면 먼저 생성: `mkdir -p docs/agency-predictor/migrations`.

`docs/agency-predictor/migrations/V6A_01_create_tables.sql` 내용:

```sql
-- V6-A Migration 01: 5개 신규 테이블 (외부+자사 통합 이력, 발주처 캐시, 예측 결과, 업로드, 임시)
-- spec: docs/superpowers/specs/2026-05-13-agency-predictor-v6a-db-infra-design.md §3

CREATE TABLE bid_history (
  id              BIGSERIAL PRIMARY KEY,
  bid_no          TEXT NOT NULL,
  legacy_record_id BIGINT,
  source          TEXT NOT NULL DEFAULT 'legacy_bid_records'
                    CHECK (source IN ('legacy_bid_records','infona','external_award','file_upload')),
  ag              TEXT,
  canonical_ag    TEXT,
  industry        TEXT,
  work_cat        TEXT,
  region          TEXT,
  contract_method TEXT,
  opened_at       DATE,
  notice_title    TEXT,
  base_amount     NUMERIC,
  a_value         NUMERIC,
  expected_price  NUMERIC,
  floor_amount    NUMERIC,
  floor_rate      NUMERIC,
  price_ratio     NUMERIC GENERATED ALWAYS AS (
                    CASE WHEN base_amount > 0 AND expected_price IS NOT NULL
                         THEN (expected_price / base_amount * 100)
                    END
                  ) STORED,
  price_ratio_dev NUMERIC,
  rank1_company   TEXT,
  rank1_biz_no    TEXT,
  rank1_amount    NUMERIC,
  rank1_ratio     NUMERIC,
  competitor_count INTEGER,
  win_window_pct  NUMERIC GENERATED ALWAYS AS (
                    CASE WHEN base_amount > 0 AND rank1_amount IS NOT NULL AND floor_amount IS NOT NULL
                         THEN ((rank1_amount - floor_amount) / base_amount * 100)
                    END
                  ) STORED,
  self_bid_amount       NUMERIC,
  self_rank             INTEGER,
  self_was_disqualified BOOLEAN,
  is_excluded     BOOLEAN DEFAULT FALSE,
  excl_reason     TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  imported_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (bid_no, source)
);
COMMENT ON TABLE bid_history IS
  'V6-A: 외부+자사 통합 입찰 이력. price_ratio = ep/ba×100. 자사 컬럼은 V6-D에서 채움.';

CREATE TABLE agency_profile (
  id                  BIGSERIAL PRIMARY KEY,
  canonical_ag        TEXT NOT NULL,
  industry            TEXT,
  amount_tier         TEXT,
  display_name        TEXT,
  sample_size         INTEGER NOT NULL DEFAULT 0,
  mean_ratio          NUMERIC,
  median_ratio        NUMERIC,
  std_dev             NUMERIC,
  p25                 NUMERIC,
  p75                 NUMERIC,
  min_ratio           NUMERIC,
  max_ratio           NUMERIC,
  recommended_margin  NUMERIC,
  confidence_tier     TEXT,
  avg_competitor      INTEGER,
  avg_win_window      NUMERIC,
  top_winner_company  TEXT,
  top_winner_share    NUMERIC,
  self_total_bids     INTEGER DEFAULT 0,
  self_wins           INTEGER DEFAULT 0,
  self_disq_rate      NUMERIC,
  last_bid_date       DATE,
  last_recalc_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (canonical_ag, industry, amount_tier)
);
COMMENT ON TABLE agency_profile IS
  'V6-A: (canonical_ag, industry, amount_tier) 통계 캐시. NULL = 전체 합계 의미.';

CREATE TABLE bid_predictions_v3 (
  id                       BIGSERIAL PRIMARY KEY,
  bid_no                   TEXT NOT NULL,
  canonical_ag             TEXT,
  industry                 TEXT,
  amount_tier              TEXT,
  base_amount              NUMERIC,
  a_value                  NUMERIC,
  floor_rate               NUMERIC,
  predicted_ratio          NUMERIC NOT NULL,
  predicted_floor_amount   NUMERIC,
  aggressive_margin        NUMERIC,
  balanced_margin          NUMERIC,
  safe_margin              NUMERIC,
  strategy_aggressive_bid  NUMERIC,
  strategy_balanced_bid    NUMERIC,
  strategy_safe_bid        NUMERIC,
  disq_risk_aggressive     NUMERIC,
  disq_risk_balanced       NUMERIC,
  disq_risk_safe           NUMERIC,
  confidence_tier          TEXT,
  signal_stage             INTEGER,
  sample_size_used         INTEGER,
  model_version            TEXT NOT NULL DEFAULT 'v3.0',
  match_status             TEXT NOT NULL DEFAULT 'pending'
                             CHECK (match_status IN ('pending','matched','no_match','expired')),
  matched_history_id       BIGINT REFERENCES bid_history(id),
  actual_ratio             NUMERIC,
  ratio_error              NUMERIC,
  result                   TEXT,
  created_at               TIMESTAMPTZ DEFAULT now(),
  expires_at               TIMESTAMPTZ,
  matched_at               TIMESTAMPTZ
);
COMMENT ON TABLE bid_predictions_v3 IS
  'V6-A: 발주처사정율 예측 결과. predicted_*, strategy_*, disq_risk_*, confidence_tier, signal_stage, sample_size_used, model_version은 트리거가 UPDATE 차단.';

CREATE TABLE upload_batches (
  id              BIGSERIAL PRIMARY KEY,
  batch_type      TEXT NOT NULL CHECK (batch_type IN ('notice','infona','award_list')),
  file_name       TEXT,
  file_size_bytes BIGINT,
  total_rows      INTEGER,
  inserted_rows   INTEGER DEFAULT 0,
  skipped_rows    INTEGER DEFAULT 0,
  error_rows      INTEGER DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','completed','failed')),
  error_log       JSONB,
  uploaded_by     UUID REFERENCES auth.users(id),
  uploaded_at     TIMESTAMPTZ DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

CREATE TABLE bid_notices_temp (
  id              BIGSERIAL PRIMARY KEY,
  batch_id        BIGINT REFERENCES upload_batches(id) ON DELETE CASCADE,
  bid_no          TEXT NOT NULL,
  ag              TEXT,
  canonical_ag    TEXT,
  industry        TEXT,
  base_amount     NUMERIC,
  a_value         NUMERIC,
  floor_rate      NUMERIC,
  opened_at       DATE,
  notice_title    TEXT,
  contract_method TEXT,
  predicted       BOOLEAN DEFAULT FALSE,
  prediction_id   BIGINT REFERENCES bid_predictions_v3(id),
  error_message   TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

- [ ] **Step 1-2: Supabase MCP로 마이그레이션 적용**

Tool: `mcp__claude_ai_Supabase__apply_migration`
- `project_id`: `sadunejfkstxbxogzutl`
- `name`: `v6a_01_create_tables`
- `query`: 위 SQL 전문 그대로

Expected: `success: true`. 에러 시 부분 생성된 테이블은 자동 롤백 (트랜잭션).

- [ ] **Step 1-3: 생성 검증**

`execute_sql` 호출:
```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema='public'
  AND table_name IN ('bid_history','agency_profile','bid_predictions_v3','upload_batches','bid_notices_temp')
ORDER BY table_name;
```
Expected: 5행 (agency_profile, bid_history, bid_notices_temp, bid_predictions_v3, upload_batches).

GENERATED 컬럼 확인:
```sql
SELECT column_name, generation_expression
FROM information_schema.columns
WHERE table_schema='public' AND table_name='bid_history'
  AND column_name IN ('price_ratio','win_window_pct');
```
Expected: 2행. generation_expression NOT NULL.

- [ ] **Step 1-4: 기존 시스템 baseline 캡쳐 + 무손상 확인**

```sql
SELECT
  (SELECT COUNT(*) FROM bid_records)     AS records_count,    -- 62,365 유지
  (SELECT COUNT(*) FROM bid_predictions) AS preds_count,      -- 1,940 유지
  (SELECT COUNT(*) FROM bid_details)     AS details_count,    -- 880 유지
  (SELECT COUNT(*) FROM bid_predictions WHERE canonical_ag ILIKE '%한국전력%' AND actual_adj_rate IS NOT NULL) AS kepco_matched,
  (SELECT COUNT(*) FROM bid_predictions WHERE canonical_ag ILIKE '%고양시%'   AND actual_adj_rate IS NOT NULL) AS goyang_matched,
  (SELECT COUNT(*) FROM bid_predictions WHERE canonical_ag ILIKE '%육군%'     AND actual_adj_rate IS NOT NULL) AS army_matched;
```

**이 5개 숫자(records_count, preds_count, kepco_matched, goyang_matched, army_matched)를
plan 작업 노트에 기록**. Task 15-2 최종 검증에서 동일 쿼리 결과와 비교해 차이 0임을 확인한다.

- [ ] **Step 1-5: 커밋**

```
git add docs/agency-predictor/migrations/V6A_01_create_tables.sql
git commit -m "feat(agency-predictor-v6a): create 5 new tables (bid_history, agency_profile, bid_predictions_v3, upload_batches, bid_notices_temp)"
```

---

## Task 2: Migration 02 — 인덱스 일괄

**Files:**
- Create: `docs/agency-predictor/migrations/V6A_02_indexes.sql`

- [ ] **Step 2-1: SQL 파일 작성**

```sql
-- V6-A Migration 02: 핫 경로 인덱스
-- spec §9

CREATE INDEX bh_canonical_industry_amount
  ON bid_history (canonical_ag, industry, base_amount DESC)
  WHERE expected_price IS NOT NULL;
CREATE INDEX bh_opened_desc ON bid_history (opened_at DESC NULLS LAST);
CREATE INDEX bh_rank1_company ON bid_history (rank1_company text_pattern_ops);
CREATE INDEX bh_legacy_id ON bid_history (legacy_record_id) WHERE legacy_record_id IS NOT NULL;
CREATE INDEX bh_canonical_only ON bid_history (canonical_ag);

CREATE INDEX ap_canonical ON agency_profile (canonical_ag);
CREATE INDEX ap_confidence ON agency_profile (confidence_tier);

CREATE INDEX bpv3_match_status ON bid_predictions_v3 (match_status, created_at DESC);
CREATE INDEX bpv3_bid_no ON bid_predictions_v3 (bid_no);
CREATE INDEX bpv3_canonical ON bid_predictions_v3 (canonical_ag);

CREATE INDEX bnt_batch_pending ON bid_notices_temp (batch_id) WHERE predicted = FALSE;
```

- [ ] **Step 2-2: 마이그레이션 적용**

`apply_migration({name: 'v6a_02_indexes', query: <위 SQL>})`

- [ ] **Step 2-3: 인덱스 검증**

```sql
SELECT indexname FROM pg_indexes
WHERE schemaname='public'
  AND indexname LIKE 'bh_%' OR indexname LIKE 'ap_%' OR indexname LIKE 'bpv3_%' OR indexname LIKE 'bnt_%'
ORDER BY indexname;
```
Expected: 11개 인덱스 (위 CREATE INDEX 수와 일치).

- [ ] **Step 2-4: 커밋**

```
git add docs/agency-predictor/migrations/V6A_02_indexes.sql
git commit -m "feat(agency-predictor-v6a): add hot-path indexes for bid_history/agency_profile/bid_predictions_v3/bid_notices_temp"
```

---

## Task 3: Migration 03 — RLS 정책

**Files:**
- Create: `docs/agency-predictor/migrations/V6A_03_rls.sql`

- [ ] **Step 3-1: SQL 파일 작성**

```sql
-- V6-A Migration 03: RLS enable + authenticated SELECT 정책
-- spec §8

ALTER TABLE bid_history        ENABLE ROW LEVEL SECURITY;
ALTER TABLE agency_profile     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bid_predictions_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE upload_batches     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bid_notices_temp   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read" ON bid_history
  FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "authenticated_read" ON agency_profile
  FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "authenticated_read" ON bid_predictions_v3
  FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "authenticated_read" ON upload_batches
  FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "authenticated_read" ON bid_notices_temp
  FOR SELECT TO authenticated USING (TRUE);
-- INSERT/UPDATE/DELETE 정책 미선언 → service_role 만 가능
```

- [ ] **Step 3-2: 마이그레이션 적용**

`apply_migration({name: 'v6a_03_rls', query: <위 SQL>})`

- [ ] **Step 3-3: RLS 활성 검증**

```sql
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN ('bid_history','agency_profile','bid_predictions_v3','upload_batches','bid_notices_temp')
ORDER BY relname;
```
Expected: 5행 모두 `relrowsecurity = true`.

```sql
SELECT tablename, policyname FROM pg_policies
WHERE schemaname='public'
  AND tablename IN ('bid_history','agency_profile','bid_predictions_v3','upload_batches','bid_notices_temp')
ORDER BY tablename;
```
Expected: 5행 (각 테이블에 `authenticated_read` 1개).

- [ ] **Step 3-4: 커밋**

```
git add docs/agency-predictor/migrations/V6A_03_rls.sql
git commit -m "feat(agency-predictor-v6a): enable RLS with authenticated SELECT policy on 5 tables"
```

---

## Task 4: Migration 04 — 보조 함수 `amount_tier_of()`

**Files:**
- Create: `docs/agency-predictor/migrations/V6A_04_amount_tier_of.sql`

- [ ] **Step 4-1: SQL 파일 작성**

```sql
-- V6-A Migration 04: 보조 함수
-- spec §4.0

CREATE OR REPLACE FUNCTION amount_tier_of(p_amount NUMERIC)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_amount IS NULL              THEN NULL
    WHEN p_amount <  100000000         THEN '~1억'
    WHEN p_amount <  300000000         THEN '1억~3억'
    WHEN p_amount <  500000000         THEN '3억~5억'
    WHEN p_amount < 1000000000         THEN '5억~10억'
    WHEN p_amount < 3000000000         THEN '10억~30억'
    ELSE                                    '30억~'
  END;
$$;
```

- [ ] **Step 4-2: 마이그레이션 적용 + smoke**

`apply_migration({name: 'v6a_04_amount_tier_of', query: <위 SQL>})`

검증 (한 줄에 5개):
```sql
SELECT
  amount_tier_of(NULL)         AS t_null,         -- NULL
  amount_tier_of(50000000)     AS t_under1,       -- '~1억'
  amount_tier_of(250000000)    AS t_1_3,          -- '1억~3억'
  amount_tier_of(656000000)    AS t_5_10,         -- '5억~10억'
  amount_tier_of(5000000000)   AS t_30plus;       -- '30억~'
```

- [ ] **Step 4-3: 커밋**

```
git add docs/agency-predictor/migrations/V6A_04_amount_tier_of.sql
git commit -m "feat(agency-predictor-v6a): add amount_tier_of() helper (6-bucket classifier)"
```

---

## Task 5: Migration 05 — RPC `classify_confidence_tier()`

**Files:**
- Create: `docs/agency-predictor/migrations/V6A_05_classify_confidence_tier.sql`

- [ ] **Step 5-1: SQL 파일 작성**

```sql
-- V6-A Migration 05: 신뢰도 등급 분류
-- spec §4.1

CREATE OR REPLACE FUNCTION classify_confidence_tier(p_n INTEGER, p_std NUMERIC)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_n IS NULL OR p_n < 5 THEN 'insufficient'
    WHEN p_n >= 30 AND p_std IS NOT NULL AND p_std < 0.5 THEN 'high'
    WHEN p_n >= 10 AND p_std IS NOT NULL AND p_std < 1.0 THEN 'medium'
    ELSE 'low'
  END;
$$;
```

- [ ] **Step 5-2: 마이그레이션 적용 + smoke**

`apply_migration({name: 'v6a_05_classify_confidence_tier', query: <위 SQL>})`

검증:
```sql
SELECT
  classify_confidence_tier(NULL, 0.3)  AS t_null,        -- 'insufficient'
  classify_confidence_tier(3,    0.3)  AS t_n3,          -- 'insufficient'
  classify_confidence_tier(40,   0.3)  AS t_high,        -- 'high'
  classify_confidence_tier(15,   0.7)  AS t_medium,      -- 'medium'
  classify_confidence_tier(8,    0.8)  AS t_low;         -- 'low'
```

- [ ] **Step 5-3: 커밋**

```
git add docs/agency-predictor/migrations/V6A_05_classify_confidence_tier.sql
git commit -m "feat(agency-predictor-v6a): add classify_confidence_tier() RPC"
```

---

## Task 6: Migration 06 — RPC `calculate_recommended_margin()`

**Files:**
- Create: `docs/agency-predictor/migrations/V6A_06_calculate_recommended_margin.sql`

- [ ] **Step 6-1: SQL 파일 작성**

```sql
-- V6-A Migration 06: std 기반 권장 마진
-- spec §4.2 (근거: ZERO_MARGIN_SIMULATION §8.2)

CREATE OR REPLACE FUNCTION calculate_recommended_margin(p_std NUMERIC, p_n INTEGER)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_n IS NULL OR p_n < 5            THEN 0.30
    WHEN p_std IS NULL                     THEN 0.30
    WHEN p_std < 0.3                       THEN 0.10
    WHEN p_std < 0.6                       THEN 0.20
    WHEN p_std < 1.0                       THEN 0.30
    ELSE                                        0.40
  END;
$$;
```

- [ ] **Step 6-2: 마이그레이션 적용 + smoke**

`apply_migration({name: 'v6a_06_calculate_recommended_margin', query: <위 SQL>})`

검증:
```sql
SELECT
  calculate_recommended_margin(0.17, 4)  AS m_small_n,   -- 0.30 (안전판)
  calculate_recommended_margin(0.17, 30) AS m_tight,     -- 0.10
  calculate_recommended_margin(0.50, 30) AS m_mid,       -- 0.20
  calculate_recommended_margin(0.85, 30) AS m_loose,     -- 0.30
  calculate_recommended_margin(1.20, 30) AS m_wide;      -- 0.40
```

- [ ] **Step 6-3: 커밋**

```
git add docs/agency-predictor/migrations/V6A_06_calculate_recommended_margin.sql
git commit -m "feat(agency-predictor-v6a): add calculate_recommended_margin() RPC (std-based)"
```

---

## Task 7: Migration 07 — RPC `calculate_disq_risk()` (Zelen & Severo)

**Files:**
- Create: `docs/agency-predictor/migrations/V6A_07_calculate_disq_risk.sql`

**Why this implementation:** PG 17.6에는 `erf()` 미지원(PG 18+). Zelen & Severo 다항 근사로 표준정규 CDF를 직접 구현.

- [ ] **Step 7-1: SQL 파일 작성**

```sql
-- V6-A Migration 07: 부적격 위험 (정규분포 1 - Φ(margin/std))
-- spec §4.3

CREATE OR REPLACE FUNCTION calculate_disq_risk(p_margin NUMERIC, p_std NUMERIC)
RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_z   NUMERIC;
  v_az  NUMERIC;
  v_t   NUMERIC;
  v_phi NUMERIC;
  v_cdf NUMERIC;
BEGIN
  IF p_std IS NULL OR p_std <= 0 THEN
    RETURN CASE WHEN p_margin IS NOT NULL AND p_margin > 0 THEN 0 ELSE 0.5 END;
  END IF;

  v_z  := p_margin / p_std;
  v_az := ABS(v_z);

  v_t   := 1.0 / (1.0 + 0.2316419 * v_az);
  v_phi := EXP(- v_az * v_az / 2.0) / SQRT(2 * PI());
  v_cdf := 1.0 - v_phi * (
              0.319381530   * v_t
           + (-0.356563782) * v_t * v_t
           +  1.781477937   * v_t * v_t * v_t
           + (-1.821255978) * v_t * v_t * v_t * v_t
           +  1.330274429   * v_t * v_t * v_t * v_t * v_t
          );

  IF v_z < 0 THEN v_cdf := 1.0 - v_cdf; END IF;

  RETURN GREATEST(0, LEAST(1, 1 - v_cdf));
END;
$$;
```

- [ ] **Step 7-2: 마이그레이션 적용 + smoke**

`apply_migration({name: 'v6a_07_calculate_disq_risk', query: <위 SQL>})`

검증 (ZERO_MARGIN §6.2 표와 일치 확인):
```sql
SELECT
  calculate_disq_risk(0,    0.5)  AS r_margin0,     -- ≈ 0.5  (margin 0 → 50%)
  calculate_disq_risk(0.30, 0.3)  AS r_z1,          -- ≈ 0.158 (Φ(1) ≈ 0.841)
  calculate_disq_risk(0.30, 0.15) AS r_z2,          -- ≈ 0.023
  calculate_disq_risk(0.30, NULL) AS r_std_null,    -- 0 (margin>0)
  calculate_disq_risk(NULL, 0.3)  AS r_margin_null; -- 0.5 (margin<=0 path)
```

- [ ] **Step 7-3: 커밋**

```
git add docs/agency-predictor/migrations/V6A_07_calculate_disq_risk.sql
git commit -m "feat(agency-predictor-v6a): add calculate_disq_risk() RPC (Zelen-Severo CDF for PG17)"
```

---

## Task 8: Migration 08 — 트리거 `trigger_normalize_bh`

**Files:**
- Create: `docs/agency-predictor/migrations/V6A_08_trigger_normalize_bh.sql`

- [ ] **Step 8-1: SQL 파일 작성**

```sql
-- V6-A Migration 08: bid_history.canonical_ag 자동 채움
-- spec §5.1

CREATE OR REPLACE FUNCTION fn_normalize_bh()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.canonical_ag IS NULL AND NEW.ag IS NOT NULL THEN
    NEW.canonical_ag := normalize_agency_name(NEW.ag);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_normalize_bh
  BEFORE INSERT OR UPDATE OF ag ON bid_history
  FOR EACH ROW EXECUTE FUNCTION fn_normalize_bh();
```

- [ ] **Step 8-2: 마이그레이션 적용**

`apply_migration({name: 'v6a_08_trigger_normalize_bh', query: <위 SQL>})`

- [ ] **Step 8-3: smoke (INSERT 후 자동 채움 확인)**

```sql
INSERT INTO bid_history (bid_no, source, ag)
VALUES ('SMOKE_NORMALIZE_BH_01', 'external_award', '한국전력공사 경기북부본부')
RETURNING id, ag, canonical_ag;
-- canonical_ag 가 정규화된 값으로 자동 채워졌는지 확인
```

기대: `canonical_ag` NOT NULL. 정규화 결과 형식은 기존 `normalize_agency_name()` 출력에 따름.

cleanup:
```sql
DELETE FROM bid_history WHERE bid_no = 'SMOKE_NORMALIZE_BH_01';
```

- [ ] **Step 8-4: 커밋**

```
git add docs/agency-predictor/migrations/V6A_08_trigger_normalize_bh.sql
git commit -m "feat(agency-predictor-v6a): add trigger_normalize_bh (auto-fill canonical_ag)"
```

---

## Task 9: Migration 09 — 트리거 `bpv3_lifecycle`

**Files:**
- Create: `docs/agency-predictor/migrations/V6A_09_trigger_bpv3_lifecycle.sql`

- [ ] **Step 9-1: SQL 파일 작성**

```sql
-- V6-A Migration 09: bid_predictions_v3 불변성 + 라이프사이클
-- spec §5.2

CREATE OR REPLACE FUNCTION fn_bpv3_lifecycle()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.expires_at IS NULL THEN
      NEW.expires_at := COALESCE(NEW.created_at, now()) + INTERVAL '30 days';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.predicted_ratio          IS DISTINCT FROM OLD.predicted_ratio          OR
     NEW.predicted_floor_amount   IS DISTINCT FROM OLD.predicted_floor_amount   OR
     NEW.aggressive_margin        IS DISTINCT FROM OLD.aggressive_margin        OR
     NEW.balanced_margin          IS DISTINCT FROM OLD.balanced_margin          OR
     NEW.safe_margin              IS DISTINCT FROM OLD.safe_margin              OR
     NEW.strategy_aggressive_bid  IS DISTINCT FROM OLD.strategy_aggressive_bid  OR
     NEW.strategy_balanced_bid    IS DISTINCT FROM OLD.strategy_balanced_bid    OR
     NEW.strategy_safe_bid        IS DISTINCT FROM OLD.strategy_safe_bid        OR
     NEW.disq_risk_aggressive     IS DISTINCT FROM OLD.disq_risk_aggressive     OR
     NEW.disq_risk_balanced       IS DISTINCT FROM OLD.disq_risk_balanced       OR
     NEW.disq_risk_safe           IS DISTINCT FROM OLD.disq_risk_safe           OR
     NEW.confidence_tier          IS DISTINCT FROM OLD.confidence_tier          OR
     NEW.signal_stage             IS DISTINCT FROM OLD.signal_stage             OR
     NEW.sample_size_used         IS DISTINCT FROM OLD.sample_size_used         OR
     NEW.model_version            IS DISTINCT FROM OLD.model_version            THEN
    RAISE EXCEPTION 'bid_predictions_v3 immutable columns cannot be updated (id=%)', OLD.id;
  END IF;

  IF OLD.match_status = 'pending' AND NEW.match_status = 'matched'
     AND NEW.matched_at IS NULL THEN
    NEW.matched_at := now();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER bpv3_lifecycle
  BEFORE INSERT OR UPDATE ON bid_predictions_v3
  FOR EACH ROW EXECUTE FUNCTION fn_bpv3_lifecycle();
```

- [ ] **Step 9-2: 마이그레이션 적용**

`apply_migration({name: 'v6a_09_trigger_bpv3_lifecycle', query: <위 SQL>})`

- [ ] **Step 9-3: smoke (불변성 + expires_at + matched_at 모두 검증)**

```sql
-- (a) INSERT 시 expires_at 자동 30일
INSERT INTO bid_predictions_v3 (bid_no, predicted_ratio, model_version)
VALUES ('SMOKE_BPV3_01', 100.0, 'v3.0')
RETURNING id, created_at, expires_at;
-- expires_at = created_at + 30 days
```

```sql
-- (b) 불변 컬럼 UPDATE 차단
UPDATE bid_predictions_v3 SET predicted_ratio = 99.5
WHERE bid_no = 'SMOKE_BPV3_01';
-- ERROR: bid_predictions_v3 immutable columns cannot be updated
```

```sql
-- (c) match_status 전환 시 matched_at 자동 설정
UPDATE bid_predictions_v3 SET match_status = 'matched'
WHERE bid_no = 'SMOKE_BPV3_01'
RETURNING matched_at;
-- matched_at IS NOT NULL
```

cleanup:
```sql
DELETE FROM bid_predictions_v3 WHERE bid_no = 'SMOKE_BPV3_01';
```

- [ ] **Step 9-4: 커밋**

```
git add docs/agency-predictor/migrations/V6A_09_trigger_bpv3_lifecycle.sql
git commit -m "feat(agency-predictor-v6a): add bpv3_lifecycle trigger (immutability + auto expires_at/matched_at)"
```

---

## Task 10: Migration 10 — 백필 (bid_records → bid_history)

**Files:**
- Create: `docs/agency-predictor/migrations/V6A_10_backfill.sql`

**Why this task here:** 트리거 `trigger_normalize_bh`가 먼저 존재해야 `canonical_ag` NULL 행이 자동 채워짐. RPC들은 아직 없어도 됨.

- [ ] **Step 10-1: SQL 파일 작성**

```sql
-- V6-A Migration 10: bid_records 62,365건 → bid_history 백필
-- spec §6

INSERT INTO bid_history (
  bid_no, legacy_record_id, source,
  ag, canonical_ag,
  industry, work_cat, contract_method,
  opened_at, notice_title,
  base_amount, a_value, expected_price, floor_amount, floor_rate,
  rank1_company, rank1_biz_no, rank1_amount, rank1_ratio,
  competitor_count, is_excluded, excl_reason
)
SELECT
  COALESCE(pn_no, 'legacy_' || id::TEXT)        AS bid_no,
  id                                            AS legacy_record_id,
  'legacy_bid_records'                          AS source,
  ag,
  COALESCE(canonical_ag, normalize_agency_name(ag)) AS canonical_ag,
  cat AS industry, work_cat, contract_method,
  od AS opened_at, pn AS notice_title,
  ba, av, ep, floor_price, fr,
  co, co_no, bp, br1,
  pc, COALESCE(is_excluded, FALSE), excl_reason
FROM bid_records
ON CONFLICT (bid_no, source) DO NOTHING;
```

- [ ] **Step 10-2: `execute_sql`로 실행** (마이그레이션 트랜잭션이 아닌 단발 INSERT, 시간 ~30초)

Tool: `mcp__claude_ai_Supabase__execute_sql({query: <위 SQL>})`

Expected: 62,365행 내외 INSERT (또는 행 수 반환 없음 — 다음 step 검증으로 확인).

- [ ] **Step 10-3: 백필 검증**

```sql
SELECT
  (SELECT COUNT(*) FROM bid_records)                              AS legacy_total,
  (SELECT COUNT(*) FROM bid_history WHERE source='legacy_bid_records') AS imported,
  (SELECT COUNT(*) FROM bid_history WHERE source='legacy_bid_records' AND canonical_ag IS NULL) AS null_canon,
  (SELECT COUNT(*) FROM bid_history WHERE source='legacy_bid_records' AND price_ratio IS NOT NULL) AS with_ratio,
  (SELECT COUNT(DISTINCT canonical_ag) FROM bid_history WHERE source='legacy_bid_records') AS distinct_agencies;
```
Expected:
- `legacy_total = imported = 62,365` (또는 매우 근접)
- `null_canon = 0` (트리거 + COALESCE로 모두 채움)
- `with_ratio ≈ 50,753` (bid_records.ep NOT NULL 수와 일치)
- `distinct_agencies ≥ 1,639`

- [ ] **Step 10-4: 기존 시스템 무손상 확인 (백필은 SELECT만 했으므로 변화 없음)**

```sql
SELECT
  (SELECT COUNT(*) FROM bid_records)     AS records_count,    -- 62,365 유지
  (SELECT COUNT(*) FROM bid_predictions) AS preds_count;      -- 1,940 유지
```

- [ ] **Step 10-5: 커밋**

```
git add docs/agency-predictor/migrations/V6A_10_backfill.sql
git commit -m "feat(agency-predictor-v6a): backfill bid_records (62K) into bid_history"
```

---

## Task 11: Migration 11 — `recalibrate_agency_profiles()` 함수 정의

**Files:**
- Create: `docs/agency-predictor/migrations/V6A_11_recalibrate_function.sql`

**Why this task here:** 함수만 정의(아직 실행 안 함). predict_with_history가 의존하므로 그 전에 만들어 둠.

- [ ] **Step 11-1: SQL 파일 작성**

```sql
-- V6-A Migration 11: recalibrate_agency_profiles 함수
-- spec §7

CREATE OR REPLACE FUNCTION recalibrate_agency_profiles()
RETURNS TABLE (rows_inserted INTEGER, agencies_distinct INTEGER, elapsed_ms INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  v_start    TIMESTAMPTZ := clock_timestamp();
  v_inserted INTEGER;
  v_agencies INTEGER;
BEGIN
  TRUNCATE agency_profile;

  WITH base AS (
    SELECT canonical_ag, industry,
           amount_tier_of(base_amount) AS amount_tier,
           price_ratio, competitor_count, win_window_pct, rank1_company,
           opened_at
    FROM bid_history
    WHERE expected_price IS NOT NULL
      AND is_excluded = FALSE
      AND canonical_ag IS NOT NULL
  ),
  grouped AS (
    SELECT canonical_ag, industry,                amount_tier, price_ratio, competitor_count, win_window_pct, rank1_company FROM base
    UNION ALL
    SELECT canonical_ag, industry,                NULL,        price_ratio, competitor_count, win_window_pct, rank1_company FROM base
    UNION ALL
    SELECT canonical_ag, NULL,                    amount_tier, price_ratio, competitor_count, win_window_pct, rank1_company FROM base
    UNION ALL
    SELECT canonical_ag, NULL,                    NULL,        price_ratio, competitor_count, win_window_pct, rank1_company FROM base
  ),
  agg AS (
    SELECT canonical_ag, industry, amount_tier,
           COUNT(*)                                                       AS sample_size,
           AVG(price_ratio)                                               AS mean_ratio,
           PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY price_ratio)      AS median_ratio,
           STDDEV_SAMP(price_ratio)                                       AS std_dev,
           PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY price_ratio)      AS p25,
           PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY price_ratio)      AS p75,
           MIN(price_ratio)                                               AS min_ratio,
           MAX(price_ratio)                                               AS max_ratio,
           AVG(competitor_count)::INTEGER                                 AS avg_competitor,
           AVG(win_window_pct)                                            AS avg_win_window
    FROM grouped
    GROUP BY canonical_ag, industry, amount_tier
  ),
  top_winners AS (
    SELECT canonical_ag, industry, amount_tier, rank1_company,
           COUNT(*) AS wins,
           ROW_NUMBER() OVER (
             PARTITION BY canonical_ag, industry, amount_tier
             ORDER BY COUNT(*) DESC
           ) AS rk,
           SUM(COUNT(*)) OVER (PARTITION BY canonical_ag, industry, amount_tier) AS total
    FROM grouped
    WHERE rank1_company IS NOT NULL
    GROUP BY canonical_ag, industry, amount_tier, rank1_company
  ),
  last_dates AS (
    SELECT canonical_ag, MAX(opened_at) AS last_bid_date FROM base GROUP BY canonical_ag
  )
  INSERT INTO agency_profile (
    canonical_ag, industry, amount_tier, display_name,
    sample_size, mean_ratio, median_ratio, std_dev, p25, p75, min_ratio, max_ratio,
    recommended_margin, confidence_tier,
    avg_competitor, avg_win_window, top_winner_company, top_winner_share,
    last_bid_date, last_recalc_at
  )
  SELECT
    a.canonical_ag, a.industry, a.amount_tier, a.canonical_ag,
    a.sample_size, a.mean_ratio, a.median_ratio, a.std_dev, a.p25, a.p75, a.min_ratio, a.max_ratio,
    calculate_recommended_margin(a.std_dev, a.sample_size),
    classify_confidence_tier(a.sample_size, a.std_dev),
    a.avg_competitor, a.avg_win_window,
    tw.rank1_company,
    CASE WHEN tw.total > 0 THEN tw.wins::NUMERIC / tw.total END,
    ld.last_bid_date, now()
  FROM agg a
  LEFT JOIN top_winners tw
    ON tw.canonical_ag = a.canonical_ag
   AND tw.industry IS NOT DISTINCT FROM a.industry
   AND tw.amount_tier IS NOT DISTINCT FROM a.amount_tier
   AND tw.rk = 1
  LEFT JOIN last_dates ld ON ld.canonical_ag = a.canonical_ag;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  SELECT COUNT(DISTINCT canonical_ag) INTO v_agencies FROM agency_profile;

  RETURN QUERY SELECT v_inserted, v_agencies,
    EXTRACT(MILLISECOND FROM (clock_timestamp() - v_start))::INTEGER;
END;
$$;
```

- [ ] **Step 11-2: 마이그레이션 적용**

`apply_migration({name: 'v6a_11_recalibrate_function', query: <위 SQL>})`

- [ ] **Step 11-3: 함수 존재 검증 (아직 실행 안 함)**

```sql
SELECT routine_name FROM information_schema.routines
WHERE routine_schema='public' AND routine_name='recalibrate_agency_profiles';
```
Expected: 1행.

- [ ] **Step 11-4: 커밋**

```
git add docs/agency-predictor/migrations/V6A_11_recalibrate_function.sql
git commit -m "feat(agency-predictor-v6a): define recalibrate_agency_profiles() (4-grain aggregator)"
```

---

## Task 12: Migration 12 — RPC `predict_with_history()`

**Files:**
- Create: `docs/agency-predictor/migrations/V6A_12_predict_with_history.sql`

**Why this task here:** 모든 의존 RPC(amount_tier_of, classify_confidence_tier, calculate_recommended_margin, calculate_disq_risk)와 `agency_profile` 테이블이 준비된 후. 실제 호출은 다음 Task에서 recalibrate 실행 후.

- [ ] **Step 12-1: SQL 파일 작성**

```sql
-- V6-A Migration 12: 메인 예측 RPC (3단계 폴백)
-- spec §4.4

CREATE OR REPLACE FUNCTION predict_with_history(
  p_bid_no       TEXT,
  p_canonical_ag TEXT,
  p_industry     TEXT,
  p_base_amount  NUMERIC,
  p_a_value      NUMERIC,
  p_floor_rate   NUMERIC
)
RETURNS TABLE (
  predicted_ratio          NUMERIC,
  predicted_floor_amount   NUMERIC,
  aggressive_bid           NUMERIC,
  balanced_bid             NUMERIC,
  safe_bid                 NUMERIC,
  aggressive_margin        NUMERIC,
  balanced_margin          NUMERIC,
  safe_margin              NUMERIC,
  disq_risk_aggressive     NUMERIC,
  disq_risk_balanced       NUMERIC,
  disq_risk_safe           NUMERIC,
  confidence_tier          TEXT,
  signal_stage             INTEGER,
  sample_size_used         INTEGER
) LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_tier       TEXT := amount_tier_of(p_base_amount);
  v_mean       NUMERIC;
  v_std        NUMERIC;
  v_n          INTEGER;
  v_ct         TEXT;
  v_stage      INTEGER;
  v_margin_b   NUMERIC;
  v_margin_a   NUMERIC;
  v_margin_s   NUMERIC;
  v_pred_floor NUMERIC;
BEGIN
  -- 1단계: (canonical_ag, industry, amount_tier) 정확 매치
  SELECT mean_ratio, std_dev, sample_size, confidence_tier
    INTO v_mean, v_std, v_n, v_ct
  FROM agency_profile
  WHERE canonical_ag = p_canonical_ag
    AND industry = p_industry
    AND amount_tier = v_tier
    AND sample_size >= 5;
  IF FOUND THEN
    v_stage := 1;
  ELSE
    -- 2단계: (canonical_ag, industry, NULL)
    SELECT mean_ratio, std_dev, sample_size, confidence_tier
      INTO v_mean, v_std, v_n, v_ct
    FROM agency_profile
    WHERE canonical_ag = p_canonical_ag
      AND industry = p_industry
      AND amount_tier IS NULL;
    IF FOUND THEN
      v_stage := 2;
    ELSE
      -- 2.5단계: (canonical_ag, NULL, NULL)
      SELECT mean_ratio, std_dev, sample_size, confidence_tier
        INTO v_mean, v_std, v_n, v_ct
      FROM agency_profile
      WHERE canonical_ag = p_canonical_ag
        AND industry IS NULL
        AND amount_tier IS NULL;
      IF FOUND THEN
        v_stage := 2;
      ELSE
        -- 3단계: 글로벌 평균
        SELECT AVG(mean_ratio), AVG(std_dev), SUM(sample_size)
          INTO v_mean, v_std, v_n
        FROM agency_profile WHERE industry IS NULL AND amount_tier IS NULL;
        v_ct := 'insufficient';
        v_stage := 3;
      END IF;
    END IF;
  END IF;

  -- 마지막 폴백 (글로벌도 NULL이면 상수)
  IF v_mean IS NULL THEN
    v_mean := 100.0;
    v_std  := 0.7;
    v_n    := 0;
    v_ct   := 'insufficient';
    v_stage := 3;
  END IF;

  v_margin_b := calculate_recommended_margin(v_std, v_n);
  v_margin_a := GREATEST(0.05, v_margin_b * 0.5);
  v_margin_s := v_margin_b * 1.5;

  v_pred_floor := p_a_value
                + (p_base_amount * v_mean / 100 - p_a_value) * (p_floor_rate / 100);

  RETURN QUERY SELECT
    v_mean,
    v_pred_floor,
    CEIL(v_pred_floor * (1 + v_margin_a / 100))::NUMERIC,
    CEIL(v_pred_floor * (1 + v_margin_b / 100))::NUMERIC,
    CEIL(v_pred_floor * (1 + v_margin_s / 100))::NUMERIC,
    v_margin_a, v_margin_b, v_margin_s,
    calculate_disq_risk(v_margin_a, v_std),
    calculate_disq_risk(v_margin_b, v_std),
    calculate_disq_risk(v_margin_s, v_std),
    v_ct, v_stage, v_n;
END;
$$;
```

- [ ] **Step 12-2: 마이그레이션 적용**

`apply_migration({name: 'v6a_12_predict_with_history', query: <위 SQL>})`

- [ ] **Step 12-3: 함수 존재 검증** (smoke 호출은 Task 14)

```sql
SELECT routine_name FROM information_schema.routines
WHERE routine_schema='public' AND routine_name='predict_with_history';
```
Expected: 1행.

- [ ] **Step 12-4: 커밋**

```
git add docs/agency-predictor/migrations/V6A_12_predict_with_history.sql
git commit -m "feat(agency-predictor-v6a): define predict_with_history() RPC (3-stage fallback + 3-strategy)"
```

---

## Task 13: `recalibrate_agency_profiles()` 1회 실행 + 검증

**Files:** 변경 없음 (RPC 호출만, 결과는 `agency_profile` 테이블에 INSERT됨)

**Why this task here:** 백필 + 모든 RPC 준비 완료 후 첫 캐시 빌드. predict_with_history smoke의 전제조건.

- [ ] **Step 13-1: recalibrate 호출**

```sql
SELECT * FROM recalibrate_agency_profiles();
```
Expected:
- `rows_inserted ≥ 4,000` (1,639 발주처 × 평균 3-4 grain)
- `agencies_distinct ≥ 1,639`
- `elapsed_ms` ≤ 5,000 (1~3초 예상)

- [ ] **Step 13-2: agency_profile 분포 검증**

```sql
SELECT
  COUNT(*)                                                 AS total_rows,
  COUNT(*) FILTER (WHERE industry IS NULL AND amount_tier IS NULL) AS agency_only,
  COUNT(*) FILTER (WHERE industry IS NOT NULL AND amount_tier IS NULL) AS by_industry,
  COUNT(*) FILTER (WHERE industry IS NULL AND amount_tier IS NOT NULL) AS by_tier,
  COUNT(*) FILTER (WHERE industry IS NOT NULL AND amount_tier IS NOT NULL) AS full_grain,
  COUNT(*) FILTER (WHERE confidence_tier = 'high')         AS tier_high,
  COUNT(*) FILTER (WHERE confidence_tier = 'medium')       AS tier_medium,
  COUNT(*) FILTER (WHERE confidence_tier = 'low')          AS tier_low,
  COUNT(*) FILTER (WHERE confidence_tier = 'insufficient') AS tier_insuff
FROM agency_profile;
```
Expected: 4가지 grain 각각 1,000행 이상, confidence_tier 분포에 'high'/'medium' 일부 + 'low'/'insufficient' 다수.

- [ ] **Step 13-3: 핵심 영역 스팟체크 (한전·고양시·군부대)**

```sql
SELECT canonical_ag, industry, amount_tier, sample_size, mean_ratio, std_dev,
       recommended_margin, confidence_tier
FROM agency_profile
WHERE canonical_ag ILIKE '%한국전력공사 경기북부%'
  AND industry='전기'
ORDER BY amount_tier NULLS FIRST;
```
Expected: 1~7행 (각 amount_tier별 + NULL agg). `recommended_margin` 0.10~0.40 범위.

```sql
SELECT canonical_ag, industry, sample_size, mean_ratio, std_dev, confidence_tier
FROM agency_profile
WHERE canonical_ag ILIKE '%고양시%' AND amount_tier IS NULL
LIMIT 5;
```

```sql
SELECT canonical_ag, industry, sample_size, mean_ratio, std_dev, confidence_tier
FROM agency_profile
WHERE canonical_ag ILIKE '%육군%' AND amount_tier IS NULL
LIMIT 5;
```

- [ ] **Step 13-4: 커밋 (없음 — DB 데이터만 변경, SQL 파일 변동 없음)**

생략. 또는 검증 결과 노트가 필요하면 `docs/agency-predictor/migrations/V6A_13_recalibrate_run.md`에 결과 캡쳐.

---

## Task 14: `predict_with_history()` smoke 호출

**Files:** 변경 없음

- [ ] **Step 14-1: 한전 경기북부본부 전기 65.6억 smoke 호출 (1단계 매치 기대)**

```sql
SELECT * FROM predict_with_history(
  p_bid_no       := 'SMOKE_PREDICT_01',
  p_canonical_ag := (SELECT canonical_ag FROM agency_profile
                     WHERE canonical_ag ILIKE '%한국전력공사 경기북부%'
                     LIMIT 1),
  p_industry     := '전기',
  p_base_amount  := 656000000,
  p_a_value      := 65000000,
  p_floor_rate   := 88.25
);
```
Expected (행 1개):
- `predicted_ratio` 99~101 부근
- `predicted_floor_amount` > 0
- `aggressive_bid < balanced_bid < safe_bid` (순서)
- `aggressive_margin < balanced_margin < safe_margin`
- `disq_risk_aggressive > disq_risk_balanced > disq_risk_safe`
- `signal_stage = 1` (정확 매치), `confidence_tier ∈ ('high','medium','low')`
- `sample_size_used ≥ 5`

- [ ] **Step 14-2: 글로벌 폴백 smoke 호출 (없는 발주처)**

```sql
SELECT * FROM predict_with_history(
  p_bid_no       := 'SMOKE_PREDICT_02',
  p_canonical_ag := '존재하지않는발주처테스트XYZ',
  p_industry     := '전기',
  p_base_amount  := 300000000,
  p_a_value      := 30000000,
  p_floor_rate   := 87.745
);
```
Expected: `signal_stage = 3`, `confidence_tier = 'insufficient'`, `sample_size_used` 글로벌 합계 또는 0.

- [ ] **Step 14-3: 결과를 bid_predictions_v3에 INSERT (불변성 트리거 통과 확인)**

```sql
WITH p AS (
  SELECT * FROM predict_with_history(
    'SMOKE_PREDICT_INS_01',
    (SELECT canonical_ag FROM agency_profile WHERE canonical_ag ILIKE '%한국전력공사 경기북부%' LIMIT 1),
    '전기', 656000000, 65000000, 88.25
  )
)
INSERT INTO bid_predictions_v3 (
  bid_no, canonical_ag, industry, amount_tier, base_amount, a_value, floor_rate,
  predicted_ratio, predicted_floor_amount,
  aggressive_margin, balanced_margin, safe_margin,
  strategy_aggressive_bid, strategy_balanced_bid, strategy_safe_bid,
  disq_risk_aggressive, disq_risk_balanced, disq_risk_safe,
  confidence_tier, signal_stage, sample_size_used
)
SELECT
  'SMOKE_PREDICT_INS_01',
  (SELECT canonical_ag FROM agency_profile WHERE canonical_ag ILIKE '%한국전력공사 경기북부%' LIMIT 1),
  '전기', amount_tier_of(656000000), 656000000, 65000000, 88.25,
  p.predicted_ratio, p.predicted_floor_amount,
  p.aggressive_margin, p.balanced_margin, p.safe_margin,
  p.aggressive_bid, p.balanced_bid, p.safe_bid,
  p.disq_risk_aggressive, p.disq_risk_balanced, p.disq_risk_safe,
  p.confidence_tier, p.signal_stage, p.sample_size_used
FROM p
RETURNING id, expires_at, predicted_ratio;
```
Expected: 1행 INSERT. `expires_at = now() + 30 days`.

cleanup:
```sql
DELETE FROM bid_predictions_v3 WHERE bid_no IN ('SMOKE_PREDICT_INS_01');
```

- [ ] **Step 14-4: 커밋 (없음 — 코드 변화 없음, 검증 통과만 확인)**

---

## Task 15: V6-A 완료 정의 + 회귀 보호 최종 검증

**Files:** 변경 없음

- [ ] **Step 15-1: V6-A 완료 정의 5가지 충족 확인 (spec §13)**

```sql
WITH counts AS (
  SELECT
    (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema='public'
       AND table_name IN ('bid_history','agency_profile','bid_predictions_v3','upload_batches','bid_notices_temp'))
                                                        AS new_tables,
    (SELECT COUNT(*) FROM bid_history
     WHERE source='legacy_bid_records')                 AS bh_legacy_rows,
    (SELECT COUNT(*) FROM agency_profile)               AS ap_rows,
    (SELECT COUNT(*) FROM pg_proc
     WHERE proname IN ('predict_with_history','classify_confidence_tier',
                       'calculate_recommended_margin','calculate_disq_risk',
                       'amount_tier_of','recalibrate_agency_profiles',
                       'fn_normalize_bh','fn_bpv3_lifecycle'))
                                                        AS new_functions,
    (SELECT COUNT(*) FROM pg_trigger
     WHERE tgname IN ('trigger_normalize_bh','bpv3_lifecycle'))
                                                        AS new_triggers
)
SELECT
  new_tables    = 5      AS tables_ok,         -- 모두 생성
  bh_legacy_rows ≥ 60000 AS backfill_ok,       -- ≥60K
  ap_rows ≥ 4000         AS profile_ok,        -- ≥4K
  new_functions = 8      AS functions_ok,      -- 8개 모두
  new_triggers = 2       AS triggers_ok        -- 2개 모두
FROM counts;
```
Expected: 모든 5개 컬럼 `true`.

- [ ] **Step 15-2: 기존 시스템 무손상 최종 확인 (Phase 23-3 핵심 영역 보존)**

```sql
SELECT
  (SELECT COUNT(*) FROM bid_records)     AS records,   -- 62,365 유지
  (SELECT COUNT(*) FROM bid_predictions) AS preds,     -- 1,940 유지
  (SELECT COUNT(*) FROM bid_details)     AS details;   -- 880 유지
```

기존 RPC 동작 (smoke 호출 1건):
```sql
-- predict_v6 정상 호출 (signature는 기존 그대로)
SELECT proname, prosrc IS NOT NULL FROM pg_proc
WHERE proname IN ('predict_v6','normalize_agency_name');
-- 2행 모두 존재 + 본문 보존
```

뷰/뷰 의존 객체:
```sql
SELECT count(*) FROM v_system_health;  -- 정상 작동 (행 수는 도메인에 따라 다름)
```

- [ ] **Step 15-3: 핵심 영역 MAE 보존 (Phase 23-3 4단계 deploy-gate에서 요구하는 확인)**

기존 `bid_predictions` 테이블에 V6-A는 단 한 줄도 INSERT/UPDATE/DELETE하지 않았으므로 MAE는
변동 0. Task 1-4에서 캡쳐한 baseline과 동일 쿼리로 재조회 후 5개 숫자 모두 일치 확인:
```sql
SELECT
  (SELECT COUNT(*) FROM bid_records)     AS records_count,
  (SELECT COUNT(*) FROM bid_predictions) AS preds_count,
  (SELECT COUNT(*) FROM bid_predictions WHERE canonical_ag ILIKE '%한국전력%' AND actual_adj_rate IS NOT NULL) AS kepco_matched,
  (SELECT COUNT(*) FROM bid_predictions WHERE canonical_ag ILIKE '%고양시%'   AND actual_adj_rate IS NOT NULL) AS goyang_matched,
  (SELECT COUNT(*) FROM bid_predictions WHERE canonical_ag ILIKE '%육군%'     AND actual_adj_rate IS NOT NULL) AS army_matched;
```
Expected: Task 1-4 baseline과 5개 숫자 모두 100% 일치. 차이 1이라도 있으면 회귀 발생 →
어느 Task에서 기존 테이블에 쓰기 발생했는지 추적 후 롤백.

- [ ] **Step 15-4: V6-A 종료 커밋**

```
git add -A docs/agency-predictor/migrations/
git commit -m "chore(agency-predictor-v6a): V6-A complete — 5 tables + 4 RPCs + 2 triggers + 62K backfill + recalibrate cache

V6-A 완료 정의 충족:
- 신규 5개 테이블 + RLS + 인덱스 모두 생성
- bid_history ≥ 60K행 (bid_records 백필)
- agency_profile ≥ 4K행 (recalibrate 캐시)
- predict_with_history() smoke 호출 1단계/3단계 모두 통과
- 기존 시스템 회귀 0 (bid_records 62,365 / bid_predictions 1,940 보존)

다음 단계: V6-B (메인 탭 + 일괄 예측) brainstorm + spec.
spec: docs/superpowers/specs/2026-05-13-agency-predictor-v6a-db-infra-design.md"
```

- [ ] **Step 15-5: V6-B 진입 결정 (사용자 확인)**

V6-A가 모두 통과했음을 사용자에게 보고 후, V6-B (메인 탭 + 일괄 예측) brainstorm을 즉시 시작할지,
별도 세션으로 미룰지 사용자 결정. 본 plan은 V6-A에서 종료.

---

## Phase 23-3 게이트 요약 (참고)

| 단계 | 본 plan 적용 |
|---|---|
| 1. Design | spec(`2026-05-13-agency-predictor-v6a-db-infra-design.md`) 완료. `predict-architect` 면제 — 다른 변수 예측, 기존 `opt_adj` 미수정 |
| 2. Build | DB만, `src/*` 미수정 → PostToolUse hook 비트리거. 각 Task의 마이그레이션 검증 쿼리로 대체 |
| 3. Verify | `/evaluate` 면제 — `bid_predictions.opt_adj` 변경 0. Task 14가 V6 자체 smoke |
| 4. Operate | DB 마이그레이션은 Supabase MCP 직접 — Vercel 배포 무관, `deploy-gate` 미호출. Task 15-2/15-3가 핵심 영역 MAE 보존 확인 |
| 5. Predict | V6-A에는 예측 UI 없음. `predict_with_history()` 직접 호출만 가능 (psql/MCP). 정책 부합 |

---

## V6-A 완료 후 보류된 결정 (V6-B 시작 시 처리)

- supabase-js SDK 도입 vs `authedFetch` REST 패턴 유지
- recharts 도입 vs SVG 자체 구현 (V6-C 차트용)
- 외부 인포나·낙찰정보 시드 100건+100건 임포트 (V6-B 파서 구현 후)
- 자사 사업자번호 매칭 로직 (V6-D)
- 기존 17개 테이블 RLS 활성화 정책 (별도 결정, V6 범위 밖)
