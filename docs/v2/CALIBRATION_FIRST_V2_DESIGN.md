# 이후 예측 시스템 설계안 — Calibration-First V2

> 대상: Claude Code 세션
> 일자: 2026-05-25
> 상태: 설계 확정 (Codex 교차검증 + predict-architect 영향도 검토 반영). 코드 미작성.
> 상위 문서: `HANDOFF_V2_MASTER_PLAN.md` (단일 진실)
> 관련 명세: `V2_MEASUREMENT_SPEC.md`, `V2_DDL_SPEC.md`, `A_MODE_A_MILITARY_WIN_DESIGN_2026-05-23.md`
> 근거 메모리: `project_win_prob_levers_competition_trap`

---

## 0. 한 줄 결론

> 못 맞히는 추첨(사정률)을 더 맞히려 하지 말고, 맞힐 수 있는 통과확률을 정직하게 **보정(calibration)** 한다.

낙찰확률을 올리는 검증 가능한 레버는 `bid_rate` 공간의 **(A) Mode B 하한통과율**, **(B) Mode A WIN-zone 진입률** 뿐이다. 경쟁강도(참가자수) 기반 마진 사이징은 도메인상 함정이며 영구 금지한다.

---

## 1. 설계 전제 — 정확도 천장 (데이터 확인)

predict-architect 측정 (최근 60일):

| 핵심영역 | n(60d) | n(90d) | bias | MAE | 해석 |
|---|---|---|---|---|---|
| 한전 | 58 | 62 | +0.0549 | **0.4485** | 이론하한(0.642) **이하** = accuracy 천장 돌파 |
| 군부대 | 80 | 124 | +0.0676 | 0.5238 | 천장 근처 |
| 고양시 | 9 | 11 | +0.4680 | 0.7720 | n 부족, 통계적 무의미 |

- 사정률 = 예정가격/기초금액, 예정가격은 복수예비가 C(15,4) 추첨 평균 → 이론 MAE 하한 0.642%.
- 한전 MAE 0.4485 < 0.642 → **정확도(MAE) 레버는 죽었다.** 사정률을 더 맞히려는 시도는 전면 중단.

### 1.1 경쟁강도 함정 (영구 금지 근거)

2026-05-25 Codex 교차검증 + 코드 증거:
- **order-statistics IID 가정 붕괴** — 적격심사 입찰자는 독립 난수가 아니라 같은 예측서비스·낙찰하한율·반올림 규칙·하한 공포를 공유. N↑→최저 초과값↓ 논리가 성립하지 않음.
- **코드 증거**: `src/lib/utils.js:590` — v5에서 경쟁강도 보정을 역효과(<1500명 5.0% vs ≥1500명 5.8%)로 이미 제거.
- **proxy 부적격**: `pc`(참가자수)는 개찰 후(post-hoc) 값이라 신규 예측 시점엔 미지. `AT_AVG_PARTICIPANTS`(constants-tables.js:118)는 자사 투찰 479건 표본 평균 → 표본편향+생존편향.
- → `pc`는 "분산투찰 경고" UI 용도로만. 마진/추천금액 산식에 넣으면 검증 안 된 보정 상수 장식.

---

## 2. 설계 원칙

1. **accuracy 추구 중단, calibration 우선** — "P(하한통과)=95%"가 실제로 95% 통과하도록 만드는 게 곧 낙찰확률.
2. **모드별 단일 KPI** — Mode B(비군시설)=하한통과율, Mode A(군시설)=WIN-zone 진입률. 둘 다 `bid_rate` 공간.
3. **경쟁강도(pc) 마진 영구 금지** (§1.1).
4. **정직성** — 가짜 win_prob 노출 금지. Mode B는 `win_prob:null` 유지(`utils.js:1130`), 하한통과확률·WIN-zone진입확률만 표기.

---

## 3. 세 가지 레버

### L1 — Mode B 하한통과 calibration (비군시설, 최대 효과)
- **내용**: `recommendV2` Mode B의 P(하한통과)를 per-(canonical_ag, 금액대) 분포로 보정. 목표 하한통과율 ≥90%.
- **⚠️ 가드 (predict-architect)**: 좁은 WIN-zone 영역(한전·LH·교육청, p90 gap 0.002~0.01%)에서 targetProb를 무작정 올리면 X가 커져 **좁은 zone을 위로 넘어버린다**(하한은 통과하나 낙찰 zone 이탈). → **targetProb 상향에 `p90_gap` 폭 반비례 캡** 필수. 무한 상향 금지.
- **분류**: Generator → `/evaluate` 필수.
- **수정 위치**: `recommendModeB` (`utils.js:879-912`), `recommendV2` Mode B 분기 (`utils.js:1109-1182`).

### L2 — 저표본 영역 hierarchical shrinkage
- **내용**: `insufficient_sample`(V2_DDL_SPEC:139,154 enum, 이미 존재) 영역에서 기관유형 prior로 mean 추정 축소 → 분산↓ → 과신(탈락)·과보수(마진 과다) 동시 완화.
- **⚠️ 가드 (predict-architect)**: shrinkage는 **distribution.mean의 분산 축소**이지 bias 오프셋 가산이 아니다. **별도 bias 테이블을 만들면 G-bias 게이트 FAIL**(`evaluate.md:178-221`, src 카운트 UNION). → 반드시 `recommendV2` distribution 추정 단계 내부(`utils.js:1112-1120`)에서 수행하고 `// 격리: shrinkage=분산축소, bias 오프셋 아님` 가드 주석 명시.
- **분류**: Generator. 단 고양시(n=11)·LH(n=11)는 표본 부족으로 효과 사전·사후 측정 불가 → 변경 허용하되 `floor_pass_daily` 8주 누적 후 `calibration_gap`으로 사후 평가.

### L3 — Mode A WIN-zone gap 실측화 (군시설 한정)
- **내용**: `recommendModeA`의 m_star/δ를 `winner_gap = win_bid_rate − floor_rate` 실측 분포로 검증·보정. `A_MODE_A_MILITARY_WIN_DESIGN_2026-05-23.md` Phase 3 연계 (군부대 n_90d=124 충분).
- **⚠️ 가드 (predict-architect)**: `floorErrDist`를 비군시설 호출부에 전달하지 않도록 `App.jsx` 호출부 점검. 코드상 `mode==='A'` 분기 + fallback 'B'(`utils.js:1078`)라 누설 방향은 안전하나 입력 차단 확인.
- **분류**: Generator(m_star 산출) + Evaluator(gap 분포 측정) 혼합 → 분리 구현.
- **수정 위치**: `recommendModeA` (`utils.js:836-877`).

### 비레버 (설계상 영구 금지)
- pc/AT_AVG 마진 사이징 · adj_rate WIN-zone/`opt_adj` UPDATE (`CLAUDE.md:103,119`) · `recommendBid1st` 종형 fallback 확장(폐기 예정 취약 경로, `utils.js:1167`).

---

## 4. 측정·게이트 (재구축 불필요, 기존 인프라 위에 얹힘)

predict-architect 확인: mode_gate_report(21건)·win_zone_daily(49건)·floor_pass_daily(59건)·agency_mode_lookup(41건) 일배치 적재 진행 중.

| 레버 | 검증 소스 | 컬럼 |
|---|---|---|
| L1 | `floor_pass_daily` | `pred_floor_pass_prob_avg` vs `actual_floor_pass_rate`, `calibration_gap` (V2_DDL_SPEC:107-109) |
| L3 | `win_zone_daily` | `pct_in_win_zone`, `p90_gap` (V2_DDL_SPEC:77-83) |
| 통합 | `mode_gate_report` | A=pct_in_win_zone / B=actual_floor_pass_rate |

- 게이트: `/evaluate` 4게이트(단위/A안/bias/모드표시). bid_rate 공간 변경이라 G-단위 PASS 예상, 핵심영역 MAE +0.02 FAIL 트리거 구조적으로 낮음.
- 배포 후 24h `/accuracy` 재측정 유지 (보조 모니터링).

---

## 5. 선결조건 검증 결과 (2026-05-25 — 해소)

**판정: L1은 G-단위 게이트에서 FAIL하지 않는다. 진행 가능.**

검증: `calcFloorPassProb`/`recommendModeB`는 **사정률(adj_rate) 공간 산술**이 맞다.
- `utils.js:794` 정의: `P(자사투찰 ≥ 낙찰하한가) = P(실제 사정률 ≤ X) = Φ((X−mean)/std)`
- `utils.js:804` `z=(adj−mean)/effStd`, `:801` 노이즈플로어 0.642%(사정률 공간), `recommendV2:1097` `xpC(adj)=ba*(1+adj/100)` → `adj`는 사정률(% 편차).

그럼에도 FAIL 아닌 이유 (3중 근거):
1. **폐기된 것은 adj_rate WIN-zone(양방향 모순식)** `my_adj < win_adj AND my_adj ≥ adj_rate`(MEASUREMENT_SPEC §2.1). 하한통과는 **단방향**(`my_bid ≥ floor`)이라 모순 없음. 또 floor-pass 사건은 단조변환으로 **공간 불변** — 사정률 분포로 계산해도 동일 확률.
2. **G-단위 게이트(evaluate.md:91-128)는** 신규 `+`라인에 (win_zone|in_win_zone|pass_top1|pct_win|pct_pass_floor) **AND** (adj_rate|adj_rate_error|opt_adj) 동시 출현, 또는 신규 DB func/view에 win_zone+adj_rate일 때만 FAIL. L1 코드는 변수 `adj`(bare)·`floor_pass_prob`이며 win_zone/opt_adj 토큰 미포함 → 검출 0건 PASS.
3. **MEASUREMENT_SPEC §6.1** 명시: adj_rate 공간 사정률 추적은 G-단위 FAIL 대상 아님(게이트 목적=신규 WIN-zone/승률 KPI 신설 금지). L1 KPI는 `floor_pass_daily.calibration_gap`(bid_rate) → 준수.

**2차 확인 항목 (BLOCKER 아님, L1 1차 구현 시 점검)**: `agencyDist`/`win1st_dist_map`의 `mean/std`가 실제로 **사정률 분포**인지 확인. MEASUREMENT_SPEC §3.1은 win1st_dist_map을 "1위 투찰률(bid_rate) 분포"로 재해석 의도하나, `calcFloorPassProb`는 사정률 분포를 기대(grid `mean±1.5`가 사정률 ≈0 기준). 입력 분포 공간이 어긋나면 게이트가 아니라 **calibration 정확성**이 틀어진다 → 한전(n=62) 1차에서 실데이터 `mean` 값으로 공간 확인.

---

## 6. 인프라 충돌 1건

- L1의 per-ag targetProb 저장은 `agency_mode_lookup`에 컬럼이 없음(현재 adj_range_min/max만, V2_DDL_SPEC:58-62) → B2 시점 모드 컬럼 ADD와 묶어 진행.

---

## 7. 단계적 롤아웃 (회귀위험 中)

```
선결: §5 calcFloorPassProb 측정공간 검증
1차: L3(군부대 n=124) + L1 한전(n=62)   ─ 표본 충분, calibration_gap 관찰
2차: L1 나머지 충분표본 영역
3차: L2 고양시·LH(저표본)              ─ 8주 누적 후 사후 평가
```

각 레버는 Generator → 구현 후 `/evaluate` PASS/WARN 시에만 push, FAIL 시 push 금지 (`CLAUDE.md` Phase 23-3).

---

## 8. Calibration 실측 baseline (2026-05-25, `floor_pass_daily`)

calibration-first 원칙 — 코드 변경 전 현 calibration 측정 결과 (model_version=v2_modeB_canonical, calibration_gap=ABS(pred−actual)):

| at | n | pred_pass | actual_pass | gap | 해석 |
|---|---|---|---|---|---|
| 한전 | 16 | 0.950 | 1.000 | 0.050 | 과보수(100% 통과) |
| 교육청 | 7 | 0.950 | 1.000 | 0.050 | 과보수(저n) |
| LH | 6 | 0.950 | 1.000 | 0.050 | 과보수(저n) |
| 지자체 | 109 | 0.950 | 0.908 | 0.041 | **과신** (하한미달 9.2%) |
| 전체 | 140 | 0.950 | 0.929 | 0.021 | 경미한 과신 |

### 8.1 §3 L1 가정 정정 (데이터 기반)
설계 초안의 "좁은 WIN-zone 영역(한전 등) targetProb **상향**"은 **데이터와 반대**다.
- 한전·교육청·LH: 이미 actual=100% 과보수 → targetProb 상향은 낭비(이미 max). ≥90% KPI 헤드룸(10%p) 내에서 **하향**해 낙찰 기회 회복이 오히려 정방향.
- 지자체: 과신(90.8%<95%) → 분포 보수화/std 확대 방향.
→ L1은 "일률 상향"이 아니라 **영역별 calibration_gap 부호에 따라 양방향 조정**으로 재정의.

### 8.2 즉시 구현 보류 (calibration-first 규율)
한전 n=16·교육청 n=7·LH n=6은 단일 일배치라 robust하지 않음. 유일하게 의미 있는 신호는 지자체 과신(n=109)이며 이것도 1일치.
→ `floor_pass_daily` 일배치 누적(가동 중) **수주~8주 후 재측정**으로 영역별 정정 방향 확정 후 L1 코드 착수. 그 전 Generator 변경은 소표본 과적합 위험.
