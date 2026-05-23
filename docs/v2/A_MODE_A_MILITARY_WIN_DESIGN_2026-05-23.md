# A — 군부대 Mode A (1위 확률 최대화) 설계 (2026-05-23)

> 위치: 기존 `A_WIN_OPT_GAP_DESIGN_2026-05-22.md` 의 **Step 3 (산식 분기 / V2 Mode A 합류)** 구체화판.
> Step 1(한전 lock + 그 외 0 clamp)은 임시 처방이었고, 군시설 hit 5~15% 한계의 **본질 해결**이 본 문서.

## 1. 배경 / 목표
- 사용자 자사(태찬산업공사 1282919297, 이룸일렉트릭 7446000370)가 군부대 입찰에서 **1위 낙찰 절실**.
- 결정: **군부대 = 별도 Mode A (1위 확률 최대화, 실격 위험 감수)**, 그 외 발주사 = 기존 Mode B(하한 안착) 유지.
- 사용자 철학(설계 1순위 원칙): **"아무리 예측해도 빗나가면 어차피 실격. 소수라도 실제 1위 낙찰되는 것이 의미 있다."**
- 출처: 코덱스 consult 2회(2026-05-23) + 본 세션 데이터 검증.

## 2. 결정적 데이터 발견 (2026-05-23, `bid_history` n=6,979 군부대)

### 2.1 "면도날 가설" 확정 — 군부대에 넓은 WIN-zone은 없다
1위 낙찰자의 **실제 하한금액 대비 마진** `(rank1_amount/floor_amount − 1)×100`:

| 지표 | 값 |
|---|---|
| p50 | **+0.003%** (사실상 0) |
| p75 | +0.017% |
| p90 | +0.054% |
| p95 | +0.103% |
| +0.05% 이내 낙찰 | **6,225/6,979 = 89.2%** |
| +0.10% 이내 낙찰 | 6,616/6,979 = 94.8% |
| +0.50% 초과 낙찰 | 55건 = 0.79% |

→ **군부대 1위 낙찰자도 실제 하한금액에 초밀집**. 코덱스 1차 답변이 가정한 "넓은 갭 G를 노리는 옵티마이저"는 군부대에 부적합.

### 2.2 함의 — 게임의 본질
> 군부대 1위 = **예정가격(→하한금액)을 가장 잘 맞혀 그 바로 위에 써내기.** 경쟁자 갭 G(~0.05%)는 무시 가능, **지배항은 자사의 예정가격 예측오차(floorErr)**.

이로써 코덱스의 컨볼루션 목적함수 `argmax_m P(floorErr ≤ m ≤ floorErr + G)`가 G≈0 이므로 **단순식으로 수렴**:
```
m_star ≈ quantile(floorErr, 1 − alpha)
```
- alpha = 실격 허용률. 작을수록 안전(높은 마진, 드물게 1위), 클수록 공격(낮은 마진, 자주 1위).
- **alpha가 곧 1위 확률 손잡이.**

## 3. 측정 공간 (V2 bid_rate 공간, 분모 통일)
모든 비율은 **base_amount 분모로 통일** (`rank1_ratio − floor_rate` 같은 분모 혼합 금지):
```
floor_bid_rate            = floor_amount / base_amount
predicted_floor_bid_rate  = predicted_floor_amount / base_amount
자사_bid_rate             = predicted_floor_bid_rate + m
floorErr (bid_rate 공간)  = (actual_floor_amount − predicted_floor_amount) / base_amount
```
- `predicted_floor_amount` = predict_v6 예측 사정률 → 예정가격 → 앱 `calcBid` 공식(a_value 반영)으로 산출.
- 하한 통과: `자사_bid_rate ≥ actual_floor_bid_rate` ⟺ `m ≥ floorErr`. 따라서 `P_under(m) = P(floorErr > m)`.

> **P0 선결**: `bid_history.rank1_ratio`의 정확한 분모가 본 세션 샘플에서 base/ep 어느 쪽과도 깔끔히 일치하지 않음(≈100.x). **import 코드에서 정의 확정 필요.** 단, **본 설계의 백테스트·라이브 계산은 amount 공간(floor_amount, rank1_amount, base_amount)으로 수행**하므로 rank1_ratio 정의 모호성에 영향받지 않음.

## 4. Mode A 결정규칙 (군부대)
```
입력: base_amount, predict_v6 예측 사정률, floor_rate(at·금액대·시기), a_value, ownScore, alpha
1) predicted_floor_amount = calcBid(predicted_ep, a_value, effFr)   // effFr = calcEffectiveFloorRate(floor_rate, ownScore)
2) predicted_floor_bid_rate = predicted_floor_amount / base_amount
3) m_star = quantile(floorErr_segment, 1 − alpha)                   // 세그먼트 경험분포, 최신성 가중 exp(-age/365)
4) 자사_bid_rate = predicted_floor_bid_rate + m_star
5) 자사_bid_amount = base_amount × 자사_bid_rate
반환: { m_star, 자사_bid_amount, p_under_est, p_win_est, alpha_used, segment_n, src }
```
- 경쟁자 갭 G: 1차 구현에서는 **생략(YAGNI)** — 데이터상 무시 가능. 후속에서 작은 가산항으로 옵션화 검토.
- 기존 `recommendModeA`(`src/lib/utils.js:807`)는 경쟁자 갭의 p10/p25/p50을 쓰던 것 → **floorErr 분위수 + alpha 제약**으로 교체. (코덱스 "p10/p25/p50 고정 선택 금지" 반영)

## 5. floorErr 분포 추정 (캘리브레이션)
- **추론 예측기와 동일 캘리브레이션 필수** — leave-one-out median이 아니라 **predict_v6가 그 시점 산출했을 예측치** 기준 오차로 학습 (불일치 시 위험 추정 왜곡).
- `floorErr_i = (actual_floor_amount_i − predicted_floor_amount_i)/base_amount_i`.
- 세그먼트 경험 CDF, 최신성 가중 `weight_i = exp(-age_days/365)`.

## 6. 표본 게이트 / fallback 사다리
```
군부대 + 공사종류 + 금액대 + 하한밴드   n ≥ 300
군부대 + 공사종류 + 금액대             n ≥ 300
군부대 + 금액대                       n ≥ 300
군부대 전체                          n ≥ 1000  (현재 ~6,979 → 견고)
전부 미달 → 보수 fallback: m = q(floorErr, 1−alpha), 단 신뢰도 라벨 하향
```
- 최소 n 미달 시 **`WIN_OPT_GAP=0` clamp로 회귀하지 않음** (코덱스 권고) — floorErr 분위수 fallback 사용.

## 7. 백테스트 명세 (alpha sweep)
- **목적**: alpha ∈ {0.10, 0.125, 0.15, 0.20, 0.25}에 대해 (실제 1위 전환 건수 vs 실격률) 곡선 산출 → sweet spot 채택.
- **자사 1위 판정(과거 재현, amount 공간)**:
  ```
  자사_bid_amount = base × (predicted_floor_bid_rate + m_star(alpha))
  실격            = 자사_bid_amount < actual_floor_amount
  1위 전환        = (자사_bid_amount ≥ actual_floor_amount) AND (자사_bid_amount ≤ rank1_amount)
  ```
  (자사가 하한 위 + 실제 1위금액 이하 → 자사가 최저가로 1위였을 것. rank1_amount·floor_amount는 데이터에 존재.)
- **시작점**: alpha 0.10~0.15. **데이터가 받쳐주면 0.25 방향**까지 확장(사용자 결정).
- **판정 윈도우**: 누적 표본 충분(최소 수백 건)으로 시뮬레이션. 라이브 효과는 배포 후 7~14일 누적(코덱스 §9.7 전례).
- **리포트**: alpha별 {1위전환율, 실격률, 평균 마진, 세그먼트별 n}. "실격 비용 대비 1위전환 증가가 꺾이는 지점" 명시.

## 8. 코드 변경 범위 (추정)
| 파일 | 변경 |
|---|---|
| `src/lib/utils.js:807` `recommendModeA` | 경쟁자 갭 분위수 → **floorErr 분위수 + alpha 제약**. bid_rate 공간 산출 |
| `src/lib/constants-tables.js:30` `WIN_OPT_GAP` | 군부대 스칼라 **사용 중단**(Mode A 경유). 한전/LH 등 비-군부대는 무변경 |
| floorErr 분포 적재 | 세그먼트별 경험 CDF — DB 뷰/RPC 또는 클라이언트 산출 (구현 단계 결정) |
| 호출부 | `App.jsx:577, 586` 군부대 분기 시 Mode A 경로 (Step 2 시그니처 전례 참조) |
| `recommendModeB`(`utils.js:842`) | **무변경** (그 외 발주사) |

## 9. 거버넌스 게이트 (Phase 23-3 + V2)
| 게이트 | 결과 |
|---|---|
| Generator 분류? | **Yes** (군부대 추천 투찰값 변경) |
| predict-architect | **필수** (코드 전, 핵심영역 군부대 영향표 재발급) |
| /evaluate | **필수** — G-단위(bid_rate 공간 확인)/G-A안/G-bias/G-모드표시 + **G-hit(군부대 1위전환·실격률)** |
| 측정공간 | **bid_rate 전용** (adj_rate WIN-zone 신규 금지 — G-단위 FAIL 회피) |
| deploy-gate | **필수** (push 직전, 핵심영역 MAE +0.02 이내 + 한전 hit 회귀 없음) |
| 24h /accuracy | 이상 징후 확인용. 효과 판정은 7~14일 누적 |

## 10. 미해결 / 구현 단계 확정 사항
1. **rank1_ratio 정의 확정** (P0) — import 코드 확인. (백테스트는 amount 공간이라 비차단)
2. **floorErr 캘리브레이션 소스** — predict_v6 라이브 예측치 재현 방법 (DB 백필 vs 클라이언트).
3. **세그먼트 키 정의** — 공사종류·금액대·하한밴드 경계값.
4. **군부대 분류 canonical 목록** — `ag ILIKE '%군%'` 부분일치는 지명(양평군 등) 오탐. 정식 발주기관 분류 필요.
5. **적격심사 통과 가정** — Mode A는 자사 95점+ 통과 전제(태찬 재무 우수로 안전, 비가격점수→effFloor 반영). 이룸일렉트릭은 별도 비가격점수 확인 필요.

## 11. 코덱스 종합 (2026-05-23, consult ×2)
- **채택**: bid_rate 공간 + 분모 통일 / 단일 상수 폐기, 경험분포 사용 / 하드제약 `P_under ≤ alpha` 방식 / 표본 미달 시 분위수 fallback.
- **데이터로 정정**: 코덱스 1차의 "넓은 갭 G 옵티마이저"는 군부대에 부적합(면도날 가설). G 생략하고 floorErr 분위수로 단순화.
- **이견/완화**: 코덱스 기본 alpha=0.25(실격 25%)는 공격적 → **0.10~0.15 시작, 백테스트로 sweet spot**, 데이터가 받쳐주면 0.25 방향(사용자 결정).

## 12. 관련 문서
- `A_WIN_OPT_GAP_DESIGN_2026-05-22.md` — Step 1/2/3 로드맵 (본 문서 = Step 3 구체화)
- `HANDOFF_V2_MASTER_PLAN.md` — 모드 분기(군시설=A, 그 외=B)
- `V2_MEASUREMENT_SPEC.md` — bid_rate 측정공간 정식 명세
- `.claude/commands/evaluate.md` — 게이트
- `src/lib/utils.js:807,842` — `recommendModeA`/`recommendModeB`

---
_처리자: Claude Opus 4.7 / 일자: 2026-05-23 / 다음 단계: predict-architect 영향도 검토 → writing-plans 구현 계획_
