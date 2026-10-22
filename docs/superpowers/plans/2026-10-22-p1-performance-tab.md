# P1 성과 화면(자사 성적표) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 자사 투찰 결과(`bid_details`)를 월별 성적표로 보여 주는 "성과" 탭을 추가한다. 관내·소경쟁 공고 커버리지·통과율·1위 근접률이 핵심 지표다.

**Architecture:** 순수 집계 함수 2개 파일(`eligibility.js`, `performance.js`)을 테스트로 먼저 고정하고, 그 위에 표시 전용 컴포넌트 `PerformanceTab.jsx`를 올린다. 데이터는 App.jsx가 이미 로드한 `bidDetails`·`recs` state를 prop으로 받는다. 새 REST 호출·DB 변경·예측 코드 변경 없음.

**Tech Stack:** React 18 + Vite, `node --test tests/*.test.mjs`(프로젝트 관례: `eq`/`near` 헬퍼 + exit code), 팔레트 `C`(`src/lib/constants.js`).

**Spec:** `docs/superpowers/specs/2026-10-22-bid-ops-funnel-redesign-design.md` §6.4(성과)·§6.2 배지 정의·§6.8 검증·§0 재현 수치. predict-architect 판정(2026-10-22): Evaluator, 회귀 위험 低, `/evaluate` 면제.

## Global Constraints

- Generator 코드(`getFinalRecommendation`·`opt_adj`·`pred_bias_map`·낙찰하한율 함수·`bid_predictions` 쓰기) diff 0줄. 0줄이 아니면 중단하고 `/evaluate`.
- 신규 DB 객체·컬럼·REST 호출 없음. Supabase SDK 금지. 운영 DB 전수 집계 쿼리 금지(클라이언트 집계).
- `bidDetails`·`recs` 배열은 예측 엔진 입력과 공유된다. **제자리 변형 금지**(`.sort()` 금지, `[...arr].sort()`만).
- 지표는 bid_rate 공간만. adj_rate 공간의 WIN-zone/승률 지표 신규 추가 금지. "낙찰 확률" 문구 금지. 순위는 "1위"·"10위 이내"로만.
- "확정/제출" 류 버튼 금지.
- 수치 컬럼: 투찰률(`my_bid_rate`·`win_bid_rate`·`floor_rate`)은 기초금액 대비 %(예 89.7661). PostgREST numeric은 JSON 문자열로 오므로 전부 `Number()` 후 사용, NaN은 null 취급.
- 기본 자격 키워드 `["고양"]`, 소경쟁 경계 `300`(미만, `pc ≥ 1`일 때만), 1위 근접 `gap ≤ 0.5`(%p), 간격 입력오류 방어 `|gap| ≤ 5`.
- 완료 전 `npx vite build` + `node --test tests/*.test.mjs` 통과, 브라우저 프리뷰에서 실제 수치 확인. push는 사용자 승인 + deploy-gate.

## Review Focus

1. REST 숫자 문자열("89.7661")이 그대로 들어와도 집계가 맞아야 한다 → Task 2 테스트에 문자열 입력 포함.
2. `my_rank`가 `null`·`0`·음수인 행은 전부 "통과 아님"(파서가 `-?\d+` 허용) → Task 2.
3. 공고는 있는데 자사 투찰 행이 0인 달은 커버리지 0%가 아니라 "업로드 없음"(2026-06 이후 공백) → Task 2 `noUpload`, Task 3 표시.
4. `participant_count`·`pc`가 `null`/`0`인 행은 소경쟁이 아니다. `od` 없는 행·`pn_no` 중복 행·`is_excluded`·유찰(`co` 없음) 행은 집계 제외 → Task 1·2.
5. 키워드 목록이 비면 아무 행도 "관내"가 아니고, 공백 키워드는 무시(`"x".includes("")` 함정) → Task 1.

---

### Task 1: 자격·소경쟁 판정 (`eligibility.js`)

**Files:**
- Create: `src/lib/eligibility.js` (import 없는 독립 모듈)
- Test: `tests/eligibility.test.mjs`

**Interfaces:**
- Produces:
  - `export const DEFAULT_KEYWORDS = ["고양"]`
  - `export const SMALL_PC_MAX = 300`
  - `export const ELIG_KEY = "eligibilityKeywords.v1"`
  - `export function normalizeKeywords(list: unknown): string[]` — 배열 또는 쉼표 구분 문자열 → trim, 빈 문자열 제거, 중복 제거.
  - `export function isEligible(row: {ag?, pn?}, keywords: string[]): boolean` — `ag` 또는 `pn`에 키워드 중 하나라도 부분 포함(대소문자 무관). 빈 배열 → false.
  - `export function isSmallField(pc: unknown): boolean` — `Number(pc)`가 `1 ≤ n < SMALL_PC_MAX`. null/0/NaN → false.
  - `export function isTarget(row: {ag?, pn?, pc?}, keywords): boolean` — `isEligible(row) || isSmallField(row.pc)`.
  - `export function loadKeywords(storage = globalThis.localStorage): string[]` — 없음/파싱 실패/빈 배열이면 `[...DEFAULT_KEYWORDS]`.
  - `export function saveKeywords(list, storage = globalThis.localStorage): string[]` — normalize 후 JSON 저장, 저장된 배열 반환. storage 없으면 저장 생략.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/eligibility.test.mjs`

```js
eq(isEligible({ag:"경기도교육청 경기도고양교육지원청"}, ["고양"]), true, "ag 부분 일치");
eq(isEligible({ag:"경기도 성남시 분당구", pn:"[(고양시)] 전기공사"}, ["고양"]), true, "pn 일치");
eq(isEligible({ag:"경기도 성남시 분당구", pn:"[관내] 전기공사"}, ["고양"]), false, "미일치");
eq(isEligible({ag:"경기도 고양시"}, []), false, "키워드 없음 → false");
eq(isEligible({ag:"경기도 고양시"}, [""]), false, "빈 키워드는 전부 일치 함정 → false");
eq(normalizeKeywords(" 고양 , ,파주 ,고양").join("|"), "고양|파주", "trim·빈값·중복 제거");
eq(isSmallField("224"), true, "문자열 224"); eq(isSmallField(300), false, "경계 300");
eq(isSmallField(null), false, "null"); eq(isSmallField(0), false, "0");
eq(isTarget({ag:"서울교통공사", pc:13}, ["고양"]), true, "소경쟁만으로 대상");
const mem = { s:{}, getItem(k){ return this.s[k] ?? null; }, setItem(k,v){ this.s[k]=String(v); } };
eq(loadKeywords(mem).join("|"), "고양", "기본값");
saveKeywords("고양, 파주", mem); eq(loadKeywords(mem).join("|"), "고양|파주", "저장 후 로드");
mem.setItem(ELIG_KEY, "{bad json"); eq(loadKeywords(mem).join("|"), "고양", "파싱 실패 → 기본값");
mem.setItem(ELIG_KEY, "[]"); eq(loadKeywords(mem).join("|"), "고양", "빈 배열 → 기본값");
```

- [ ] **Step 2: 실패 확인** — Run: `node --test tests/eligibility.test.mjs` → Expected: FAIL (ERR_MODULE_NOT_FOUND)
- [ ] **Step 3: `src/lib/eligibility.js` 구현** — 위 시그니처. 비교는 `String(x).toLowerCase().includes(kw.toLowerCase())`, 키워드는 normalize를 거친 것만 사용.
- [ ] **Step 4: 통과 확인** — Run: `node --test tests/eligibility.test.mjs` → Expected: `OK`, exit 0
- [ ] **Step 5: Commit**

```bash
git add src/lib/eligibility.js tests/eligibility.test.mjs
git commit -m "feat(performance): 자격 키워드·소경쟁 판정 헬퍼 (P1)"
```

---

### Task 2: 월별 성적표 집계 (`performance.js`)

**Files:**
- Create: `src/lib/performance.js` (import는 `./eligibility.js`만)
- Test: `tests/performance.test.mjs`

**Interfaces:**
- Consumes: Task 1 `isEligible`, `isSmallField`, `isTarget`.
- Produces:
  - `export const NEAR_GAP_MAX = 0.5`, `export const GAP_SANE_MAX = 5`
  - `export function dedupeByPnNo(rows): rows` — `pn_no` 기준 첫 행만 유지(새 배열). `pn_no` 없는 행은 그대로 둔다.
  - `export function classifyDetail(d, keywords): null | {month, group:'target'|'general', eligible, small, passed, belowFloor, nearBand, top10, rank1, gapToWin:number|null}`
    - `od` 없으면 null. `month = String(od).slice(0,7)`.
    - `rank = Number(my_rank)`; `passed = rank >= 1` (null/0/음수/NaN → false).
    - `belowFloor = my_bid_rate != null && floor_rate != null && Number(my_bid_rate) < Number(floor_rate)`.
    - `gapToWin = passed && win_bid_rate != null ? Number(my_bid_rate) − Number(win_bid_rate) : null`; `|gap| > GAP_SANE_MAX`이면 null.
    - `nearBand = gapToWin != null && gapToWin <= NEAR_GAP_MAX`.
    - `top10 = passed && rank <= 10`, `rank1 = passed && rank === 1`.
    - `eligible = isEligible({ag,pn}, keywords)`, `small = isSmallField(participant_count)`, `group = eligible||small ? 'target' : 'general'`.
  - `export function classifyRecord(r, keywords): null | {month, group}` — `od` 없음, `is_excluded === true`, `co` 비어 있음(유찰) → null. `group = isTarget({ag, pn, pc}) ? 'target' : 'general'`.
  - `export function aggregatePerformance(details, records, keywords, todayIso): { months: MonthRow[], summary, totals }`
    - 입력 두 배열은 `dedupeByPnNo` 후 사용. 원본 불변.
    - `MonthRow = { month, target: Cell, general: Cell, noUpload }`, `Cell = { notices, bids, coverage, passed, passRate, belowFloor, nearBand, top10, rank1, medGap }`
    - `coverage = notices > 0 ? bids/notices : null`, `passRate = bids > 0 ? passed/bids : null`, `medGap` = gapToWin 비null 값 중앙값(없으면 null, 소수 4자리 반올림).
    - `months` = details 최소 월 ~ `todayIso.slice(0,7)` 매월 1행, 최신 먼저. details가 비면 `[]`. `noUpload = target.bids + general.bids === 0`.
    - `summary = { coverage, passRate, nearRate, n }` — `noUpload`가 아닌 최근 3개월의 **target** 셀 합산. `n = bids 합`, `nearRate = nearBand/bids`. 업로드 있는 달이 없으면 전부 null.
    - `totals = { bids, belowFloor, eligibleBids, eligibleNotPassed }` — 전 기간(§0 재현: 967·387·146·74).

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/performance.test.mjs`

```js
const KW = ["고양"];
const D = [
  {pn_no:"A", od:"2026-01-15", ag:"경기도 고양시 일산동구", participant_count:"224", my_rank:1, my_bid_rate:"89.7661", floor_rate:"89.745", win_bid_rate:"89.7661"},
  {pn_no:"B", od:"2026-01-20", ag:"경기도 고양시", participant_count:"3340", my_rank:null, my_bid_rate:"89.10", floor_rate:"89.745", win_bid_rate:"89.75"},
  {pn_no:"C", od:"2026-01-22", ag:"서울교통공사", participant_count:"13", my_rank:0, my_bid_rate:null, floor_rate:"89.745", win_bid_rate:"89.77"},
  {pn_no:"D", od:"2026-02-03", ag:"경기도 성남시 분당구", participant_count:"3434", my_rank:"381", my_bid_rate:"89.9643", floor_rate:"89.745", win_bid_rate:"89.7451"},
  {pn_no:"E", od:null, ag:"경기도 고양시", participant_count:"230", my_rank:5, my_bid_rate:"89.80", floor_rate:"89.745", win_bid_rate:"89.75"},
  {pn_no:"A", od:"2026-01-15", ag:"경기도 고양시 일산동구", participant_count:"224", my_rank:50, my_bid_rate:"90.5", floor_rate:"89.745", win_bid_rate:"89.7661"},
];
const R = [
  {pn_no:"r1", od:"2026-01-10", ag:"경기도 고양시", pn:"x", pc:"230", co:"갑사"},
  {pn_no:"r2", od:"2026-01-11", ag:"경기도 고양시", pn:"y", pc:"3300", co:"을사"},
  {pn_no:"r3", od:"2026-01-12", ag:"경기도 김포시", pn:"[(김포시)] z", pc:"3311", co:"병사"},
  {pn_no:"r4", od:"2026-02-01", ag:"경기도 고양시 덕양구", pn:"w", pc:"228", co:"정사"},
  {pn_no:"r5", od:"2026-03-05", ag:"경기도 고양시", pn:"v", pc:"231", co:"무사"},
  {pn_no:"r6", od:"2026-01-13", ag:"경기도 고양시", pn:"excluded", pc:"200", co:"기사", is_excluded:true},
  {pn_no:"r7", od:"2026-01-14", ag:"경기도 고양시", pn:"유찰", pc:"0", co:""},
  {pn_no:"r1", od:"2026-01-10", ag:"경기도 고양시", pn:"x-dup", pc:"230", co:"갑사"},
];
const dCopy = JSON.stringify(D), rCopy = JSON.stringify(R);
const out = aggregatePerformance(D, R, KW, "2026-03-20");
eq(JSON.stringify(D), dCopy, "details 원본 불변"); eq(JSON.stringify(R), rCopy, "records 원본 불변");
eq(out.months.map(m=>m.month).join(","), "2026-03,2026-02,2026-01", "월 범위: details 최소월~오늘, 최신 먼저");
const jan = out.months[2];
eq(jan.target.notices, 2, "1월 관내 공고(제외·유찰·중복 제거)"); eq(jan.general.notices, 1, "1월 일반 공고");
eq(jan.target.bids, 3, "1월 관내 투찰(고양 2 + 소경쟁 1, 중복 A 제거)"); eq(jan.target.passed, 1, "rank 0/null 통과 아님");
eq(jan.target.belowFloor, 1, "하한 미달 1"); eq(jan.target.nearBand, 1, "1위 근접 1 (gap 0)");
eq(jan.target.rank1, 1, "1위 1"); eq(jan.target.top10, 1, "10위 이내 1");
near(jan.target.coverage, 1.5, 1e-9, "커버리지 3/2"); near(jan.target.passRate, 1/3, 1e-9, "통과율 1/3"); near(jan.target.medGap, 0, 1e-9, "간격 중앙값 0");
const feb = out.months[1];
eq(feb.general.bids, 1, "2월 일반 투찰 1"); near(feb.general.medGap, 0.2192, 1e-4, "간격 0.2192");
eq(feb.general.nearBand, 0, "의도적 오답 — 구현 후 1로 정정");
const mar = out.months[0];
eq(mar.noUpload, true, "3월: 공고 있음·투찰 0 → 업로드 없음"); eq(mar.target.coverage, 0, "커버리지 0/1");
eq(out.totals.bids, 4, "od 없는 행·중복 제외"); eq(out.totals.belowFloor, 1, "하한 미달 합");
eq(out.totals.eligibleBids, 2, "키워드 일치 투찰"); eq(out.totals.eligibleNotPassed, 1, "키워드 일치 중 통과 아님");
near(out.summary.passRate, 2/4, 1e-9, "의도적 오답 — 구현 후 1/3로 정정"); eq(out.summary.n, 3, "요약 n = 1·2월 target bids");
near(out.summary.coverage, 1, 1e-9, "요약 커버리지 3/3"); near(out.summary.nearRate, 1/3, 1e-9, "요약 1위 근접률");
eq(aggregatePerformance([], R, KW, "2026-03-20").months.length, 0, "details 없으면 빈 months");
```

- [ ] **Step 2: 실패 확인** — Run: `node --test tests/performance.test.mjs` → Expected: FAIL (ERR_MODULE_NOT_FOUND)
- [ ] **Step 3: `src/lib/performance.js` 구현** — 위 시그니처. 월 열거는 `YYYY-MM` 문자열 증가(12→다음 해 01). 중앙값은 복사본 정렬 후 짝수면 평균.
- [ ] **Step 4: 통과 확인** — Run: `node --test tests/performance.test.mjs` → Expected: "의도적 오답" 2건만 FAIL
- [ ] **Step 5: 기대값 2건 정정(nearBand 1, passRate 1/3) 후 재실행** → Expected: `OK`, exit 0. 전체 `node --test tests/*.test.mjs` → 전부 PASS
- [ ] **Step 6: Commit**

```bash
git add src/lib/performance.js tests/performance.test.mjs
git commit -m "feat(performance): 자사 성적표 월별 집계 순수 함수 (P1)"
```

---

### Task 3: 성과 탭 컴포넌트 + App 마운트

**Files:**
- Create: `src/components/PerformanceTab.jsx`
- Modify: `src/App.jsx` — import 1줄(상단 import 블록, `NoticesTab` import 옆), 탭 버튼 1줄(`<Tb id="notices" .../>` 바로 뒤, 약 1372행), 마운트 1줄(`{tab==="notices"&&<NoticesTab` 블록 바로 앞, 약 2931행). `bidDetails` state는 약 483행에 이미 있음.

**Interfaces:**
- Consumes: Task 1 `loadKeywords/saveKeywords/normalizeKeywords`, Task 2 `aggregatePerformance`, 팔레트 `C`(`src/lib/constants.js`), App state `recs`·`bidDetails`.
- Produces: `export default function PerformanceTab({ recs, bidDetails })`.

- [ ] **Step 1: 컴포넌트 구현**
  - 상태: `keywords`(초기 `loadKeywords()`), `kwInput`(문자열, 초기 `keywords.join(", ")`).
  - `useMemo(() => aggregatePerformance(bidDetails||[], recs||[], keywords, new Date().toISOString().slice(0,10)), [bidDetails, recs, keywords])`. 배열 변형 금지.
  - 상단: 제목 "성과 — 자사 성적표", 키워드 입력란(쉼표 구분) + "적용" 버튼(`saveKeywords(kwInput)` 결과로 `keywords` 갱신), 안내 1줄 "관내 = 발주처·공고명에 키워드 포함 · 소경쟁 = 참가자 300개사 미만(개찰 후 실측)".
  - 요약 카드 3개(최근 3개월, 관내·소경쟁, 각 카드에 `n={summary.n}` 소형 표기): 커버리지 %, 통과율 %, 1위 근접률 %. 해설 1줄 고정 문구: 커버리지 "관내·소경쟁 공고 중 자사가 투찰한 비율", 통과율 "하한가 위에 안착한 비율 — 90% 미만이면 가정 사정률을 올려야 합니다", 1위 근접 "통과 건 중 1위 투찰률과 0.5%p 이내였던 비율". null → "—".
  - 월별 표: 행 = 월(최신 먼저). 열 그룹 `관내·소경쟁` / `일반`, 각 그룹 열: 공고 · 투찰 · 커버리지 · 통과율 · 하한미달 · 1위근접 · 10위↓ · 1위 · 간격(중앙값). `noUpload` 행은 투찰 이후 셀 비우고 "업로드 없음" 배지(`C.txd`). 통과율 셀 색: `< 0.9` → `#e24b4a`, 그 외 `#5dca96`.
  - 하단 2줄: `totals` "전체 투찰 {bids}건 · 하한 미달 {belowFloor}건 · 키워드 일치 {eligibleBids}건(그중 통과 아님 {eligibleNotPassed}건)" / 각주 "커버리지는 분자(실측 참가자수)·분모(공고 pc) 기준이 달라 100%를 넘을 수 있습니다".
  - `bidDetails`가 `null`이면 "불러오는 중", 빈 배열이면 "SUCVIEW 개찰 결과 업로드가 없습니다" 안내.
  - 스타일은 `C` 팔레트와 NoticesTab 표 스타일. 이모지 없음. "낙찰 확률" 문구 없음.
- [ ] **Step 2: App.jsx 3줄 추가** — `import PerformanceTab from "./components/PerformanceTab.jsx";` / `<Tb id="performance" ch="성과"/>` / `{tab==="performance"&&<PerformanceTab recs={recs} bidDetails={bidDetails}/>}`
- [ ] **Step 3: 빌드·테스트** — Run: `npx vite build` → `✓ built`, exit 0. Run: `node --test tests/*.test.mjs` → 전부 PASS
- [ ] **Step 4: Generator diff 0 확인** — Run: `git diff --stat HEAD~3 -- src/App.jsx` → +3줄만. `git diff HEAD~3 -- src/App.jsx | grep -c "getFinalRecommendation\|opt_adj\|pred_bias_map\|getFloorRate"` → `0`
- [ ] **Step 5: 브라우저 확인** — `preview_start`(dev 서버), 로그인 후 "성과" 탭. 확인: (a) 하단 totals 줄이 `967건 · 387건 · 146건(74건)`과 일치(2026-10-22 DB 기준; 이후 업로드가 있었으면 증가분 설명) (b) 2026-06 이후 달 "업로드 없음" (c) 키워드 "고양, 파주" 적용 시 수치 변동·새로고침 후 유지 (d) 콘솔 에러 0 (e) 기존 탭(예측·공고) 동작 변화 없음. 스크린샷 1장.
- [ ] **Step 6: Commit**

```bash
git add src/components/PerformanceTab.jsx src/App.jsx
git commit -m "feat(performance): 성과 탭 — 자사 성적표 월별 표·요약 카드 (P1)"
```

---

### Task 4: 마무리 검증·문서

**Files:**
- Modify: `docs/superpowers/specs/2026-10-22-bid-ops-funnel-redesign-design.md` §6.7 P1 행에 "구현 완료(커밋 해시)".

- [ ] **Step 1: 전체 검증 재실행** — `npx vite build && node --test tests/*.test.mjs` → exit 0. Stop 훅 통과.
- [ ] **Step 2: 스펙 P1 행 갱신 후 커밋** — `git commit -m "docs: P1 성과 화면 완료 표기"`
- [ ] **Step 3: push 전** — 사용자 승인 → `superpowers:requesting-code-review` 1회(신규 파일 3개) → `deploy-gate` PASS → push. `/evaluate`는 면제(Evaluator).

---

## 알려진 임시 상태

- P1 완료 시 상단 탭이 13개가 된다(안티목표 "탭 13개"에 문자 그대로 해당). P4 탭 재배치까지의 임시 상태로 사용자에게 고지.
- `sbFetchDetails()`는 `order=od.desc`만 있어 1,000행을 넘으면 페이징 중복 가능(기존 결함). P1은 `dedupeByPnNo`로 방어만 한다. `,id.desc` 추가는 예측 입력 순서에 닿으므로 별도 커밋·별도 판단.

## Self-Review

- 스펙 §6.4 커버: 월별 열 7종(공고·투찰·커버리지·통과율·하한미달·1위근접·10위↓/1위·간격) → Task 2 Cell + Task 3 표. 요약 카드 3개 + n → Task 2 summary + Task 3. "업로드 없음" → noUpload. 집계 정의(통과 ≥1 / 하한미달 / 관내 / 소경쟁 pc≥1 / 그룹 / 유찰·제외·중복 제거 / bid_rate 공간) → classifyDetail·classifyRecord·dedupeByPnNo. 데이터 취급 규칙(prop 재사용·불변) → Task 3 props + Task 2 불변 테스트. 키워드 편집·로컬스토리지 → Task 1 + Task 3. §6.8 P1 검증 → Task 3 Step 5 + totals.
- 타입 일관성: `aggregatePerformance(details, records, keywords, todayIso)`와 `Cell` 필드명(notices/bids/coverage/passed/passRate/belowFloor/nearBand/top10/rank1/medGap), `summary.{coverage,passRate,nearRate,n}`가 Task 2·3에서 동일.
- Review Focus 5건 모두 Task 1·2 테스트에 입력이 있다(문자열 숫자, rank 0/null, noUpload, od null·pc 0·중복·유찰·제외, 빈 키워드).
- 비례: 계획 ≈ 스펙 §6.4의 2배 이내. 코드 블록은 테스트 단언과 시그니처만.
