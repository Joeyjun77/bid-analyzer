# V2_MEASUREMENT_SPEC — 측정 공간 정식 명세

> 대상: Claude Code 세션
> 목적: V2 재설계의 측정 공간 전환(`adj_rate` → `bid_rate`)을 코드 작성 전 락인
> 위상: D 트랙 D1 산출물 (마스터플랜 §3 D1 본문 분리)
> 강제 수단: `/evaluate` G-단위 게이트 (`.claude/commands/evaluate.md` §6)
> 선행 문서: `HANDOFF_V2_DIAGNOSIS_RESULT.md` §1~2 (모순식 진단)

---

## 0. 한 줄 명세

> **V2의 모든 신규 WIN-zone·승률·통과율 KPI는 `bid_rate` 공간만 사용한다. `adj_rate` 공간 WIN-zone 측정은 영구 폐기한다.**

---

## 1. 정식 WIN-zone 판정식

```
WIN-zone ⇔  floor_rate  ≤  my_bid_rate  <  win_bid_rate
```

| 기호 | 의미 | 출처 컬럼 |
|---|---|---|
| `floor_rate` | 낙찰하한율 (기관·금액대별 86.745%·87.745% 등) | `bid_details.floor_rate`, `bid_records.fr` |
| `my_bid_rate` | 자사 투찰률 (자사가 실제 투찰한 금액 / 예가) | `bid_details.my_bid_rate` |
| `win_bid_rate` | 1위(낙찰자) 투찰률 (낙찰자 실제 투찰가 / 예가) | `bid_details.win_bid_rate`, `bid_records.br0` |

> **주의**: `floor_rate` 미보유 시 (한전·LH 등 일부) `lower_bound_rate_lookup` 함수로 종목+금액대 기반 역산.

---

## 2. 폐기 공간 — `adj_rate` WIN-zone

### 2.1 폐기 사유 (DIAGNOSIS §1~2)

```
판정식:  my_adj < win_adj  (상한)  AND  my_adj ≥ adj_rate  (하한)

실측 결과:  win_adj_rate ≈ adj_rate
  → 1위가 항상 하한가 직상에 형성 → 역산값이 실제 사정률로 수렴

대입:  my_adj < adj_rate  AND  my_adj ≥ adj_rate
  = 동시 충족 불가능한 모순식
  → pct_in_win_zone = 0.00% (n=875)는 버그 아닌 모순식의 정확한 출력
```

### 2.2 영구 폐기 대상 측정·정의

| 컬럼 / 뷰 / 함수 | 사유 | 처리 |
|---|---|---|
| `prediction_quality_daily.top1_hit_existing/balanced/aggressive/conservative` | adj_rate 공간 hit 측정 | 유지 (보조 모니터링), 신규 KPI 아님 |
| `phase17_validation.in_confidence_band` | adj_rate 신뢰구간 | 폐기 (V2에서 미사용) |
| 신규 view/function이 `adj_rate`를 win-zone 정의에 사용 | 모순식 재현 | `/evaluate` G-단위 게이트 **FAIL** |

---

## 3. 컬럼·공간 매핑

### 3.1 bid_rate 공간 (V2 신규 KPI 의존)

| 객체 | 컬럼 | 용도 |
|---|---|---|
| `bid_details` | `floor_rate`, `my_bid_rate`, `win_bid_rate` | WIN-zone 재구성 |
| `bid_records` | `fr`, `br0`, `br1`, `base_ratio` | 분포 학습용 |
| `bid_predictions` | `pred_floor_rate`, `pred_bid_amount` | 예측 투찰률 |
| `win1st_dist_map` (신규 재해석) | `mean`, `std` | 1위 투찰률 분포 (현 컬럼명 유지하되 의미는 bid_rate 공간 분포) |
| 신규 `floor_pass_daily` | `pred_floor_pass_prob_avg`, `actual_floor_pass_rate` | Mode B 1차 KPI |
| 신규 `win_zone_daily` | `pct_pass_floor`, `pct_pass_top1`, `pct_in_win_zone` | Mode A 1차 KPI |

### 3.2 adj_rate 공간 (보조 모니터링만 — 신규 KPI 추가 금지)

| 객체 | 컬럼 | 용도 |
|---|---|---|
| `bid_details` | `adj_rate`, `my_adj_rate`, `win_adj_rate` | MAE 계산용 (V2 KPI 아님) |
| `bid_predictions` | `pred_adj_rate`, `actual_adj_rate`, `adj_rate_error`, `opt_adj` | V6 호환, MAE 모니터링 |
| `pred_bias_map` | `bias`, `n` 등 | bias 학습 (보조 보정) |

---

## 4. KPI 등급 (DIAGNOSIS §5 결정 #2 + 마스터플랜 §6 정합)

| 등급 | KPI | 측정 공간 | 산출 위치 |
|---|---|---|---|
| **1차 (Mode A)** | WIN-zone 진입률 | bid_rate | `win_zone_daily.pct_in_win_zone` |
| **1차 (Mode B)** | 하한 통과율 | bid_rate | `floor_pass_daily.actual_floor_pass_rate` |
| **1차 (전체)** | calibration_gap | bid_rate | `floor_pass_daily.calibration_gap` |
| **2차** | gap median/p90 | bid_rate | `win_zone_daily`, `agency_mode_lookup` |
| **보조** | MAE (강등) | adj_rate | `prediction_quality_daily.mae`, `weekly_quality_report.mae_week` |
| **추적만** | 자사 낙찰률 | bid_rate (`my_rank=1`) | `bid_details` (KPI 게이트 진입 금지) |
| **폐기** | adj_rate 공간 WIN-zone | adj_rate | (없음 — 모순식) |

---

## 5. 면제 객체 목록 (`/evaluate` G-단위 게이트)

신규 코드/뷰가 `adj_rate`를 WIN-zone 정의에 사용하면 FAIL. 단, 아래는 면제 (기존 MAE 모니터링용):

```
prediction_quality_daily
phase17_validation
weekly_quality_report
v_v8_v6_hit_analysis
v_win_calibration_summary       (V6 호환 모니터링)
pwin_calibration_by_strategy    (Mode A 한정)
```

신규 V2 KPI 테이블 추가 시 면제 목록 갱신 책임은 V2_DDL_SPEC 책임자.

---

## 6. MAE 강등 정책

- MAE는 1차 KPI **아님**. `/accuracy` 리포트 §1·§2에 "보조 지표" 명시.
- MAE +0.02 이상 악화는 여전히 `/evaluate` FAIL 트리거 (V6 dual-run 보존용).
- V6 retire(Mode B n≥500 + 4주 pass) 후에는 MAE를 모니터링에서 제거 검토 가능.

---

## 7. 검증 인프라 진입점 (4개 신규 테이블)

| 테이블 | 측정 공간 | 갱신 주기 | 산출 KPI |
|---|---|---|---|
| `agency_mode_lookup` | bid_rate | 일배치 | Mode A/B 판정, gap median/p90 |
| `win_zone_daily` | bid_rate | 일배치 | Mode A 1차 KPI |
| `floor_pass_daily` | bid_rate | 일배치 | Mode B 1차 KPI + calibration |
| `mode_gate_report` | (집계) | 주간 | 영역별 게이트 pass/warn/fail/insufficient_sample |

DDL 본문은 `V2_DDL_SPEC.md`.

---

## 8. 절대 준수

- 모든 신규 KPI/뷰/함수는 `*_bid_rate` 컬럼만 사용
- adj_rate 컬럼 신규 WIN-zone 측정 금지 (`/evaluate` G-단위 FAIL)
- 본 문서가 V2_DDL_SPEC·V2_UI_SPEC·`/evaluate` 게이트 정합의 단일 진실 소스
- 변경 필요 시 V2_DDL_SPEC + evaluate.md 게이트 + 면제 목록 동시 갱신 (3곳 부분 변경 금지)

---

_DDL 명세 → `V2_DDL_SPEC.md` / 화면 명세 → `V2_UI_SPEC.md` / 마스터플랜 → `HANDOFF_V2_MASTER_PLAN.md`_
