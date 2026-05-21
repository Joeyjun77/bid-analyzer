# 예측 시스템 + 예측 검증 진행 방향 (2026-05-21)

> 작성자: Claude Opus 4.7
> 트리거: 사용자 "현재 예측 시스템과 예측 검증에 대해 진행 방향을 설명" 요청 + 코덱스 의견 수렴
> 단일 진실: `SYSTEM_AUDIT_2026-05-21.md` (메타 점검), `HANDOFF_NEXT_SESSION.md` §9.8 (전체 진행 영구 기록)
> 본 문서는 라운드 16 BRIEF가 아닌 **시스템 방향 + 로드맵 공유**용 (코덱스 의견 수렴 후 라운드 16 트리거 결정)

---

## 1. 현재 예측 시스템 본질 (메타 점검 결과)

### 1.1 4종 예측의 영역별 적합성

| 시스템 | 무엇을 예측 | 자사 1위 적중 직접 기여 | 적용 영역 |
|---|---|---|---|
| **V6 `predict_v6`** | 1위 사정률 점추정 (`opt_adj`) | **직접** — 자사 신고 사정률 결정 입력 | 사정률 점추정 영역 (한전·교육청·LH·조달청·지자체) |
| **V8 (`predict_v8`)** | 1위 사정률 점추정 (병렬, dual-run) | **직접** — V6 검증·대체 후보 | 전 영역 dual-run, agency_type / agency / global fallback |
| **agency-floor V1** | 발주사별 1위 사정률 분포 중앙값 | **참고·교차 검증** | 전 영역 |
| **V2 Mode A** | 자사 사정률이 WIN-zone 진입 확률 | **직접** — 1위 가능 범위 진입 확률 | 군시설만 (gap_p90 ≥ 0.10) |
| **V2 Mode B** | 자사 투찰가 하한 통과 확률 | **간접 안전망** — 무효 입찰 방지 | 전 영역 보조 |

### 1.2 영역별 모드 분기 (V2_UI_SPEC §3.1.2 + JIJACHE_MODE_A_REVIEW)

| 영역 | gap_p90 (current) | 1위 본질 | 메인 라벨 | Mode A 활성화 |
|---|---|---|---|---|
| **군시설** | 0.6070 | WIN-zone 진입 | **WIN-zone 진입확률** (Mode A) | ✅ |
| 한전 | 0.0060 | 사정률 정확도 | **사정률 점추정** (V6+V8+agency-floor) | ❌ B 유지 |
| 교육청 | 0.0059 | 사정률 정확도 | 사정률 점추정 | ❌ B 유지 |
| 지자체 | 0.0518 (최대) | 사정률 정확도 | 사정률 점추정 | **❌ B 유지** (조건부 A 미활성, JIJACHE 검증) |
| 조달청 | 0.0006 | 사정률 + 공격성 교정 | 사정률 점추정 + 공격성 교정 배지 | ❌ B 유지 |
| LH | 0.0013 | 사정률 정확도 | 사정률 점추정 | ❌ B 유지 (n 보강 후) |

### 1.3 본 세션 핵심 발견 (자사 1위 적중 직결 영역 비대칭)

`/accuracy` 진단 결과 (체크8, 60일):
- **한전 Top-1 적중률 72.73%** ✅
- 조달청 40.00%, LH 36.37%
- **군시설 2.53% 🚨, 지자체 7.87% 🚨, 교육청 0~8% 🚨, 수자원공사 0% 🚨**

→ **현 시스템은 한전 위주 최적화**. 비한전 영역의 1위 적중률이 매우 낮음. 사용자 본질 의문 "예측 사정률이 맞는 건가"의 근거.

---

## 2. 예측 검증 인프라 현 상태

### 2.1 V2 측정 인프라 정합 7단계 완성 (m20~m30)

| 단계 | 마이그레이션 | 의미 |
|---|---|---|
| 1 | m20 | refresh_floor_pass_daily 공동도급 제외 |
| 2 | m25 | refresh_agency_adj_range era 정합 |
| 3 | m26 | refresh_win_zone_daily era 정합 |
| 4 | m27 | refresh_floor_pass_daily canonical 분기 (V6 retire 정합 카운터) |
| 5 | m28 | bid_records.at 분류 정합 (군 발주사 145건) |
| 6 | m29 | refresh_win_zone_daily outlier sanity check ±5pp |
| 7 | m30 | bid_records.is_duplicate flag (중복 113건) + refresh_win_zone_daily 필터 |

### 2.2 V6 retire 게이트 카운터 (canonical 기준)

| 조건 | 상태 |
|---|---|
| n≥500 | ✅ matched 1,660 / matched+actual 1,360 |
| 4주 연속 PASS | ❌ **canonical 카운터 0주** (mixed 5/18·5/19 무효, canonical 5/25 시작) |
| Mode B 통과율 ≥90% | ✅ canonical _overall_ 0.9704 (n=135) |
| calibration gap ≤5pp | ✅ _overall_ 0.0206 |
| Mode A WIN-zone ≥15% | ❌ WARN (current-only 10.00%, m30 후 13.33%, 목표 -1.67pp~-5pp) |

**ETA**: ~2026-06-22 (canonical 첫 weekly gate 5/25 + 4주 PASS 누적)

### 2.3 코덱스 라운드 15 평가 (메타 점검 후)

**Composite 8.9/10** (라운드 13 8.5 → +0.4):
- 도메인 정확성 9.0 / 안전성 8.8 / 측정 일관성 9.1 / 코드-문서 8.5 / KPI 신뢰도 8.7
- 코덱스 인용: **"메타 점검 진입 자체가 옳았다. 이 라운드의 가장 큰 개선점이다."**
- Critical 0 / Major 3 (1 정정 완료) / Minor 3 (1 정정 완료)

### 2.4 운영 모니터링 발견 (accuracy 진단)

| 지표 | 현 상태 |
|---|---|
| 전체 MAE 14일 | 0.7188 (5/19 0.4084 대비 +0.3104 ⚠) |
| 군시설 14일 드리프트 | +0.1949 🚨 |
| 고양시 MAE | 1.0932 (n=3, 단방향 +1.09 bias 🚨) |
| Phase 17 confidence_band_pct | 41.67% 🚨 (목표 70%+) |
| weekly_quality_report 적재 | 5/04 주 까지만, 5/11·5/18 누락 ⚠ |
| V8 fetch | ✅ 본 세션 chunk 페이징 fix (ae18713) |

---

## 3. 향후 진행 방향 — 단기·중기·장기 로드맵

### 3.1 단기 (1~2주, 즉시 진행 가능)

| # | 작업 | 분량 | 우선순위 | 진입 조건 |
|---|---|---|---|---|
| S1 | **m33** weekly_quality_report cron 적재 누락 fix (`generate_weekly_quality_report` silent fail 분석 + 5/11·5/18 backfill) | 1일 | High | 즉시 |
| S2 | **canonical_ag 정규화 보강** (지자체 28% NULL, 중복 master 100% NULL) | 1~2일 | High | 즉시 |
| S3 | **at 소스 표준화** (d.at vs r.at vs p.at) — 코덱스 Minor #2 | 1일 | Medium | 즉시 |
| S4 | **고양시 단방향 bias 정밀 진단** (data accuracy vs V6 모델 결함 구분) | 0.5일 | Medium | 표본 n≥10 누적 후 |
| S5 | **육군교육사령부 7건 처리** (at='교육청'→'군시설' 도메인 판단) | 0.5일 | Low | 즉시 |
| S6 | **m32** UNIQUE(pn_no) WHERE is_duplicate=false 부분 인덱스 | 0.5일 | Medium | 24시간 모니터링 (5/22) 후 |
| S7 | **Phase 17 신뢰구간 재조정** (confidence_band_pct 41.67% → 70%+) | 3~5일 | Medium | 즉시 |

### 3.2 중기 (2~6주, 시간 누적 + 별도 세션)

| # | 작업 | 분량 | 진입 시점 |
|---|---|---|---|
| M1 | **m31** legacy era 2,578건 중복 정정 | 1주 | 5/28 (1주 모니터링 후) |
| M2 | **canonical 4주 PASS 누적 → V6 retire 판정** | 4주 자동 | 2026-06-22 무렵 |
| M3 | **군시설 pred_bias_map 재학습** (14일 드리프트 +0.1949) | 1주 | accuracy 추적 누적 후 |
| M4 | **agency_predictor 재학습** (한전 72.73% vs 군시설 2.53% 비대칭 해소) | 1~2주 | 별도 세션 권고 |
| M5 | **Mode A 군시설 15% 목표 도달 가능성 재평가** | 1주 | current-only 데이터 4주 누적 후 |
| M6 | **라운드 16 BRIEF** (코덱스 트리거 조건 충족 시) | — | M1/M6 완료 또는 5/25 weekly gate 후 |

### 3.3 장기 (1.5~6개월, 시스템 재설계)

| # | 작업 | 분량 | 비고 |
|---|---|---|---|
| L1 | **Phase 3 #2 — `ba_seg` → `ep` 기반 전환** | 1주 | V2_DOMAIN_RULES_CHECK 마지막 잔여, predict-architect 필수 (Generator) |
| L2 | **V6 retire 후 사정률 점추정 후속 모듈** (`predict_v6` 폐기 후 별도 함수 또는 agency-floor V1 확장) | 2주 | MEASUREMENT_SPEC §6.1 명문화 — Mode B에 통합 금지 |
| L3 | **V2_UI_SPEC §3.1 라벨 코드 반영** (ModeBadge + App.jsx) | 1주 | Generator 분류 가능, predict-architect 호출 필수 |
| L4 | **비한전 영역(군시설·지자체·교육청) 1위 적중률 본질 개선** | 3~6개월 | 시스템 재설계급 작업 |
| L5 | **agency-floor V1 확장** — 발주사별 분포 시각화·alert 기능 강화 | 1~2개월 | 자사 의사결정 직접 지원 |

### 3.4 진행 우선순위 권고 (Claude Opus 4.7 판단)

**즉시 (이번 주)**: S1 (cron backfill) + S2 (canonical_ag) + S3 (at 표준화) 묶음 — 운영 모니터링 정상화 + 데이터 무결성 잔여 회복
**1주 후**: S6 (m32 UNIQUE) + M1 (m31 legacy) — 데이터 무결성 영구 차단
**~6/22**: M2 V6 retire 판정 + M3 pred_bias_map 재학습 + M5 Mode A 재평가
**~7월 이후**: L1 (Phase 3 #2) + L3 (UI 라벨 코드 반영) + L4 (비한전 본질 개선)

---

## 4. 코덱스 의견 수렴 핵심 질문

본 진행 방향에 대해 코덱스에 검증·의견을 받을 6건:

### Q1. 단기 우선순위 적절성
S1 (cron backfill) > S2 (canonical_ag 정규화) > S3 (at 표준화) > S6 (m32 UNIQUE) > S7 (Phase 17 신뢰구간) 순서가 옳은가? 데이터 무결성·운영 모니터링·정합 회복의 우선순위 trade-off.

### Q2. V6 retire 판정 기준 (6/22)
4주 PASS 누적 + Mode B 통과율 ≥90% + calibration gap ≤5pp가 충족돼도 **Mode A 군시설 WARN(15% 미달)**이 잔존하면 V6 retire 가능한가? 마스터플랜 §0 retire 조건은 Mode B 한정인가, 전 영역 종합인가?

### Q3. 비한전 영역 1위 적중률 본질 (L4)
한전 72.73% vs 군시설 2.53%·지자체 7.87% 격차의 본질 원인은:
- (a) 한전 입찰 패턴이 통계적으로 단순 (산포 작음, 점추정 정확도 결정적)
- (b) 군시설·지자체 입찰 패턴이 본질적으로 추정 곤란 (참여자 수·복수예가 추첨 노이즈)
- (c) V6 모델 자체의 영역별 학습 편향 (한전 데이터 편중)
- 어느 가설을 우선 검증해야 하는가?

### Q4. V6 retire 후 점추정 모듈 형태 (L2)
MEASUREMENT_SPEC §6.1에 "V6 retire 후 점추정 모듈은 Mode B에 통합 말고 별도 분리"로 명문화. 실제 구현 형태는:
- (a) 별도 함수 `predict_dist` (코덱스 라운드 9 권고 명칭) 신설
- (b) agency-floor V1의 `agency_rate_distribution`을 점추정 모듈로 격상
- (c) V8(`predict_v8`)을 V6 대체로 승격
- 어느 방향이 V2 마스터플랜 정신에 부합?

### Q5. 라운드 16 트리거 시점
코덱스 라운드 15 권고는 "M31/M32 완료 후" 또는 "5/25 첫 canonical weekly gate 후" 또는 "Mode A 재평가 자료 후"의 3 조건. 어느 시점이 라운드 16 BRIEF의 가장 큰 평가 가치를 제공하는가?

### Q6. 본 진행 방향에서 누락된 영역
본 §3 로드맵이 빠뜨린 시스템 영역 또는 결함 (예: V8 dual-run의 V6 대체 후보로서의 평가, agency-floor V1의 UI 위치, Phase 17 신뢰구간의 본질적 정의 등)?

---

## 5. 진행 방식

본 문서를 코덱스에 메타 상의 의뢰 (`codex:codex-rescue` 서브에이전트)
→ 코덱스 응답을 §6 신규 sub-section으로 기록
→ 코덱스 권고 반영 후 단기 작업(S1~S7) 우선순위 확정
→ 5/22~5/25 canonical cron 자동 누적 → 5/25 첫 weekly gate 결과로 라운드 16 트리거 결정

---

_본 문서는 본 세션 메타 점검 + 7단계 측정 정합 + V8 fetch fix 결과를 종합한 진행 방향. 코덱스 의견 수렴 후 라운드 16 트리거 또는 단기 작업 진입 결정._
_작성자: Claude Opus 4.7 / 작성 일자: 2026-05-21 / 후속: codex:codex-rescue 의견 수렴_
