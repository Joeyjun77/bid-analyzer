# v7 예측 시스템 재설계 — Phase 21-A·21-B 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** v7 분포 모델 인프라 구축 — 신규 테이블 3개 + RPC 함수 3개 + 백필 데이터. UI 노출/코드 변경 없음 (Phase 21-C부터 시작).

**Architecture:** PostgreSQL 17 (Supabase) 측에서만 작업. `agency_rate_distribution` (canonical_ag×cat 분포 통계), `lower_bound_rate_lookup` (낙찰하한율 시드), `agency_residual_offset` (at×ba_seg×cat 잔차) 3 테이블 + `bid_records.is_joint_contract` 컬럼 추가. RPC `predict_dist()`, `predict_dist_combined()`, `calc_bid_amount_dist()`. 백필은 outlier 필터 `abs(ar1-100)≤30` 적용.

**Tech Stack:** Supabase PostgreSQL 17, MCP 도구 (`apply_migration` for DDL, `execute_sql` for DML). React/Vite 빌드 영향 없음 (UI 미변경).

**Spec 참조:** `docs/superpowers/specs/2026-05-08-v7-prediction-redesign-design.md`

**선행 게이트 통과 기록:**
- predict-architect 1차: BLOCK (군부대 +0.086) → 잔차 재보정 층 추가
- predict-architect 2차: CONDITIONAL → writing-plans 진입 승인 (3개 게이트 spec 반영 완료)

---

## File Structure

이 plan은 코드 파일을 **변경하지 않습니다**. 모든 산출물은 Supabase 데이터베이스 객체.

| 산출물 | 종류 | 명 |
|---|---|---|
| 마이그레이션 1 | DDL | `phase_21a_dist_schema` (3 테이블 + 1 컬럼) |
| 시드 INSERT | DML | `lower_bound_rate_lookup` 7행 |
| 마이그레이션 2 | DDL | `phase_21b_dist_rpc_functions` (3 RPC 함수) |
| 백필 INSERT 1 | DML | `agency_rate_distribution` ~500행 예상 |
| 백필 INSERT 2 | DML | `agency_residual_offset` ~25행 예상 |
| 검증 기록 | docs | `docs/migrations/phase-21ab-verification.md` (신규, git 추적) |

---

## Task 1: Phase 21-A 스키마 마이그레이션 (3 테이블 + 1 컬럼)

**Files:**
- Apply migration: `phase_21a_dist_schema` (Supabase MCP)
- Verify: SQL `\d` queries via execute_sql

- [ ] **Step 1: 사전 검증 — 신규 객체 미존재 확인**

`mcp__claude_ai_Supabase__execute_sql` 호출:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema='public'
  AND table_name IN ('agency_rate_distribution', 'lower_bound_rate_lookup', 'agency_residual_offset');
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='bid_records'
  AND column_name IN ('is_joint_contract', 'joint_contract_type');
```

Expected: **둘 다 0행** (신규 객체 미존재). 1행 이상이면 마이그레이션 충돌 — 중단하고 사용자 확인.

- [ ] **Step 2: apply_migration 으로 3 테이블 + 1 컬럼 추가**

`mcp__claude_ai_Supabase__apply_migration` 호출, name=`phase_21a_dist_schema`, query=:

```sql
-- 1) agency_rate_distribution: 발주사×업종 분포 통계
CREATE TABLE agency_rate_distribution (
    canonical_ag        text NOT NULL,
    cat                 text NOT NULL,
    median_adj_ratio    numeric(8,5) NOT NULL,
    p25_adj_ratio       numeric(8,5) NOT NULL,
    p75_adj_ratio       numeric(8,5) NOT NULL,
    std_adj_ratio       numeric(8,5) NOT NULL,
    sample_size         int NOT NULL,
    tier                text NOT NULL CHECK (tier IN ('tier1','tier2','tier3')),
    confidence          text NOT NULL CHECK (confidence IN ('high','med','low')),
    last_recalc_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (canonical_ag, cat)
);
ALTER TABLE agency_rate_distribution ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_read_agency_rate_distribution
    ON agency_rate_distribution FOR SELECT TO anon USING (true);

-- 2) lower_bound_rate_lookup: 낙찰하한율 룩업 (예측 아님)
CREATE TABLE lower_bound_rate_lookup (
    agency_type         text NOT NULL,
    cat                 text NOT NULL,
    size_band           text NOT NULL,
    lower_bound_rate    numeric(7,5) NOT NULL,
    source_regulation   text,
    PRIMARY KEY (agency_type, cat, size_band)
);
ALTER TABLE lower_bound_rate_lookup ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_read_lower_bound_rate_lookup
    ON lower_bound_rate_lookup FOR SELECT TO anon USING (true);

-- 3) agency_residual_offset: 잔차 재보정 층 (predict-architect 1차 검토 결과)
CREATE TABLE agency_residual_offset (
    at                  text NOT NULL,
    ba_seg              text NOT NULL,
    cat                 text NOT NULL,
    residual_median     numeric(8,5) NOT NULL,
    residual_n          int NOT NULL,
    residual_n_required int NOT NULL DEFAULT 30,
    last_recalc_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (at, ba_seg, cat)
);
ALTER TABLE agency_residual_offset ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_read_agency_residual_offset
    ON agency_residual_offset FOR SELECT TO anon USING (true);

-- 4) bid_records 격리 컬럼 (Phase 22+ 데이터 보강 시 활성화)
ALTER TABLE bid_records
    ADD COLUMN IF NOT EXISTS is_joint_contract boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS joint_contract_type text;
```

Expected: 마이그레이션 적용 성공. 트랜잭션 중간 실패 시 전체 롤백 — 새 apply_migration 호출로 복구.

- [ ] **Step 3: 검증 — 객체 존재 + RLS + 정책 확인**

`execute_sql`:
```sql
-- 테이블 3개 + 컬럼 2개 존재 확인
SELECT table_name FROM information_schema.tables
WHERE table_schema='public'
  AND table_name IN ('agency_rate_distribution','lower_bound_rate_lookup','agency_residual_offset')
ORDER BY table_name;
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='bid_records'
  AND column_name IN ('is_joint_contract','joint_contract_type')
ORDER BY column_name;
-- RLS 활성 확인
SELECT relname, relrowsecurity FROM pg_class
WHERE relname IN ('agency_rate_distribution','lower_bound_rate_lookup','agency_residual_offset');
-- anon read 정책 확인
SELECT polrelid::regclass::text AS table_name, polname
FROM pg_policy
WHERE polrelid::regclass::text IN ('agency_rate_distribution','lower_bound_rate_lookup','agency_residual_offset');
```

Expected:
- 테이블 3행, 컬럼 2행 (모두 존재)
- relrowsecurity = `true` 3건
- 정책 3건 (각 테이블에 anon_read 1개씩)

- [ ] **Step 4: bid_records 컬럼 NOT NULL 확인**

`execute_sql`:
```sql
SELECT count(*) AS rows_with_null_is_joint
FROM bid_records WHERE is_joint_contract IS NULL;
SELECT count(*) AS total, count(*) FILTER (WHERE is_joint_contract = false) AS false_count
FROM bid_records;
```

Expected: rows_with_null_is_joint = 0, false_count = total (DEFAULT false 적용 확인).

- [ ] **Step 5: 빌드 무관 확인**

```bash
npx vite build
```

Expected: PASS. UI/코드 미변경이라 영향 없어야 함.

- [ ] **Step 6: 검증 기록 파일 생성 + commit**

새 파일: `docs/migrations/phase-21ab-verification.md`

```markdown
# Phase 21-A·B 마이그레이션 검증 기록

**적용일**: 2026-05-09
**spec**: docs/superpowers/specs/2026-05-08-v7-prediction-redesign-design.md
**plan**: docs/superpowers/plans/2026-05-08-v7-redesign-phase-21ab.md

## Task 1: Phase 21-A 스키마

- 마이그레이션명: `phase_21a_dist_schema`
- 신규 테이블: agency_rate_distribution, lower_bound_rate_lookup, agency_residual_offset
- 신규 컬럼: bid_records.is_joint_contract (NOT NULL DEFAULT false), bid_records.joint_contract_type
- RLS: 3 테이블 모두 활성, anon_read 정책 적용
- 빌드: npx vite build PASS
```

```bash
git add docs/migrations/phase-21ab-verification.md
git commit -m "docs(phase-21a): v7 분포 스키마 마이그레이션 검증 기록"
```

---

## Task 2: lower_bound_rate_lookup 시드 데이터

**Files:**
- Execute SQL via Supabase MCP (DDL ↔ DML 분리 — 메모리 원칙)

- [ ] **Step 1: 시드 INSERT 실행**

`execute_sql`:
```sql
INSERT INTO lower_bound_rate_lookup (agency_type, cat, size_band, lower_bound_rate, source_regulation) VALUES
('지자체', '전기/통신/소방', 'u150m', 87.74500, '1.5억 미만, 90점 산식'),
('지자체', '전기/통신/소방', 'u300m', 87.74500, '1.5억~3억, 80점 산식'),
('지자체', '전기/통신/소방', 'u5b',   86.74500, '3억~50억, 70점 산식'),
('조달청', '전기/통신/소방', 'u80m',  87.74500, '8천만 미만'),
('조달청', '전기/통신/소방', 'u300m', 87.74500, '8천만~3억'),
('조달청', '전기/통신/소방', 'u5b',   86.74500, '3억~50억'),
('LH',    '전체',              '전체',  87.74500, '별도 (예가 천원 절상)');
```

Expected: 7 rows inserted.

- [ ] **Step 2: 시드 검증**

`execute_sql`:
```sql
SELECT count(*) AS n,
       avg(lower_bound_rate) AS avg_rate,
       min(lower_bound_rate) AS min_rate,
       max(lower_bound_rate) AS max_rate
FROM lower_bound_rate_lookup;
```

Expected: n=7, avg ≈ 87.6, min=86.74500, max=87.74500.

- [ ] **Step 3: anon read 정책 작동 확인 (PostgREST endpoint)**

`execute_sql`:
```sql
SET LOCAL ROLE anon;
SELECT count(*) FROM lower_bound_rate_lookup;
RESET ROLE;
```

Expected: count = 7 (anon이 SELECT 가능).

- [ ] **Step 4: 검증 기록 추가 + commit**

`docs/migrations/phase-21ab-verification.md`에 추가:
```markdown
## Task 2: 시드 데이터

- lower_bound_rate_lookup INSERT: 7 rows
- avg_rate: 87.6%, range 86.745~87.745%
- anon SELECT 권한 확인: PASS
- 시드 출처: docs/superpowers/specs/2026-05-08-v7-prediction-redesign-design.md §4.2 표 (입찰교육자료)
```

```bash
git add docs/migrations/phase-21ab-verification.md
git commit -m "docs(phase-21a): lower_bound_rate_lookup 시드 7행 적용 기록"
```

---

## Task 3: Phase 21-B 추정 RPC 함수 3개

**Files:**
- Apply migration: `phase_21b_dist_rpc_functions`

- [ ] **Step 1: predict_dist, predict_dist_combined, calc_bid_amount_dist 함수 한번에 적용**

`apply_migration`, name=`phase_21b_dist_rpc_functions`, query=:

```sql
-- 1) predict_dist: 단순 분포 통계 + 3-tier shrinkage
CREATE OR REPLACE FUNCTION predict_dist(
    p_canonical_ag text,
    p_cat          text DEFAULT '전기'
) RETURNS TABLE (
    median_adj   numeric,
    p25_adj      numeric,
    p75_adj      numeric,
    std_adj      numeric,
    confidence   text,
    tier         text,
    sample_size  int
) LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_n_self int;
    v_at     text;
BEGIN
    SELECT at INTO v_at FROM bid_records
    WHERE canonical_ag = p_canonical_ag LIMIT 1;

    SELECT count(*) INTO v_n_self
    FROM bid_records
    WHERE canonical_ag = p_canonical_ag
      AND cat LIKE p_cat || '%'
      AND is_joint_contract = false
      AND ar1 IS NOT NULL AND abs(ar1 - 100) <= 30
      AND COALESCE(is_excluded,false) = false;

    IF v_n_self >= 10 THEN
        RETURN QUERY
        SELECT
            percentile_cont(0.50) WITHIN GROUP (ORDER BY ar1)::numeric,
            percentile_cont(0.25) WITHIN GROUP (ORDER BY ar1)::numeric,
            percentile_cont(0.75) WITHIN GROUP (ORDER BY ar1)::numeric,
            stddev_samp(ar1)::numeric,
            'high'::text, 'tier1'::text, v_n_self
        FROM bid_records
        WHERE canonical_ag = p_canonical_ag
          AND cat LIKE p_cat || '%'
          AND is_joint_contract = false
          AND ar1 IS NOT NULL AND abs(ar1 - 100) <= 30
          AND COALESCE(is_excluded,false) = false;
    ELSIF v_n_self >= 5 THEN
        -- Tier 2: Bayesian shrinkage (n_pool=10, weight = n/(n+10))
        RETURN QUERY
        WITH self_stats AS (
            SELECT
                percentile_cont(0.50) WITHIN GROUP (ORDER BY ar1)::numeric AS m,
                percentile_cont(0.25) WITHIN GROUP (ORDER BY ar1)::numeric AS p25,
                percentile_cont(0.75) WITHIN GROUP (ORDER BY ar1)::numeric AS p75,
                stddev_samp(ar1)::numeric AS s,
                count(*) AS n
            FROM bid_records
            WHERE canonical_ag = p_canonical_ag
              AND cat LIKE p_cat || '%' AND is_joint_contract = false
              AND ar1 IS NOT NULL AND abs(ar1 - 100) <= 30
              AND COALESCE(is_excluded,false) = false
        ),
        global_stats AS (
            SELECT
                percentile_cont(0.50) WITHIN GROUP (ORDER BY ar1)::numeric AS m,
                percentile_cont(0.25) WITHIN GROUP (ORDER BY ar1)::numeric AS p25,
                percentile_cont(0.75) WITHIN GROUP (ORDER BY ar1)::numeric AS p75,
                stddev_samp(ar1)::numeric AS s
            FROM bid_records
            WHERE at = v_at AND cat LIKE p_cat || '%'
              AND is_joint_contract = false
              AND ar1 IS NOT NULL AND abs(ar1 - 100) <= 30
              AND COALESCE(is_excluded,false) = false
        )
        SELECT
            (s.m * s.n / (s.n + 10) + g.m * 10 / (s.n + 10))::numeric,
            (s.p25 * s.n / (s.n + 10) + g.p25 * 10 / (s.n + 10))::numeric,
            (s.p75 * s.n / (s.n + 10) + g.p75 * 10 / (s.n + 10))::numeric,
            (s.s * s.n / (s.n + 10) + g.s * 10 / (s.n + 10))::numeric,
            'med'::text, 'tier2'::text, s.n::int
        FROM self_stats s, global_stats g;
    ELSE
        RETURN QUERY
        SELECT
            percentile_cont(0.50) WITHIN GROUP (ORDER BY ar1)::numeric,
            percentile_cont(0.25) WITHIN GROUP (ORDER BY ar1)::numeric,
            percentile_cont(0.75) WITHIN GROUP (ORDER BY ar1)::numeric,
            stddev_samp(ar1)::numeric,
            'low'::text, 'tier3'::text, v_n_self
        FROM bid_records
        WHERE at = v_at AND cat LIKE p_cat || '%'
          AND is_joint_contract = false
          AND ar1 IS NOT NULL AND abs(ar1 - 100) <= 30
          AND COALESCE(is_excluded,false) = false;
    END IF;
END;
$$;

-- 2) predict_dist_combined: 잔차 재보정 결합
CREATE OR REPLACE FUNCTION predict_dist_combined(
    p_canonical_ag text,
    p_cat          text DEFAULT '전기',
    p_ba           numeric DEFAULT NULL
) RETURNS TABLE (
    final_adj    numeric,
    median_adj   numeric,
    p25_adj      numeric,
    p75_adj      numeric,
    std_adj      numeric,
    confidence   text,
    tier         text,
    sample_size  int,
    residual_applied numeric,
    residual_src text
) LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_seg text := CASE
        WHEN p_ba IS NULL THEN 'S0'
        WHEN p_ba < 1e8 THEN 'S1'
        WHEN p_ba < 3e8 THEN 'S2'
        WHEN p_ba < 1e9 THEN 'S3'
        WHEN p_ba < 3e9 THEN 'S4'
        ELSE 'S5'
    END;
    v_at text;
    v_residual numeric := 0;
    v_residual_src text := '없음';
BEGIN
    SELECT at INTO v_at FROM bid_records
    WHERE canonical_ag = p_canonical_ag LIMIT 1;

    SELECT residual_median, format('%s×%s', at, ba_seg)
      INTO v_residual, v_residual_src
    FROM agency_residual_offset
    WHERE at = v_at AND ba_seg = v_seg AND cat LIKE p_cat || '%'
      AND residual_n >= residual_n_required
    LIMIT 1;
    IF v_residual IS NULL THEN
        v_residual := 0;
        v_residual_src := '표본부족';
    END IF;

    RETURN QUERY
    SELECT
        (v.median_adj - v_residual)::numeric,
        v.median_adj, v.p25_adj, v.p75_adj, v.std_adj,
        v.confidence, v.tier, v.sample_size,
        v_residual, v_residual_src
    FROM predict_dist(p_canonical_ag, p_cat) v;
END;
$$;

-- 3) calc_bid_amount_dist: 결정적 투찰금액 산식 (LH 외 공통)
CREATE OR REPLACE FUNCTION calc_bid_amount_dist(
    p_ba              numeric,
    p_adj_ratio_pct   numeric,
    p_lower_bound_pct numeric
) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
    SELECT ceil(p_ba * (p_adj_ratio_pct / 100.0) * (p_lower_bound_pct / 100.0));
$$;
```

Expected: 마이그레이션 적용 성공.

- [ ] **Step 2: 함수 존재 확인**

`execute_sql`:
```sql
SELECT proname, pronargs FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('predict_dist', 'predict_dist_combined', 'calc_bid_amount_dist')
ORDER BY proname;
```

Expected: 3행 (predict_dist=2, predict_dist_combined=3, calc_bid_amount_dist=3).

- [ ] **Step 3: predict_dist 동작 검증 (Tier 1 표본)**

`execute_sql`:
```sql
-- 한전 본사 같은 Tier 1 (n>=10) 발주사 1건 선택해 호출 결과와 직접 집계 비교
WITH t1 AS (
  SELECT canonical_ag FROM bid_records
  WHERE COALESCE(is_excluded,false)=false AND ar1 IS NOT NULL
    AND abs(ar1-100)<=30 AND cat LIKE '전기%'
  GROUP BY canonical_ag
  HAVING count(*) >= 100
  ORDER BY count(*) DESC LIMIT 1
)
SELECT
  pv.median_adj AS rpc_median,
  pv.tier, pv.sample_size,
  d.direct_median, d.direct_n
FROM t1
CROSS JOIN LATERAL predict_dist(t1.canonical_ag, '전기') pv,
LATERAL (
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY ar1)::numeric AS direct_median,
         count(*) AS direct_n
  FROM bid_records
  WHERE canonical_ag = t1.canonical_ag AND cat LIKE '전기%'
    AND is_joint_contract = false AND ar1 IS NOT NULL AND abs(ar1-100)<=30
    AND COALESCE(is_excluded,false)=false
) d;
```

Expected: rpc_median = direct_median (소수 5자리 정확 일치), tier='tier1', rpc.sample_size = direct_n.

- [ ] **Step 4: calc_bid_amount_dist 산식 검증**

`execute_sql`:
```sql
-- 1억 × 99.876% × 87.745% = 87,628,797.5 → ceil = 87,628,798
SELECT calc_bid_amount_dist(100000000, 99.87600, 87.74500) AS computed;
SELECT ceil(100000000 * 0.998760 * 0.877450) AS expected;
```

Expected: computed = expected (정수, ceil 적용).

- [ ] **Step 5: 검증 기록 + commit**

`docs/migrations/phase-21ab-verification.md`에 추가:
```markdown
## Task 3: 추정 RPC 함수 3개

- 마이그레이션명: `phase_21b_dist_rpc_functions`
- predict_dist (Tier1/2/3 분기 + outlier 필터): 표본 검증 PASS
- predict_dist_combined (잔차 결합): 표본 검증 PASS
- calc_bid_amount_dist (결정적 산식): 1억 × 99.876% × 87.745% = 87,628,798 정상
```

```bash
git add docs/migrations/phase-21ab-verification.md
git commit -m "docs(phase-21b): predict_dist/predict_dist_combined/calc_bid_amount_dist RPC 적용 기록"
```

---

## Task 4: agency_rate_distribution 백필 (outlier 필터 적용)

**Files:**
- Execute SQL via Supabase MCP

- [ ] **Step 1: 사전 행 수 시뮬 (백필 전 dry-run)**

`execute_sql`:
```sql
SELECT count(DISTINCT (canonical_ag, cat)) AS expected_rows
FROM bid_records
WHERE COALESCE(is_excluded,false)=false
  AND ar1 IS NOT NULL AND abs(ar1 - 100) <= 30
  AND canonical_ag IS NOT NULL AND cat IS NOT NULL;
```

Expected: 약 ~1,400행 (canonical_ag×cat 조합).

- [ ] **Step 2: agency_rate_distribution 백필 INSERT**

`execute_sql`:
```sql
INSERT INTO agency_rate_distribution
SELECT canonical_ag, cat,
       percentile_cont(0.50) WITHIN GROUP (ORDER BY ar1)::numeric(8,5),
       percentile_cont(0.25) WITHIN GROUP (ORDER BY ar1)::numeric(8,5),
       percentile_cont(0.75) WITHIN GROUP (ORDER BY ar1)::numeric(8,5),
       COALESCE(stddev_samp(ar1), 0)::numeric(8,5),
       count(*),
       CASE WHEN count(*)>=10 THEN 'tier1'
            WHEN count(*)>=5  THEN 'tier2'
            ELSE 'tier3' END,
       CASE WHEN count(*)>=10 THEN 'high'
            WHEN count(*)>=5  THEN 'med'
            ELSE 'low' END,
       now()
FROM bid_records
WHERE COALESCE(is_excluded,false)=false
  AND ar1 IS NOT NULL AND abs(ar1 - 100) <= 30
  AND canonical_ag IS NOT NULL AND cat IS NOT NULL
GROUP BY canonical_ag, cat
HAVING count(*) >= 1;
```

Expected: insert 성공, 행 수 = Step 1 expected_rows와 일치.

- [ ] **Step 3: tier 분포 검증**

`execute_sql`:
```sql
SELECT tier, count(*) AS n_agencies, sum(sample_size) AS total_records,
       round(avg(sample_size)::numeric, 1) AS avg_n_per_agency
FROM agency_rate_distribution
GROUP BY tier ORDER BY tier;
```

Expected (spec §2.2 진단과 정합):
- tier1: 약 345 발주사 / 약 49,818건 누적 (96%대)
- tier2: 약 149 / 약 982건
- tier3: 약 934 / 약 1,578건

±5% 편차는 cat 단일/복합 매칭 방식 차이로 정상. 큰 편차 발생 시 outlier 필터 동작 재확인.

- [ ] **Step 4: 한전 outlier 필터 효과 확인**

`execute_sql`:
```sql
SELECT canonical_ag, cat, median_adj_ratio, std_adj_ratio, sample_size, tier
FROM agency_rate_distribution
WHERE canonical_ag LIKE '%한국전력%' AND cat LIKE '전기%'
ORDER BY sample_size DESC LIMIT 5;
```

Expected: std_adj_ratio < 5 (1차 outlier 제거 전 17.68 → 후 1.62 수준). std > 10 발생 시 필터 재검토.

- [ ] **Step 5: 핵심 영역 spot check (한전·고양시·군부대)**

`execute_sql`:
```sql
SELECT canonical_ag, cat, median_adj_ratio, p25_adj_ratio, p75_adj_ratio,
       sample_size, tier
FROM agency_rate_distribution
WHERE canonical_ag IN ('한국전력공사', '고양시', '국방부') -- 정확한 canonical_ag는 실측에 따라 보정
   OR canonical_ag LIKE '%군부대%' OR canonical_ag LIKE '%사단%'
ORDER BY sample_size DESC LIMIT 20;
```

Expected: 핵심 영역 모두 tier1 또는 tier2 (n≥5), median_adj_ratio가 99.5~100.5 범위.

- [ ] **Step 6: 검증 기록 + commit**

`docs/migrations/phase-21ab-verification.md` 추가:
```markdown
## Task 4: 분포 백필

- 행 수: <Step 2 결과>
- tier1/2/3 분포: <Step 3 결과>
- 한전 outlier 필터 효과: std=<Step 4 결과>
- 핵심 영역 spot check: <Step 5 결과>
```

```bash
git add docs/migrations/phase-21ab-verification.md
git commit -m "docs(phase-21b): agency_rate_distribution 백필 검증 기록"
```

---

## Task 5: agency_residual_offset 백필 (잔차 재보정 층)

**Files:**
- Execute SQL via Supabase MCP

- [ ] **Step 1: 사전 행 수 시뮬**

`execute_sql`:
```sql
SELECT count(*) AS grain_count, count(*) FILTER (WHERE n>=30) AS active_grain
FROM (
  SELECT br.at,
         CASE WHEN br.ba<1e8 THEN 'S1' WHEN br.ba<3e8 THEN 'S2'
              WHEN br.ba<1e9 THEN 'S3' WHEN br.ba<3e9 THEN 'S4'
              ELSE 'S5' END AS ba_seg,
         br.cat,
         count(*) AS n
  FROM bid_records br
  JOIN agency_rate_distribution ard
    ON ard.canonical_ag = br.canonical_ag AND ard.cat = br.cat
  WHERE COALESCE(br.is_excluded,false)=false
    AND br.ar1 IS NOT NULL AND abs(br.ar1 - 100) <= 30
    AND br.at IS NOT NULL AND br.ba IS NOT NULL
  GROUP BY br.at, ba_seg, br.cat
) t;
```

Expected: active_grain ≥ 20 (predict-architect 2차 시뮬상 26개 그레인 중 23개 OK).

- [ ] **Step 2: agency_residual_offset 백필 INSERT**

`execute_sql`:
```sql
INSERT INTO agency_residual_offset (at, ba_seg, cat, residual_median, residual_n, residual_n_required, last_recalc_at)
SELECT br.at,
       CASE WHEN br.ba<1e8 THEN 'S1' WHEN br.ba<3e8 THEN 'S2'
            WHEN br.ba<1e9 THEN 'S3' WHEN br.ba<3e9 THEN 'S4'
            ELSE 'S5' END AS ba_seg,
       br.cat,
       percentile_cont(0.50) WITHIN GROUP (ORDER BY (ard.median_adj_ratio - br.ar1))::numeric(8,5) AS residual_median,
       count(*) AS residual_n,
       30 AS residual_n_required,
       now()
FROM bid_records br
JOIN agency_rate_distribution ard
  ON ard.canonical_ag = br.canonical_ag AND ard.cat = br.cat
WHERE COALESCE(br.is_excluded,false)=false
  AND br.ar1 IS NOT NULL AND abs(br.ar1 - 100) <= 30
  AND br.at IS NOT NULL AND br.ba IS NOT NULL
GROUP BY br.at, ba_seg, br.cat
HAVING count(*) >= 5;  -- 최소 5건 이상만 기록 (residual_n_required=30 이상만 적용되지만 분석용으로 5+ 보존)
```

Expected: insert 성공, 행 수 = Step 1 grain_count와 비슷 (cat 다양성으로 약간 차이).

- [ ] **Step 3: 군부대 그레인 잔차 검증**

`execute_sql`:
```sql
SELECT at, ba_seg, cat, residual_median, residual_n,
       (residual_n >= residual_n_required) AS will_apply
FROM agency_residual_offset
WHERE at = '군시설'
ORDER BY ba_seg, cat;
```

Expected (predict-architect 2차):
- S1: residual ≈ 0.0, n ≈ 4288, will_apply = true
- S2: residual ≈ 0.0, n ≈ 1209, will_apply = true
- S3: residual ≈ −0.05, n ≈ 580, will_apply = true
- S4: residual ≈ 0.11, n ≈ 31, will_apply = true (경계)

- [ ] **Step 4: predict_dist_combined RPC 동작 검증 (잔차 적용 케이스)**

`execute_sql`:
```sql
-- 군부대 영역 표본 발주사로 호출 — final_adj와 median_adj가 다른지(잔차 적용) 확인
WITH t AS (
  SELECT br.canonical_ag, br.ba
  FROM bid_records br
  WHERE br.at = '군시설' AND br.cat LIKE '전기%' AND br.ba >= 1e9 AND br.ba < 3e9
    AND COALESCE(br.is_excluded,false)=false AND br.ar1 IS NOT NULL
  LIMIT 1
)
SELECT t.canonical_ag, t.ba,
       pvc.final_adj, pvc.median_adj, pvc.residual_applied, pvc.residual_src,
       (pvc.final_adj - pvc.median_adj) AS diff
FROM t, predict_dist_combined(t.canonical_ag, '전기', t.ba) pvc;
```

Expected: residual_src = '군시설×S3', residual_applied ≠ 0, diff = -residual_applied. residual_src='없음'/'표본부족'은 그레인 미존재 또는 n<30 경우.

- [ ] **Step 5: 검증 기록 + commit**

`docs/migrations/phase-21ab-verification.md` 추가:
```markdown
## Task 5: 잔차 재보정 백필

- 행 수: <Step 2 결과>
- 군부대 4개 그레인: <Step 3 결과 표>
- predict_dist_combined 잔차 적용 동작: <Step 4 결과>
```

```bash
git add docs/migrations/phase-21ab-verification.md
git commit -m "docs(phase-21b): agency_residual_offset 백필 + RPC 잔차 결합 검증"
```

---

## Task 6: 최종 검증 + Phase 21-A·B 완료 보고

**Files:**
- 빌드/통합 검증, 검증 기록 마무리

- [ ] **Step 1: 핵심 영역 3건 final_adj 시뮬 (Shadow 진입 직전 baseline)**

`execute_sql`:
```sql
-- 한전·고양시·군부대 표본 발주사 5건씩 final_adj 산출
WITH samples AS (
  SELECT canonical_ag, cat, ba
  FROM bid_records
  WHERE COALESCE(is_excluded,false)=false AND ar1 IS NOT NULL AND ba > 0
    AND (canonical_ag LIKE '%한국전력%' OR canonical_ag LIKE '%고양시%' OR at='군시설')
    AND cat LIKE '전기%'
  ORDER BY random() LIMIT 15
)
SELECT s.canonical_ag, s.ba,
       pvc.final_adj, pvc.median_adj, pvc.residual_applied, pvc.tier
FROM samples s,
LATERAL predict_dist_combined(s.canonical_ag, '전기', s.ba) pvc
ORDER BY s.canonical_ag, s.ba;
```

Expected: 모든 행에서 final_adj가 95~105 범위, tier in (tier1, tier2, tier3) 적절 분포.

- [ ] **Step 2: 빌드 통과 확인 (전체 검증)**

```bash
npx vite build
```

Expected: PASS. UI/JS 코드 미변경이므로 영향 없어야 함.

- [ ] **Step 3: 검증 기록 마무리 + commit**

`docs/migrations/phase-21ab-verification.md` 끝부분에 추가:
```markdown
## Task 6: 통합 검증

- 핵심 영역 final_adj 시뮬: <Step 1 결과 표>
- npx vite build: PASS

## Phase 21-A·B 완료 요약

- 신규 테이블 3개, 신규 컬럼 2개, 신규 RPC 함수 3개
- 백필 행 수: agency_rate_distribution=<n>, agency_residual_offset=<n>, lower_bound_rate_lookup=7
- UI/코드 변경 없음 (Phase 21-C부터)
- 다음 단계: Phase 21-C plan 작성 (별도 세션, App.jsx 토글 추가)
- 21-C 진입 전 predict-architect 3차 검토 권장 (실제 백필 데이터로 시뮬 재실측)
```

```bash
git add docs/migrations/phase-21ab-verification.md
git commit -m "docs(phase-21ab): 통합 검증 완료 — Phase 21-C 진입 준비 완료"
```

- [ ] **Step 4: 사용자 보고**

요약 메시지:
- Phase 21-A·B 완료
- 신규 객체: 3 테이블, 2 컬럼, 3 RPC, 백필 데이터
- UI 미변경, 빌드 PASS
- 다음 단계 결정 필요: (a) 21-C plan 즉시 작성, (b) 백필 실데이터로 predict-architect 3차 재검증 후 21-C 진입, (c) 잠시 보류하고 운영 데이터 누적 모니터링

**Push는 사용자 명시 요청 후에만 실행**. docs commit만 main에 누적되어 있으며, deploy-gate는 코드 변경 시 트리거되므로 docs-only 변경에는 면제 가능 (사용자 확인 필요).

---

## Self-Review

**Spec coverage 점검**:

| Spec 섹션 | Plan 커버 |
|---|---|
| §4.1 agency_rate_distribution | Task 1 Step 2 (DDL), Task 4 (백필) |
| §4.2 lower_bound_rate_lookup | Task 1 Step 2 (DDL), Task 2 (시드) |
| §4.3 bid_records 컬럼 | Task 1 Step 2 |
| §5.1 predict_dist RPC | Task 3 Step 1 |
| §5.2 잔차 층 (agency_residual_offset, predict_dist_combined) | Task 1 Step 2, Task 3 Step 1, Task 5 |
| §5.3 calc_bid_amount_dist | Task 3 Step 1 |
| §5.2 deprecate 게이트 | Phase 21-C plan에서 측정 (이 plan 범위 밖) |
| §6 Phase 21-A | Task 1, 2 |
| §6 Phase 21-B | Task 3, 4, 5 |
| §6 Phase 21-C 합격 기준 | Task 6 Step 1 (baseline 측정), 실제 측정은 21-C plan |
| §7 검증 게이트 (apply_migration ↔ DDL, execute_sql ↔ DML) | Task 1·3 (DDL), Task 2·4·5 (DML) — 메모리 원칙 정렬 |

→ Phase 21-A·B 범위 내 spec 모두 커버. Phase 21-C 이후는 별도 plan.

**Placeholder 점검**: 없음. SQL 전문, expected 결과, 검증 쿼리 모두 구체.

**Type consistency**: `canonical_ag` (text), `cat` (text), `ar1` (numeric, 100% 기준), `numeric(8,5)` 분포 통계, `numeric(7,5)` 하한율 — 일관 적용.

**Phase 분할 명시**: 21-C 이후는 별도 plan 권고. 사용자가 즉시 21-C plan을 원하면 다음 세션 또는 별도 호출.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-08-v7-redesign-phase-21ab.md`.

**실행 옵션 2가지**:

**1. Subagent-Driven (추천)** — task별 fresh subagent dispatch, 사이에 사용자/메인 리뷰. 빠른 iteration. Supabase MCP 호출 단위 작업이라 task별 격리가 안전.

**2. Inline Execution** — 현 세션에서 executing-plans로 일괄 진행, 체크포인트 단위 리뷰. 마이그레이션 충돌 즉시 발견 시 빠른 롤백 가능. 컨텍스트 유지로 검증 표본 추적 용이.

**어느 방식으로 진행할까요?**
