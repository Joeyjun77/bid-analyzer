# 자사 유효 낙찰하한율 모듈 — 디자인 스펙

> **작성일**: 2026-05-21
> **근거**: V2_DOMAIN_RULES_CHECK #1, 코덱스 라운드 8 (composite 8.1/10) KPI 신뢰도 6.8 감점 해소
> **위상**: Phase 2 #1 (마지막 V2_DOMAIN_RULES_CHECK 잔여 정정 중 가장 영향력 큰 항목)
> **선행 문서**:
> - `docs/skills/01-domain-knowledge.md` §적격심사 점수 체계
> - `docs/v2/HANDOFF_V2_WIN_DEFINITION.md` §6 own_qualified 변수
> - `docs/v2/HANDOFF_V2_PREDICTION_DEFINITION.md` §1.3 P(적격심사 통과) = 1.0 가정

---

## 0. 한 줄 요약

자사 비가격 점수(시공경험+경영상태, 0~20점)를 입력받아 표준 낙찰하한율에 **`(20 - 점수) × 0.05%p`**를 가산한 "자사 유효 낙찰하한율"을 계산하고, `recommendV2` 투찰금액 산출의 `fr` 자리에 사용한다.

---

## 1. 문제 정의

### 1.1 현 시스템의 가정

- 적격심사 통과 확률 = 1.0 (도메인 표준 — 시공경험·경영상태 만점 가정)
- 즉, 자사 가격 점수 만점 = 표준 낙찰하한율 (예: 87.745%)
- `recommendV2`의 `calcBid` 내 `fr = eraFR(at, ep||ba, today)` → 표준 하한율 사용

### 1.2 도메인 진실 (`01-domain-knowledge.md`)

종합평점 95점 = 시공경험(5) + 경영상태(15) + 입찰가격(90) 중 합 95 이상.
- 자사 비가격 점수가 1점 부족 → 가격 점수에서 86점 필요 → 투찰률 87.795% (표준보다 +0.05%p)
- 일반화: **부족점수 N → effective하한 = baseFloor + N × 0.05%p**

### 1.3 코덱스 라운드 8 진단

- KPI 신뢰도 6.8/10 — n=31 표본 + 자사 점수 미반영 동시 작용
- "P(적격심사 통과) ≈ 1.0 가정"이 안전성·KPI 신뢰도 동시 감점 요인

---

## 2. 결정 사항 (5건)

| # | 결정 | 선택지 |
|---|---|---|
| D1 | 입력 형태 | **비가격 점수 합계 0~20점 한 숫자** (3구성 분리 또는 직접 % 입력 거절) |
| D2 | 영구 저장 | **localStorage** (`bidAnalyzer.ownScore` 키) |
| D3 | 산식 | **도메인 표준 식**: `effectiveFloor = baseFloor + (20 - score) × 0.05` |
| D4 | 호출 지점 | **모든 발주** (recommendV2 공통 경로 — Mode A·B 동일 적용) |
| D5 | UI 표시 | **표준 + 자사 듀얼 표기** (`"87.745% → 자사 87.795%"`) |

---

## 3. 아키텍처

### 3.1 모듈 분리 (접근 A 채택)

```
src/lib/effectiveFloor.js (신규)
  └─ export calcEffectiveFloorRate(at, baseFloor, score) → effectiveFloor

src/lib/utils.js
  └─ import calcEffectiveFloorRate
  └─ recommendModeB·recommendV2 calcBid 내 fr → effFr 교체

src/components/OwnScoreInput.jsx (신규)
  └─ 0~20 number input + 슬라이더 (선택), 변경 시 콜백

src/App.jsx
  ├─ localStorage 'bidAnalyzer.ownScore' 초기 로드 (디폴트 20)
  ├─ ownScore useState 전역 보관
  ├─ OwnScoreInput을 헤더(또는 설정 영역)에 렌더
  └─ recommendV2 호출 시 context.ownScore 전달

src/components/RecommendPanel.jsx (또는 추천 패널)
  └─ 표준/자사 듀얼 표기 inline 렌더
```

### 3.2 데이터 흐름

```
localStorage 'bidAnalyzer.ownScore' (영구)
  ↓ 초기 로드
useState ownScore (App.jsx)
  ↓ context.ownScore
recommendV2 (utils.js)
  ↓ ownScore
calcBid 내부
  ├─ fr = eraFR(at, ep||ba, today)        ← 표준 하한율
  ├─ effFr = calcEffectiveFloorRate(at, fr, ownScore)  ← 자사 유효
  └─ bid = ... × (effFr / 100)            ← 자사 유효로 투찰금액 산출
  ↓
추천 패널 렌더
  └─ "표준 87.745% → 자사 87.795%" inline
```

---

## 4. 핵심 모듈 명세

### 4.1 `src/lib/effectiveFloor.js` (신규)

```js
// V2_DOMAIN_RULES_CHECK #1 — 자사 유효 낙찰하한율
// 산식: baseFloor + (20 - score) × 0.05%p
// score: 비가격 점수 합계 (0~20), 시공경험 5 + 경영상태 15
// at: 발주유형 (현재 산식은 at 무관, 미래 발주유형별 정밀화 여지)
// baseFloor: eraFR()/getFloorRate() 반환값 (87.745 등 % 단위)
export function calcEffectiveFloorRate(at, baseFloor, score = 20) {
  const s = Math.max(0, Math.min(20, Number(score) || 20));
  const shortfall = 20 - s;
  return baseFloor + shortfall * 0.05;
}
```

**단위 가정**: `eraFR()`이 반환하는 `fr` 값은 `87.745`처럼 % 단위 (utils.js의 `fr/100` 사용 패턴으로 확인됨). 따라서 가산값도 0.05 (% 단위).

**가드**:
- score < 0 → 0 (clamp)
- score > 20 → 20 (clamp)
- NaN/undefined → 20 (디폴트 만점)

### 4.2 `src/lib/utils.js` 변경 지점

**A. recommendModeB (line 281 부근 calcBid)**:
```js
const fr = eraFR(at, ep||ba, new Date().toISOString().slice(0,10));
const effFr = calcEffectiveFloorRate(at, fr, context?.ownScore);
const calcBid = (adjRate) => {
  const xp = ba * (1 + adjRate/100);
  const raw = av > 0 ? av + (xp - av) * (effFr/100) : xp * (effFr/100);
  return at === "LH" ? ceilToThousand(raw) : ceilToWon(raw);
};
```

**B. recommendV2 또는 별도 분기 (line 499 부근 calcBid)**:
동일 패턴 적용. 같은 raw·effFr 사용.

**시그니처 변경**:
- `recommendModeB(bid, context, options)`의 `context.ownScore` 추가 (옵셔널, 디폴트 20)
- `recommendV2(bid, context, options)` 동일

### 4.3 `src/components/OwnScoreInput.jsx` (신규)

```jsx
// 단순 number input + 작은 설명 텍스트
// 0~20 정수, 디폴트 20
// onChange: 즉시 parent state 갱신
export default function OwnScoreInput({ value, onChange }) {
  return (
    <div className="own-score-input">
      <label>자사 비가격 점수 (0~20)</label>
      <input
        type="number"
        min={0} max={20} step={1}
        value={value}
        onChange={e => onChange(Math.max(0, Math.min(20, Number(e.target.value) || 0)))}
      />
      <span className="hint">시공경험 5 + 경영상태 15. 만점 20점 가정 시 표준 하한율 적용.</span>
    </div>
  );
}
```

### 4.4 App.jsx 변경

```jsx
const STORAGE_KEY = 'bidAnalyzer.ownScore';

const [ownScore, setOwnScore] = useState(() => {
  const stored = localStorage.getItem(STORAGE_KEY);
  const n = Number(stored);
  return Number.isFinite(n) && n >= 0 && n <= 20 ? n : 20;
});

useEffect(() => {
  localStorage.setItem(STORAGE_KEY, String(ownScore));
}, [ownScore]);

// 헤더 또는 설정 영역에 OwnScoreInput 렌더
<OwnScoreInput value={ownScore} onChange={setOwnScore} />

// recommendV2 호출
const rec = recommendV2(bid, { ...existingContext, ownScore });
```

### 4.5 추천 패널 듀얼 표기

표준 fr과 자사 effFr이 다를 때만 화살표 표기:
```jsx
const fr = eraFR(at, ep||ba, today);
const effFr = calcEffectiveFloorRate(at, fr, ownScore);
const floorDisplay = fr === effFr
  ? `${fr.toFixed(3)}%`
  : `${fr.toFixed(3)}% → 자사 ${effFr.toFixed(3)}%`;
```

---

## 5. 영향도 분석

### 5.1 MAE (보조 지표)

- **opt_adj 사정률 공간 무변경** (calcBid의 adjRate 계산은 분포 추정 기반)
- **opt_bid 출력단 변경**: `fr → effFr`로 투찰금액 계산식 변경
- score=20 (디폴트, 만점) → `effFr = fr` → **비트 단위 동일** → MAE 회귀 0
- score<20 → effFr > fr → opt_bid 상향 → bid_predictions.opt_bid 신규 적재값만 영향
- **매칭된 row의 opt_adj·actual_adj_rate 무관** (A안 INSERT-only 정책 보호)

### 5.2 핵심 영역 (한전·고양시·군부대)

- 모두 동일 산식 적용. score 디폴트 20일 때 영향 0.
- 사용자가 score 변경 시 모든 영역의 신규 예측에 일률 적용.

### 5.3 V2 5대 게이트

| 게이트 | 영향 |
|---|---|
| G-단위 | 무관 (bid_rate 공간 미사용) |
| G-A안 | 무관 (INSERT-only, matched UPDATE 없음) |
| G-bias | 무관 (bias 레이어 추가 없음) |
| G-모드표시 | 무관 (낙찰확률 문구 추가 없음, Mode B 분기 미변경) |
| G-도메인 | **#1 정정 — 자사 점수 반영, 통과 기여** |

---

## 6. 검증 전략

### 6.1 5단계 하네스

- **§1 설계**: predict-architect 호출 (Generator 분류·핵심 영역 영향도 확인)
- **§2 구축**: 5개 파일 변경 (effectiveFloor.js 신규 + utils.js + App.jsx + OwnScoreInput.jsx + 추천 패널)
- **§3 검증**: `/evaluate` 실행 — score=20 가정으로 baseline 동일성 확인 + 5대 게이트 모두 PASS
- **§4 운영**: deploy-gate → commit → push

### 6.2 단위 테스트 (선택)

`calcEffectiveFloorRate(*, 87.745, 20)` → 87.745
`calcEffectiveFloorRate(*, 87.745, 19)` → 87.795
`calcEffectiveFloorRate(*, 87.745, 15)` → 87.995
`calcEffectiveFloorRate(*, 87.745, 0)` → 88.745
`calcEffectiveFloorRate(*, 87.745, -5)` → 87.745 (clamp)
`calcEffectiveFloorRate(*, 87.745, 25)` → 87.745 (clamp)
`calcEffectiveFloorRate(*, 87.745, NaN)` → 87.745 (디폴트)

### 6.3 회귀 검증 SQL

score=20 디폴트 유지 시 push 직후 동일 MAE 확인:
```sql
WITH recent AS (
  SELECT opt_bid, opt_adj, actual_adj_rate
  FROM bid_predictions
  WHERE match_status='matched' AND created_at >= NOW() - INTERVAL '7 days'
)
SELECT COUNT(*) AS n_recent,
       ROUND(AVG(ABS(opt_adj - actual_adj_rate))::numeric,4) AS mae
FROM recent;
```

---

## 7. 미해결 의문 (다음 라운드)

1. **발주유형별 산식 정밀화** — at 인자를 받지만 현재 사용 안 함. 일부 발주유형(LH/한전)은 점수 산정 기준 다를 수 있음.
2. **자사 점수 변경 알림** — 사용자가 점수 바꾸면 기존 추천 자동 재계산? 또는 수동 새로고침?
3. **자사 점수 변경 이력** — localStorage만이라 변경 추적 안 됨. 향후 모니터링용 추가 가능.
4. **agency_mode_lookup adj_range_min/max 연계** — m21에서 추가한 메타 컬럼과 결합해 발주사별 grid 동적 적용 (이번 스펙 범위 밖).

---

## 8. 절대 준수

- `calcEffectiveFloorRate` 외부에서 effective 산식 직접 구현 금지 (단일 진실 소스)
- score 디폴트 20 유지 (만점 가정 — 가장 안전한 fallback)
- localStorage 키 `bidAnalyzer.ownScore` 외 다른 키 사용 금지
- recommendV2 시그니처에 ownScore 추가하되 옵셔널 유지 (기존 호출처 호환)
- matched bid_predictions row의 opt_bid UPDATE 금지 (A안 INSERT-only)

---

_단일 진실: 본 스펙 + `docs/v2/HANDOFF_V2_MASTER_PLAN.md`_
_구현 계획: writing-plans skill 후 `docs/superpowers/plans/2026-05-21-effective-floor-rate-plan.md`로 분리 작성 예정_
