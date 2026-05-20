# Codex Round 9 검증 의뢰문

> 작성일: 2026-05-21 (Phase 2 마무리 후)
> 직전 라운드: 8 (composite 8.1/10) — 코드-문서 정합성 6.5 + KPI 신뢰도 6.8 감점이 핵심
> 평가 대상: **오늘 세션 5개 commit 종합 + V2_DOMAIN_RULES_CHECK 7/9 정정 완료**

---

## 1. 평가 의뢰 핵심 질문

1. **오늘 세션 전체 효과를 정량 평가하면?** (라운드 8 8.1/10 → 라운드 9 ?/10)
2. **Phase 2 #1-a (recommendV2 한정 적용) 결정이 KPI 신뢰도(라운드 8 6.8/10) 감점을 얼마나 해소했는가?**
3. **잔여 #1-b/#2 중 다음 세션 우선순위는?**
4. **V2 마스터플랜 §9 종료 조건 (4주 연속 pass + n≥500) 도달 예상 시점은?**

---

## 2. 오늘 세션 commit 시퀀스 (2026-05-21)

| commit | 종류 | 내용 |
|---|---|---|
| `b4e9470` | docs | 코덱스 라운드 8 (8.1/10) + B3 정책-실태 불일치 정정 (옵션 A 채택). 5 파일 문구 정정 (HANDOFF·V2_DDL_SPEC·migrations/README·m18 SQL·CODEX_ROUND_8_BRIEF) |
| `58e95fd` | refactor | #5 ceilToWon + #3 ceilToThousand 공통 절상 함수 추출. calcBid 인라인 → 함수 호출 리팩토링. 수학적 동등성 보장 |
| `7009018` | feat | #6 m21 — agency_mode_lookup adj_range_min/max 두 NUMERIC(4,2) 컬럼 추가 + 41 row 일률 ±3% 적재 |
| `466a308` | feat | **#1-a 자사 유효 낙찰하한율 모듈** — effectiveFloor.js 신규 + recommendV2 본체 effFr 도입 + OwnScoreInput.jsx 신규 + App.jsx localStorage·state·헤더 렌더·ownScore 전달 |
| `05be203` | docs | 핸드오프 갱신 — Phase 2 #1-a/#3/#5/#6 완료 마킹 + #1-b 등재 |

총 6 commit (전일 핸드오프 commit `0c7673d` 제외), Generator 변경 3 (b4e9470 docs / 58e95fd 리팩토링 / 466a308 신규 모듈), DB 변경 1 (m21).

---

## 3. V2_DOMAIN_RULES_CHECK 7/9 정정 (오늘 추가분 4건)

| # | 항목 | 상태 |
|---|---|---|
| #0 era_v2 컬럼 | ✅ (어제 m17) |
| **#1-a 자사 유효 낙찰하한율 (recommendV2)** | ✅ **466a308 (오늘)** |
| #1-b legacy 통합 (predictV5/recommendBid1st/recommendAssumedAdj) | ⚠ 잔여 |
| #2 ba_seg → ep 전환 | ⚠ Phase 3 |
| **#3 LH 천원 절상** | ✅ **58e95fd (오늘)** — ceilToThousand 공통 함수 추출 |
| #4 'mixed' 격리 + current 재적재 (라운드 8 옵션 A 정정 포함) | ✅ (어제 m18 + 오늘 b4e9470 정정) |
| **#5 투찰금액 절상** | ✅ **58e95fd (오늘)** — ceilToWon 공통 함수 추출 |
| **#6 발주처별 사정범위 메타** | ✅ **7009018 (오늘 m21)** |
| #7 공동도급 제외 | ✅ (어제 m20) |

**7/9 close, 2 잔여**. 잔여는 모두 V2 핵심 경로(recommendV2) 외 (legacy 함수 통합 / ba_seg 의미 정확화).

---

## 4. 현재 예측 시스템 상태 (2026-05-21 기준)

### 4.1 Mode B (안착 모드 — 한전·LH·교육청·조달청·지자체·수자원)

- floor_pass_daily 'v2_modeB_real' (어제 적재): 전체 n=300, pass_rate=96.00%, calibration_gap=1.02%p
- 'v2_modeB_post_m20' (오늘 m20 효과 측정): n=133, pass_rate=96.99%, gap=2.01%p (표본 -56%는 윈도우 차이, m20 효과 자체는 0건 — 공동도급 표본 0)
- 모든 발주사 PASS (kpi_target 0.90)
- mode_gate_report 한전 98.21%, 지자체 94.74%, LH·교육청·조달청 100%

### 4.2 Mode A (군시설 공략 모드)

- win_zone_daily current (오늘 cron): 군시설 n=60, pct_in_win_zone=10.00%, median_gap=0.4245
- 어제 mixed 데이터 (n=153, win_zone=12.42%) → 오늘 current 필터(n=60, 10.00%)로 표본 성격 변화
- v2_modeA_weekly_gate 12.42% WARN 유지 (목표 15%)
- AT grain n=31로 `recommendModeA` 컨볼루션 정상 가동 (라운드 8 옵션 A 채택)

### 4.3 Phase 2 #1-a 적용 (오늘)

- recommendV2 본체에 effFr 도입
- score 디폴트 20 → effFr === fr → bid_predictions.opt_bid 신규 적재 비트 단위 동일
- 사용자가 score 변경 시 모든 신규 V2 예측에 일률 적용 (모드 A·B 공통)
- legacy 함수(predictV5/recommendBid1st/recommendAssumedAdj)는 미적용 → Plan #1-b 잔여
- localStorage 'bidAnalyzer.ownScore' 영구 저장
- UI: 헤더에 OwnScoreInput 렌더 (메인 추천 패널 듀얼 표기는 Task 6 스킵)

### 4.4 #6 m21 — agency_mode_lookup 메타

- adj_range_min/max 두 NUMERIC(4,2) 컬럼 + 41 row 일률 ±3% 적재
- 향후 recommendV2 grid 검색 범위를 발주사별 동적 설정의 기반 (현 ±1.5% 고정)
- 호출처 없음 (dead column 상태, 향후 사용 예정)

---

## 5. 라운드 8 감점 항목 점검

| 라운드 8 항목 | 라운드 8 점수 | 오늘 변화 | 라운드 9 추정 |
|---|---|---|---|
| 도메인 정확성 (30%) | 8.8 | #3 LH 천원 절상 + #5 투찰금액 절상 공통 함수화 + #6 사정범위 메타 + #1-a 자사 점수 도입 | +상승 예상 |
| 안전성 (25%) | 8.4 | score=20 디폴트 비트 동등성 + 5대 게이트 PASS + matched row 보호 유지 | 유지~상승 |
| 측정 일관성 (20%) | 8.6 | m21 adj_range 메타 추가 (즉시 활용 없음) | 유지 |
| **코드-문서 정합성 (15%)** | **6.5** | B3 정책-실태 불일치 정정 (b4e9470) + 핸드오프 갱신 (05be203) | **+상승 강함** |
| **KPI 신뢰도 (10%)** | **6.8** | #1-a 자사 유효 낙찰하한율 도입 — P(적격심사 통과)=1.0 가정 해소 시작점 | **+상승 강함 (단 score 활용 사용자 의존)** |

---

## 6. 코덱스 평가 항목 (라운드 8 동일 가중치)

1. 도메인 정확성 (era 분리·공동도급 제외·게이트 신설·자사 점수·LH 천원 절상·투찰금액 절상·사정범위 메타) — 30%
2. 안전성 (Mode B PASS 유지, Mode A 게이트 WARN 유지, score 디폴트 비트 동등성) — 25%
3. 측정 일관성 (cron 자동화, model_version 분리, m21 메타 추가) — 20%
4. 코드-문서 정합성 (B3 라운드 8 옵션 A 채택, 핸드오프 갱신) — 15%
5. KPI 신뢰도 (#1-a 자사 점수 도입의 효과, score 사용자 활용 가능성) — 10%

---

## 7. 다음 세션 우선순위 후보

1. **#1-b legacy 통합** — predictV5/recommendBid1st/recommendAssumedAdj도 calcEffectiveFloorRate 적용. V2 외 추천 경로 일관성 확보. 회귀 위험 통제 위해 분리됨.
2. **#2 ba_seg → ep 전환** — agency_mode_lookup·agency_gap_distribution 재적재 필요. 큰 변경.
3. **Task 6 듀얼 표기 적용 (effectiveFloor formatFloorDual UI)** — V2 추천 결과 카드에 "표준 X% → 자사 Y%" 표기. UI 일관성 보강.
4. **/accuracy 24h 후 재측정** — 오늘 #1-a 적용 후 사용자 score 활용 패턴 모니터링.
5. **V6 retire 준비** — Mode B n≥500 + 4주 연속 pass 자연 진행 (~6주 후 후보).

---

## 8. 단일 진실 문서

- `docs/v2/HANDOFF_V2_MASTER_PLAN.md`
- `docs/v2/HANDOFF_NEXT_SESSION.md` (오늘 갱신)
- `docs/superpowers/specs/2026-05-21-effective-floor-rate-design.md` (오늘 신규)
- `docs/superpowers/plans/2026-05-21-effective-floor-rate-plan.md` (오늘 신규)
- 본 문서 (`docs/v2/CODEX_ROUND_9_BRIEF.md`)

---

_의뢰자: Claude Opus 4.7 / 의뢰 일자: 2026-05-21 (라운드 8로부터 ~6시간 후)_
