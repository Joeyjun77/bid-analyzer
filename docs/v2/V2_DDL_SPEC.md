# V2_DDL_SPEC — 검증 시스템 테이블 명세

> 대상: Claude Code 세션
> 목적: 마스터플랜 D3의 신규 4개 테이블 DDL 락인
> 코덱스 정정 #2 대응: DDL이 핸드오프 근거 없는 창작이므로 별도 명세로 분리
> 적용: 각 테이블 = 독립 `apply_migration` 호출 (개별 롤백 가능)

---

## 0. 명세 원칙

- 모든 측정 컬럼은 `*_bid_rate` 공간 (adj_rate 금지 — DIAGNOSIS §1)
- 4개 테이블 상호 의존성 없음 → 개별 DROP 가능
- 각 마이그레이션에 RLS 활성화 + 정책 본문 명시 (anon/auth SELECT + service_role INSERT[+UPDATE])
- 모든 UNIQUE는 `NULLS NOT DISTINCT` (PG15+) — NULL 컬럼이 포함된 UNIQUE는 fallback row 중복 방지
- `win_zone_daily`/`floor_pass_daily`는 일배치 누적 → 인덱스 필수
- 운용 주체: service_role (cron / edge function). anon/authenticated는 SELECT만

---

## 1. agency_mode_lookup — 영역별 모드 판정 (정적, 일배치 갱신)

```sql
CREATE TABLE agency_mode_lookup (
  id              BIGSERIAL PRIMARY KEY,
  at              TEXT NOT NULL,
  canonical_ag    TEXT,                          -- NULL = at-level fallback row
  ba_seg          TEXT,                          -- S1~S5 금액대 세그먼트
  n               INT  NOT NULL,
  median_gap      NUMERIC(6,4),
  p90_gap         NUMERIC(6,4),
  mode_recommend  CHAR(1) NOT NULL CHECK (mode_recommend IN ('A','B')),
  confidence      TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  sample_window_days INT DEFAULT 180,
  UNIQUE NULLS NOT DISTINCT (at, canonical_ag, ba_seg)
  -- PG15+ NULLS NOT DISTINCT: (at, NULL, NULL) fallback row 중복 방지
);
CREATE INDEX idx_aml_lookup ON agency_mode_lookup (at, canonical_ag, ba_seg);

ALTER TABLE agency_mode_lookup ENABLE ROW LEVEL SECURITY;
CREATE POLICY agency_mode_lookup_anon_select    ON agency_mode_lookup FOR SELECT TO anon          USING (true);
CREATE POLICY agency_mode_lookup_auth_select    ON agency_mode_lookup FOR SELECT TO authenticated USING (true);
CREATE POLICY agency_mode_lookup_service_insert ON agency_mode_lookup FOR INSERT TO service_role  WITH CHECK (true);
CREATE POLICY agency_mode_lookup_service_update ON agency_mode_lookup FOR UPDATE TO service_role  USING (true) WITH CHECK (true);
```

**confidence 산식 (코덱스 지적 — 미명시 보강)**
- `high`   : n ≥ 50
- `medium` : 20 ≤ n < 50
- `low`    : n < 20  (한전 39→medium, 조달청 26→medium, LH 11→low)

**fallback 규칙**: `(at, canonical_ag, ba_seg)` 미스 → `(at, NULL, NULL)` row 사용.

---

## 2. win_zone_daily — Mode A 검증 집계 (일배치 누적)

```sql
CREATE TABLE win_zone_daily (
  id              BIGSERIAL PRIMARY KEY,
  measured_on     DATE NOT NULL,
  at              TEXT,
  canonical_ag    TEXT,
  n               INT,
  pct_pass_floor  NUMERIC(5,2),
  pct_pass_top1   NUMERIC(5,2),
  pct_in_win_zone NUMERIC(5,2),
  avg_gap         NUMERIC(6,4),
  median_gap      NUMERIC(6,4),
  p90_gap         NUMERIC(6,4),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE NULLS NOT DISTINCT (measured_on, at, canonical_ag)
);
CREATE INDEX idx_wzd_date ON win_zone_daily (measured_on, at);

ALTER TABLE win_zone_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY win_zone_daily_anon_select    ON win_zone_daily FOR SELECT TO anon          USING (true);
CREATE POLICY win_zone_daily_auth_select    ON win_zone_daily FOR SELECT TO authenticated USING (true);
CREATE POLICY win_zone_daily_service_insert ON win_zone_daily FOR INSERT TO service_role  WITH CHECK (true);
-- UPDATE 정책 의도적 미생성 — A안 INSERT-only
```

**파티셔닝 (코덱스 지적)**: 초기엔 단일 테이블. row 수 연 ~2,500건(7 at × 일배치) 수준이라 파티션 불필요. 3년 후 재검토.

---

## 3. floor_pass_daily — Mode B 검증 + calibration (일배치 누적)

```sql
CREATE TABLE floor_pass_daily (
  id                       BIGSERIAL PRIMARY KEY,
  measured_on              DATE NOT NULL,
  at                       TEXT,
  canonical_ag             TEXT,
  model_version            TEXT,                 -- 'v2_modeB' 등
  n                        INT,
  pred_floor_pass_prob_avg NUMERIC(5,4),         -- 예측이 약속한 평균 통과확률
  actual_floor_pass_rate   NUMERIC(5,4),         -- 실측 통과율
  calibration_gap          NUMERIC(5,4),         -- abs(pred - actual)
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE NULLS NOT DISTINCT (measured_on, at, canonical_ag, model_version)
);
CREATE INDEX idx_fpd_date  ON floor_pass_daily (measured_on, at);
CREATE INDEX idx_fpd_calib ON floor_pass_daily (model_version, calibration_gap);

ALTER TABLE floor_pass_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY floor_pass_daily_anon_select    ON floor_pass_daily FOR SELECT TO anon          USING (true);
CREATE POLICY floor_pass_daily_auth_select    ON floor_pass_daily FOR SELECT TO authenticated USING (true);
CREATE POLICY floor_pass_daily_service_insert ON floor_pass_daily FOR INSERT TO service_role  WITH CHECK (true);
-- UPDATE 정책 의도적 미생성 — A안 INSERT-only
```

`calibration_gap`은 마스터플랜 §4 B2 정의의 검증 지표 — 사후 1주 실측 vs 예측 괴리.

---

## 4. mode_gate_report — 영역별 주간 게이트

```sql
CREATE TABLE mode_gate_report (
  id               BIGSERIAL PRIMARY KEY,
  report_week      DATE NOT NULL,
  at               TEXT NOT NULL,
  mode             CHAR(1) NOT NULL CHECK (mode IN ('A','B')),
  primary_kpi_name TEXT NOT NULL,
  kpi_value        NUMERIC(6,4),
  kpi_target       NUMERIC(6,4),
  gate_status      TEXT NOT NULL
                   CHECK (gate_status IN ('pass','warn','fail','insufficient_sample')),
  dual_run_n       INT,                          -- 영역별 분리 카운터 (마스터플랜 정정 #4)
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE NULLS NOT DISTINCT (report_week, at, mode)
);
CREATE INDEX idx_mgr_week ON mode_gate_report (report_week, at, mode);

ALTER TABLE mode_gate_report ENABLE ROW LEVEL SECURITY;
CREATE POLICY mode_gate_report_anon_select    ON mode_gate_report FOR SELECT TO anon          USING (true);
CREATE POLICY mode_gate_report_auth_select    ON mode_gate_report FOR SELECT TO authenticated USING (true);
CREATE POLICY mode_gate_report_service_insert ON mode_gate_report FOR INSERT TO service_role  WITH CHECK (true);
-- UPDATE 정책 의도적 미생성 — 주간 집계 INSERT-only
```

**`insufficient_sample` enum 추가 (코덱스 지적)**
- 한전·LH·조달청은 n<40 → 게이트 판정 불가 주차가 발생
- `pass/warn/fail`로 강제하면 거짓 신호 → `insufficient_sample`로 명시
- `dual_run_n`은 영역별 독립 카운터 — Mode B 먼저 n≥500 도달 시 retire 판정

---

## 5. 기존 객체 처리

| 객체 | 처리 |
|------|------|
| `prediction_quality_daily` | 유지 (보조 모니터링), mae 컬럼 강등 표시 |
| `phase17_validation` | `passed_floor_bid_rate` 컬럼 ADD (bid_rate 재계산) |
| `weekly_quality_report` | 유지 + `mode_gate_report` JOIN 통합 뷰 신설 |
| `bid_predictions.bid1st_v2_win_prob` | 값 NULL 무효화, 컬럼 보존 |
| `bid_predictions` 신규 6컬럼 | `b_pred_floor_pass_prob`, `b_pred_mode` 등 ADD only |
| `pwin_calibration_by_strategy` | Mode A 한정 사용 명시 |

---

## 6. 적용 순서 (apply_migration)

```
m1_create_agency_mode_lookup       (B0a) ✅ 적용 완료 2026-05-19
m2_create_floor_pass_daily         (B0a) ✅ 적용 완료 2026-05-19
m3_unique_nulls_not_distinct       (B0a, 코덱스 라운드 1 결함 #1) ✅ 적용 완료
m4_add_insert_policies             (B0a, 코덱스 라운드 1 결함 #2) ✅ 적용 완료
m5_create_win_zone_daily           (B0b) ✅ 적용 완료 2026-05-19
m6_create_mode_gate_report         (B0b) ✅ 적용 완료 2026-05-19
m7_alter_bid_predictions_add_modeb (B2)  — 예정
m8_alter_phase17_add_floor_bidrate (B0b) ✅ 적용 완료 2026-05-19 (passed_floor_bid_rate 컬럼 ADD)
m9_create_lookup_agency_mode_rpc   (B1)  ✅ 적용 완료 2026-05-19 (3단계 fallback RPC)
m10_create_refresh_floor_pass_daily(B2.6) ✅ 적용 완료 2026-05-19 (Mode B calibration 일배치 함수)
m11_refresh_floor_pass_daily_window(B2.6+) ✅ 적용 완료 2026-05-19 (window 분리 — 자기충족예언 방지, 코덱스 라운드 3 권고 #2)
m12_v2_modeB_cron_schedule        (B5)      ✅ 적용 완료 2026-05-19 (pg_cron 자동화 — 일간 calibration + 주간 게이트, 코덱스 라운드 5 권고 #2)
m13_create_agency_gap_distribution(B3.1)    ✅ 적용 완료 2026-05-20 (군시설 gap 분포 테이블)
m14_create_lookup_gap_distribution_rpc(B3.2)✅ 적용 완료 2026-05-20 (gap 분포 3단계 fallback RPC)
m15_create_refresh_win_zone_daily (B3.6)    ✅ 적용 완료 2026-05-20 (Mode A KPI 누적 함수)
m16_v2_modeA_cron_schedule        (B3.7)    ✅ 적용 완료 2026-05-20 (Mode A pg_cron 자동화)
m17_add_era_v2_columns            (Phase1)  ✅ 적용 완료 2026-05-20 (era_v2 컬럼 — V2_DOMAIN_RULES_CHECK #0)
m18_alter_agency_gap_distribution_add_era_v2 (Phase1) ✅ 적용 완료 2026-05-20 (시대 혼입 'mixed' 마킹 + current 재적재 — current AT n=31로 Mode A 가동, 라운드 8 옵션 A)
```

각 마이그레이션은 snake_case 명명, RLS 활성화 + 정책 본문 명시 (anon/auth SELECT + service_role INSERT).
`apply_migration` 실패 시 전체 트랜잭션 롤백 → 새 마이그레이션명으로 재시도 (execute_sql로 DDL 금지).

---

## 7. 절대 준수

- 측정 컬럼은 `*_bid_rate` 공간만 — `/evaluate` 단위 게이트가 강제
- DDL은 `apply_migration` 전용, `execute_sql` DDL 금지
- 4개 테이블 상호 의존 없음 — 개별 DROP 가능, 롤백 안전
