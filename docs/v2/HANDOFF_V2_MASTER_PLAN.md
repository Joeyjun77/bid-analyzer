# HANDOFF: 입찰분석기 V2 — 통합 마스터플랜 (코덱스 검증 정정판)

> 대상: Claude Code 세션
> 일자: 2026-05-19
> 상태: 코덱스 독립검증 (6/10 → 정정 후 85%) 반영 완료
> 분리 문서: `V2_DDL_SPEC.md` (테이블 명세), `V2_UI_SPEC.md` (화면 명세)
> 선행 핸드오프: `HANDOFF_V2_PREDICTION_DEFINITION.md`, `HANDOFF_V2_WIN_DEFINITION.md`, `HANDOFF_V2_DIAGNOSIS_RESULT.md`
> 후속 설계: `CALIBRATION_FIRST_V2_DESIGN.md` (2026-05-25, 정확도 천장 인정 → calibration 우선 방향 전환)

---

## 0. 전제 (Invariants)

| 항목 | 처리 |
|------|------|
| 보존 | bid_records 63K, bid_details 880, canonical_ag, agency_win_stats, win1st_dist_map, predictions_v2 그릇 |
| 폐기 | adj_rate 공간 WIN-zone 측정, recommendBid1st 종형 캡, MAE 1차 KPI 지위 (산포 낮은 사정률 영역 예외 — `V2_MEASUREMENT_SPEC.md` §6.1) |
| 보류 | V6(opt_adj) — dual-run n≥500까지 가동 유지 |
| 금지 | bid_predictions.opt_adj UPDATE, bid_records DELETE, predictions_v2 UPDATE (A안 INSERT-only) |

---

## 1. 코덱스 검증 반영 — 원안 대비 정정 5건

| # | 원안 | 정정 | 근거 |
|---|------|------|------|
| 1 | B0 1~2주 통째 BLOCKER | **B0a(0.5주, B2 병행) + B0b(B2 가동 후 1주)** | B0 전체 고정은 과함. 최소 측정 도구만 BLOCKER |
| 2 | D3 DDL 초안 | **`V2_DDL_SPEC.md` 분리** | DDL 4개가 핸드오프 근거 없는 창작 → 별도 명세 락인 |
| 3 | B2 "≥95% 최공격 X" | **calibration 가능 정의로 재기술** (§4 참조) | 문서 외 추가 정의, calibration 미입증 |
| 4 | B5 n≥500 단일 카운터 | **영역별 분리 카운터 — Mode B 먼저 retire** | 군시설 n≥500 도달 ~12개월, 전체 묶으면 dual-run 중 재수정 |
| 5 | UI = B3 곁가지 1줄 | **독립 U 트랙(U0~U3) 신설** | 현 UI는 한전·LH(WIN-zone 0%)에서 거짓 약속. B와 동급 |

---

## 2. 3-트랙 구조

```
D 트랙 (재설계, Week 1)      ─ 코드 작성 전 결정 락인
B 트랙 (백엔드 구축)         ─ 엔진·검증 인프라
U 트랙 (UI 재구축)           ─ B와 병렬, 약간 선행
```

---

## 3. D 트랙 — 재설계 (Week 1, 코드 작성 전)

### D1 — 측정 공간 전환 락인
- 산출물: `docs/V2_MEASUREMENT_SPEC.md`
- 정식 WIN-zone 판정식: `floor_rate ≤ my_bid_rate < win_bid_rate`
- adj_rate 공간이 모순식임을 명세에 명시 (DIAGNOSIS §1~2 인용)
- MAE를 "보조 지표"로 강등하는 정책 1줄 명문화
- 폐기 컬럼: `prediction_quality_daily.top1_hit_*`, `phase17_validation.in_confidence_band`(adj_rate 기반)

### D2 — Mode A/B 분기 기준 확정

> **이 표는 작성 시점(2026-05-19) mixed era 기준 추정값입니다.** m26 적용 후 current-only 측정값은 §D2.1 참조. 영역 분류 결론은 mixed/current 모두 일관 (지자체 "조건부 A" 미활성 추가 정정 외).

| 영역 | n | gap p90 (mixed 추정) | 권장 모드 | 1차 KPI | 목표 |
|------|-----|---------|-----------|---------|------|
| 군시설 | 186 | 0.7993 | A | WIN-zone 진입률 | 10.8% → 15%+ |
| 지자체 | 349 | 0.0209 | **B (조건부 A 미활성)** | 하한 통과율 | 51.6% → 90%+ |
| 교육청 | 230 | 0.0102 | B | 하한 통과율 | 57.0% → 90%+ |
| 한전 | 39 | 0.0060 | B | 하한 통과율 | 69.2% → 90%+ |
| 조달청 | 26 | 0.0019 | B + 공격성 교정 | 하한 통과율 | 46.2% → 80%+ |
| LH | 11 | 0.0060 | B (n 보강 후) | 하한 통과율 | 81.8% → 90%+ |

### D2.1 — current-only 측정값 (m26 적용 후, 2026-05-21)

m26 `refresh_win_zone_daily` era_v2='current' 필터 적용 후 90일 윈도우 측정값:

| 영역 | n (current 90일) | gap p90 | pct_in_win_zone | 모드 판정 (재검증) |
|------|-----|---------|-----------|---------|
| 군시설 | 60 | 0.6070 | 10.00% (WARN) | A 유지 |
| **지자체** | 126 | **0.2345** (outlier 1건 영향) | 2.38% | **B 유지** (실제 정상 분포는 ≤ 0.0518) |
| 교육청 | 12 | 0.0059 | 0.00% | B 유지 |
| 한전 | 23 | 0.0060 | 0.00% | B 유지 |
| 조달청 | 7 | 0.0006 | 0.00% | B + 공격성 교정 유지 |
| LH | 6 | 0.0013 | 0.00% | B 유지 (n 보강 필요) |

**지자체 정정 근거** (JIJACHE_MODE_A_REVIEW_2026-05-21.md):
- `lookup_agency_mode` RPC: 지자체 7개 발주사 모두 Mode B 권장, 최대 p90_gap = 0.0518 (경기도 고양시)
- m26 측정 0.2345는 **outlier 1건**(`id=348193`, `win_bid_rate=66.4059`, floor 대비 -22pp) 단독 영향
- 정상 분포 기준 마스터플랜 §3 D2 조건 `gap_p90 ≥ 0.10` 미충족 → 조건부 A 미활성

**자동 분기 함수**는 §D2 그대로 (이 표는 정책 결정 근거이며 함수는 lookup_agency_mode RPC 결과 사용):

```python
def select_mode(at, agency_gap_p90):
    if at == "군시설":          return "A"
    if agency_gap_p90 >= 0.10:   return "A"   # 현재 지자체는 미충족
    return "B"
```

- n<30 영역(한전·조달청·LH)은 신뢰구간 명시 의무
- D2.1 갱신 일자: 2026-05-21 (m26 적용 + JIJACHE_MODE_A_REVIEW 검증 후)

### D3 — 검증 시스템 스키마 설계
- **DDL 본문은 `V2_DDL_SPEC.md`로 분리** (코덱스 정정 #2)
- 본 문서는 테이블 4개의 존재·역할만 명시:
  - `agency_mode_lookup` — 영역별 모드 판정 (정적, 일배치)
  - `win_zone_daily` — Mode A 검증 집계
  - `floor_pass_daily` — Mode B 검증 + calibration
  - `mode_gate_report` — 영역별 주간 게이트
- DDL_SPEC가 컬럼·PK·인덱스·enum(`insufficient_sample` 포함)·confidence 산식 락인

### D4 — 마이그레이션·롤백·dual-run 정책
- Phase 23-9 v2 206건: 컬럼 보존, `bid1st_v2_src='종형환원폐기'` 마킹 → dual-run 표본 제외
- dual-run 카운터: **영역별 분리** (코덱스 정정 #4)
- V6 retire 조건 (Mode B 먼저):
  - Mode B 영역 n≥500 누적 AND
  - 하한 통과율 V2 > V6 + 10%p (영역 평균) AND
  - 4주 연속 게이트 pass
- Mode A(군시설)는 별도 트랙 — n≥500 도달까지 ~12개월 예상, V6 병행 유지
- 롤백 트리거: 게이트 fail 4주 연속 또는 핵심 영역 회귀 시 V6 단독 복귀

---

## 4. B 트랙 — 백엔드 구축 (Week 1~14)

### B0a — 최소 측정 인프라 (BLOCKER, 0.5주, Week 1~2)
> 이것만 BLOCKER. B2 시작 전 완료 필수.
- `agency_mode_lookup` 테이블 생성 + 1회 백필
- `bid_rate` 공간 측정 함수 1개 (`refresh_floor_pass_daily` 코어)
- V6 베이스라인을 신규 KPI로 측정해 baseline 동결 저장

### B0b — 운영 고도화 (B2 가동 후 1주)
- `win_zone_daily`, `floor_pass_daily`, `mode_gate_report` 테이블 + refresh 함수
- 슬래시 커맨드 갱신: `.claude/commands/accuracy.md`, `evaluate.md`

### B1 — 영역별 gap lookup 적재 (0.5주)
- `agency_mode_lookup` 초기 적재 (canonical_ag × baSeg, n≥10 keys)
- 표본 부족 영역은 at-level fallback row
- `lookup_agency_mode(at, canonical_ag, ba)` RPC (LATERAL 금지, 정적 캐시)

### B2 — Mode B 엔진 (2~3주, Week 3~5) — 대상 77.7%
- `recommendBid1st` 리팩토링: 종형 캡 제거, `calcFloorPassProb()` 신설
- **추천 사정률 정의 (코덱스 정정 #3 재기술)**:
  > "예측 하한통과확률 ≥ 95%를 만족하는 가장 공격적인 X.
  >  단, calibration 검증 — 사후 1주 실측 통과율 ≥ 예측 통과율 − 5%p 만족."
- `bid_predictions`에 신규 컬럼 6개 ADD (`b_pred_floor_pass_prob`, `b_pred_mode` 등) — 기존 row UPDATE 금지
- 조달청 별도 bias 레이어 (OPT_OFFSET·predictor_bias_correction과 중복 차단)
- B2는 **Generator 분류** → predict-architect 사전 검토 + `/evaluate` 강제

### B3 — Mode A 엔진 (군시설, 2주, Week 6~7)
- 군시설 한정 경쟁 분포 추정 (`win_bid_rate − floor_rate`, n=186)
- 부트스트랩 1000회 신뢰구간
- 낙찰 곡선 `P(낙찰|X)` 내부 계산 — **UI엔 추천값 하나만 노출** (U_SPEC 참조)
- **A→B fallback 트리거 명시**: Mode A 게이트 fail 2주 연속 시 군시설도 임시 Mode B

### B4 — 조달청 공격성 교정 (0.5주, Week 8)
- 하한 통과율 46.2% → 80%+ 보정
- `predictor_bias_correction` row 추가, OPT_OFFSET와 적용 순서 명시
- 다른 영역 회귀 없음 확인

### B5 — dual-run 평가 (Week 9~)
- Mode B: n≥500 + 4주 연속 pass → ~3개월 내 V6 retire 후보
- Mode A: 별도 카운터, ~12개월 트랙
- WARN 시 24시간 내 `/accuracy` 재측정, FAIL 시 deploy-gate가 push 차단

---

## 5. U 트랙 — UI 재구축 (B와 병렬, 약간 선행)

> 상세 화면 명세는 `V2_UI_SPEC.md`. 본 문서는 단계·일정만.

| 단계 | 시기 | 내용 | 백엔드 의존 |
|------|------|------|-------------|
| U0 | Week 1~2 (B0 병행) | App.jsx 1,294줄 분할 + `RecommendPanel` 골격(mock). 99.8525 버그 자연 소멸 | 없음 — 선행 |
| U1 | Week 2 (B1 직후) | `ModeBadge` + `modeResolver.js` — agency_mode_lookup 연결 | B1 |
| U2 | Week 3~5 (B2 병행) | `RecommendPanel` 안착 모드 — 메인 숫자=하한 통과 확률 | B2 |
| U3 | Week 6~7 (B3 병행) | 같은 패널 공략 모드 prop 추가 — 곡선 없음, 추천값 하나 | B3 |

핵심: U0를 mock으로 선행 → B2 엔진 나오면 즉시 연결.

---

## 6. /evaluate 게이트 — 4개 강제 (코덱스 정정 #3 + UI 1개)

| 게이트 | FAIL 조건 |
|--------|-----------|
| 단위 게이트 | 측정 컬럼이 `*_adj_rate` 계열이면 FAIL (bid_rate 계열만 허용) |
| A안 게이트 | 매칭된 row UPDATE 시도 발견 시 FAIL |
| bias 중복 게이트 | OPT_OFFSET + predictor_bias_correction + 조달청 bias가 동일 row 중복 적용 시 FAIL |
| 모드 표시 게이트 | 안착 모드 화면에 "낙찰 확률" 문자열 렌더링 시 FAIL |

---

## 7. 마일스톤·일정

| 주차 | D/B/U | 주요 산출물 |
|------|-------|-------------|
| Week 1 | D1~D4 + B0a + U0 | 설계문서 4건, DDL_SPEC, App.jsx 분할 |
| Week 2 | B0a완료 + B1 + U1 | 측정 인프라, lookup 적재, ModeBadge |
| Week 3~5 | B2 + B0b + U2 | Mode B 엔진, 안착 모드 화면 |
| Week 6~7 | B3 + U3 | Mode A 엔진, 공략 모드 prop |
| Week 8 | B4 + B5 시작 | 조달청 교정, dual-run 리셋 |
| Week 9~11 | B5 (Mode B) | Mode B n≥500 누적 → retire 후보 |
| Week 12~ | B5 (Mode A) | 군시설 장기 트랙 |

---

## 8. 위험 매트릭스

| 위험 | 단계 | 완화책 |
|------|------|--------|
| 표본 부족 (한전 39, LH 11, 조달청 26) | B2 | 결과에 n 명시, 신뢰구간 게이트 |
| 군시설 과적합 (n=186) | B3 | 부트스트랩, A→B fallback |
| 종형 캡 제거 단기 회귀 | B2 | predict-architect 사전 검토 + /evaluate 강제 |
| 조달청 보정 타 영역 영향 | B4 | 영역 격리 bias 레이어 |
| Mode A n≥500 ~12개월 | B5 | 영역별 분리 카운터, Mode B 먼저 retire |
| UI 거짓 약속 (안착에 낙찰확률 표시) | U2 | 모드 표시 게이트 (§6) |

---

## 9. 종료 조건

- 모든 영역 `mode_gate_report.gate_status='pass'` 4주 연속
- Mode B 영역 평균 하한 통과율 ≥ 90%
- Mode A 군시설 WIN-zone 진입률 ≥ 15%
- 전 영역 calibration_gap < 5%p
- Mode B에서 V2 > V6 + 10%p 입증 (Mode A는 별도 장기 판정)

---

## 10. 절대 준수 (핸드오프 §8 재확인)

- `bid_records`/`bid_details` DELETE 금지
- `bid_predictions.opt_adj` 매칭 레코드 UPDATE 금지 (A안 INSERT-only)
- `predictions_v2` UPDATE 금지
- DDL은 `apply_migration` + 명시적 확인, 분리 적용(개별 롤백 가능)
- bias 레이어 중복 적용 금지 (§6 게이트로 강제)
- 자사 낙찰률은 추적만 — 목표 KPI 아님

_DDL 명세 → `V2_DDL_SPEC.md` / 화면 명세 → `V2_UI_SPEC.md`_
