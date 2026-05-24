# near-floor exposure 가드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `win_zone_daily`에 하한 마진(`my_bid_rate − floor_rate`) 밀집도 지표를 추가하고 `mode_gate_report`의 2차 가드로 연동해 cliff-riding/실격 위험을 감지한다.

**Architecture:** 전부 Supabase Postgres DDL/함수/pg_cron 변경. 신규 지표는 `bid_rate` 공간(`/evaluate` G-단위 PASS), 예측 로직 무관. 기존 인프라(`win_zone_daily`, `refresh_win_zone_daily`, `mode_gate_report`, cron m16/m12) 확장 — 신규 테이블 없음. 1차 KPI 불변, 가드는 `pass→warn`만 강등.

**Tech Stack:** Supabase Postgres, pg_cron, `apply_migration`/`execute_sql` (MCP). SQL 마이그레이션은 `docs/v2/migrations/`에 보존. 테스트 = `execute_sql` 검증 쿼리(코드 단위테스트 불가).

**선행 설계:** `docs/superpowers/specs/2026-05-24-near-floor-exposure-guard-design.md`

> **주의:** 라이브 Supabase DB 변경. 전부 가산적·되돌리기 가능(ADD COLUMN, CREATE OR REPLACE, cron 재등록). 1차 게이트·예측·앱 동작 불변. 적용은 service_role(MCP).

---

## 파일 구조

| 파일 | 책임 | 작업 |
|---|---|---|
| `db/migrations/m28_near_floor_exposure.sql` | 전체 마이그레이션 보존(ALTER+함수+cron) | Create |

DB 객체(win_zone_daily, refresh_win_zone_daily, mode_gate_report, cron jobs)는 git에 없으므로 SQL 파일로만 보존. 적용은 MCP.

> 마이그레이션 경로 주의: 기존 V2 마이그레이션은 `docs/v2/migrations/`에 있으나, 본 계획은 다른 세션 산출물과 일관되게 `db/migrations/`(updated_at 마이그레이션과 동일 위치)에 둔다. 한 곳으로 통일하고 싶으면 실행자가 `docs/v2/migrations/`로 변경 가능 — 경로만 일관되면 됨.

---

## Task 1: 마이그레이션 SQL 파일 작성

**Files:** Create `db/migrations/m28_near_floor_exposure.sql`

- [ ] **Step 1: 파일 작성 (전체 SQL)**

`db/migrations/m28_near_floor_exposure.sql`:
```sql
-- m28: near-floor exposure 가드 (하한 마진 밀집도)
-- 설계: docs/superpowers/specs/2026-05-24-near-floor-exposure-guard-design.md
-- bid_rate 공간 (my_bid_rate − floor_rate, pp). /evaluate G-단위 PASS. 예측 로직 무관.
-- 적용: Supabase apply_migration (service_role). 가산적·되돌리기 가능.

-- ── (1) win_zone_daily 컬럼 추가 ────────────────────────────
ALTER TABLE win_zone_daily
  ADD COLUMN IF NOT EXISTS near_floor_qual_n        int,
  ADD COLUMN IF NOT EXISTS pct_below_floor          numeric(6,2),
  ADD COLUMN IF NOT EXISTS pct_near_floor_001       numeric(6,2),
  ADD COLUMN IF NOT EXISTS pct_near_floor_003       numeric(6,2),
  ADD COLUMN IF NOT EXISTS pct_near_floor_005       numeric(6,2),
  ADD COLUMN IF NOT EXISTS floor_margin_avg_pp      numeric(10,6),
  ADD COLUMN IF NOT EXISTS floor_margin_median_pp   numeric(10,6),
  ADD COLUMN IF NOT EXISTS floor_margin_p10_pp      numeric(10,6),
  ADD COLUMN IF NOT EXISTS pct_floor_margin_neg_001 numeric(6,2);

-- ── (2) mode_gate_report 컬럼 추가 ──────────────────────────
ALTER TABLE mode_gate_report
  ADD COLUMN IF NOT EXISTS near_floor_pct_005      numeric(6,4),  -- 0~1 (kpi_value 스케일)
  ADD COLUMN IF NOT EXISTS near_floor_qual_n       int,
  ADD COLUMN IF NOT EXISTS near_floor_guard_status text
    CHECK (near_floor_guard_status IN ('pass','warn','insufficient_sample'));

-- ── (3) refresh_win_zone_daily 재정의 (near-floor 9컬럼 추가) ──
CREATE OR REPLACE FUNCTION public.refresh_win_zone_daily(
    p_since date DEFAULT ((CURRENT_DATE - '90 days'::interval))::date,
    p_until date DEFAULT CURRENT_DATE)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_inserted INT := 0;
  v_rows     INT;
BEGIN
  -- 슬라이스 1: overall (at=NULL)
  INSERT INTO win_zone_daily
    (measured_on, at, canonical_ag, n,
     pct_pass_floor, pct_pass_top1, pct_in_win_zone,
     avg_gap, median_gap, p90_gap,
     near_floor_qual_n, pct_below_floor,
     pct_near_floor_001, pct_near_floor_003, pct_near_floor_005,
     floor_margin_avg_pp, floor_margin_median_pp, floor_margin_p10_pp,
     pct_floor_margin_neg_001)
  SELECT
    p_until, NULL::text, NULL::text,
    COUNT(*)::int,
    ROUND(100.0 * SUM(CASE WHEN d.my_bid_rate >= d.floor_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(100.0 * SUM(CASE WHEN d.my_bid_rate < d.win_bid_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(100.0 * SUM(CASE WHEN d.my_bid_rate >= d.floor_rate AND d.my_bid_rate < d.win_bid_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(AVG(d.win_bid_rate - d.floor_rate)::numeric, 4),
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.win_bid_rate - d.floor_rate)::numeric, 4),
    ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY d.win_bid_rate - d.floor_rate)::numeric, 4),
    -- near-floor (margin = my_bid_rate − floor_rate)
    COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate >= 0)::int,
    ROUND(100.0 * COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate < 0)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(100.0 * COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate BETWEEN 0 AND 0.001)::numeric / NULLIF(COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate >= 0),0), 2),
    ROUND(100.0 * COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate BETWEEN 0 AND 0.003)::numeric / NULLIF(COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate >= 0),0), 2),
    ROUND(100.0 * COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate BETWEEN 0 AND 0.005)::numeric / NULLIF(COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate >= 0),0), 2),
    ROUND(AVG(d.my_bid_rate - d.floor_rate)::numeric, 6),
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.my_bid_rate - d.floor_rate)::numeric, 6),
    ROUND(PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY d.my_bid_rate - d.floor_rate)::numeric, 6),
    ROUND(100.0 * COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate < 0 AND d.my_bid_rate - d.floor_rate >= -0.001)::numeric / NULLIF(COUNT(*),0), 2)
  FROM bid_details d
  LEFT JOIN bid_records r ON r.pn_no = d.pn_no
  WHERE d.my_bid_rate IS NOT NULL AND d.win_bid_rate IS NOT NULL AND d.floor_rate IS NOT NULL
    AND d.od BETWEEN p_since AND p_until
    AND COALESCE(r.is_joint_contract, false) != true
    AND COALESCE(r.era_v2, 'current') = 'current'
    AND ABS(d.win_bid_rate - d.floor_rate) <= 5
    AND COALESCE(r.is_duplicate, false) = false
  HAVING COUNT(*) >= 5
  ON CONFLICT (measured_on, at, canonical_ag) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_inserted := v_inserted + v_rows;

  -- 슬라이스 2: per-at
  INSERT INTO win_zone_daily
    (measured_on, at, canonical_ag, n,
     pct_pass_floor, pct_pass_top1, pct_in_win_zone,
     avg_gap, median_gap, p90_gap,
     near_floor_qual_n, pct_below_floor,
     pct_near_floor_001, pct_near_floor_003, pct_near_floor_005,
     floor_margin_avg_pp, floor_margin_median_pp, floor_margin_p10_pp,
     pct_floor_margin_neg_001)
  SELECT
    p_until, d.at, NULL::text,
    COUNT(*)::int,
    ROUND(100.0 * SUM(CASE WHEN d.my_bid_rate >= d.floor_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(100.0 * SUM(CASE WHEN d.my_bid_rate < d.win_bid_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(100.0 * SUM(CASE WHEN d.my_bid_rate >= d.floor_rate AND d.my_bid_rate < d.win_bid_rate THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(AVG(d.win_bid_rate - d.floor_rate)::numeric, 4),
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.win_bid_rate - d.floor_rate)::numeric, 4),
    ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY d.win_bid_rate - d.floor_rate)::numeric, 4),
    COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate >= 0)::int,
    ROUND(100.0 * COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate < 0)::numeric / NULLIF(COUNT(*),0), 2),
    ROUND(100.0 * COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate BETWEEN 0 AND 0.001)::numeric / NULLIF(COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate >= 0),0), 2),
    ROUND(100.0 * COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate BETWEEN 0 AND 0.003)::numeric / NULLIF(COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate >= 0),0), 2),
    ROUND(100.0 * COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate BETWEEN 0 AND 0.005)::numeric / NULLIF(COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate >= 0),0), 2),
    ROUND(AVG(d.my_bid_rate - d.floor_rate)::numeric, 6),
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY d.my_bid_rate - d.floor_rate)::numeric, 6),
    ROUND(PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY d.my_bid_rate - d.floor_rate)::numeric, 6),
    ROUND(100.0 * COUNT(*) FILTER (WHERE d.my_bid_rate - d.floor_rate < 0 AND d.my_bid_rate - d.floor_rate >= -0.001)::numeric / NULLIF(COUNT(*),0), 2)
  FROM bid_details d
  LEFT JOIN bid_records r ON r.pn_no = d.pn_no
  WHERE d.my_bid_rate IS NOT NULL AND d.win_bid_rate IS NOT NULL AND d.floor_rate IS NOT NULL
    AND d.at IS NOT NULL AND d.od BETWEEN p_since AND p_until
    AND COALESCE(r.is_joint_contract, false) != true
    AND COALESCE(r.era_v2, 'current') = 'current'
    AND ABS(d.win_bid_rate - d.floor_rate) <= 5
    AND COALESCE(r.is_duplicate, false) = false
  GROUP BY d.at
  HAVING COUNT(*) >= 3
  ON CONFLICT (measured_on, at, canonical_ag) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_inserted := v_inserted + v_rows;

  RETURN v_inserted;
END;
$function$;

-- ── (4) 최신 행 즉시 활성화 (ON CONFLICT DO NOTHING 우회) ──
DELETE FROM win_zone_daily WHERE measured_on = CURRENT_DATE;
SELECT refresh_win_zone_daily();

-- ── (5) cron 재정의: Mode A 주간 게이트 (near-floor 가드 A>40%) ──
SELECT cron.unschedule('v2_modeA_weekly_gate');
SELECT cron.schedule(
  'v2_modeA_weekly_gate',
  '15 1 * * 1',
  $$ INSERT INTO mode_gate_report
       (report_week, at, mode, primary_kpi_name, kpi_value, kpi_target, gate_status, dual_run_n, notes,
        near_floor_pct_005, near_floor_qual_n, near_floor_guard_status)
     SELECT
       date_trunc('week', CURRENT_DATE)::date, at, 'A', 'pct_in_win_zone',
       (pct_in_win_zone / 100.0)::numeric(6,4), 0.1500,
       CASE
         WHEN n < 10 THEN 'insufficient_sample'
         WHEN pct_in_win_zone >= 15.0 AND near_floor_qual_n >= 30 AND pct_near_floor_005 > 40.0 THEN 'warn'
         WHEN pct_in_win_zone >= 15.0 THEN 'pass'
         WHEN pct_in_win_zone >= 10.0 THEN 'warn'
         ELSE 'fail'
       END,
       n,
       'weekly cron auto Mode A — gap_p90=' || p90_gap::text || ' nf005=' || COALESCE(pct_near_floor_005::text,'NA'),
       (pct_near_floor_005 / 100.0)::numeric(6,4), near_floor_qual_n,
       CASE WHEN near_floor_qual_n IS NULL OR near_floor_qual_n < 30 THEN 'insufficient_sample'
            WHEN pct_near_floor_005 > 40.0 THEN 'warn' ELSE 'pass' END
     FROM win_zone_daily
     WHERE at = '군시설'
       AND measured_on = (SELECT MAX(measured_on) FROM win_zone_daily WHERE at = '군시설')
     ON CONFLICT (report_week, at, mode) DO NOTHING; $$
);

-- ── (6) cron 재정의: Mode B 주간 게이트 (near-floor 가드 B>25%, win_zone 조인) ──
SELECT cron.unschedule('v2_modeB_weekly_gate');
SELECT cron.schedule(
  'v2_modeB_weekly_gate',
  '0 1 * * 1',
  $$ INSERT INTO mode_gate_report
       (report_week, at, mode, primary_kpi_name, kpi_value, kpi_target, gate_status, dual_run_n, notes,
        near_floor_pct_005, near_floor_qual_n, near_floor_guard_status)
     SELECT
       date_trunc('week', CURRENT_DATE)::date,
       COALESCE(fpd.at, '_overall_'), 'B', 'actual_floor_pass_rate',
       fpd.actual_floor_pass_rate, 0.9000,
       CASE
         WHEN fpd.n < 5 THEN 'insufficient_sample'
         WHEN fpd.actual_floor_pass_rate >= 0.90 AND wz.near_floor_qual_n >= 30 AND wz.pct_near_floor_005 > 25.0 THEN 'warn'
         WHEN fpd.actual_floor_pass_rate >= 0.90 THEN 'pass'
         WHEN fpd.actual_floor_pass_rate >= 0.80 THEN 'warn'
         ELSE 'fail'
       END,
       fpd.n,
       'weekly cron auto — gap=' || fpd.calibration_gap::text || ' nf005=' || COALESCE(wz.pct_near_floor_005::text,'NA'),
       (wz.pct_near_floor_005 / 100.0)::numeric(6,4), wz.near_floor_qual_n,
       CASE WHEN wz.near_floor_qual_n IS NULL OR wz.near_floor_qual_n < 30 THEN 'insufficient_sample'
            WHEN wz.pct_near_floor_005 > 25.0 THEN 'warn' ELSE 'pass' END
     FROM floor_pass_daily fpd
     LEFT JOIN win_zone_daily wz
       ON wz.at IS NOT DISTINCT FROM fpd.at
      AND wz.measured_on = (SELECT MAX(measured_on) FROM win_zone_daily)
     WHERE fpd.model_version = 'v2_modeB_real'
       AND fpd.measured_on = (SELECT MAX(measured_on) FROM floor_pass_daily WHERE model_version = 'v2_modeB_real')
     ON CONFLICT (report_week, at, mode) DO NOTHING; $$
);
```

- [ ] **Step 2: Commit**
```bash
git add db/migrations/m28_near_floor_exposure.sql
git commit -m "feat(db): m28 near-floor exposure 마이그레이션 SQL (보존)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 컬럼 추가 적용 (win_zone_daily + mode_gate_report)

- [ ] **Step 1: ALTER 적용** — MCP `apply_migration`(name `m28a_near_floor_columns`)로 m28 SQL의 (1)(2) 블록 실행.

- [ ] **Step 2: 검증**
```sql
SELECT count(*) FILTER (WHERE column_name LIKE '%near_floor%' OR column_name LIKE '%floor_margin%') AS wz_new
FROM information_schema.columns WHERE table_name='win_zone_daily';
SELECT count(*) FILTER (WHERE column_name LIKE '%near_floor%') AS mgr_new
FROM information_schema.columns WHERE table_name='mode_gate_report';
```
Expected: `wz_new = 9`, `mgr_new = 3`.

---

## Task 3: refresh 함수 재정의 + 최신 행 활성화

- [ ] **Step 1: 함수 재정의 적용** — m28 SQL의 (3) 블록을 `apply_migration`(name `m28b_refresh_winzone`)로 실행.

- [ ] **Step 2: 최신 행 활성화** — m28 (4) 블록 실행:
```sql
DELETE FROM win_zone_daily WHERE measured_on = CURRENT_DATE;
SELECT refresh_win_zone_daily();
```
Expected: 양의 정수 반환(삽입 행수, overall+at 슬라이스).

- [ ] **Step 3: near-floor 컬럼 채워짐 검증**
```sql
SELECT at, n, near_floor_qual_n, pct_below_floor,
       pct_near_floor_001, pct_near_floor_003, pct_near_floor_005,
       floor_margin_median_pp, floor_margin_p10_pp, pct_floor_margin_neg_001
FROM win_zone_daily
WHERE measured_on = (SELECT MAX(measured_on) FROM win_zone_daily)
ORDER BY at NULLS FIRST;
```
Expected: 최신 날짜 모든 슬라이스(overall+각 at)에 신규 컬럼 채워짐. sanity: `pct_near_floor_005` ∈ [0,100] 또는 NULL(분모0), `near_floor_qual_n ≤ n`, `pct_near_floor_001 ≤ pct_near_floor_003 ≤ pct_near_floor_005`(단조), `pct_below_floor + (적격%) ≈ 100`.

---

## Task 4: cron 재정의 (Mode A + Mode B 가드 연동)

- [ ] **Step 1: cron 재정의 적용** — m28 SQL의 (5)(6) 블록을 `execute_sql`로 실행(unschedule→schedule ×2). `apply_migration`은 트랜잭션이라 cron.schedule과 충돌 가능 → `execute_sql` 사용.

- [ ] **Step 2: cron 등록 검증**
```sql
SELECT jobname, schedule, active FROM cron.job
WHERE jobname IN ('v2_modeA_weekly_gate','v2_modeB_weekly_gate') ORDER BY jobname;
```
Expected: 두 잡 모두 `active=true`, schedule 각 `15 1 * * 1` / `0 1 * * 1`.

---

## Task 5: 주간 게이트 수동 실행 + 가드 동작 검증 + 최종 검증

- [ ] **Step 1: Mode A 주간 게이트 수동 실행** — m28 (5)의 INSERT 본문(cron $$ 안)을 직접 `execute_sql`로 1회 실행(이번 주 행 생성). 이미 이번 주 행 있으면 `DELETE FROM mode_gate_report WHERE report_week=date_trunc('week',CURRENT_DATE)::date AND mode='A'` 후 재실행.

- [ ] **Step 2: Mode B 주간 게이트 수동 실행** — m28 (6)의 INSERT 본문 직접 실행(동일, mode='B').

- [ ] **Step 3: 가드 컬럼·상태 검증**
```sql
SELECT report_week, at, mode, primary_kpi_name, kpi_value, gate_status,
       near_floor_pct_005, near_floor_qual_n, near_floor_guard_status
FROM mode_gate_report
WHERE report_week = date_trunc('week', CURRENT_DATE)::date
ORDER BY mode, at;
```
Expected: Mode A(군시설) + Mode B(각 at + _overall_) 행에 `near_floor_*` 채워짐. `near_floor_guard_status` ∈ {pass,warn,insufficient_sample}. qual_n<30이면 guard=insufficient_sample이고 gate_status는 1차 판정 그대로(강등 없음).

- [ ] **Step 4: 가드 강등 로직 검증 (합성)** — 가드가 실제로 pass→warn 강등하는지 확인:
```sql
-- 최신 win_zone 한 행을 가드 임계 초과로 가정했을 때 gate_status 분기 확인 (읽기 전용 시뮬)
SELECT at, pct_in_win_zone, near_floor_qual_n, pct_near_floor_005,
  CASE
    WHEN n < 10 THEN 'insufficient_sample'
    WHEN pct_in_win_zone >= 15.0 AND near_floor_qual_n >= 30 AND pct_near_floor_005 > 40.0 THEN 'warn(guard)'
    WHEN pct_in_win_zone >= 15.0 THEN 'pass'
    WHEN pct_in_win_zone >= 10.0 THEN 'warn'
    ELSE 'fail' END AS would_be
FROM win_zone_daily
WHERE at='군시설' AND measured_on=(SELECT MAX(measured_on) FROM win_zone_daily WHERE at='군시설');
```
Expected: 분기식이 의도대로 평가됨(현재 데이터로 'pass' 또는 적절한 상태). 강등 경로 도달은 데이터 의존 — 로직 정상 평가 확인이 목적.

- [ ] **Step 5: /evaluate G-단위 sanity** — 신규 컬럼/cron이 adj_rate를 win-zone 정의에 쓰지 않는지 확인:
```sql
-- m28 SQL에 'adj_rate' / 'actual_adj_rate' 가 win-zone/near-floor 정의에 없는지 grep (로컬 파일)
```
Run: `grep -c "adj_rate" db/migrations/m28_near_floor_exposure.sql`
Expected: `0` (bid_rate 공간만 사용 → G-단위 PASS).

- [ ] **Step 6: 최종 커밋** (Task 1에서 파일 커밋했으면 생략, 검증 후 적용 결과 노트 추가 시)
```bash
git add db/migrations/m28_near_floor_exposure.sql
git commit -m "feat(db): m28 near-floor exposure 가드 적용·검증 완료

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>" || echo "no changes to commit"
```

---

## Self-Review 결과

**스펙 커버리지:** §3 정의→Task1 SQL(3)+Task3 검증 / §4.1 win_zone ALTER→Task2 / §4.2 refresh→Task3(+ON CONFLICT 우회 (4)) / §4.3 mode_gate ALTER→Task2 / §4.4 cron→Task4 / §5 게이트규칙→Task1(5)(6) CASE / §6 G-단위→Task5 Step5 / §7 롤아웃순서→Task2~5 / §8 검증→Task3/5. 누락 없음.

**플레이스홀더:** 없음. 전체 SQL·검증쿼리·기대값 명시.

**타입 일관성:** 컬럼명 win_zone_daily(near_floor_qual_n/pct_below_floor/pct_near_floor_001/003/005/floor_margin_avg/median/p10_pp/pct_floor_margin_neg_001) ↔ refresh INSERT/SELECT ↔ 검증쿼리 일치. mode_gate_report(near_floor_pct_005 numeric(6,4) 0~1, near_floor_qual_n, near_floor_guard_status) ↔ cron INSERT 일치. 스케일: win_zone pct_* 0~100, mode_gate near_floor_pct_005 = /100 (0~1). 가드 임계 비교는 win_zone 스케일(40.0/25.0). NULL-safe: near_floor_qual_n NULL이면 AND 조건 NULL→강등 안 함(forward-only 안전).

**스펙 deviation:** 마이그레이션 경로를 `db/migrations/`로 둠(스펙 §7은 `docs/v2/migrations/` 언급). 실행자 재량 — 일관성만 유지. Task1 노트에 명시.
