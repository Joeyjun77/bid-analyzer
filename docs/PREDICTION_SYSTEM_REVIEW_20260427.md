# bid-analyzer 예측 시스템 정리 (Phase 23-7 시점)

> **기준일**: 2026-04-27
> **목적**: 다음 구축·점검을 빠르게 시작할 수 있도록 발주사별 예측 시스템·보정 상수·학습 인프라를 한 눈에 정리
> **이전 문서**: `docs/PREDICTION_SYSTEM_REVIEW_20260424.md` (3일 전, 구조 설명 중심) — 본 문서는 운영 데이터·발주사 단위 성능 중심
> **반영 변경**: Phase 23-7 (commit `702aa9b`) — 군시설 ASSUMED 분위수 정렬 + predict_notice rec_bid_p25/p75 NULL 버그 수정

---

## 0. 한눈에 (2026-04-27 baseline)

| 항목 | 값 | 메모 |
|---|---|---|
| Production model | `v6.2` (`predict_v6_2`) | baseline MAE 0.49 |
| Shadow model | `v7.0` (`predict_v7`) | 2026-04-18 등록, MAE 미기록 |
| 활성 매칭 데이터 (60일) | 207건 (matched, opt_adj IS NOT NULL) | 7개 발주유형 분포 |
| 학습된 발주사 | 156개 (`agency_predictor`) | 강한 학습 3개(n≥20), 약한 37개(n≥5) |
| 금액대 보정 | 6 row (`amount_band_correction`) | -0.086 ~ +0.320 |
| 이론 MAE 하한 | 0.642% | 복수예비가 C(15,4) 추첨 분산 |

### 핵심 영역 베이스라인 (60일 매칭, opt_adj 기준)

| 영역 | n | bias | MAE | 판정 |
|---|---|---|---|---|
| 한전 | 44 | -0.009 | 0.451 | ✅ 양호 (이론 한계 근접) |
| 군부대(=`at='군시설'`) | 41 | -0.115 | 0.461 | ⚠ bias 음수, Phase 23-7 P1로 일부 개선 진행 중 |
| 고양시 | 5 | +0.003 | 0.550 | 표본 부족, 모니터링만 |

---

## 1. 발주유형별 현재 성능 (60일 매칭)

| at | n | bias | MAE | actual_p50 | actual_avg | pred_avg | actual_std | in_band* |
|---|---|---|---|---|---|---|---|---|
| **지자체** | 141 | -0.150 | 0.656 | -0.013 | -0.034 | -0.184 | 0.873 | 50.4% |
| **한전** | 44 | -0.009 | 0.451 | -0.134 | -0.039 | -0.048 | 0.557 | 36.4% |
| **군시설** | 41 | -0.115 | 0.461 | +0.266 | +0.234 | +0.119 | 0.555 | 39.0% |
| 조달청 | 9 | -0.046 | 0.395 | -0.058 | -0.194 | -0.240 | 0.499 | 66.7% |
| 교육청 | 7 | -0.543 | 0.543 | +0.115 | +0.117 | -0.426 | 0.350 | 71.4% |
| LH | 4 | -0.671 | 0.977 | +0.073 | -0.026 | -0.697 | 0.574 | 50.0% |
| 수자원공사 | 3 | -0.316 | 0.568 | -0.065 | -0.032 | -0.347 | 0.728 | 33.3% |

*in_band = `rec_adj_p25 ≤ actual_adj ≤ rec_adj_p75` 비율 (분위수 추천이 실측을 잘 잡는지)

### 관찰
- **양의 사정률 발주유형 과소평가 패턴**: 군시설/교육청/LH 모두 bias 큰 음수. opt_adj가 실측보다 낮음 = 추천이 보수적.
- **한전이 유일하게 정렬 양호**: bias 거의 0, MAE 0.45 (이론 하한 0.642 직전).
- **표본 부족 영역**: 조달청·교육청·LH·수자원공사 모두 n<10. 추가 데이터 누적 필요.

---

## 2. 발주유형별 적용 보정 (현재 활성)

### 2-1. `TYPE_OFF` (utils.js, predictV5 → opt_adj 가산)
```
지자체   -0.15
군시설    0.00
교육청   -0.45  (Phase 21에서 -0.20 → -0.45 재조정)
한전      0.10
LH       -0.10
조달청   -0.10
수자원공사 -0.10
```
근거: 1,091건 백테스트. **현재 데이터(60일)**와 비교하면:
- 교육청 -0.45가 너무 음수 (현 bias -0.54 → 추가 음수 보정 시 더 악화 가능). 재추정 필요.
- 군시설 0.00이 음수 bias -0.115를 못 잡음. +0.10~+0.15 상향 후보.
- 한전 +0.10이 적절히 작동 중.

### 2-2. `ASSUMED_ADJ_TABLE` (constants-tables.js:62~70, recommendAssumedAdj 베이스)
```
"지자체":   under300M:{-0.22, 0.37, 1.07}, over300M:{0.00, 0.53, 1.05}
"교육청":   under300M:{ 0.03, 0.57, 1.19}, over300M:{0.21, 0.68, 1.19}
"군시설":   under300M:{-0.10, 0.45, 0.85}, over300M:{0.59, 1.00, 1.38}  ← Phase 23-7 P1 갱신
"한전":     under300M:{ 0.26, 0.67, 1.07}, over300M:{0.35, 0.83, 1.12}
"조달청":   under300M:{-1.42,-0.21, 0.66}, over300M:{0.58, 1.29, 2.47}
"LH":       under300M:{ 0.08, 0.40, 1.01}, over300M:{1.09, 1.56, 2.67}
"수자원공사":under300M:{-0.27, 0.04, 0.38}, over300M:{0.47, 1.01, 1.09}
```
사용자 추천 분위수 `rec_adj_p25/p50/p75`의 베이스. ag별 보정(`agAss`/`agSt`) 가중평균 후 적용.

### 2-3. `WIN_OPT_GAP` (constants-tables.js:9~17, frontend 표시 전용)
```
지자체 0.493 / 군시설 0.150 / 교육청 0.533 / 한전 0.367
조달청 0.676 / LH 0.088 / 수자원공사 0.003
```
**중요**: 이 상수는 `calcWin1stBid`(프론트 "1위 목표 투찰금" 표시값)에만 사용됨. **`opt_adj`/MAE/bias/Top-1 hit 등 DB 정확도 메트릭과 무관** (Phase 23-7 측정으로 확인). 변경해도 `/evaluate` 게이트로 검증 불가.

### 2-4. `RATE_TABLE` (낙찰하한율, 2026 개정 반영)
| 기관 | 시행일 | 3억 미만 | 3~10억 | 10~50억 | 50억+ |
|---|---|---|---|---|---|
| 조달청 | 2026-01-30 | 90.25% | 89.745% | 88.745% | 87.495% |
| 지자체 | 2025-07-01 | 90.25% | 89.745% | 88.745% | 87.495% |
| 교육청 | 2025-07-01 | 90.25% | 89.745% | 88.745% | 87.495% |
| LH | 2026-02-01 | 90.25% | 89.745% | 88.745% | 87.495% |
| 군시설 | 2026-01-19 | 90.25% | 89.745% | 88.745% | 87.495% |
| 수자원공사 | 2026-02-27 | 90.25% | 89.745% | 88.745% | 87.495% |
| **한전** | **자체기준 유지** | **88.25%** | **87.745%** | **86.745%** | **85.495%** |

한전 자체기준 유지는 144건 중앙값 87.745% 실측 검증 근거.

---

## 3. 핵심 발주사별 성능 (n≥5, 90일 매칭)

| canonical_ag | at | n | bias | MAE | actual_avg | 비고 |
|---|---|---|---|---|---|---|
| 한국전력공사 경기북부본부 | 한전 | 15 | +0.004 | 0.420 | -0.103 | ✅ 거의 무편향 |
| 한국전력공사 경기본부 | 한전 | 14 | +0.156 | 0.362 | -0.120 | 약간 +방향, MAE 양호 |
| **서울교통공사** | 지자체 | 11 | -0.385 | 0.765 | -0.155 | ⚠ 큰 음수 bias |
| 한국철도공사 회계통합센터 | 지자체 | 7 | +0.019 | 0.444 | -0.014 | 양호 |
| 제25보병사단 | 군시설 | 6 | +0.047 | 0.334 | +0.182 | 양호 |
| 제7군단 | 군시설 | 5 | -0.324 | 0.414 | +0.306 | ⚠ -방향, ag_offset 부족 |
| 경기도 안산시 | 지자체 | 5 | +0.475 | 0.809 | -0.517 | ⚠ +방향 과대 |
| 경기도 파주시 | 지자체 | 5 | -0.102 | 0.320 | +0.106 | 약간 음수, MAE 양호 |
| **경기도** | 지자체 | 5 | -0.736 | 0.736 | +0.581 | 🚨 큰 음수 bias |
| 서울지방조달청 | 조달청 | 5 | -0.035 | 0.474 | -0.290 | 양호 |
| **경기도 의정부시** | 지자체 | 5 | -1.107 | 1.107 | +0.805 | 🚨 큰 음수 bias |

### 발주사별 시사점
- **경기도/경기도 의정부시/제7군단**: 실측이 양수인데 우리 예측이 음수 → 큰 -bias. agency_predictor 재학습 필요.
- **경기도 안산시**: 반대로 실측이 -0.5인데 예측이 0 부근 → +bias. 학습 표본 누적 필요.
- **한전 본부 단위 양호**: 한전 영역 전체가 잘 작동하는 이유 — agency_predictor가 한전 산하 본부를 잘 학습.

---

## 4. 학습 인프라 상태

| 객체 | 현재 값 | 의미 |
|---|---|---|
| `model_registry` production | v6.2 (predict_v6_2), baseline 0.49 | 운영 모델 |
| `model_registry` shadow | v7.0 (predict_v7), 2026-04-18 등록 | A/B 쉐도우 레인 |
| `agency_predictor` | 156개 발주사, offset -0.305 ~ +0.255 | n≥20 강한 학습 3개, 5≤n<20 약한 학습 37개 |
| `amount_band_correction` | 6 row, correction -0.086 ~ +0.320 | at×band(under_300M/300M_1B/1B_5B/over_5B) 보정 |
| `pred_bias_map` | VIEW (ag×at×금액대 잔차 매핑) | predict_v6 잔차 기반 |
| `prediction_quality_daily` | 일간 route×at MAE/hit/floor_safe | KST 04:00 cron |
| `weekly_quality_report` | 주간 gate/drift 자동 판정 | 월 KST 05:00 cron |
| `phase17_validation` | A/B등급 실측 낙찰 통과율 | 수동 입력 일부 |
| `pwin_calibration_by_strategy` | aggressive 78.5%, balanced 62.8%, safe 37.7% | 1194 sample, 04-26 갱신 |

### 자동화 cron (5개 + 검증 2개)
| jobid | 이름 | 스케줄 | 비고 |
|---|---|---|---|
| 1 | `collect_notices_every_30min` | `*/30 * * * *` | 공고 수집 |
| 2 | `collect_results_daily_06kst` | `0 21 * * *` | 낙찰정보 |
| 3 | `reset_api_counters_daily_00kst` | `5 15 * * *` | API 쿼터 |
| 4 | `auto-predict-every-30min` | `3,33 * * * *` | 공고→예측 |
| 5 | `refresh-analysis-assets-daily` | `0 18 * * *` | agency_predictor + band_correction + win_strategy_cache |
| 8 | `prediction_quality_daily` | KST 04:00 | 최근 7일 재집계 |
| 9 | `weekly_quality_report` | 월 KST 05:00 | gate/drift/delta |

---

## 5. 예측 엔진 흐름 (요약)

### 5-1. predict_v6_2 (DB, 운영 자동 예측 — `g2b_manual` / `g2b_auto`)
5계층 가중평균:
1. 직접 매칭 (동일 발주사·금액대) — n≥5: 0.40
2. 유사 케이스 (동일 발주사·유사 금액대) — n≥3: 0.25
3. 주력업체 (발주사 단골) — 0.15
4. `agency_predictor` 오프셋 — 0.10
5. 발주유형 `at` 전체 평균 — 0.10

`final_adj = weighted_sum + amount_band_correction`

호출: `predict_notice(p_notice_id bigint)` → bid_predictions INSERT/UPDATE

### 5-2. predictV5 (JS, 파일 업로드 수동 예측 — `file_upload`)
```
optAdj = ref.med + TYPE_OFF[at] + agencyOff
agencyOff = agency_predictor.adj_offset × min(1, n/10)
biasAdj = clamp(±0.5, avgPreBias×0.3 + avgDrawBias×0.2)
```

### 5-3. recommendAssumedAdj (JS, 사용자 추천 분위수)
```
base = ASSUMED_ADJ_TABLE[at][tier]
if agAss[ag|tier] n≥10: w=0.8, n≥5: w=0.5, n≥3: w=0.3
elif agSt[ag] n≥5: agOff = ag_med - at_med, w=0.3~0.5
참여업체수 보정: pc<100 → p25-=0.05/p75+=0.05, pc>3000 → 반대
```

### 5-4. 라우팅 분류 (`opt_adj_router`)
| route | 조건 | 참고 MAE (1148건) |
|---|---|---|
| `agency_rich` | 해당 발주사 n≥5 | 0.526% / hit±0.5 55.4% |
| `blend` | 2≤n<5 → 발주사·유형 가중평균 | 0.532% / hit±0.5 57.9% |
| `tier_fallback` | n<2 → at 전체 | 0.576% / hit±0.5 50.9% |
| `agency_redirect` | AGENCY_LOOKUP_REDIRECT 매핑 | 옛데이터 격리 |

---

## 6. 측정 경로 분리 (중요, Phase 23-7 발견)

DB의 정확도 메트릭과 frontend 표시값은 **완전히 분리**되어 있음:

| 컬럼/메트릭 | 산출 경로 | WIN_OPT_GAP | 변경 영향 측정 가능? |
|---|---|---|---|
| `bid_predictions.opt_adj` | DB `predict_v6_2` (5계층) | ❌ | ✅ `evaluate_model_release` |
| `bid_predictions.pred_bid_amount` | `pred_adj_rate × xp` | ❌ | ✅ |
| `bid_predictions.rec_adj_p25/p50/p75` | file_upload: `recommendAssumedAdj` / 자동: `predict_notice` | ❌ | ✅ in-band SQL |
| `rec_1st_possible.aggressive` | `rec_bid_p25 ≤ actual_bp AND ≥ floor` (supabase.js:75) | ❌ | ✅ |
| `prediction_quality_daily.top1_hit_*` | `rec_1st_possible` 직접 읽기 | ❌ | ✅ |
| **frontend "1위 목표 투찰금"** (`calcWin1stBid`, NoticesTab) | `bid × fr / (fr+gap)` | ✅ **유일** | ❌ 사용자 실투찰만 측정 가능 |

**금기**: `WIN_OPT_GAP`을 정확도 개선 목적으로 변경하지 말 것. 이 상수는 사용자 시각 표시 전용이며 `/evaluate` 게이트가 잡지 못함. 측정 가능한 메트릭은 `opt_adj` 경로(predict_v6_2) 또는 `rec_adj_*` 경로(recommendAssumedAdj/predict_notice)만.

---

## 7. Phase 23-7 변경 (2026-04-27 commit `702aa9b`)

### P1 — 군시설 under300M 분위수 정렬
파일: `src/lib/constants-tables.js:65`
```diff
- "군시설": {under300M:{p25:0.04, p50:0.48, p75:0.92}, ...}
+ "군시설": {under300M:{p25:-0.10, p50:0.45, p75:0.85}, ...}
```
근거: 군시설 매칭 60일 데이터 actual `{p25:-0.241, p50:+0.322, p75:+0.814}`에 정렬. ag 보정(-0.15) 후 적용 평균 `{-0.25, +0.30, +0.70}`이 실측에 근접 → in-band 41.7% → 45~50% 추정.
영향 격리: ASSUMED는 at별 격리 → 한전·고양시·기타 발주유형 무영향.
**효과 측정 가능 시점**: +14일 (2026-05-11) in-band 비율 비교 SQL.

### P3 — predict_notice DB 함수 NULL 버그 수정
ALTER FUNCTION으로 적용 (git 추적 밖, 본 문서 §10에 마이그레이션 SQL 보관).
- 기존: UPDATE 절에 `rec_bid_p50 = v_bid`만 있고 `rec_bid_p25/p75` 누락 → 자동예측의 4%(8/207)가 NULL
- 수정: `v_adj_p25/p75` → `v_xp_p25/p75` → `v_bid_p25/p75` 변수 산출 후 UPDATE
**효과 측정**: +7일 신규 g2b_manual/g2b_auto row의 rec_bid_p25/p75 NULL 0% 도달 확인

### deploy-gate PASS 결과
- 빌드 OK (789.66 kB, 2.05s)
- evaluate_model_release v6.2 14d: PASS (mae 0.6049 동일치, opt_adj 무관 변경 입증)
- 핵심 영역 MAE +0.02 악화 없음

---

## 8. 조달청 시설공사 적격심사세부기준 요약

> 원문: `D:\2026_프로젝트\01_AI입찰분석기\01_문서\1_조달청 시설공사 적격심사세부기준(개정전문).hwpx`

본 문서는 **적격심사 기준**(시공경험·경영상태·신인도 평가)이며, 우리 예측 시스템의 **낙찰하한율(RATE_TABLE)과는 별개**. 두 시스템은 분리해서 다뤄야 함.

### 8-1. 공사규모별 평가기준 (제2조)

| 공사 규모 (전기·통신·소방·국가유산공사 등) | 별표 |
|---|---|
| 100억 미만 50억 이상 | [별표 1] |
| 50억 미만 3억 이상 (일반: 50억 미만 10억 이상) | [별표 2] |
| 10억 미만 3억 이상 (건설산업기본법) | [별표 3] |
| 3억 미만 8천만원 이상 (일반: 3억 미만 2억 이상) | [별표 4] |
| 8천만원 미만 (일반: 2억 미만) | [별표 5] |

**우리 앱 주요 대상은 전기/통신/소방** → 8천만원 ~ 50억원 구간이 핵심. [별표 2]/[별표 4]/[별표 5] 적용.

### 8-2. 핵심 운영 규칙
- **적격통과점수**: 95점 이상 (제4조)
- **순공사원가 98% 미만 자동 탈락** (제5조): 100억 미만 공사
  ```
  순공사원가 = (예비가격기초금액 중 재료비/노무비/경비 + 부가세) × (예정가격 / 예비가격기초금액)
  ```
- **이의신청**: 통보일로부터 3일 이내 (제4조)
- **결격사유**: 부도·파산·해산·부정당업자 제재·영업정지·입찰무효 (제6조)
- **공동수급체 평가**: 시공비율 가중 (제3조)

### 8-3. 우리 시스템과의 관계
- **적격심사 기준은 회사 자체의 자격 평가** — 우리 예측 시스템(사정률·낙찰하한율)과 직접 연동 안 됨
- 다만 **순공사원가 98% 하한**은 향후 "추천 투찰금이 순공사원가 98% 위인지" 검증 로직 추가 시 활용 가능 (현재 미반영)
- **별표 1~5의 평가표 본문**은 hwpx의 표 객체에 있어 텍스트 추출 불가 — 필요 시 사용자가 한컴오피스로 직접 확인

### 8-4. 부칙 이력 (최신 5건)
- 제7726호 (2024.08.26 시행)
- 제4353호 (2024.05.10 → 2024.05.17 시행)
- 제161호 (2024.01.05 → 2024.01.08 시행)
- 제11568호 (2023.12.20 → 2024.01.01 시행)
- 제5882호 (2023.06.29 → 2023.06.30 시행)

---

## 9. 다음 작업 후보 (우선순위)

### 9-1. 14일 후 (2026-05-11) — Phase 23-7 효과 검증
```sql
-- P1: 군시설 under300M in-band 비율 변화
SELECT at, ba<3e8 AS under300M, COUNT(*) n,
       AVG(actual_adj_rate) avg_actual,
       AVG(rec_adj_p25) avg_p25, AVG(rec_adj_p50) avg_p50, AVG(rec_adj_p75) avg_p75,
       100.0*COUNT(*) FILTER (WHERE rec_adj_p25<=actual_adj_rate AND actual_adj_rate<=rec_adj_p75)/COUNT(*) in_band
FROM bid_predictions
WHERE match_status='matched' AND at='군시설' AND open_date >= CURRENT_DATE - 30
  AND rec_adj_p25 IS NOT NULL AND actual_adj_rate IS NOT NULL
GROUP BY at, under300M;

-- P3: 자동예측 NULL 비율
SELECT source, COUNT(*) n, COUNT(rec_bid_p25) p25_filled, COUNT(rec_bid_p75) p75_filled
FROM bid_predictions
WHERE source IN ('g2b_manual','g2b_auto') AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY source;
```

### 9-2. P2 재설계 (predict_v6 at별 차등 보정)
- 직전 검토(predict-architect)에서 "글로벌 보정은 한전 회귀 위험" 판정
- 후보: 군부대·교육청·LH +0.15, 한전 0, 기타 +0.05 (at별 차등)
- 별도 세션 권고. 적용 전 predict-architect 재호출 필수.

### 9-3. 한전 under300M in-band 17.6% (predict-architect 발견)
- 한전 over300M는 48.1%인데 under300M만 낮음
- ASSUMED 베이스 `{0.26, 0.67, 1.07}` 또는 ag 보정이 under300M에 안 맞을 가능성
- 30일 추가 데이터 누적 후 재평가

### 9-4. 군시설 over300M 분위수 (n=5 보류)
- 베이스 `{0.59, 1.00, 1.38}` vs 실측 `{-0.46, -0.13, -0.07}` 1.5 차이
- 표본 부족이라 변경 위험. 30일 추가 누적 후 재평가.

### 9-5. 발주사 단위 재학습 후보
- 경기도, 경기도 의정부시, 서울교통공사, 제7군단 — bias |Δ|>0.3
- `agency_predictor` 재계산 cron이 일 1회 작동 중 → 데이터 축적되면 자동 보정 기대
- 자동 갱신 효과가 부족하면 수동 ag_offset 추가 검토

### 9-6. WIN_OPT_GAP 정합성 점검 (선택)
- 현재 frontend "1위 목표 투찰금" 표시값. DB 메트릭에 영향 없음을 명시 필요
- `bid_details` 자사 입찰 데이터 누적되면 재추정 가치 있음. 우선순위 낮음.

---

## 10. Phase 23-7 P3 마이그레이션 SQL (롤백 대비)

본 SQL은 git 추적 밖이므로 별도 보관:

```sql
-- 적용일: 2026-04-27
-- 변경: predict_notice UPDATE 절에 rec_bid_p25, rec_bid_p75 채움 추가
-- 롤백: 변경 전 함수 본문은 docs/PREDICTION_SYSTEM_REVIEW_20260424.md 또는
--       2026-04-27 시점 git history (e1b94cd 커밋) 직전 DB dump 참조

CREATE OR REPLACE FUNCTION public.predict_notice(p_notice_id bigint)
 RETURNS TABLE(pred_id bigint, ag text, predicted_adj numeric, pred_bid numeric, status text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  -- 신규 변수
  v_adj_p25 numeric; v_adj_p75 numeric;
  v_xp_p25 numeric; v_xp_p75 numeric;
  v_bid_p25 numeric; v_bid_p75 numeric;
  -- (기존 변수 생략, 본문 fully reproduced — 위 docs/PREDICTION_SYSTEM_REVIEW_20260424.md 참조)
  ...
BEGIN
  ...
  IF v6 IS NOT NULL AND v6.predicted_adj IS NOT NULL THEN
    ...
    -- P3 신규 산출 블록
    v_adj_p25 := v6.confidence_low + v_band_corr;
    v_adj_p75 := v6.confidence_high + v_band_corr;
    v_xp_p25 := ROUND(COALESCE(n.ba, v_ep) * (1 + v_adj_p25 / 100), 0);
    v_xp_p75 := ROUND(COALESCE(n.ba, v_ep) * (1 + v_adj_p75 / 100), 0);
    IF COALESCE(n.av, 0) > 0 THEN
      v_bid_p25 := CEIL(n.av + (v_xp_p25 - n.av) * v_fr / 100);
      v_bid_p75 := CEIL(n.av + (v_xp_p75 - n.av) * v_fr / 100);
    ELSE
      v_bid_p25 := CEIL(v_xp_p25 * v_fr / 100);
      v_bid_p75 := CEIL(v_xp_p75 * v_fr / 100);
    END IF;
    ...
    UPDATE bid_predictions SET
      ...,
      rec_adj_p25 = v_adj_p25, rec_adj_p50 = v_final_adj, rec_adj_p75 = v_adj_p75,
      rec_bid_p25 = v_bid_p25, rec_bid_p50 = v_bid, rec_bid_p75 = v_bid_p75,
      ...
    WHERE id = v_new_id;
  END IF;
  ...
END;
$function$;
```

전체 함수 본문 백업: `pg_get_functiondef('predict_notice'::regproc)` 실행 결과를 `db/migrations/20260427_predict_notice_p3.sql`에 저장 권고 (현재 미수행).

---

## 11. 참조 문서 매핑

| 문서 | 역할 | 위치 |
|---|---|---|
| 본 문서 | 발주사별 운영 데이터·보정 상수·인프라 (Phase 23-7) | `docs/PREDICTION_SYSTEM_REVIEW_20260427.md` |
| 직전 리뷰 | 구조 설명·Phase 23-3 규칙 (3일 전) | `docs/PREDICTION_SYSTEM_REVIEW_20260424.md` |
| 예측 엔진 상세 | predictV5/predict_v6 흐름 (일부 outdated, Phase 12-D 기준) | `docs/skills/03-prediction-engine.md` |
| 데이터 아키텍처 | 테이블 구조·컬럼 정의 | `docs/skills/02-data-architecture.md` |
| 도메인 지식 | 사정률·복수예가·낙찰하한율 | `docs/skills/01-domain-knowledge.md` |
| Generator/Evaluator 규칙 | 변경 검증 절차 | `CLAUDE.md` (Phase 23-3 섹션) |
| 정확도 슬래시 | 9체크 측정 | `.claude/commands/accuracy.md` |
| 회귀 검증 슬래시 | PASS/WARN/FAIL 3값 판정 | `.claude/commands/evaluate.md` |
| 적격심사 원문 | 조달청 시설공사 평가기준 | `D:\2026_프로젝트\01_AI입찰분석기\01_문서\1_조달청 시설공사 적격심사세부기준(개정전문).hwpx` |

---

## 12. 변경 이력

| Phase | 일자 | 주요 변경 |
|---|---|---|
| 12-D | 2026-04 | agency_predictor 도입, 발주사별 effective_offset |
| 17-A | 2026-04 | WIN_OPT_GAP 도입 (frontend 1위 목표 투찰금 표시) |
| 21 | 2026-04-18 | TYPE_OFF 재교정 (교육청 -0.20→-0.45 등), v6.2 production 승격 |
| 21-R | 2026-04-21 | WIN_OPT_GAP[군시설] 0.385→0.150 (frontend만, DB 무영향) |
| 23-3 | 2026-04-23 | Generator/Evaluator 분리 규칙, 5단계 하네스 트리거 |
| 23-4 | 2026-04 | benchmark_rate (SUCVIEW 1위 투찰 벤치마크) 도입 |
| 23-6 | 2026-04-25 | refresh_prediction_bias no-op 교체로 cron 9일 실패 복구 |
| **23-7** | **2026-04-27** | **P1 군시설 ASSUMED 정렬 + P3 predict_notice rec_bid_p25/p75 NULL 수정** |
