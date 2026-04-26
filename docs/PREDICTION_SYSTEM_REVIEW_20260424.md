# bid-analyzer 예측 시스템 설계 검증 요약

> **기준일**: 2026-04-24
> **목적**: 예측 코어·보정층·검증 인프라 설계의 구조적 타당성을 한 눈에 점검할 수 있는 요약
> **원문 레퍼런스**: `SYSTEM_DESIGN_20260418.md`, `HANDOFF_CLAUDE_CODE.md`, `src/lib/utils.js`, `CLAUDE.md`, `.claude/commands/{accuracy,evaluate}.md`

---

## 1. 서비스 정체성 — 4대 출력

한국 공공조달(전기·통신·소방) 입찰에서 발주사별 **사정률 예측**을 4개 값으로 환원.

| # | 출력 | 용도 | 필드 |
|---|---|---|---|
| 1 | 최소 사정률 | 하한 공격 시나리오 | `ref.q1` / `ci70.low` |
| 2 | 최소 하한금액 | 무효 경계선 | `calcBid(ref.q1)` |
| 3 | 1위 추천 사정률 | 낙찰 목표 | `optAdj = ref.med + typeOff + agencyOff` |
| 4 | 추천 투찰금액 | 실제 투찰 액면가 | `optBid = calcBid(optAdj)` |

앱은 정보 제공 도구이며 투찰은 나라장터에서 수행 — "확정/제출" 류 UI 없음.

---

## 2. 예측 엔진 2-track 구조

| 엔진 | 위치 | 역할 | 보정 체계 |
|---|---|---|---|
| `predict_v6_2` | DB (PL/pgSQL) | 운영 자동 예측 | 5계층 가중 + `predictor_bias_correction` + `amount_band_correction` |
| `predictV5` | `src/lib/utils.js:228` | 수동/백테스트 | `ref` 선택(agency_rich/blend/fallback) + `bid_details` 패턴 보정 + `TYPE_OFF` + `agencyOff(n/10 shrinkage)` |

### 2-1. predict_v6_2 가중치 (5계층)

| 순위 | 계층 | 가중 | 조건 |
|---|---|---|---|
| 1 | 직접 매칭 (동일 발주사·동일 금액대) | 0.40 | n≥5 |
| 2 | 유사 케이스 (동일 발주사·유사 금액대) | 0.25 | n≥3 |
| 3 | 주력업체 (발주사 단골) | 0.15 | — |
| 4 | `agency_predictor` 오프셋 | 0.10 | — |
| 5 | 발주유형 `at` 전체 평균 | 0.10 | — |

`final_adj = weighted_sum + bias_correction + amount_band_correction`

### 2-2. predictV5 최종 공식 (utils.js:322~343)

```
optAdj = ref.med + TYPE_OFF[at] + agencyOff
agencyOff = agency_predictor.adj_offset × min(1, n/10)     # Bayesian shrinkage
biasAdj    = clamp(-0.5, +0.5, avgPreBias×0.3 + avgDrawBias×0.2)   # bid_details 기반
```

---

## 3. 라우팅 분류 (`routePrediction`, utils.js:217)

| route | 조건 | 참고 MAE (1,148건 표본) |
|---|---|---|
| `agency_rich` | 해당 발주사 `n≥5` | 0.526% / hit±0.5 55.4% |
| `blend` | `2≤n<5` → 발주사·유형 가중평균 (w=0.5~0.7) | 0.532% / hit±0.5 57.9% |
| `tier_fallback` | `n<2` → `at` 전체로 대체 | 0.576% / hit±0.5 50.9% |
| `agency_redirect` | `AGENCY_LOOKUP_REDIRECT` 매핑 발주사 (LH 본사 → 경기남부) | 옛데이터 격리 |

이론 노이즈 바닥 **0.642%** (4-of-15 복수예비가 추첨의 구조적 랜덤성). 세 주 route 모두 바닥에 근접 → 건강.

---

## 4. 보정층 상수 (src/lib/utils.js)

### 4-1. TYPE_OFF (utils.js:322)
```
지자체 -0.15 / 군시설 0.00 / 교육청 -0.45 / 한전 +0.10
LH -0.10 / 조달청 -0.10 / 수자원공사 -0.10
```
근거: 1,091건 백테스트. 교육청 -0.45는 Phase 21에서 -0.20 → -0.45로 재조정.

### 4-2. WIN_OPT_GAP (Phase 17-A, utils.js:20)
1위 목표 투찰금 보정. `bid1st = opt_bid × fr / (fr + gap)`.
```
지자체 0.493 / 군시설 0.385 / 교육청 0.533 / 한전 0.367
조달청 0.676 / LH 0.088 / 수자원공사 0.003
```

### 4-3. 데이터 시점 보호
- `STALE_CUTOFF = "2024-01-01"` (utils.js:158): 이전 데이터는 발주사 개별 학습에서만 제외(at 통계는 유지)
- `AGENCY_REDIRECT`: 옛 데이터만 보유한 발주사(LH 본사 등)는 학습 제외 → 대체 발주사가 자기 데이터로 자연 학습

### 4-4. 신뢰구간 (utils.js:289~294)
```
effStd = max(ref.std, 0.642)     # 이론 바닥 강제
ci70 = med ± 0.52×effStd         # 백테스트 교정값
ci90 = med ± 1.28×effStd
```

---

## 5. 낙찰하한율 규칙 (RATE_TABLE, utils.js:40)

2026 개정 반영. 기관별 시행일 분리 관리(`cutoff` + `isNewEra`).

| 기관 | 시행일 | 3억 미만 | 3~10억 | 10~50억 | 50억+ |
|---|---|---|---|---|---|
| 조달청 | 2026-01-30 | 90.25% | 89.745% | 88.745% | 87.495% |
| 지자체 | 2025-07-01 | 90.25% | 89.745% | 88.745% | 87.495% |
| 교육청 | 2025-07-01 | 90.25% | 89.745% | 88.745% | 87.495% |
| 한전 | 자체기준 유지 | 88.25% | 87.745% | 86.745% | 85.495% |
| LH | 2026-02-01 | 90.25% | 89.745% | 88.745% | 87.495% |
| 군시설 | 2026-01-19 | 90.25% | 89.745% | 88.745% | 87.495% |
| 수자원공사 | 2026-02-27 | 90.25% | 89.745% | 88.745% | 87.495% |

한전은 144건 중앙값 87.745% 실측 검증으로 구기준 유지. 여성기업 가산(−0.25%p)은 UI 선택 옵션.

---

## 6. 투찰금액 공식 (utils.js:280, calcBidAmount)

```
A값 없음:  투찰금 = CEIL(ba × (1 + adj/100) × fr/100)
A값 있음:  투찰금 = CEIL(av + (ba−av) × (1 + adj/100) × fr/100)
LH 종심제/순심제: 천원 이하 절상, 예측모델이 −2.941로 수렴하는 구조적 미지원 구간 (isLhJongsim)
```

---

## 7. 검증 인프라 (Generator/Evaluator 분리)

### 7-1. 핵심 객체

| 객체 | 타입 | 역할 |
|---|---|---|
| `prediction_quality_daily` | table | 일간 route×at MAE·hit·floor_safe 누적 (KST 04:00 cron) |
| `weekly_quality_report` | table | 주간 gate/drift 자동 판정 (월 KST 05:00 cron) |
| `phase17_validation` | table | A/B등급 실측 낙찰 통과율 |
| `model_registry` | table | version·engine·baseline_mae·status (candidate→shadow→production) |
| `model_release_gate` | table | metric·comparator·tolerance_pct (mae -5%, hit_0_5 +3%, floor_safe 0%) |
| `prediction_shadow` | table | A/B 쉐도우 레인 병행 예측 |
| `evaluate_model_release(candidate, baseline, window_days)` | function | 게이트 일괄 검사 |
| `refresh_prediction_quality_daily(since, until, model_version)` | function | 범위 재집계 |
| `pred_bias_map` | view | ag×at×금액대 잔차 매핑 |

### 7-2. 자동화 cron (5개)

| jobid | 이름 | 스케줄 | 비고 |
|---|---|---|---|
| 1 | collect_notices_every_30min | `*/30 * * * *` | 공고 수집 |
| 2 | collect_results_daily_06kst | `0 21 * * *` | 낙찰정보 |
| 3 | reset_api_counters_daily_00kst | `5 15 * * *` | 쿼터 |
| 4 | auto-predict-every-30min | `3,33 * * * *` | 공고→예측 |
| 5 | refresh-analysis-assets-daily | `0 18 * * *` | agency_predictor + band_correction + win_strategy_cache |
| 8 | prediction_quality_daily | KST 04:00 | 최근 7일 재집계 |
| 9 | weekly_quality_report | 월 KST 05:00 | gate/drift/delta |

---

## 8. Generator / Evaluator 분리 규칙 (Phase 23-3)

예측 코드(`getFinalRecommendation`, `opt_adj` 계산, `pred_bias_map`, 낙찰하한율 함수) 변경 시 **필수 절차**:

1. 변경 직전에 baseline MAE 측정 (`evaluate_model_release` or 직접 쿼리)
2. 변경 후 `/evaluate` 슬래시 커맨드 → **PASS / WARN / FAIL** 3값 판정
3. FAIL 시 git push 금지 → 롤백 또는 수정 후 재검증
4. WARN 이상 변경은 배포 후 24h 내 `/accuracy` 재측정 필수
5. **핵심 영역(한전·고양시·군부대) MAE +0.02 이상 악화는 즉시 FAIL**

### 8-1. /evaluate 판정 기준

- **FAIL**: 빌드 실패 / 핵심 영역 MAE +0.02 악화 / 게이트 passes=false
- **WARN**: 전체 MAE +0.005~+0.02 악화 / 특정 영역 소폭 악화
- **PASS**: 그 외

### 8-2. /accuracy 6체크

1. 최근 14일 MAE 추이 (route별)
2. at별 14d vs 이전 14d 드리프트 (Δ>0.02 경고)
3. 핵심 영역(한전/고양시/군부대) 30일 MAE·bias
4. 주간 게이트 상태 (drift_flag, gate_status)
5. Phase17 실측 통과율 (floor_pass_pct, confidence_band_pct)
6. 이상치 Top 10 (|err|>2σ)

---

## 9. 매트릭스 조직 구조 (수직×수평)

```
수직 1개: 예측 코어 (model_registry · 하네스 · 릴리스 게이트 · A/B 쉐도우)
수평 6개: ①설계 ②수집 ③분석 ④구축 ⑤운영 ⑥검증
```

**교차점 계약 (Interface Contract)** — 파트 내부 변경이 타 파트로 전파되지 않도록 좁게 정의:

| 교차 | 계약 |
|---|---|
| ①설계 ↔ 예측코어 | `constants.js` PR 리뷰 필수 · DB migration |
| ②수집 ↔ 예측코어 | `bid_records.is_excluded` 준수 · `bid_notices.status` |
| 예측코어 ↔ ③분석 | `prediction_quality_daily` UPSERT만 허용 |
| 예측코어 ↔ ④구축 | `model_registry.status='production'` 단일 |
| ⑤운영 ↔ 예측코어 | 모델 헬스 엔드포인트 · cron 결과 |

**금지 예시**: ④구축이 `model_registry`를 우회해 직접 엔진 코드 변경 / ②수집이 `is_excluded=true`를 학습 포함 / ③분석이 `prediction_quality_daily` 외 경로로 재보정 직접 반영

---

## 10. 현재 성능 (2026-04-18 기준)

| 지표 | 값 |
|---|---|
| bid_records 활성 | 54,750건 (88 배제) |
| bid_predictions matched | 1,192건 |
| 이론 노이즈 바닥 | 0.642% (4-of-15 추첨 중앙값) |
| 운영 MAE (v6.2) | 0.49% — 이론 한계 근접 |

**Phase 21 핵심 개선**

| 영역 | Phase 20 → Phase 21 |
|---|---|
| 교육청 MAE | 1.070% → 0.383% (-64%) |
| LH MAE | 0.654% → 0.348% (-47%) |
| 1위 낙찰 가능 (지자체) | 3% → 25.2% (8.4배) |
| 1위 낙찰 가능 (한전) | 21.6% → 41.2% (1.9배) |

---

## 11. 설계 검증 체크리스트

### ✅ 구조적 건전성
- [x] 예측 엔진이 DB/JS 2-track으로 분리되어 서로 대조 가능
- [x] 라우팅 분류기(`routePrediction`)가 route×MAE 분해 분석 가능하게 명시 레이블 저장
- [x] 보정층(TYPE_OFF/WIN_OPT_GAP/agencyOff)이 엔진 외부 상수로 격리 → 코드 변경 없이 튜닝 가능
- [x] 낙찰하한율이 기관별 `cutoff` 날짜로 분리 관리 → 개정 추가 시 표 수정으로 충분
- [x] `is_excluded` + `is_cancelled` 필터로 수의·긴급·유찰 등 비정상 건 학습 배제

### ✅ 회귀 방지
- [x] `model_registry`로 엔진 버전 관리, `production` 단일성 제약
- [x] `model_release_gate` 3rule로 승격 자동 차단
- [x] A/B 쉐도우 레인(`prediction_shadow` + `evaluate_model_release`)으로 무위험 실험
- [x] Generator/Evaluator 분리 + PASS/WARN/FAIL 3값 판정 (`.claude/commands/evaluate.md`)
- [x] 일/주 cron으로 드리프트 자동 감지 → 7일 MA 대비 +20% 악화 플래그

### ✅ 데이터 무결성
- [x] `STALE_CUTOFF` + `AGENCY_REDIRECT`로 옛 데이터 학습 오염 차단
- [x] 잔차 |adj|>5% 제거, `ABS(opt_adj − actual) ≤ 5` 클립으로 극단치 격리
- [x] 신뢰구간 `effStd = max(std, 0.642)`로 이론 바닥 강제

### ⚠ 알려진 취약점 / 한계

| 영역 | 한계 | 대응 |
|---|---|---|
| 나라장터 비공개 정보 | 공고시점 기초/A값 비공개 → `bdgt_amt` 근사 사용 | SUCVIEW 수동 업로드 |
| 군부대(UMM)·직찰·민간 | 나라장터 비공개 | SUCVIEW 유지 |
| 복수예비가 15개 값 | API 미제공 | SUCVIEW 수동 |
| LH 종심제/순심제 대형(≥100억) | 예측값 -2.941로 수렴, 구조적 미지원 | `isLhJongsim` 플래그로 격리 |
| App.jsx 1,834줄 단일 파일 | 변경 블래스트 반경 큼 | 점진 분리(NoticesTab 완료, 진행 중) |

### 📋 검증자 수행 권고 (리뷰어용)

1. `SYSTEM_DESIGN_20260418.md` §7 Phase 21-R 변경 이력과 `git log` 일치 여부 확인
2. `utils.js:322 TYPE_OFF`와 `HANDOFF_CLAUDE_CODE.md §"Phase 21 예측 엔진 보정층"` 수치 일치 여부
3. `RATE_TABLE`의 기관별 `cutoff`와 실제 시행일 공문 대조 (특히 한전 자체기준 유지 근거)
4. `model_release_gate` 시드값이 CLAUDE.md 금기사항(핵심 영역 MAE +0.02 FAIL)과 정합하는지
5. `evaluate_model_release(p_candidate='v6.2', p_baseline='v6.2', p_window_days=14)` 수동 실행해 현재 passes 전부 true인지
6. `prediction_quality_daily` 최근 14일 row가 route×at 조합별로 비어 있지 않은지

---

## 12. 레퍼런스

- `C:\Users\home\bid-analyzer\SYSTEM_DESIGN_20260418.md` (매트릭스 구조, Phase 21-R 변경 이력)
- `C:\Users\home\bid-analyzer\HANDOFF_CLAUDE_CODE.md` (Phase 21 상세)
- `C:\Users\home\bid-analyzer\src\lib\utils.js` (predictV5·RATE_TABLE·TYPE_OFF·WIN_OPT_GAP 원본)
- `C:\Users\home\bid-analyzer\.claude\commands\accuracy.md` (정확도 6체크)
- `C:\Users\home\bid-analyzer\.claude\commands\evaluate.md` (회귀 검증 체크리스트)
- `C:\Users\home\bid-analyzer\CLAUDE.md` (Generator/Evaluator 분리 규칙)
