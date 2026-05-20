# 자사 유효 낙찰하한율 구현 계획 (Phase 2 #1-a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 자사 비가격 점수(0~20)를 입력받아 `effectiveFloor = baseFloor + (20 - score) × 0.05`로 자사 유효 낙찰하한율을 계산하고, `recommendV2` 투찰금액 산출에 적용한다. V2_DOMAIN_RULES_CHECK #1 정정의 핵심 경로(recommendV2)에 한정 적용.

**Architecture:** 단일 진실 모듈 `src/lib/effectiveFloor.js` 분리 + `recommendV2` 호출 시 `context.ownScore` 전달 + localStorage 영구 저장 + 추천 패널 듀얼 표기.

**Tech Stack:** React 18 + Vite 5, JS ES Modules. 단위 테스트 인프라 없음(vitest/jest 미설치) → 빌드 통과 + `/evaluate` + 수동 sanity로 TDD 대체.

**범위 제한 (이번 plan):** `recommendV2` 한정 적용. `predictV5`/`recommendBid1st`/`recommendAssumedAdj` (V5/V6 legacy 경로)는 별도 Plan #1-b로 분리 — 회귀 위험 축소.

---

## File Structure

**Create:**
- `src/lib/effectiveFloor.js` — `calcEffectiveFloorRate(at, baseFloor, score)` 단일 export
- `src/components/OwnScoreInput.jsx` — 0~20 number input + 설명 텍스트

**Modify:**
- `src/lib/utils.js` (line 1004-1018 `recommendV2` 본체) — import 추가 + bidC 안에서 effFr 사용
- `src/App.jsx` (line 14 import + 헤더/설정 영역 + line 1159 호출) — useState/useEffect/localStorage + 컴포넌트 렌더 + ownScore 전달
- `src/App.jsx` (line 146 테이블 셀 또는 추천 패널) — fr 듀얼 표기

---

## Task 1: predict-architect 호출 (5단계 §1 설계)

**Files:** 없음 (의사결정 단계)

- [ ] **Step 1: predict-architect 서브에이전트 호출**

Agent 툴 `subagent_type=predict-architect`로 다음 prompt 전달:

```
V2_DOMAIN_RULES_CHECK #1 — 자사 유효 낙찰하한율 모듈 신규 추가 예정.

변경 범위 (Plan #1-a):
- src/lib/effectiveFloor.js 신규 (calcEffectiveFloorRate)
- src/lib/utils.js recommendV2(line 1002) 본체 bidC 변경
- src/components/OwnScoreInput.jsx 신규
- src/App.jsx localStorage + state + render + recommendV2 호출에 ownScore 전달
- 추천 패널 듀얼 표기 (fr → effFr)

산식: effectiveFloor = baseFloor + (20 - score) × 0.05
score 디폴트 20 → effFr = fr (비트 단위 동일)

검토 요청:
1. Generator/Evaluator 분류
2. 핵심 영역(한전·고양시·군부대) 영향도 — score=20 디폴트 시 0
3. /evaluate 필요 여부
4. predictV5/recommendBid1st/recommendAssumedAdj는 이번 plan에서 제외(별도 Plan #1-b). 이게 적절한지
```

- [ ] **Step 2: 판정 결과 확인**

기대: Generator 분류 / 핵심 영역 영향 0 (score=20 디폴트) / `/evaluate` 필수 / 범위 제한 적절

- [ ] **Step 3: Task 진행 가능 여부 결정**

predict-architect가 FAIL을 주거나 추가 우려 제기 시 plan 수정. PASS 시 Task 2 진입.

---

## Task 2: effectiveFloor.js 모듈 신규

**Files:**
- Create: `src/lib/effectiveFloor.js`

- [ ] **Step 1: 모듈 파일 작성**

```js
// V2_DOMAIN_RULES_CHECK #1 — 자사 유효 낙찰하한율
// 산식: baseFloor + (20 - score) × 0.05%p (도메인 표준)
// score: 비가격 점수 합계 (0~20), 시공경험 5 + 경영상태 15
// baseFloor: eraFR()/getFloorRate() 반환값 (87.745 등 % 단위)
// at: 발주유형 (현재 산식은 at 무관, 향후 발주유형별 정밀화 여지)
export function calcEffectiveFloorRate(at, baseFloor, score = 20) {
  const base = Number(baseFloor);
  if (!Number.isFinite(base)) return baseFloor;
  const raw = Number(score);
  const s = Number.isFinite(raw) ? Math.max(0, Math.min(20, raw)) : 20;
  const shortfall = 20 - s;
  return base + shortfall * 0.05;
}
```

- [ ] **Step 2: 빌드 통과 확인**

Run: `npx vite build`
Expected: PASS, 859.x kB

- [ ] **Step 3: 수동 sanity check**

브라우저 콘솔 또는 임시 스크립트로:
- `calcEffectiveFloorRate('조달청', 87.745, 20)` → 87.745
- `calcEffectiveFloorRate('조달청', 87.745, 19)` → 87.795
- `calcEffectiveFloorRate('조달청', 87.745, 0)` → 88.745
- `calcEffectiveFloorRate('조달청', 87.745, -5)` → 87.745 (clamp)
- `calcEffectiveFloorRate('조달청', 87.745, 25)` → 87.745 (clamp)
- `calcEffectiveFloorRate('조달청', 87.745, NaN)` → 87.745

---

## Task 3: recommendV2의 bidC가 effFr 사용하도록 변경

**Files:**
- Modify: `src/lib/utils.js` (line 1004-1018 영역)

- [ ] **Step 1: import 추가 (utils.js 상단)**

기존 line 4 (`import { ceilToWon, ceilToThousand } from "./fmtAdj.js";`) 아래에 추가:

```js
import { calcEffectiveFloorRate } from "./effectiveFloor.js";
```

- [ ] **Step 2: recommendV2 bidC 변경**

`utils.js` line 1004-1018 영역에서:

**변경 전 (line 1002-1018):**
```js
export function recommendV2(bid, context, options) {
  const opt = Object.assign({ targetProb: 0.95, gridStep: 0.0001, gridRange: 1.5 }, options || {});
  const { at, agName, ba, ep, av, fr } = bid || {};
  if (!at || !ba || !fr) return null;

  const mode = context?.modeResolution?.mode_recommend || 'B';
  const grain = context?.modeResolution?.matched_grain || null;
  const baSeg = baSegOf(ba);

  // 투찰금액 계산식 (recommendBid1st와 동일 — A값 보정)
  const xpC = (adj) => ba * (1 + adj / 100);
  const bidC = (adj) => {
    const xp = xpC(adj);
    return (av && av > 0)
      ? Math.ceil(av + (xp - av) * (fr / 100))
      : Math.ceil(xp * (fr / 100));
  };
```

**변경 후 (effFr 계산 추가 + bidC에서 effFr 사용):**
```js
export function recommendV2(bid, context, options) {
  const opt = Object.assign({ targetProb: 0.95, gridStep: 0.0001, gridRange: 1.5 }, options || {});
  const { at, agName, ba, ep, av, fr } = bid || {};
  if (!at || !ba || !fr) return null;

  const mode = context?.modeResolution?.mode_recommend || 'B';
  const grain = context?.modeResolution?.matched_grain || null;
  const baSeg = baSegOf(ba);

  // V2_DOMAIN_RULES_CHECK #1 — 자사 유효 낙찰하한율 (context.ownScore 없으면 디폴트 20=만점)
  const effFr = calcEffectiveFloorRate(at, fr, context?.ownScore);

  // 투찰금액 계산식 (recommendBid1st와 동일 — A값 보정, effFr 사용)
  const xpC = (adj) => ba * (1 + adj / 100);
  const bidC = (adj) => {
    const xp = xpC(adj);
    return (av && av > 0)
      ? Math.ceil(av + (xp - av) * (effFr / 100))
      : Math.ceil(xp * (effFr / 100));
  };
```

- [ ] **Step 3: 빌드 통과 확인**

Run: `npx vite build`
Expected: PASS

- [ ] **Step 4: 수동 sanity check**

context.ownScore 없는 호출 → effFr === fr (현 동작 유지) 확인. ownScore=15 → effFr = fr + 0.25 확인.

---

## Task 4: OwnScoreInput 컴포넌트 신규

**Files:**
- Create: `src/components/OwnScoreInput.jsx`

- [ ] **Step 1: 컴포넌트 파일 작성**

```jsx
// V2_DOMAIN_RULES_CHECK #1 — 자사 비가격 점수 입력
// 0~20 정수, 디폴트 20 (만점=표준 하한율 적용)
export default function OwnScoreInput({ value, onChange }) {
  const handle = (e) => {
    const n = Number(e.target.value);
    if (!Number.isFinite(n)) return;
    onChange(Math.max(0, Math.min(20, Math.round(n))));
  };
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      padding: "4px 10px", border: "1px solid #ccc", borderRadius: 6,
      background: "#fafafa", fontSize: 13
    }}>
      <label style={{ fontWeight: 600 }}>자사 비가격 점수</label>
      <input
        type="number"
        min={0} max={20} step={1}
        value={value}
        onChange={handle}
        style={{ width: 56, padding: "2px 4px", textAlign: "right" }}
      />
      <span style={{ color: "#666" }}>/ 20</span>
      <span title="시공경험 5 + 경영상태 15. 만점 20점일 때 표준 하한율 적용. 1점 부족당 +0.05%p" style={{ cursor: "help", color: "#999" }}>?</span>
    </div>
  );
}
```

- [ ] **Step 2: 빌드 통과 확인**

Run: `npx vite build`
Expected: PASS (컴포넌트 import 호출처 없으면 dead code 경고 없이 PASS)

---

## Task 5: App.jsx — localStorage + state + 렌더 + recommendV2 호출

**Files:**
- Modify: `src/App.jsx` (line 14 import + state 정의 영역 + 헤더/설정 영역 + line 1159 호출)

- [ ] **Step 1: import 추가**

`src/App.jsx` line 14의 utils import 다음 줄에 추가:

```jsx
import OwnScoreInput from "./components/OwnScoreInput.jsx";
```

(import 정확한 위치는 line 14 import 다음, 다른 컴포넌트 import 부근. 기존 컴포넌트 import 라인을 grep으로 찾아 옆에 배치.)

- [ ] **Step 2: localStorage 키 + useState 정의**

App 함수 컴포넌트 상단(useState 선언 영역, line 431 부근의 `basegFinetune` useState 옆)에 추가:

```jsx
const OWN_SCORE_KEY = 'bidAnalyzer.ownScore';
const [ownScore, setOwnScore] = useState(() => {
  try {
    const stored = localStorage.getItem(OWN_SCORE_KEY);
    const n = Number(stored);
    return Number.isFinite(n) && n >= 0 && n <= 20 ? n : 20;
  } catch { return 20; }
});
useEffect(() => {
  try { localStorage.setItem(OWN_SCORE_KEY, String(ownScore)); } catch {}
}, [ownScore]);
```

- [ ] **Step 3: OwnScoreInput 렌더 위치 결정 + 추가**

위치 후보:
- A) 헤더 또는 메인 컨테이너 상단 (편집 빈도 낮은 영구 설정)
- B) 추천 결과 패널 옆 (옵션처럼 자주 변경 가능)

**선택: A (헤더 상단)** — 자사 점수는 회사 정보로 영구 설정.

App.jsx 헤더 영역(파일 상단 부근의 첫 `<div>` 또는 타이틀 옆)에 `<OwnScoreInput value={ownScore} onChange={setOwnScore} />` 추가. 정확한 위치는 grep으로 첫 `<div`와 `<h1>` 또는 `<header>` 위치 확인 후 그 옆.

(이 step 실행 시 App.jsx의 header/title 위치를 먼저 확인하고 정확한 라인에 삽입.)

- [ ] **Step 4: recommendV2 호출에 ownScore 전달**

App.jsx line 1159-1162 변경:

**변경 전:**
```js
const v2=recommendV2(
  {at:p.at,agName:p.ag,ba:Number(p.ba),ep:Number(p.ep)||Number(p.ba),av:Number(p.av)||0,fr:Number(p.pred_floor_rate)},
  {distMap:win1stDistMap,modeResolution:modeRes,gapDist}
);
```

**변경 후:**
```js
const v2=recommendV2(
  {at:p.at,agName:p.ag,ba:Number(p.ba),ep:Number(p.ep)||Number(p.ba),av:Number(p.av)||0,fr:Number(p.pred_floor_rate)},
  {distMap:win1stDistMap,modeResolution:modeRes,gapDist,ownScore}
);
```

- [ ] **Step 5: 빌드 통과 + 사용자 sanity (선택)**

Run: `npx vite build`
Expected: PASS

브라우저에서 dev 서버 켜고 점수 슬라이더 동작 + localStorage 저장 확인. 다만 dev 서버는 push 후 vercel preview로 대체 가능.

---

## Task 6: 추천 패널 듀얼 표기

**Files:**
- Modify: `src/App.jsx` (line 146 테이블 셀 또는 line 195 표기)

**우선 변경 대상**: App.jsx line 146 (table cell, `Number(r.fr).toFixed(3)+"%"` 표기 영역). 추가로 line 195의 matched.fr 표기도 함께.

- [ ] **Step 1: 듀얼 표기 유틸 추가 (App.jsx 상단 또는 import)**

App.jsx 함수 안 또는 utils 가까이에:

```jsx
// 표준/자사 듀얼 표기 헬퍼
const fmtFloorDual = (baseFr, effFr, decimals = 3) => {
  if (baseFr == null || !Number.isFinite(Number(baseFr))) return "-";
  const b = Number(baseFr);
  const e = Number(effFr);
  if (!Number.isFinite(e) || Math.abs(b - e) < 1e-6) return b.toFixed(decimals) + "%";
  return `${b.toFixed(decimals)}% → 자사 ${e.toFixed(decimals)}%`;
};
```

(또는 src/lib/effectiveFloor.js에 export `formatFloorDual` 추가 후 import.)

**선택**: effectiveFloor.js로 묶기 (단일 진실).

`src/lib/effectiveFloor.js`에 추가:

```js
// 표준/자사 듀얼 표기 — score=20 시 표준만, 부족 시 화살표 표기
export function formatFloorDual(baseFloor, effFloor, decimals = 3) {
  const b = Number(baseFloor);
  if (!Number.isFinite(b)) return "-";
  const e = Number(effFloor);
  if (!Number.isFinite(e) || Math.abs(b - e) < 1e-6) return b.toFixed(decimals) + "%";
  return `${b.toFixed(decimals)}% → 자사 ${e.toFixed(decimals)}%`;
}
```

- [ ] **Step 2: App.jsx에서 import + 적용**

App.jsx 상단 import에 추가:

```jsx
import { calcEffectiveFloorRate, formatFloorDual } from "./lib/effectiveFloor.js";
```

App.jsx line 146 변경:

**변경 전:**
```jsx
<td style={{padding:"3px 6px",textAlign:"right",fontFamily:"monospace"}}>{r.fr!=null?Number(r.fr).toFixed(3)+"%":"-"}</td>
```

**변경 후:**
```jsx
<td style={{padding:"3px 6px",textAlign:"right",fontFamily:"monospace"}}>
  {r.fr!=null
    ? formatFloorDual(Number(r.fr), calcEffectiveFloorRate(r.at, Number(r.fr), ownScore))
    : "-"}
</td>
```

App.jsx line 195 변경 (matched.fr 표기):

**변경 전:**
```jsx
{matched&&matched.fr!=null?Number(matched.fr).toFixed(3)+"%":<span style={{color:C.txd}}>—</span>}
```

**변경 후:**
```jsx
{matched&&matched.fr!=null
  ? formatFloorDual(Number(matched.fr), calcEffectiveFloorRate(matched.at, Number(matched.fr), ownScore))
  : <span style={{color:C.txd}}>—</span>}
```

- [ ] **Step 3: 빌드 통과 확인**

Run: `npx vite build`
Expected: PASS

---

## Task 7: 5단계 §3 검증 — /evaluate

**Files:** 없음 (검증 단계)

- [ ] **Step 1: /evaluate skill 실행**

Skill 툴 `evaluate` 호출. ARGUMENTS:

```
변경: src/lib/effectiveFloor.js 신규 + src/lib/utils.js recommendV2 bidC effFr 사용 + App.jsx ownScore state + OwnScoreInput.jsx 신규 + 추천 패널 듀얼 표기. 
score 디폴트 20 → calcEffectiveFloorRate 결과 effFr === fr → bid 출력 비트 단위 동일.
score < 20 시 effFr > fr → opt_bid 신규 적재만 영향(matched row 무관, A안 보호).
opt_adj 사정률 공간 무변경, MAE 영향 0 예상.
핵심 영역(한전·고양시·군부대) score 20 디폴트 시 무영향.
```

- [ ] **Step 2: PASS/WARN/FAIL 판정 확인**

기대: PASS (5대 게이트 0건, MAE 무회귀, evaluate_model_release passes=true)

- [ ] **Step 3: WARN/FAIL 시 대응**

WARN: 24h 내 `/accuracy` 재측정 예약. FAIL: 롤백 후 원인 분석.

---

## Task 8: 5단계 §4 운영 — deploy-gate + push

**Files:** 없음 (배포 단계)

- [ ] **Step 1: deploy-gate 서브에이전트 호출**

Agent 툴 `subagent_type=deploy-gate`로 prompt 전달 (변경 파일 명시 + /evaluate PASS 결과 첨부).

- [ ] **Step 2: PASS 확인**

기대: 빌드 PASS + 5대 게이트 0건 + MAE 무회귀 + push 허용.

- [ ] **Step 3: 명시 add + commit + pull --rebase + push**

```bash
git add src/lib/effectiveFloor.js src/components/OwnScoreInput.jsx src/lib/utils.js src/App.jsx
git commit -m "$(cat <<'EOF'
feat(v2-phase2): #1 자사 유효 낙찰하한율 — effectiveFloor 모듈 + recommendV2 적용

- src/lib/effectiveFloor.js 신규 — calcEffectiveFloorRate + formatFloorDual
- src/lib/utils.js recommendV2 bidC가 effFr 사용 (context.ownScore 디폴트 20)
- src/components/OwnScoreInput.jsx 신규 — 0~20 number input
- src/App.jsx localStorage 'bidAnalyzer.ownScore' + useState + render + recommendV2 호출에 ownScore 전달
- 추천 패널 듀얼 표기 ("87.745% → 자사 87.795%")
- score=20 디폴트 시 비트 단위 동일, MAE 무회귀
- V2_DOMAIN_RULES_CHECK #1 정정 (Plan #1-a, recommendV2 한정)
- 코덱스 라운드 8 KPI 신뢰도 6.8 감점 해소 시작점

EOF
)"
git pull --rebase origin main
git push origin main
```

- [ ] **Step 4: push 완료 확인 + Vercel 자동 배포 시작 확인**

기대: `XXXXXXX..YYYYYYY  main -> main` 출력 + 2~3분 후 Vercel preview/production 갱신.

---

## Task 9: 핸드오프 노트 갱신

**Files:**
- Modify: `docs/v2/HANDOFF_NEXT_SESSION.md` (잔여 정정 #1 ✅ 마킹 + 라운드 8 KPI 신뢰도 후속)

- [ ] **Step 1: 잔여 정정 블록 갱신**

`docs/v2/HANDOFF_NEXT_SESSION.md`의 "잔여 정정 (Phase 2·3)" 블록에서 #1 항목을:

**변경 전:**
```
- ⚠ #1 적격심사 ≠ 1.0 — 자사 유효 낙찰하한율 모듈
```

**변경 후:**
```
- ✅ #1 자사 유효 낙찰하한율 모듈 (Plan #1-a, 2026-05-21) — recommendV2 한정 적용 + localStorage 저장. predictV5/recommendBid1st/recommendAssumedAdj는 Plan #1-b 보류.
```

- [ ] **Step 2: Plan #1-b 등재**

같은 파일 §4 우선순위 영역에 추가:

```
### 우선순위 B (Phase 2 잔여)
- ⚠ #1-b legacy 함수 통합 — predictV5/recommendBid1st/recommendAssumedAdj에도 calcEffectiveFloorRate 적용 (V2 핵심 외 경로 일관성)
```

- [ ] **Step 3: commit + push (선택)**

핵심 push 직후 별도 commit으로 docs 갱신. 또는 Task 8 commit에 포함 가능.

---

## Self-Review (계획 작성 직후 inline 점검)

**Spec coverage:**
- §1 모듈 (effectiveFloor.js) → Task 2 ✅
- §2 utils.js 변경 → Task 3 ✅ (recommendV2만, predictV5/recommendBid1st/recommendAssumedAdj는 #1-b로 분리 — spec §4.2의 "두 calcBid 위치(281, 503)"는 보수적 범위 축소)
- §3 OwnScoreInput → Task 4 ✅
- §4 App.jsx localStorage/state/render → Task 5 ✅
- §5 듀얼 표기 → Task 6 ✅
- 5단계 하네스 §1/§3/§4 → Task 1/7/8 ✅
- 핸드오프 노트 갱신 → Task 9 ✅

**Placeholder scan:** 모든 step에 구체 코드/명령 포함. "TBD" 없음. Task 5 Step 3의 "헤더 위치 grep"은 실행 시 수행하는 동작 명시.

**Type consistency:**
- `calcEffectiveFloorRate(at, baseFloor, score)` — Task 2/3/6 동일
- `formatFloorDual(base, eff, decimals)` — Task 6에서만 정의·호출
- `OWN_SCORE_KEY` 'bidAnalyzer.ownScore' — Task 5에서만 사용
- `context.ownScore` — Task 3 (utils.js)/Task 5 (App.jsx) 일치

**Scope:** 단일 plan 가능 범위 (5 파일 변경 + 검증 + 배포). #1-b는 별도 plan으로 분리됨.

**Ambiguity:** Task 5 Step 3 "헤더 위치 결정"이 약간 유연 — 실행 시 grep으로 결정 후 명시. 다른 ambiguity 없음.

---

_단일 진실: 본 plan + `docs/superpowers/specs/2026-05-21-effective-floor-rate-design.md`_
_실행 권고: subagent-driven-development (Task 단위 fresh subagent + 두 단계 리뷰)_
