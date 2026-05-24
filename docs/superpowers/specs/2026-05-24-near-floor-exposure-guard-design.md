# near-floor exposure (하한 마진 밀집도) 가드 — 디자인 스펙

> **작성일**: 2026-05-24
> **근거**: Codex consult 2회(top1_hit KPI 승격 논의) + DB 실측 종합. 사용자 지시로 Codex 의견 종합 결과로 진행.
> **분류**: Evaluator / 측정 인프라 (예측 로직 무관 — predict_v6/getFinalRecommendation/낙찰하한율 미변경). `bid_rate` 공간 → `/evaluate` G-단위 게이트 PASS.
> **선행 사실 (2026-05-24 DB 실측)**:
> - mode-split top1은 **이미 존재**: `mode_gate_report`(주간) Mode A(군시설)=`pct_in_win_zone`(target 0.15), Mode B=`actual_floor_pass_rate`(target 0.90). `win_zone_daily`(일간, at별)가 `pct_pass_floor/pct_pass_top1/pct_in_win_zone` 적재. → 신규 mode-split top1 구축은 중복.
> - 레거시 `prediction_quality_daily.top1_hit_*`(12~17%)는 **adj_rate 공간 폐기 등급**. 확장 시 `/evaluate` G-단위 FAIL.
> - 누락 = **하한 마진 밀집도(near-floor exposure)**. `win_zone_daily.gap`은 win_bid_rate−floor_rate(win-zone 폭)지 하한 마진 아님.

---

## 0. 한 줄 요약

`win_zone_daily`에 `bid_rate` 공간 하한 마진(`my_bid_rate − floor_rate`) 밀집도 지표를 추가하고, 이를 `mode_gate_report`의 **2차 가드**로 연동해, 모델이 1순위 적중률을 "하한 절벽에 붙어" 게이밍(→실격 위험)하는 것을 감지한다. 1차 KPI(Mode A `pct_in_win_zone`, Mode B `actual_floor_pass_rate`)는 그대로 두고, 가드는 `pass→warn`만 강등한다.

---

## 1. 문제 정의

### 1.1 이미 있는 것 (재구축 금지)
mode-split top1 KPI는 V2 인프라에 완비돼 있다: `win_zone_daily`(bid_rate, at별 일간) → `mode_gate_report`(주간 모드 게이트, pg_cron 적재). Codex가 권고한 "mode-aware, floor-gated guarded KPI"가 곧 현 구조다.

### 1.2 누락 (진짜 신규)
어떤 지표도 **하한 대비 마진의 밀집도**를 측정하지 않는다. `win_zone_daily.gap = win_bid_rate − floor_rate`는 win까지의 폭이다. 1순위 마진이 0.001~0.005pp로 극히 얇은 도메인에서, top1/win-zone을 올리는 가장 쉬운 길은 "하한 바로 위에 투찰"이고, 이는 floor_rate 추정오차·파싱오차·반올림에서 **실격(失格)** 위험을 키운다. 이 cliff-riding을 감지할 가드가 없다.

### 1.3 제약
신규 win/top1/pass KPI는 `bid_rate` 공간만 허용(`adj_rate` WIN-zone 영구 폐기, `/evaluate` G-단위 FAIL 대상). near-floor도 `bid_rate` 공간(`win_zone_daily`의 my_bid_rate/floor_rate)으로 정의한다.

---

## 2. 결정 사항 (Codex+Claude 종합)

| # | 결정 | 근거 |
|---|---|---|
| 1 | near-floor exposure만 신규. mode-split top1 재구축 안 함 | `mode_gate_report`가 이미 모드 분리 게이트 제공 |
| 2 | `bid_rate` 공간, `win_zone_daily` 확장 (신규 테이블 X) | 동일 grain·소스(`bid_details`)·측정공간, G-단위 PASS |
| 3 | near-floor 버킷 분모 = **qualifying-only**(margin≥0). 실격은 `pct_below_floor`로 분리 | 실격은 별개 실패모드 — 섞으면 신호 흐려짐 (Codex) |
| 4 | `mode_gate_report` **2차 가드**(신규 1차 KPI 아님) | 1차 게이트 안정성 유지, cliff-riding만 감지 |
| 5 | 가드는 `pass→warn`만 강등. 초기엔 `warn→fail` 안 함 | 도입 초기 보수적 운영, 이력 축적 후 강화 (Codex) |
| 6 | 임계: Mode B `pct_near_floor_005 > 25%` warn, Mode A `> 40%` warn, `near_floor_qual_n < 30` insufficient | Mode B는 "하한 안착"이라 cliff-riding이 직접 결함; Mode A는 win-zone 압축으로 마진 좁아짐 허용폭 큼 (Codex) |
| 7 | `pct_floor_margin_neg_001`(실격 중 −0.001 이내 미세오차 비율)는 **진단만, 게이트 X** | 미세 calibration miss vs 구조적 under-floor 구분, 이력 먼저 (Codex) |

---

## 3. 측정 정의 (bid_rate 공간, pp 단위)

`win_zone_daily` 소스(`bid_details d`)에서 `my_bid_rate`, `floor_rate`는 % 단위(예: 87.7449). 마진은 pp.

```
margin_pp = d.my_bid_rate - d.floor_rate          -- 적격 후보군: my_bid_rate/floor_rate NOT NULL (기존 win_zone 필터와 동일)
n_total   = COUNT(*)
n_qual    = COUNT(*) FILTER (WHERE margin_pp >= 0)  -- 적격(하한 통과)
```

**near-floor 밀집 버킷 (분모 = n_qual, 0~100 스케일 — win_zone_daily 기존 pct_* 와 동일 스케일):**
```
pct_near_floor_001 = 100.0 * COUNT(*) FILTER (WHERE margin_pp >= 0 AND margin_pp <= 0.001) / NULLIF(n_qual,0)
pct_near_floor_003 = 100.0 * COUNT(*) FILTER (WHERE margin_pp >= 0 AND margin_pp <= 0.003) / NULLIF(n_qual,0)
pct_near_floor_005 = 100.0 * COUNT(*) FILTER (WHERE margin_pp >= 0 AND margin_pp <= 0.005) / NULLIF(n_qual,0)
```

**실격·분포 (분모 = n_total):**
```
pct_below_floor       = 100.0 * COUNT(*) FILTER (WHERE margin_pp < 0) / NULLIF(n_total,0)
pct_floor_margin_neg_001 = 100.0 * COUNT(*) FILTER (WHERE margin_pp < 0 AND margin_pp >= -0.001) / NULLIF(n_total,0)  -- 진단만
floor_margin_avg_pp    = ROUND(AVG(margin_pp), 6)
floor_margin_median_pp = ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY margin_pp), 6)
floor_margin_p10_pp    = ROUND(PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY margin_pp), 6)
near_floor_qual_n      = n_qual
```
- 분모 0이면 `NULL`(0 아님).
- 마진 컬럼은 6자리(0.001pp 해상도 확보). 버킷 pct는 win_zone_daily 관례대로 2자리.
- **단위 게이트 주의**: pct_*는 0~100 스케일. `mode_gate_report` 적재 시 0~1로 변환(아래 §5).

---

## 4. DB 변경

### 4.1 `win_zone_daily` 컬럼 추가 (가산적)
```sql
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
```

### 4.2 `refresh_win_zone_daily` 확장
두 INSERT 슬라이스(overall: at=NULL / per-at: GROUP BY d.at)의 SELECT에 §3 표현식 9개를 추가. 기존 컬럼·필터·HAVING 로직은 불변. `CREATE OR REPLACE FUNCTION` 전체 재정의(SECURITY DEFINER 유지).

**ON CONFLICT 주의 (backfill 결함):** 현 함수는 `ON CONFLICT (measured_on, at, canonical_ag) DO NOTHING`이다. 즉 함수만 교체하고 재실행해도 **이미 존재하는 날짜 행의 신규 컬럼은 NULL로 남는다**(DO NOTHING). 두 가지 중 택1:
- **(권장) forward-only**: 함수 교체 후 다음 일배치(매일 00:15)가 만드는 새 날짜 행부터 신규 컬럼이 채워진다. 기존 42행은 NULL 유지(무해 — 가드는 `near_floor_qual_n` NULL/<30을 insufficient로 처리해 강등 안 함). 즉시 활성화는 불필요.
- **즉시 활성화(선택)**: 최신 날짜만 1회 재계산 — `DELETE FROM win_zone_daily WHERE measured_on = CURRENT_DATE; SELECT refresh_win_zone_daily();` (그날 행 삭제 후 재삽입). 과거 전체 backfill은 불필요(가드는 최신 행만 읽음).
- `ON CONFLICT`를 `DO UPDATE`로 바꾸는 안은 기존 측정 멱등성 변경이라 채택 안 함(범위 최소화).

### 4.3 `mode_gate_report` 컬럼 추가 (가산적)
```sql
ALTER TABLE mode_gate_report
  ADD COLUMN IF NOT EXISTS near_floor_pct_005    numeric(6,4),  -- 0~1 (kpi_value 스케일과 통일)
  ADD COLUMN IF NOT EXISTS near_floor_qual_n     int,
  ADD COLUMN IF NOT EXISTS near_floor_guard_status text
    CHECK (near_floor_guard_status IN ('pass','warn','insufficient_sample'));
```

### 4.4 cron INSERT 수정 (가드 연동)
가드 강등 규칙을 두 주간 cron INSERT의 `gate_status` CASE에 합성. `near_floor_guard_status`는 별도 컬럼에도 기록(투명성).

**Mode A (m16 `v2_modeA_weekly_gate`)** — 이미 `win_zone_daily`(at='군시설')에서 SELECT. near-floor 컬럼이 같은 행에 있으므로 직접 사용. 임계 40%:
```sql
-- gate_status (1차 pct_in_win_zone 판정 후 near-floor 가드로 pass→warn 강등):
CASE
  WHEN n < 10 THEN 'insufficient_sample'
  WHEN pct_in_win_zone >= 15.0
       AND near_floor_qual_n >= 30 AND pct_near_floor_005 > 40.0 THEN 'warn'  -- 가드 강등
  WHEN pct_in_win_zone >= 15.0 THEN 'pass'
  WHEN pct_in_win_zone >= 10.0 THEN 'warn'
  ELSE 'fail'
END
-- near_floor_pct_005 = (pct_near_floor_005/100.0)::numeric(6,4), near_floor_qual_n = near_floor_qual_n,
-- near_floor_guard_status = CASE WHEN near_floor_qual_n<30 THEN 'insufficient_sample' WHEN pct_near_floor_005>40.0 THEN 'warn' ELSE 'pass' END
```

**Mode B (m12 `v2_modeB_weekly_gate`)** — `floor_pass_daily`에서 SELECT 중. near-floor는 `win_zone_daily`에 있으므로 `LEFT JOIN win_zone_daily wz ON wz.at IS NOT DISTINCT FROM floor_pass_daily.at AND wz.measured_on = (최근 win_zone_daily measured_on)` 추가. 임계 25%:
```sql
CASE
  WHEN fpd.n < 5 THEN 'insufficient_sample'
  WHEN fpd.actual_floor_pass_rate >= 0.90
       AND wz.near_floor_qual_n >= 30 AND wz.pct_near_floor_005 > 25.0 THEN 'warn'  -- 가드 강등
  WHEN fpd.actual_floor_pass_rate >= 0.90 THEN 'pass'
  WHEN fpd.actual_floor_pass_rate >= 0.80 THEN 'warn'
  ELSE 'fail'
END
```
- `wz`가 NULL(매칭 win_zone 행 없음)이면 가드 미적용(1차 판정 그대로). `_overall_`은 wz.at IS NULL 행과 매칭.

---

## 5. 게이트 규칙 요약

- **1차 KPI 불변**: Mode A `pct_in_win_zone≥15%`, Mode B `actual_floor_pass_rate≥90%`.
- **2차 near-floor 가드**: `near_floor_qual_n≥30` 일 때만 평가. `pct_near_floor_005`가 임계(A 40% / B 25%) 초과면 **pass→warn 강등**(이미 warn/fail이면 그대로). 표본 부족 시 가드 미적용(1차 유지).
- `mode_gate_report.near_floor_guard_status` 컬럼에 가드 자체 판정(pass/warn/insufficient_sample) 별도 기록.

---

## 6. /evaluate 게이트 영향

- **G-단위**: 모든 신규 지표가 `bid_rate`(my_bid_rate/floor_rate) 공간 → **PASS**. adj_rate 미사용.
- **G-모드표시**: 지표가 mode_gate_report에서 모드 분리 유지 → 부합.
- **G-A안/G-bias**: bid_predictions opt_adj·UPDATE 없음, 매칭 데이터 불변 → 무관.
- 예측 로직 무변경 → MAE 회귀 없음.

---

## 7. 적용·롤아웃

- 마이그레이션 SQL은 V2 관례대로 `docs/v2/migrations/`에 보존(예: `m28_near_floor_exposure.sql`), Supabase `apply_migration`으로 적용(service_role).
- 순서: (1) win_zone_daily ALTER → (2) refresh_win_zone_daily 재정의 → (3) **최신 행 즉시 활성화**(`DELETE FROM win_zone_daily WHERE measured_on=CURRENT_DATE; SELECT refresh_win_zone_daily();`)로 신규 컬럼 채우고 검증(§4.2 forward-only 택 시 생략) → (4) mode_gate_report ALTER → (5) cron INSERT 2건 재정의(unschedule→schedule) → (6) 주간 게이트 수동 1회 실행 검증.
- cron 재정의는 `cron.unschedule` 후 `cron.schedule` 재등록(기존 m12/m16 잡 교체).
- 라이브 영향: 가산적·읽기 지표. 1차 게이트·예측·앱 동작 불변. near-floor 가드는 pass→warn만이라 기존 pass 영역에만 영향.

---

## 8. 검증

- refresh_win_zone_daily 재실행 후: 신규 컬럼이 overall+at 슬라이스 모두 채워지는지, `pct_near_floor_005`가 [0,100], `near_floor_qual_n ≤ n`, 분모 0행은 NULL인지.
- 군시설(Mode A) 행에서 가드 동작: pct_near_floor_005 인위적 임계 초과 케이스로 gate_status pass→warn 강등 확인.
- Mode B 조인: `_overall_` 및 각 at가 win_zone_daily 해당 행과 매칭되는지(at IS NOT DISTINCT FROM).
- 단위 sanity: pct_*는 0~100, mode_gate_report.near_floor_pct_005는 0~1.

---

## 9. 비목표 (YAGNI)

- mode-split top1 신규 KPI (이미 존재).
- `pct_floor_margin_neg_001` 게이트화 (이력 축적 전까지 진단만).
- per-canonical_ag near-floor 슬라이스 (현 refresh_win_zone_daily는 overall+at만 — 동일 범위 유지).
- 앱 UI 노출 (별도 후속).
- 임계 자동 튜닝 (수동 상수, 이력 후 조정).
