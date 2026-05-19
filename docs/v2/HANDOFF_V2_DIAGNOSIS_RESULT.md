# HANDOFF: 입찰분석기 V2 — 데이터 진단 결과 & 정정된 설계

> 대상: Claude Code 세션
> 일자: 2026-05-19
> 목적: `bid_details` 실데이터 진단 결과 확정 + V2 설계 4대 결정 락인
> 관련 문서: `HANDOFF_V2_PREDICTION_DEFINITION.md`, `HANDOFF_V2_WIN_DEFINITION.md`
> 상태: 진단 완료. 이 문서가 앞선 두 핸드오프의 가정 일부를 **정정**한다.

---

## 0. TL;DR — 진단으로 바뀐 것

진단 전 핸드오프는 "경쟁 분포를 모델링하면 WIN-zone을 노릴 수 있다"고 가정했다.
실데이터 검증 결과 이 가정은 **한 영역(군시설)을 제외하고 무너졌다.**

| 항목 | 진단 전 가정 | 진단 후 확정 |
|------|--------------|--------------|
| WIN-zone 측정 공간 | `adj_rate` (사정률) | **`bid_rate` (투찰률)** |
| 경쟁 모델 | 데이터 기반 분포 추정 | "1위 = 하한 + α", α median ~0.001 |
| 1차 KPI | calibration error / 낙찰확률 | **영역별 분리** (하한 통과율 / WIN-zone 진입률) |
| 자사 낙찰률 위상 | 검증 목표 지표 | 추적만, **목표 아님** (1% 미만이 구조적 천장) |
| V2 전략 | 단일 낙찰 곡선 | **영역별 2-모드** (A: WIN-zone 노림 / B: 하한 안착) |

---

## 1. 진단 1 — `win_zone 0%`의 원인 규명

### 1.1 증상

이전 점검 리포트에서 `pct_in_win_zone = 0.00%` (n=875).
하한 통과 54.86%, 상한 통과 44.11%인데 교집합이 정확히 0 → 통계적으로 불가능.

### 1.2 원인 — `*_adj_rate` 컬럼은 경쟁 신호가 아니다

`bid_details` 샘플 20건 확인 결과:

```
id   adj_rate    win_adj_rate   차이
1    0.4582      0.4638         0.0056
2   -1.1641     -1.1625         0.0016
9   -0.7548     -0.7548         0.0000
17   0.9425      0.9427         0.0002
```

→ `win_adj_rate ≈ adj_rate`. 두 컬럼은 사실상 동일.
→ `win_adj_rate`는 1위 경쟁자의 사정률이 아니라, 1위 투찰가에서 역산한 값.
   1위가 항상 하한가 직상에 형성되므로 역산하면 실제 사정률로 수렴.

### 1.3 결론 — 0%는 버그가 아니라 모순식의 정확한 출력

WIN-zone 판정식:
```
my_adj < win_adj  (상한)  AND  my_adj >= adj_rate  (하한)
```
`win_adj ≈ adj_rate` 이므로 →  `my_adj < adj_rate AND my_adj >= adj_rate`
= 동시 충족 불가능한 모순. 0%는 모순식의 정확한 답이었다.

> **확정: `*_adj_rate` 기반 WIN-zone 측정은 영구 폐기.**

---

## 2. 진단 2 — WIN-zone은 `bid_rate` 공간에서 측정

### 2.1 올바른 정의

진짜 경쟁 신호는 `*_bid_rate` (투찰률)에 있다.

```
WIN-zone 정의 (확정):
    floor_rate  ≤  my_bid_rate  <  win_bid_rate

  - floor_rate    : 낙찰하한율
  - my_bid_rate   : 자사 투찰률
  - win_bid_rate  : 1위(낙찰자) 투찰률  ← 진짜 경쟁 신호
```

### 2.2 재측정 결과 (n=843)

| 지표 | 값 |
|------|-----|
| 하한 통과율 (my_bid ≥ floor) | 57.06% |
| 1위 통과율 (my_bid < win_bid) | 45.91% |
| WIN-zone 진입률 (교집합) | **3.08%** |
| 1위 gap 평균 (win_bid − floor) | 0.1104%p |
| 1위 gap 중앙값 | **0.0008%p** |
| 자사 my_rank=1 건수 | 1 / 843 |

→ 0% 모순 해소. 측정 가능해짐.
→ 그러나 median gap 0.0008%p = WIN-zone이 사실상 존재하지 않음.
   노이즈 플로어 0.642%보다 목표 구간이 약 800배 좁음.

### 2.3 핵심 함의

자사 낙찰 1/843은 모델 실패가 아니라 **구조**다.
1,365개 복수예비가격 난수 안에서 폭 0.0008%p를 맞춰야 함 → 순수 운.
경쟁 분포를 아무리 정교히 모델링해도 이 폭은 일관되게 못 맞춤.

---

## 3. 진단 3 — 영역별 분해 (핵심)

### 3.1 `at`별 WIN-zone 분석 (n=843)

| at | n | 하한통과 | 1위통과 | WIN-zone | median gap | p90 gap |
|------|-----|---------|---------|----------|-----------|---------|
| 지자체 | 349 | 51.6% | 49.9% | 1.7% | 0.0007 | 0.0209 |
| 교육청 | 230 | 57.0% | 43.0% | 0.0% | 0.0007 | 0.0102 |
| 군시설 | 186 | 64.5% | 46.2% | **10.8%** | 0.0023 | **0.7993** |
| 한전 | 39 | 69.2% | 30.8% | 0.0% | 0.0013 | 0.0060 |
| 조달청 | 26 | 46.2% | 53.8% | 0.0% | 0.0004 | 0.0019 |
| LH | 11 | 81.8% | 18.2% | 0.0% | 0.0012 | 0.0060 |

### 3.2 발견

**(1) 군시설만 WIN-zone이 실재한다**
- WIN-zone 진입률 10.8% — 타 영역의 6배~무한대
- p90 gap 0.7993 — 타 영역(0.002~0.02)의 40~400배
- 노이즈 플로어 0.642%보다 넓은 구간이 상위 10%에 존재
- → V2의 "낙찰 곡선" 접근이 의미 있는 **유일한** 영역

**(2) 한전·LH — 하한 통과 높지만 1위 통과 바닥**
- 한전 하한 69.2% / 1위 30.8%, LH 하한 81.8% / 1위 18.2%
- 자사가 안전하게 쓰지만 너무 높아서 경쟁에 전부 밀림
- gap 0.001 수준 → WIN-zone 0% → 낙찰은 순수 운
- → V2로도 낙찰 불가 영역. 하한 안착만 목표.

**(3) 조달청 — 정반대 문제**
- 하한 통과율 46.2%로 최저 → 자사가 너무 공격적, 하한 미달 탈락 잦음
- → V2 우선 교정 대상 (공격성 ↓)

**(4) 지자체 — 최대 표본이지만 거의 운**
- WIN-zone 1.7%, median gap 0.0007
- 하한 통과율 51.6% → 90%+ 끌어올리는 것이 V2 기여분

---

## 4. 정정된 V2 설계 — 영역별 2-모드

V2는 단일 전략이 아니라 영역별 2-모드로 분기한다.

### 모드 A — WIN-zone 노림

- **대상**: 군시설 (+ 지자체 중 gap 넓은 케이스)
- **방법**: 경쟁 분포 모델링 + 낙찰 곡선 `P(낙찰|X)`
- **1차 KPI**: WIN-zone 진입률
- 핸드오프 V1/V2의 곡선·컨볼루션 접근이 유효한 유일한 영역

### 모드 B — 하한 안착

- **대상**: 한전, LH, 교육청, 조달청, 대부분의 지자체
- **방법**: 사정률 분포만 사용. 경쟁 모델 불필요.
- **목표**: 하한 통과율 극대화 + 하한 직상 안착 정밀도
- **1차 KPI**: 하한 통과율 (현재 46~82% → 목표 90%+)
- 낙찰은 운에 맡김. 통제 가능한 변수(하한 미달 탈락 방지)에만 집중.

### 모드 판정 로직 (구현 참조)

```python
def select_mode(at, agency_gap_p90):
    # agency_gap_p90: 해당 발주사/유형의 과거 win_bid - floor gap의 p90
    if at == "군시설":
        return "A"                      # WIN-zone 노림
    if agency_gap_p90 >= 0.10:          # gap p90 0.1%p 이상이면
        return "A"                      # 노이즈 플로어 대비 노릴 만함
    return "B"                          # 하한 안착
```

---

## 5. 확정된 4대 결정 (Decision Memo 종결)

이전 핸드오프의 미해결 결정 4건이 진단으로 모두 확정됨.

| # | 결정 항목 | 확정 내용 |
|---|-----------|-----------|
| 1 | WIN-zone 측정 공간 | `bid_rate` 공간 (`floor_rate ≤ my_bid < win_bid_rate`) |
| 2 | 1차 KPI | 영역별 분리 — 모드 A: WIN-zone 진입률 / 모드 B: 하한 통과율 |
| 3 | 경쟁 모델 시작점 | "1위 = 하한 + α" prior. α는 영역별 (군시설 제외 median ~0.001) |
| 4 | 자사 낙찰률 | 추적만. 목표 지표 아님 (1% 미만 = 구조적 천장) |

---

## 6. 다음 구현 스텝

### Step 1 — 영역별 gap 통계 테이블 구축
- `bid_details`에서 발주사/유형별 `win_bid_rate - floor_rate` 분포 집계
- p50/p90 산출 → 모드 A/B 판정 lookup 테이블 생성
- 표본 부족 영역(한전 n=39, LH n=11, 조달청 n=26)은 신뢰구간 넓음 명시

### Step 2 — 모드 B 엔진 (우선, 표본 큼)
- 사정률 분포 예측 → 하한 통과율 극대화
- `recommendBid1st`의 종형 `4·Φ·(1−Φ)` 캡 제거
- KPI: 하한 통과율. calibration은 "예측 하한통과확률 vs 실제 통과율"

### Step 3 — 모드 A 엔진 (군시설 한정)
- 경쟁 분포 모델링 + 낙찰 곡선
- 군시설 n=186로 시작, 표본 누적
- KPI: WIN-zone 진입률

### Step 4 — 조달청 공격성 교정
- 하한 통과율 46.2% → 사정률 예측을 덜 공격적으로 보정
- 별도 bias 레이어, 기존 OPT_OFFSET와 중복 적용 금지

### Step 5 — dual-run 재시작
- 곡선/모드 분기가 제대로 들어간 시점부터 dual-run 카운트 재시작
- 현재까지 V2 데이터(종형 환원 버전)는 dual-run 표본에서 제외
- n≥500 누적까지 V6 retire 보류

---

## 7. 진단에 사용한 쿼리 (재현용)

```sql
-- A. bid_details 스키마 확인
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'bid_details'
ORDER BY ordinal_position;

-- B. 부호·기준 샘플 점검 (win_adj_rate ≈ adj_rate 발견)
SELECT id, ag, at, my_rank,
       adj_rate, my_adj_rate, win_adj_rate,
       my_bid_rate, win_bid_rate, floor_rate, participant_count
FROM bid_details
WHERE my_adj_rate IS NOT NULL AND win_adj_rate IS NOT NULL
  AND adj_rate IS NOT NULL
ORDER BY id LIMIT 20;

-- C. bid_rate 공간 WIN-zone 재측정
WITH base AS (
  SELECT my_rank,
    (my_bid_rate >= floor_rate)   AS pass_floor,
    (my_bid_rate <  win_bid_rate) AS pass_top1,
    (my_bid_rate >= floor_rate AND my_bid_rate < win_bid_rate) AS in_win_zone,
    (win_bid_rate - floor_rate)   AS top1_gap
  FROM bid_details
  WHERE my_bid_rate IS NOT NULL AND win_bid_rate IS NOT NULL
    AND floor_rate IS NOT NULL
)
SELECT COUNT(*) AS n,
  ROUND(100.0*AVG(pass_floor::int),2)  AS pct_pass_floor,
  ROUND(100.0*AVG(pass_top1::int),2)   AS pct_pass_top1,
  ROUND(100.0*AVG(in_win_zone::int),2) AS pct_in_win_zone,
  ROUND(AVG(top1_gap)::numeric,4)      AS avg_top1_gap,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY top1_gap)::numeric,4) AS median_gap
FROM base;

-- D. at별 분해 (모드 A/B 판정 근거)
WITH base AS (
  SELECT at, my_rank,
    (my_bid_rate >= floor_rate)   AS pass_floor,
    (my_bid_rate <  win_bid_rate) AS pass_top1,
    (my_bid_rate >= floor_rate AND my_bid_rate < win_bid_rate) AS in_win_zone,
    (win_bid_rate - floor_rate)   AS top1_gap
  FROM bid_details
  WHERE my_bid_rate IS NOT NULL AND win_bid_rate IS NOT NULL
    AND floor_rate IS NOT NULL
)
SELECT COALESCE(at,'(null)') AS at, COUNT(*) AS n,
  ROUND(100.0*AVG(pass_floor::int),1)  AS pct_floor,
  ROUND(100.0*AVG(pass_top1::int),1)   AS pct_top1,
  ROUND(100.0*AVG(in_win_zone::int),1) AS pct_winzone,
  ROUND(AVG(top1_gap)::numeric,4)      AS avg_gap,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY top1_gap)::numeric,4) AS median_gap,
  ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY top1_gap)::numeric,4) AS p90_gap
FROM base GROUP BY at ORDER BY n DESC;
```

---

## 8. 절대 준수 사항

- `bid_records` / `bid_details` DELETE 금지
- `bid_predictions.opt_adj` 매칭된 레코드 UPDATE 금지 (A안 원칙)
- 진단·분석 단계는 SELECT만. DDL은 `apply_migration` + 명시적 확인.
- 표본 작은 영역(한전·LH·조달청)의 통계는 신뢰구간 넓음 — 결론 시 n 명시.
- 모드 A/B 판정 lookup은 정적 캐시 테이블 + RPC fallback (LATERAL JOIN 금지).

---

_본 문서는 진단 결과와 정정된 설계만 다룬다._
_예측 정의는 `HANDOFF_V2_PREDICTION_DEFINITION.md`, 낙찰 판정 로직은 `HANDOFF_V2_WIN_DEFINITION.md` 참조._
_단, 두 선행 문서의 "경쟁 분포 모델링으로 WIN-zone 노림" 가정은 본 문서 §3~4가 영역별로 정정함._
