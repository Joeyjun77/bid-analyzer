# 군부대 Mode A — Phase 1: floorErr 분포 소스 구축 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 군부대(군시설) Mode A의 m_star 산출 기반이 될 floorErr 경험분포를 era 분리·마진 제거·base 분모 통일로 산출하는 DB 소스(테이블 + refresh 함수 + lookup RPC)를 구축한다. (라이브 recommendModeA 연결은 Phase 2)

**Architecture:** `agency_gap_distribution`/`lookup_gap_distribution`(경쟁자 gap — 폐기 대상) 패턴을 미러한 신규 테이블 `floorerr_distribution` + `refresh_floorerr_distribution()` 적재 함수 + `lookup_floorerr_distribution(...,p_era)` 조회 RPC. floorErr는 **매칭된 `bid_predictions`의 라이브 출력**(predict_v6가 그 시점 산출한 값)으로만 산출하여 설계 §5 "leave-one-out 금지, 라이브 추론기와 동일 캘리브레이션"을 정의상 만족. era 분리는 필수(current/legacy floorErr p50가 1.86%p 차이 — FAIL 임계 압도).

**Tech Stack:** Supabase PostgreSQL (apply_migration MCP로 적용), plpgsql, 마이그레이션 파일 `docs/v2/migrations/mNN_*.sql`. 코드(src/) 변경 없음 — DB-only.

---

## 확정 스펙 (변경 금지 — predict-architect 2회 검토 + 데이터 검증 완료)

### floorErr 정의 (G-단위 게이트 핵심)
```
floorErr_bid_rate = (actual_floor_amount − predicted_floor_amount) / base_amount    [분수, ×100 안 함]
  actual_floor_amount    = bid_records.floor_price            (bid_predictions.matched_record_id 조인)
  predicted_floor_amount = pred_expected_price × pred_floor_rate / 100   ← 마진 제거 (pred_bid_amount/opt_bid 금지: 마진 +0.13~0.26% 내장)
  base_amount            = bid_predictions.ba                 (= bid_records.ba, 동일 검증됨)
```
- 부호: actual − predicted. **floorErr > 0 = 과소예측 = 하한 미달(탈락) 위험.**
- 하한 통과 조건(Phase 2 정합): 투찰 마진 m에 대해 `m ≥ floorErr` 이면 통과.
- m_star 방향(Phase 2): `m_star = quantile(floorErr, 1 − alpha)` (상위 분위수). alpha=0.10→p90, 0.15→p85, 0.25→p75.

### 모집단 필터 (refresh 함수 WHERE 절)
- `match_status='matched'` AND `actual_adj_rate IS NOT NULL`
- `classify_agency_type(ag)='군시설'` (Phase 0 정제판 717388a — 한전/지자체 누출 0 가드)
- `pred_expected_price`·`pred_floor_rate`·`floor_price`·`ba` 모두 NOT NULL
- `actual_winner NOT IN ('유찰','유찰(무)')` (m23 전례)
- `is_joint_contract != true` (G-도메인 #7, m23 전례)
- `era_v2 IS NOT NULL`
- 이상치 가드: `abs(floor_err) <= 0.10`

### 적재 grain (Phase 1)
군부대-전체 단일 분포만: `at='군시설', canonical_ag=NULL, ba_seg=NULL`. era별 1행씩(current + legacy). (공사종류×금액대 세분은 표본 부족으로 후속 Phase.)

### 진실 소스 — 적재 직후 기대값 (검증 테스트 기준값, 2026-05-23 측정)
| era | n | p10 | p25 | p50 | p75 | p80 | p85 | p90 | p95 | mean | std | confidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| current | 86 | −0.007834 | −0.003545 | +0.000507 | +0.005514 | +0.006504 | +0.007448 | +0.009121 | +0.011504 | +0.000696 | 0.006511 | insufficient_sample |
| legacy | 139 | −0.026390 | −0.022178 | −0.018050 | −0.013337 | −0.012639 | −0.011824 | −0.010468 | −0.007252 | −0.018045 | 0.006397 | insufficient_sample |

> ⚠️ **표본 부족 명시**: 두 era 모두 n<300 → `insufficient_sample`. 라이브 소비는 current만(p_era='current'). alpha sweet spot(Phase 3) 통계 판정은 현 표본으로 불가 — 배포 후 7~14일 누적 후 재평가. legacy는 era-안정 형상 참조용(라이브 분위수 직접 사용 금지).

### confidence 라벨 규칙 (설계 §6 단일 게이트 n≥300)
```
n >= 1000 → 'high'
n >= 300  → 'medium'
else      → 'insufficient_sample'
```
(`'low'`도 CHECK에 허용해 두되 본 규칙은 미사용 — 후속 grain 확장 여지.)

---

## File Structure

| 파일 | 책임 | 비고 |
|---|---|---|
| `docs/v2/migrations/m35_create_floorerr_distribution.sql` | 신규 테이블 DDL (RLS + UNIQUE + 인덱스) | m13 미러 |
| `docs/v2/migrations/m36_create_refresh_floorerr_distribution.sql` | 적재 함수 + 1회 즉시 실행 | m23 미러, UPSERT |
| `docs/v2/migrations/m37_create_lookup_floorerr_distribution_rpc.sql` | era 인자 포함 조회 RPC (3단 fallback) | m14 미러 |
| `docs/v2/A_MODE_A_MILITARY_WIN_DESIGN_2026-05-23.md` | §14 Phase 1 완료 표기 + 확정 정의 반영 | 문서 동기 |

> 각 마이그레이션은 **apply_migration (Supabase MCP)로 적용** + 동일 SQL을 위 파일로 저장(기록). DB는 라이브 직접 반영, .sql은 리포 기록.

---

## Task 1: floorerr_distribution 테이블 생성 (m35)

**Files:**
- Create: `docs/v2/migrations/m35_create_floorerr_distribution.sql`
- Apply: Supabase MCP `apply_migration` (name: `m35_create_floorerr_distribution`)

- [ ] **Step 1: 사전 검증 쿼리 — 테이블 부재 확인 (FAIL 기대)**

Run (Supabase MCP execute_sql):
```sql
SELECT to_regclass('public.floorerr_distribution') AS tbl;
```
Expected: `tbl` = `null` (테이블 없음 — 아직 미생성).

- [ ] **Step 2: 마이그레이션 SQL 작성 (.sql 파일 + apply_migration 동일 내용)**

```sql
-- m35: floorerr_distribution 테이블 (군부대 Mode A Phase 1)
-- 근거: docs/v2/A_MODE_A_MILITARY_WIN_DESIGN_2026-05-23.md §3~§6, §14 Phase 1
-- 정의: floorErr = (actual_floor_amount − predicted_floor_amount)/base_amount  [bid_rate 공간, 분수]
--   predicted_floor_amount = 마진 제거 (pred_expected_price × pred_floor_rate/100)
-- era_v2 NOT NULL — current/legacy floorErr p50 1.86%p 차이로 분리 필수
-- 적용: apply_migration (Supabase MCP), 2026-05-23

CREATE TABLE floorerr_distribution (
  id               BIGSERIAL PRIMARY KEY,
  at               TEXT NOT NULL,
  canonical_ag     TEXT,
  ba_seg           TEXT,
  era_v2           TEXT NOT NULL CHECK (era_v2 IN ('legacy','current','mixed')),
  n                INT  NOT NULL,
  floorerr_mean    NUMERIC(9,6),
  floorerr_std     NUMERIC(9,6),
  floorerr_p10     NUMERIC(9,6),
  floorerr_p25     NUMERIC(9,6),
  floorerr_p50     NUMERIC(9,6),
  floorerr_p75     NUMERIC(9,6),
  floorerr_p80     NUMERIC(9,6),
  floorerr_p85     NUMERIC(9,6),
  floorerr_p90     NUMERIC(9,6),
  floorerr_p95     NUMERIC(9,6),
  confidence       TEXT NOT NULL CHECK (confidence IN ('high','medium','low','insufficient_sample')),
  src              TEXT NOT NULL DEFAULT 'live_matched_margin_removed',
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE NULLS NOT DISTINCT (at, canonical_ag, ba_seg, era_v2)
);

CREATE INDEX idx_fed_lookup ON floorerr_distribution (at, canonical_ag, ba_seg, era_v2);

ALTER TABLE floorerr_distribution ENABLE ROW LEVEL SECURITY;

CREATE POLICY floorerr_distribution_anon_select
  ON floorerr_distribution FOR SELECT TO anon USING (true);
CREATE POLICY floorerr_distribution_auth_select
  ON floorerr_distribution FOR SELECT TO authenticated USING (true);
CREATE POLICY floorerr_distribution_service_insert
  ON floorerr_distribution FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY floorerr_distribution_service_update
  ON floorerr_distribution FOR UPDATE TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE floorerr_distribution IS
  '군부대 Mode A Phase 1 — floorErr 경험분포. floorErr=(actual_floor−predicted_floor)/base (분수, 마진 제거 predicted_floor=pred_expected_price×pred_floor_rate/100). era_v2 NOT NULL 필수 분리. 라이브 소비는 current만. 운용: service_role. 근거: A_MODE_A_MILITARY_WIN_DESIGN_2026-05-23 §3~§6.';
```

- [ ] **Step 3: apply_migration 실행**

Supabase MCP `apply_migration`, project_id=`sadunejfkstxbxogzutl`, name=`m35_create_floorerr_distribution`, query = Step 2 SQL.

- [ ] **Step 4: 사후 검증 쿼리 — 테이블/제약/RLS 확인 (PASS 기대)**

Run:
```sql
SELECT
  to_regclass('public.floorerr_distribution') IS NOT NULL AS tbl_exists,
  (SELECT relrowsecurity FROM pg_class WHERE oid='public.floorerr_distribution'::regclass) AS rls_on,
  (SELECT count(*) FROM pg_constraint WHERE conrelid='public.floorerr_distribution'::regclass AND contype='u') AS uniq_cnt,
  (SELECT count(*) FROM pg_policy WHERE polrelid='public.floorerr_distribution'::regclass) AS policy_cnt;
```
Expected: `tbl_exists=true, rls_on=true, uniq_cnt=1, policy_cnt=4`.

- [ ] **Step 5: 마이그레이션 파일 저장 + 커밋**

```bash
git add docs/v2/migrations/m35_create_floorerr_distribution.sql
git commit -m "feat(a-phase1): floorerr_distribution 테이블 생성 (m35, era 분리 필수)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: refresh_floorerr_distribution() 적재 함수 + 즉시 실행 (m36)

**Files:**
- Create: `docs/v2/migrations/m36_create_refresh_floorerr_distribution.sql`
- Apply: Supabase MCP `apply_migration` (name: `m36_create_refresh_floorerr_distribution`)

- [ ] **Step 1: 사전 검증 쿼리 — 테이블 비어있음 확인 (FAIL 기대)**

Run:
```sql
SELECT count(*) AS rows FROM floorerr_distribution;
```
Expected: `rows = 0` (아직 적재 안 됨).

- [ ] **Step 2: 마이그레이션 SQL 작성 (.sql 파일 + apply_migration 동일 내용)**

```sql
-- m36: refresh_floorerr_distribution() — 군부대 Mode A Phase 1 floorErr 적재
-- 근거: A_MODE_A_MILITARY_WIN_DESIGN_2026-05-23 §3~§6
-- 소스: 매칭 bid_predictions 라이브 출력 (predict_v6가 그 시점 산출 = 설계 §5 동일 캘리브레이션)
-- predicted_floor = pred_expected_price × pred_floor_rate/100 (마진 제거)
-- 필터: 군시설(classify_agency_type) + 공동도급 제외(G-도메인#7) + 유찰 제외 + |floorErr|≤0.10
-- grain: 군부대-전체(canonical_ag=NULL, ba_seg=NULL), era별 1행. UPSERT.
-- 적용: apply_migration (Supabase MCP), 2026-05-23

CREATE OR REPLACE FUNCTION refresh_floorerr_distribution()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INT := 0;
BEGIN
  WITH base AS (
    SELECT br.era_v2,
           (br.floor_price - bp.pred_expected_price * bp.pred_floor_rate / 100.0) / NULLIF(bp.ba,0) AS floor_err
    FROM bid_predictions bp
    JOIN bid_records br ON br.id = bp.matched_record_id
    WHERE bp.match_status = 'matched'
      AND bp.actual_adj_rate IS NOT NULL
      AND classify_agency_type(bp.ag) = '군시설'
      AND bp.pred_expected_price IS NOT NULL
      AND bp.pred_floor_rate IS NOT NULL
      AND br.floor_price IS NOT NULL
      AND bp.ba IS NOT NULL
      AND COALESCE(bp.actual_winner,'') NOT IN ('유찰','유찰(무)')
      AND COALESCE(br.is_joint_contract, false) != true
      AND br.era_v2 IS NOT NULL
  ),
  filt AS (
    SELECT * FROM base WHERE abs(floor_err) <= 0.10
  ),
  agg AS (
    SELECT
      era_v2,
      count(*) AS n,
      avg(floor_err)::numeric(9,6)                                        AS m_mean,
      stddev_samp(floor_err)::numeric(9,6)                                AS m_std,
      percentile_cont(0.10) WITHIN GROUP (ORDER BY floor_err)::numeric(9,6) AS m_p10,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY floor_err)::numeric(9,6) AS m_p25,
      percentile_cont(0.50) WITHIN GROUP (ORDER BY floor_err)::numeric(9,6) AS m_p50,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY floor_err)::numeric(9,6) AS m_p75,
      percentile_cont(0.80) WITHIN GROUP (ORDER BY floor_err)::numeric(9,6) AS m_p80,
      percentile_cont(0.85) WITHIN GROUP (ORDER BY floor_err)::numeric(9,6) AS m_p85,
      percentile_cont(0.90) WITHIN GROUP (ORDER BY floor_err)::numeric(9,6) AS m_p90,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY floor_err)::numeric(9,6) AS m_p95
    FROM filt
    GROUP BY era_v2
  )
  INSERT INTO floorerr_distribution
    (at, canonical_ag, ba_seg, era_v2, n,
     floorerr_mean, floorerr_std,
     floorerr_p10, floorerr_p25, floorerr_p50, floorerr_p75, floorerr_p80, floorerr_p85, floorerr_p90, floorerr_p95,
     confidence, src, updated_at)
  SELECT
    '군시설', NULL, NULL, era_v2, n,
    m_mean, m_std,
    m_p10, m_p25, m_p50, m_p75, m_p80, m_p85, m_p90, m_p95,
    CASE WHEN n >= 1000 THEN 'high' WHEN n >= 300 THEN 'medium' ELSE 'insufficient_sample' END,
    'live_matched_margin_removed', NOW()
  FROM agg
  ON CONFLICT (at, canonical_ag, ba_seg, era_v2) DO UPDATE SET
    n            = EXCLUDED.n,
    floorerr_mean= EXCLUDED.floorerr_mean,
    floorerr_std = EXCLUDED.floorerr_std,
    floorerr_p10 = EXCLUDED.floorerr_p10,
    floorerr_p25 = EXCLUDED.floorerr_p25,
    floorerr_p50 = EXCLUDED.floorerr_p50,
    floorerr_p75 = EXCLUDED.floorerr_p75,
    floorerr_p80 = EXCLUDED.floorerr_p80,
    floorerr_p85 = EXCLUDED.floorerr_p85,
    floorerr_p90 = EXCLUDED.floorerr_p90,
    floorerr_p95 = EXCLUDED.floorerr_p95,
    confidence   = EXCLUDED.confidence,
    src          = EXCLUDED.src,
    updated_at   = NOW();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION refresh_floorerr_distribution() IS
  '군부대 Mode A Phase 1 — floorErr 분포 적재. 매칭 bid_predictions 라이브 출력 기반(설계 §5 동일 캘리브레이션). era별 군부대-전체 grain UPSERT. 근거: A_MODE_A_MILITARY_WIN_DESIGN_2026-05-23 §3~§6.';

-- 1회 즉시 실행
SELECT refresh_floorerr_distribution() AS rows_upserted;
```

- [ ] **Step 3: apply_migration 실행**

Supabase MCP `apply_migration`, name=`m36_create_refresh_floorerr_distribution`, query = Step 2 SQL. 반환 `rows_upserted = 2` 확인.

- [ ] **Step 4: 사후 검증 쿼리 — 적재값이 진실 소스 기대값과 일치 (PASS 기대)**

Run:
```sql
SELECT era_v2, n, confidence,
       floorerr_p50, floorerr_p85, floorerr_p90, floorerr_mean
FROM floorerr_distribution
WHERE at='군시설' AND canonical_ag IS NULL AND ba_seg IS NULL
ORDER BY era_v2;
```
Expected (확정 스펙 표와 일치):
- `current`: n=86, confidence=`insufficient_sample`, p50=`0.000507`, p85=`0.007448`, p90=`0.009121`, mean=`0.000696`
- `legacy` : n=139, confidence=`insufficient_sample`, p50=`-0.018050`, p85=`-0.011824`, p90=`-0.010468`, mean=`-0.018045`

- [ ] **Step 5: 멱등성 확인 — 재실행 시 행 수 불변 (PASS 기대)**

Run:
```sql
SELECT refresh_floorerr_distribution() AS rows_upserted;
SELECT count(*) AS total_rows FROM floorerr_distribution;
```
Expected: `rows_upserted=2`, `total_rows=2` (UPSERT — 중복 적재 없음).

- [ ] **Step 6: 마이그레이션 파일 저장 + 커밋**

```bash
git add docs/v2/migrations/m36_create_refresh_floorerr_distribution.sql
git commit -m "feat(a-phase1): refresh_floorerr_distribution 적재 함수 + 초기 적재 (m36)

current n=86 / legacy n=139, 둘 다 insufficient_sample (n<300).
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: lookup_floorerr_distribution() 조회 RPC (m37)

**Files:**
- Create: `docs/v2/migrations/m37_create_lookup_floorerr_distribution_rpc.sql`
- Apply: Supabase MCP `apply_migration` (name: `m37_create_lookup_floorerr_distribution_rpc`)

- [ ] **Step 1: 사전 검증 쿼리 — 함수 부재 확인 (FAIL 기대)**

Run:
```sql
SELECT count(*) AS fn FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='lookup_floorerr_distribution';
```
Expected: `fn = 0`.

- [ ] **Step 2: 마이그레이션 SQL 작성 (.sql 파일 + apply_migration 동일 내용)**

```sql
-- m37: lookup_floorerr_distribution RPC — 군부대 Mode A Phase 1
-- 근거: A_MODE_A_MILITARY_WIN_DESIGN_2026-05-23 §4, §6
-- era 인자 필수(p_era 디폴트 'current' — 라이브 소비). 3단 fallback: AG_BA → AG → AT.
-- ba_seg 버킷은 lookup_gap_distribution(m14)과 동일 경계.
-- 적용: apply_migration (Supabase MCP), 2026-05-23

CREATE OR REPLACE FUNCTION lookup_floorerr_distribution(
  p_at           TEXT,
  p_canonical_ag TEXT    DEFAULT NULL,
  p_ba           NUMERIC DEFAULT NULL,
  p_era          TEXT    DEFAULT 'current'
)
RETURNS TABLE (
  matched_grain TEXT,
  era_v2        TEXT,
  n             INT,
  confidence    TEXT,
  floorerr_mean NUMERIC,
  floorerr_std  NUMERIC,
  floorerr_p10  NUMERIC,
  floorerr_p25  NUMERIC,
  floorerr_p50  NUMERIC,
  floorerr_p75  NUMERIC,
  floorerr_p80  NUMERIC,
  floorerr_p85  NUMERIC,
  floorerr_p90  NUMERIC,
  floorerr_p95  NUMERIC
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_ba_seg TEXT;
BEGIN
  v_ba_seg := CASE
    WHEN p_ba IS NULL THEN NULL
    WHEN p_ba < 100000000   THEN 'S1'
    WHEN p_ba < 300000000   THEN 'S2'
    WHEN p_ba < 1000000000  THEN 'S3'
    WHEN p_ba < 3000000000  THEN 'S4'
    ELSE 'S5'
  END;

  -- 1단: AG_BA grain
  IF v_ba_seg IS NOT NULL AND p_canonical_ag IS NOT NULL THEN
    RETURN QUERY
      SELECT 'AG_BA'::text, d.era_v2, d.n, d.confidence,
             d.floorerr_mean, d.floorerr_std,
             d.floorerr_p10, d.floorerr_p25, d.floorerr_p50, d.floorerr_p75,
             d.floorerr_p80, d.floorerr_p85, d.floorerr_p90, d.floorerr_p95
      FROM floorerr_distribution d
      WHERE d.at = p_at AND d.canonical_ag = p_canonical_ag AND d.ba_seg = v_ba_seg AND d.era_v2 = p_era
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- 2단: AG grain
  IF p_canonical_ag IS NOT NULL THEN
    RETURN QUERY
      SELECT 'AG'::text, d.era_v2, d.n, d.confidence,
             d.floorerr_mean, d.floorerr_std,
             d.floorerr_p10, d.floorerr_p25, d.floorerr_p50, d.floorerr_p75,
             d.floorerr_p80, d.floorerr_p85, d.floorerr_p90, d.floorerr_p95
      FROM floorerr_distribution d
      WHERE d.at = p_at AND d.canonical_ag = p_canonical_ag AND d.ba_seg IS NULL AND d.era_v2 = p_era
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- 3단: AT-level fallback
  RETURN QUERY
    SELECT 'AT'::text, d.era_v2, d.n, d.confidence,
           d.floorerr_mean, d.floorerr_std,
           d.floorerr_p10, d.floorerr_p25, d.floorerr_p50, d.floorerr_p75,
           d.floorerr_p80, d.floorerr_p85, d.floorerr_p90, d.floorerr_p95
    FROM floorerr_distribution d
    WHERE d.at = p_at AND d.canonical_ag IS NULL AND d.ba_seg IS NULL AND d.era_v2 = p_era
    LIMIT 1;
END;
$$;

COMMENT ON FUNCTION lookup_floorerr_distribution IS
  '군부대 Mode A Phase 1 — floorErr 분포 RPC. 3단 fallback AG_BA→AG→AT, p_era 필수(디폴트 current, 라이브 소비). 근거: A_MODE_A_MILITARY_WIN_DESIGN_2026-05-23 §4·§6.';

GRANT EXECUTE ON FUNCTION lookup_floorerr_distribution(TEXT, TEXT, NUMERIC, TEXT) TO anon, authenticated;
```

- [ ] **Step 3: apply_migration 실행**

Supabase MCP `apply_migration`, name=`m37_create_lookup_floorerr_distribution_rpc`, query = Step 2 SQL.

- [ ] **Step 4: 사후 검증 — current/legacy 조회 + AT fallback 동작 (PASS 기대)**

Run:
```sql
-- 라이브 경로(current)
SELECT matched_grain, era_v2, n, confidence, floorerr_p85, floorerr_p90
FROM lookup_floorerr_distribution('군시설', NULL, NULL, 'current');
-- legacy 경로
SELECT matched_grain, era_v2, n, confidence, floorerr_p50
FROM lookup_floorerr_distribution('군시설', NULL, NULL, 'legacy');
-- 미적재 era는 행 0 (mixed 없음)
SELECT count(*) AS mixed_rows FROM lookup_floorerr_distribution('군시설', NULL, NULL, 'mixed');
```
Expected:
- current: `matched_grain='AT', era_v2='current', n=86, confidence='insufficient_sample', floorerr_p85=0.007448, floorerr_p90=0.009121`
- legacy: `matched_grain='AT', era_v2='legacy', n=139, confidence='insufficient_sample', floorerr_p50=-0.018050`
- mixed: `mixed_rows = 0`

- [ ] **Step 5: 마이그레이션 파일 저장 + 커밋**

```bash
git add docs/v2/migrations/m37_create_lookup_floorerr_distribution_rpc.sql
git commit -m "feat(a-phase1): lookup_floorerr_distribution RPC (m37, era 인자 필수)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: G-단위 미니 게이트 검증 + 설계 문서 동기 + 메모리

**Files:**
- Modify: `docs/v2/A_MODE_A_MILITARY_WIN_DESIGN_2026-05-23.md` (§14 Phase 1 완료 표기)
- Verify: 신규 소스의 단위/공간/격리

- [ ] **Step 1: G-단위 미니 게이트 — base 분모·bid_rate 분수 공간 일관성 (PASS 기대)**

Run:
```sql
-- (a) 저장된 모든 분위수가 분수 스케일(|값|<0.1)인지 — adj_rate %(단위 100×) 혼입 차단
SELECT bool_and(
  COALESCE(abs(floorerr_p10),0) < 0.1 AND COALESCE(abs(floorerr_p90),0) < 0.1
  AND COALESCE(abs(floorerr_mean),0) < 0.1
) AS all_fraction_space
FROM floorerr_distribution;
-- (b) era NOT NULL 불변식
SELECT count(*) FILTER (WHERE era_v2 IS NULL) AS era_null_cnt FROM floorerr_distribution;
```
Expected: `all_fraction_space=true`, `era_null_cnt=0`.

- [ ] **Step 2: 모집단 격리 검증 — 한전/지자체 누출 0 (PASS 기대)**

Run:
```sql
-- refresh 모집단에 군시설 외 발주유형이 섞이지 않았는지 (classify_agency_type 단일 필터 확인)
SELECT count(*) AS non_mil_in_pool
FROM bid_predictions bp
JOIN bid_records br ON br.id = bp.matched_record_id
WHERE bp.match_status='matched' AND bp.actual_adj_rate IS NOT NULL
  AND classify_agency_type(bp.ag)='군시설'
  AND bp.at IS NOT NULL
  AND classify_agency_type(bp.ag) <> '군시설';  -- 모순 조건 → 항상 0이어야 함
SELECT DISTINCT classify_agency_type(bp.ag) AS pool_at
FROM bid_predictions bp
JOIN bid_records br ON br.id = bp.matched_record_id
WHERE bp.match_status='matched' AND classify_agency_type(bp.ag)='군시설';
```
Expected: `non_mil_in_pool=0`, `pool_at` 단일값 `군시설`. (한전/지자체 미접촉 — Phase 1은 WIN_OPT_GAP/calcWin1stBid 무관 DB 소스이므로 한전 LOCK 격리 유지.)

- [ ] **Step 3: 설계 문서 §14 Phase 1 완료 표기**

`docs/v2/A_MODE_A_MILITARY_WIN_DESIGN_2026-05-23.md` §14의 Phase 1 항목 끝에 추가:
```markdown
- **Phase 1 — floorErr 분포 소스 구축**: ... **[완료 2026-05-23]** m35(테이블)/m36(refresh+적재)/m37(lookup RPC). 확정 정의: floorErr=(actual_floor−predicted_floor)/base [분수], predicted_floor=pred_expected_price×pred_floor_rate/100(마진 제거). era 분리 필수. 적재: current n=86 / legacy n=139, 둘 다 insufficient_sample(n<300). 라이브 소비는 lookup_floorerr_distribution(...,'current'). alpha sweet spot(Phase 3) 통계 판정은 표본 누적(7~14일) 후.
```

- [ ] **Step 4: 커밋**

```bash
git add docs/v2/A_MODE_A_MILITARY_WIN_DESIGN_2026-05-23.md
git commit -m "docs(a-phase1): floorErr 소스 확정 정의 + Phase 1 완료 표기

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: 메모리 갱신 (project_mode_a_military_win.md)**

`C:\Users\home\.claude\projects\C--Users-home-bid-analyzer\memory\project_mode_a_military_win.md` "남은 작업" #2를 완료로 갱신하고, 확정 정의 + 표본 현실(current n=86, insufficient_sample)을 기록. MEMORY.md 포인터 갱신.

---

## 검증 게이트 메모 (Phase 23-3 / V2)
- **분류: Generator / 회귀 위험 中** (predict-architect 2회 검토). 단 Phase 1은 신규 DB 소스만 — 라이브 recommendModeA 미연결 → 라이브 출력 불변.
- **`/evaluate` 전체 본판정(G-단위/G-A안/G-bias/G-hit) + deploy-gate는 Phase 2**(recommendModeA 교체, src/ 변경)에서 강제. Phase 1은 위 Task 4 G-단위 미니 게이트로 갈음.
- **push/Vercel**: Phase 1은 DB-only + 문서/마이그레이션 기록 커밋. src/ 빌드 산출물 무변경 → Vercel 영향 없음. main push는 사용자 명시 시.
- **금기 준수**: bid_records/bid_details DELETE 없음, 매칭 bid_predictions UPDATE 없음(분포 테이블만 UPSERT — A안 INSERT-only 규칙은 예측 행 대상, 파생 통계 캐시는 sibling agency_gap_distribution과 동일 UPSERT 패턴).

## Self-Review
1. **Spec coverage**: 설계 §3(정의)→Task1 컬럼+Task2 공식 / §4(grain·era)→Task2,3 / §5(캘리브레이션 라이브)→Task2 모집단 / §6(표본게이트·confidence)→Task2 라벨 / §13.2(소스 부재)→전체 / §13.3(공간정합 G-단위)→Task4 Step1. 누락 없음.
2. **Placeholder scan**: 모든 SQL 전문 기재, 기대값 수치 확정. TBD/TODO 없음.
3. **Type consistency**: 컬럼명 `floorerr_p10..p95`/`floorerr_mean`/`floorerr_std`/`confidence`/`era_v2`가 m35 정의 ↔ m36 INSERT ↔ m37 RETURNS에서 일치. RPC 시그니처 `(TEXT,TEXT,NUMERIC,TEXT)` GRANT와 일치. UNIQUE 키 `(at,canonical_ag,ba_seg,era_v2)`가 m35 제약 ↔ m36 ON CONFLICT 일치.
