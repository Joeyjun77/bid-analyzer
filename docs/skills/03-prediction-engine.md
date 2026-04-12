# 예측 엔진 — predictV5 + 오프셋 + 발주사 모델
> 사정률 예측·투찰금액 산출·발주사 보정의 전체 흐름
> 위치: src/lib/utils.js의 predictV5 함수

## 예측 엔진 흐름 (Phase 12-D 기준)

```
입력: {at, agName, ba, ep, av} (기관·발주사·금액·A값)
  +
참조: 통계 ts/as, 복수예가 details, agencyPred (Phase 12-D)
  ↓
1. 기본 통계 선택
   - 발주사 통계(as[agName]) 5건+ → 100% 사용
   - 2~4건 → 발주사 50~70% + 기관유형 50~30% 블렌딩
   - 1건 이하 → 기관유형(ts[at])만 사용
  ↓
2. 복수예가 패턴 보정 (bid_details)
   - 발주사 상세 1건+ 우선
   - 없으면 기관유형 상세 사용
   - detailBias = avgPreBias × 0.3 + avgDrawBias × 0.2
   - clamp ±0.5%
  ↓
3. 사정률 예측 (중앙값 + Q1/Q3)
   - ref.med (중앙값) → 기본 추천
   - ref.q1 → 보수적 (안전)
   - ref.q3 → 공격적
  ↓
4. 신뢰구간 계산
   - effStd = MAX(ref.std, 0.642)  ← 노이즈 바닥
   - CI70 = ±effStd × 0.52
   - CI90 = ±effStd × 1.28
  ↓
5. 최적 투찰 (optAdj) — 핵심
   - typeOff = OPT_OFFSET[at]            ← 기관유형 오프셋
   - agencyOff = agencyPred[ag].effective_offset  ← Phase 12-D
   - off = typeOff + agencyOff
   - optAdj = ref.med + off
  ↓
6. 투찰금액 계산
   - A값 있으면: av + (ba×(1+optAdj/100) - av) × fr/100
   - A값 없으면: ba×(1+optAdj/100) × fr/100
   - 절상 처리
  ↓
출력: { adj, xp, fr, bid, optAdj, optBid, optOffset, 
        typeOffset, agencyOffset, agencyN, ci70, ci90, scenarios, ... }
```

## predictV5 함수 시그니처

```javascript
export function predictV5({at, agName, ba, ep, av}, ts, as, details, agencyPred) {
  // ts: 기관유형 통계 map (calcStats 결과)
  // as: 발주사 통계 map
  // details: bid_details 배열
  // agencyPred: ag → {effective_offset, n, strategy} map (Phase 12-D)
}
```

**파라미터 호환성**: `agencyPred`는 선택적. 없으면 발주사 오프셋 0% 적용 (기관유형 오프셋만).

## OPT_OFFSET (기관유형 오프셋)

```javascript
const OPT_OFFSET = {
  "지자체":   0.30,   // 2026-04-10 재교정 (-0.31% bias → +0.45p 상향)
  "군시설":   0.0,    // 2026-04-07 재교정 (-0.15 → 0.0)
  "교육청":  -0.2,
  "한전":    +0.1,
  "LH":      -0.1,
  "조달청":  -0.1,
  "수자원공사": -0.1,
  default:   -0.1
};
```

이 값들은 **722건 백테스트 기반**이며, 기관유형 평균 편향을 잡습니다.

## Phase 12-D 발주사 오프셋

```javascript
// agency_predictor 테이블에서 로드
// effective_offset = adj_offset × shrinkage
// shrinkage = LEAST(1, n_total / 20)

const agPred = agencyPred && agencyPred[agName];
const agencyOff = agPred ? Number(agPred.effective_offset || 0) : 0;
const off = typeOff + agencyOff;  // ← 이중 적층
```

**예시 (경기도 고양시 1억 공고)**:
```
typeOff (지자체) = +0.30%
agencyOff (고양시 본청, 35건) = +0.294%
최종 off = +0.594%

ref.med (예측 중앙값) = -0.10%
optAdj = -0.10 + 0.594 = +0.494%
→ 100-base: 100.494%
```

## predictV5 출력 필드

| 필드 | 의미 |
|---|---|
| `adj` | 순수 예측 사정률 (편향 보정 전, 0-base) |
| `xp` | 순수 예측 예정가격 |
| `fr` | 적용 낙찰하한율 |
| `bid` | 순수 예측 투찰금액 |
| `baseAdj` | 통계 평균 사정률 |
| `optAdj` | **최종 추천 사정률** (편향+오프셋 적용) |
| `optXp` | 최종 추천 예정가격 |
| `optBid` | 최종 추천 투찰금액 |
| `optOffset` | 최종 적용 오프셋 (typeOff + agencyOff) |
| `typeOffset` | 기관유형 오프셋 |
| `agencyOffset` | 발주사 오프셋 (Phase 12-D) |
| `agencyN` | 발주사 샘플 수 |
| `ci70`, `ci90` | 신뢰구간 |
| `scenarios` | [보수적, 중앙, 공격적] 3시나리오 |
| `bidRateRec` | 투찰율 통계 (avg/med/q1/q3/std) |
| `detailInsight` | 복수예가 상세 정보 (bid_details 기반) |
| `src` | 예측 근거 문자열 |
| `biasAdj` | 편향 보정량 |

## 주요 함수 카탈로그 (utils.js)

### 파싱 함수
| 함수 | 입력 | 출력 |
|---|---|---|
| `parseFile(file)` | File 객체 | `{rows}` (xlsx 자동 판별) |
| `toRecord(r)` | 24컬럼 행 | bid_records 객체 |
| `toRecords(rows)` | 행 배열 | bid_records 객체 배열 |
| `parseBidDoc(rows)` | 입찰서류함 행 | 예측 대상 객체 배열 |
| `parseSucview(rows)` | SUCVIEW 행 | bid_details 객체 |
| `isSucviewFile(rows)` | 행 배열 | boolean |

### 통계/예측
| 함수 | 용도 |
|---|---|
| `calcStats(recs, filter)` | bid_records → `{ts, as}` 통계 맵 |
| `predictV5(...)` | 사정률 예측 (Phase 12-D 통합) |
| `recommendAssumedAdj(...)` | 가정 사정률 3시나리오 추천 |
| `simDraws(preRates)` | C(15,4) 추첨 시뮬레이션 (히스토그램) |
| `calcDataStatus(rows)` | 데이터 신선도 정보 |
| `calcRoiV2(...)` | ROI 등급 (S/A/B/C/D) |

### 헬퍼
| 함수 | 용도 |
|---|---|
| `clsAg(name)` | 발주사명 → 기관유형 분류 |
| `eraFR(at, ep, od)` | 기관·금액·개찰일 → 낙찰하한율 |
| `isNewEra(at, od)` | 2025/2026 신기준 적용 여부 |
| `getFloorRate(at, ep, isNew)` | 직접 하한율 계산 |
| `md5(s)` | dedup_key 생성용 |
| `sanitizeJson(s)` | 0x00 + lone surrogate 제거 |
| `getCho(c)` | 한글 → 초성 (검색용) |
| `mSch(text, query)` | 텍스트 매칭 (초성 지원) |
| `pnv(v)` | parseNumber (콤마 제거) |

### 호환성 stub (Phase 11 청산 후)
이 함수들은 시그니처만 유지하고 빈 응답 반환:
- `setWinProbMatrix`, `setBiasMap`, `setTrendMap`
- `getEnhancedAdj`, `buildAiContext`, `callClaudeAi`

## 예측 엔진 진화 이력

### V1 (Phase 1)
- 단순 평균 기반
- MAE ~1.2%

### V2~V3 (Phase 1)
- 분위수 도입
- bid_details 패턴 추가
- MAE ~0.85%

### V4 (Phase 2 초)
- drift 보정 추가
- MAE 0.5721%

### V5 (Phase 2 후)
- **drift 보정 제거** (51K 백테스트에서 MAE 0.0165% 악화 확인)
- 노이즈 바닥 0.642% 반영
- 신뢰구간 교정
- MAE 0.5717% → **0.5446%** (Phase 12-D 적용 시)

### V5 + Phase 12-D
- 발주사별 오프셋 추가 (`agencyPred` 파라미터)
- 신규 예측에만 적용 (A안)
- 과거 데이터 무결성 유지

## 폐기된 접근 (재시도 금지)

| 접근 | 결과 |
|---|---|
| Drift 보정 | MAE 악화 (-0.0165%). 노이즈 증폭 |
| 참여자수로 사정률 예측 | R² ≈ 0. 복수예가 랜덤성 |
| 금액대로 사정률 예측 | 중앙값 변동 0.05%p. 거의 무효 |
| 업종별 사정률 예측 | R² -71.9%. 완전 무의미 |
| 모드빈 (Mode Bin) 접근 | 프리즘 2.0 분석 결과 정확도 개선 없음 |
| 투찰율을 예측 변수로 | 사정률의 결과(종속). 사용 시 MAE 악화 |
| 여성기업 할인 자동 적용 | Phase 11 폐기. 예측 오염. 5개월치 모델 무효화 |

## 호출 위치 (App.jsx)

```javascript
// 1. 입찰서류함 일괄 예측 (L416)
const results = items.map(item => {
  const p = predictV5(
    {at: item.at, agName: item.ag, ba: item.ba, ep: item.ep, av: item.av},
    allS.ts, allS.as, bidDetails, agencyPred  // ← agencyPred 필수
  );
  ...
});

// 2. 다중 파일 일괄 예측 (L456) — 동일 패턴

// 3. 수동 예측 시뮬레이터 (L511)
const p = predictV5(
  {at: clsAg(inp.agency), agName: inp.agency.trim(), ba: tn(inp.baseAmount), ep: tn(inp.estimatedPrice), av: tn(inp.aValue)},
  allS.ts, allS.as, bidDetails, agencyPred  // ← agencyPred 필수
);
```

**모든 호출에 agencyPred를 5번째 인자로 전달해야 Phase 12-D가 작동**합니다.

## 성능 측정 방법

### MAE 계산 (전체 매칭)
```sql
SELECT 
  COUNT(*) as n,
  ROUND(AVG(ABS(adj_rate_error::numeric))::numeric, 4) as mae
FROM bid_predictions
WHERE match_status = 'matched'
  AND adj_rate_error IS NOT NULL
  AND ABS(adj_rate_error::numeric) < 5;
```

### 등급별 MAE
```sql
SELECT 
  COALESCE('P'||aws.priority_tier, '미분류') as 등급,
  COUNT(*) as n,
  ROUND(AVG(ABS(p.adj_rate_error::numeric))::numeric, 4) as mae
FROM bid_predictions p
LEFT JOIN agency_win_stats aws ON aws.ag = p.ag
WHERE p.match_status = 'matched' AND ABS(p.adj_rate_error::numeric) < 5
GROUP BY aws.priority_tier
ORDER BY aws.priority_tier NULLS LAST;
```

### 오프셋 백테스트 (소급 적용)
```sql
WITH test AS (
  SELECT 
    p.id, p.opt_adj::numeric as my_adj,
    p.actual_adj_rate::numeric as actual_adj,
    COALESCE(ap.effective_offset, 0) as offset_val
  FROM bid_predictions p
  LEFT JOIN agency_predictor ap ON ap.ag = p.ag
  WHERE p.match_status='matched' AND ABS(p.adj_rate_error::numeric) < 5
)
SELECT 
  ROUND(AVG(ABS(my_adj - actual_adj))::numeric, 4) as 기존_MAE,
  ROUND(AVG(ABS((my_adj + offset_val) - actual_adj))::numeric, 4) as 보정_MAE
FROM test;
```

## 노이즈 바닥 0.642% 의미

같은 발주사의 연속된 두 입찰의 사정률 차이의 중앙값. 51K건에서 측정.

**이론적 의미**: 복수예가 C(15,4) 추첨이 만드는 본질적 분산. 이 이하로 MAE를 줄이는 건 **오버피팅**.

**실용적 의미**: 
- MAE 0.5446% < 0.642% = 이미 노이즈 바닥 근처 도달
- 추가 개선은 **단순 사정률 예측 외 차원** 필요 (예: 발주사별 모델, 가정 사정률)

## 발주사 오프셋의 한계

Phase 12-D 백테스트 결과 (1,088건):

| 지표 | 기존 | 보정 후 | 개선 |
|---|---|---|---|
| MAE | 0.5857% | 0.5446% | -7.0% |
| 낙찰 건수 | 7 | 8 | +1 |
| 낙찰률 | 0.643% | 0.735% | +14.3% |

오프셋만으로는 이론 상한 4.6%에 도달 불가. **다음 지렛대는 가정 사정률 상한율 모델** (방안 C).
