# P2 오늘의 공고 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공고 탭을 "오늘의 공고" 작업 목록으로 교체한다. 공고(bid_notices)와 예측(bid_predictions)을 공고번호로 한 행에 합치고, 관내·소경쟁 공고를 마감 임박순으로 맨 위에, 한 행에 추천 사정률·투찰금액·하한 통과 확률을 보여 준다.

**Architecture:** 순수 병합·상태 함수(`src/lib/todayNotices.js`)를 테스트로 먼저 고정한다. App.jsx에는 예측 리스트와 **같은 계산**으로 추천 맵(`todayRecMap`)을 만드는 useMemo 하나만 추가하고(읽기 전용), `NoticesTab.jsx`를 표 한 장으로 다시 쓴다. 예측 탭·업로드·DB·예측 산식은 무변경(P3에서 예측 탭 정리).

**Tech Stack:** React 18 + Vite, Supabase REST(읽기만), `node --test tests/*.test.mjs`(프로젝트 관례 `eq` 헬퍼 + exit code), 팔레트 `C`(`src/lib/constants.js`).

**Spec:** `docs/superpowers/specs/2026-10-22-bid-ops-funnel-redesign-design.md` §6.2(오늘의 공고, 2026-10-22 결정 수정분 포함)·§6.1·§10(P2 선행조건: 통합 키·선택 규칙·상태 모델). predict-architect 판정(2026-10-22): Neutral(표시층), `/evaluate` 면제 — 아래 Global Constraints의 유지 조건을 지킬 때만.

## Global Constraints

- diff 0줄: `getFinalRecommendation` 본문, `recommendMain`/`recommendV2`/`recommendBid1st`, App.jsx의 `bid1st_v2`·`b_pred` 백필 effect 2개(약 1157~1259행), `eraFR`/`getFloorRate`/`calcEffectiveFloorRate`, `sbSavePredictions`/`sbUpdatePredictionsV2`. 커밋 전 `git diff`로 확인.
- `getFinalRecommendation`·`recommendMain`은 **`source==='file_upload'` 행에만** 호출한다. 자동 예측(`g2b_auto`/`g2b_manual`)은 저장된 `b_pred_adj`·`b_pred_bid_amount`를 **읽기만** 하고(`b_pred_mode==='B'`일 때만), 어떤 추천 함수에도 넣지 않는다.
- 하한 통과 확률은 예측 리스트와 같은 경로(`resolveAdjHistory(adjHist, passKeyOf(p))` → `passProbPct(…, impliedAdjOfBid({bid, ba, av, effFr: passEffFrOf(p, ownScore)}))`)로만 계산한다. 저장된 `b_pred_floor_pass_prob`·`disq_risk_pct`는 쓰지 않는다.
- NoticesTab에 새 DB 쓰기 없음. 기존 "예측 등록"(`sbPredictNotice`)과 예측 엑셀 업로드(`loadPredFiles`) 핸들러는 그대로 호출만 한다.
- 기존 `pred_adj_rate + WIN_OPT_GAP` 투찰금 계산(NoticesTab 117~118행)과 `calcBenchmarkAdj` 열은 삭제하고 다른 곳으로 옮기지 않는다.
- "낙찰 확률" 문구 금지(안착 모드). "확정/제출" 버튼 금지. 이모지 없음.
- 공고 통합 키 = `basePnNo(pn_no)` = 끝의 `-NNN`(숫자 3자리) 접미사 제거 후 trim. 빈 값이면 합치지 않는다.
- 예측 선택 규칙: `file_upload` > 그 외 출처; 같은 출처끼리는 `open_date`(YYYY-MM-DD)가 공고 `od` 날짜와 같은 행 > `created_at` 내림차순 > `id` 내림차순.
- 배지 판정: `isEligible({ag, pn}, keywords) || (p50 != null && grain !== 'AT_BA' && isSmallField(p50))`. 키워드는 `loadKeywords()`(기본 `["고양"]`).
- 금액: 공고 행 `ba > 0 ? ba : ep*1.1`(기존 `amtOf`), 예측 행 `p.ba`. 공고 `ba`가 없고 예측이 자동 출처면 `amountEstimated=true`.
- 완료 전 `npx vite build` + `node --test tests/*.test.mjs` 통과, 브라우저에서 업로드 예측 1건의 값이 예측 탭과 일치하는지 대조. push는 사용자 승인 + deploy-gate.

## Review Focus

1. 같은 공고에 `-000`·`-001` 두 차수의 업로드 예측이 있으면 하나만 골라야 하고, 고른 행이 개찰일이 공고와 같은 쪽이어야 한다 → Task 1 `pickPrediction` 테스트.
2. 공고와 안 맞는 업로드 예측(군부대 UMM·민간)은 표에서 사라지면 안 된다. 마감일시가 없으니 개찰일로 정렬한다 → Task 1 `buildTodayRows` 단독 행 테스트.
3. 공고번호가 null인 공고·예측은 서로 합쳐지지 않아야 한다(null끼리 같은 키로 묶이는 함정) → Task 1.
4. REST 숫자 문자열(`"853617001"`)과 timestamptz 문자열(`"2026-10-22 10:00:00+00"`)을 그대로 받아도 정렬·비교가 맞아야 한다 → Task 1 테스트 입력을 문자열로.
5. 자동 예측 행에 `b_pred_adj`가 있어도 `b_pred_mode`가 'B'가 아니면 추천을 비워야 하고, 업로드 예측이 종심제면 추천이 비어야 한다 → Task 2 맵 규칙(수동 확인: Task 4 Step 3).

---

### Task 1: 병합·상태·정렬 순수 함수 (`todayNotices.js`)

**Files:**
- Create: `src/lib/todayNotices.js` (import는 `./eligibility.js`만)
- Test: `tests/todayNotices.test.mjs`

**Interfaces:**
- Consumes: `isEligible`, `isSmallField` (eligibility.js).
- Produces:
  - `export function basePnNo(pnNo): string|null` — `String(pnNo).trim()`에서 `/-\d{3}$/` 제거. 빈 문자열/null → null.
  - `export function pickPrediction(cands, noticeOdDate): pred|null` — Global Constraints의 선택 규칙. `noticeOdDate`는 'YYYY-MM-DD' 또는 null.
  - `export const STATUS = { OPENED:'opened', CLOSED:'closed', BID:'bid', PRED_FILE:'pred_file', PRED_AUTO:'pred_auto', NONE:'none' }`
  - `export function statusOf(row, nowIso): string` — 우선순위: `openAt < now` → OPENED; `closeAt && closeAt < now` → CLOSED; `participated===true` → BID; `source==='file_upload'` → PRED_FILE; `predId && source` → PRED_AUTO; 그 외 NONE. 비교는 `Date.parse`.
  - `export function buildTodayRows({ notices, predictions, keywords, pcOf, nowIso }): Row[]`
    - 예측 후보 = `match_status !== 'matched'`인 행. `basePnNo`로 색인(키 없는 행은 색인 안 함).
    - 공고마다 후보 = (같은 키의 예측) ∪ (`prediction_id`로 찾은 예측). `pickPrediction(후보, od.slice(0,10))`.
    - 공고 행 Row: `{ key:'n:'+notice.id, pnNo:base, pn, ag, at, amount, amountEstimated, closeAt: bid_close_dt||null, openAt: od, participated, noticeId, predId, source, p50, grain, group, status, sortAt }`
      - `amount` = `ba>0 ? Number(ba) : ep>0 ? Number(ep)*1.1 : null`; `amountEstimated = !(ba>0)`.
    - 공고에 소비되지 않은 예측 중 `source==='file_upload'`이고 `open_date >= nowIso.slice(0,10)`인 행 → 단독 Row(`key:'p:'+id`, `closeAt:null`, `openAt: open_date`, `amount: Number(ba)`, `amountEstimated:false`, `noticeId:null`).
    - `p50/grain` = `pcOf({at, ag, amount})`의 `{p50, grain}` 또는 null. `group` = 배지 판정(Global Constraints).
    - `sortAt = closeAt || openAt`. 반환은 `sortAt` 오름차순(없으면 뒤).
    - 원본 배열·객체 불변.
  - `export function filterRows(rows, view, includeDone): Row[]` — `view`: `'target'`(group==='target') | `'all'`; `includeDone=false`면 status OPENED·CLOSED 제외.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/todayNotices.test.mjs`

```js
eq(basePnNo("R26BK01771900-000"), "R26BK01771900", "접미사 제거"); eq(basePnNo(" R26BK01771900 "), "R26BK01771900", "trim");
eq(basePnNo("2026-01-000143-00"), "2026-01-000143-00", "두 자리 접미사는 그대로"); eq(basePnNo(null), null, "null"); eq(basePnNo(""), null, "빈 값");
const N = [
  { id: 1, pn_no: "R26BK01771900", pn: "고양시 가로등", ag: "경기도 고양시", at: "지자체", ep: "776015455", ba: null, od: "2026-10-23 11:00:00+00", bid_close_dt: "2026-10-23 10:00:00+00", participated: false, prediction_id: 18102 },
  { id: 2, pn_no: "R26BK01773039", pn: "성남 천장공사", ag: "경기도 성남시 분당구", at: "지자체", ep: "187000000", ba: null, od: "2026-10-22 11:00:00+00", bid_close_dt: "2026-10-22 10:00:00+00", participated: true, prediction_id: null },
  { id: 3, pn_no: null, pn: "번호없음", ag: "경기도 고양시", at: "지자체", ep: "1000000", ba: null, od: "2026-10-24 11:00:00+00", bid_close_dt: null, participated: false, prediction_id: null },
];
const P = [
  { id: 18102, pn_no: "R26BK01771900", source: "g2b_auto", match_status: "pending", open_date: "2026-10-23", created_at: "2026-10-20T01:00:00Z", ba: "853617001", b_pred_mode: "B", b_pred_adj: "1.1357", b_pred_bid_amount: "765690942" },
  { id: 500, pn_no: "R26BK01771900-000", source: "file_upload", match_status: "pending", open_date: "2026-10-23", created_at: "2026-10-21T01:00:00Z", ba: "850000000" },
  { id: 501, pn_no: "R26BK01771900-001", source: "file_upload", match_status: "pending", open_date: "2026-10-30", created_at: "2026-10-22T01:00:00Z", ba: "850000000" },
  { id: 600, pn_no: "UMM0410-1", source: "file_upload", match_status: "pending", open_date: "2026-10-25", created_at: "2026-10-21T01:00:00Z", ba: "178889000", ag: "제9911부대", at: "군시설", pn: "부대 전기공사" },
  { id: 601, pn_no: "UMM0400-1", source: "file_upload", match_status: "matched", open_date: "2026-10-01", created_at: "2026-09-21T01:00:00Z", ba: "1", ag: "제1부대", at: "군시설", pn: "끝난 건" },
  { id: 602, pn_no: null, source: "file_upload", match_status: "pending", open_date: "2026-10-26", created_at: "2026-10-21T01:00:00Z", ba: "5", ag: "민간", at: "지자체", pn: "번호없는 예측" },
];
const pcOf = ({ at, ag, amount }) => ag.includes("고양") ? { p50: 224, grain: "AG_BA" } : ag.includes("성남") ? { p50: 50, grain: "AT_BA" } : null;
const NOW = "2026-10-22T09:00:00.000Z";
eq(pickPrediction([P[0], P[1], P[2]], "2026-10-23").id, 500, "file_upload 우선 + 개찰일 일치 우선");
eq(pickPrediction([P[1], P[2]], null).id, 501, "개찰일 기준 없으면 created_at 최신");
eq(pickPrediction([P[0]], "2026-10-23").id, 18102, "자동만 있으면 자동");
eq(pickPrediction([], "2026-10-23"), null, "후보 없음");
const nCopy = JSON.stringify(N), pCopy = JSON.stringify(P);
const rows = buildTodayRows({ notices: N, predictions: P, keywords: ["고양"], pcOf, nowIso: NOW });
eq(JSON.stringify(N), nCopy, "notices 불변"); eq(JSON.stringify(P), pCopy, "predictions 불변");
eq(rows.map(r => r.key).join(","), "n:2,n:1,n:3,p:600,p:602", "정렬: 마감/개찰 임박순, 단독 예측은 개찰일");
const r1 = rows.find(r => r.key === "n:1");
eq(r1.predId, 500, "공고1은 file_upload 500 선택(자동 18102 아님)"); eq(r1.source, "file_upload", "출처");
eq(r1.amountEstimated, true, "공고 ba 없음 → 추정"); near(r1.amount, 776015455 * 1.1, 1, "금액 = ep×1.1");
eq(r1.group, "target", "고양 키워드 → 관내"); eq(r1.status, "pred_file", "상태");
const r2 = rows.find(r => r.key === "n:2");
eq(r2.predId, null, "성남은 예측 없음"); eq(r2.group, "general", "AT_BA grain p50은 소경쟁 판정 제외"); eq(r2.status, "bid", "participated → 투찰 기록");
const r3 = rows.find(r => r.key === "n:3"); eq(r3.predId, null, "pn_no null 공고는 pn_no null 예측과 합치지 않음"); eq(r3.status, "none", "예측 없음");
const r600 = rows.find(r => r.key === "p:600"); eq(r600.closeAt, null, "단독 예측 마감 없음"); eq(r600.openAt, "2026-10-25", "개찰일"); eq(r600.status, "pred_file", "상태"); eq(r600.amountEstimated, false, "업로드 금액은 확정");
eq(rows.some(r => r.key === "p:601"), false, "matched 예측은 제외"); eq(rows.some(r => r.key === "p:501"), false, "소비되지 않은 -001은 단독 행이 아니라 같은 공고의 후보였으므로 제외");
eq(filterRows(rows, "target", false).map(r => r.key).join(","), "n:1,n:3", "기본 필터: 관내·소경쟁, 마감·개찰 지난 것 제외");
eq(filterRows(rows, "all", false).length, 4, "전체: 마감된 n:2만 제외"); eq(filterRows(rows, "all", true).length, 5, "마감 포함");
eq(statusOf({ openAt: "2026-10-21 11:00:00+00", closeAt: "2026-10-21 10:00:00+00" }, NOW), "opened", "개찰 지남 우선");
```

  (`p:501` 기대값 보충: 같은 키의 후보는 모두 "소비"된 것으로 본다. 공고 하나에 한 행만 남긴다.)

- [ ] **Step 2: 실패 확인** — Run: `node --test tests/todayNotices.test.mjs` → Expected: FAIL (ERR_MODULE_NOT_FOUND)
- [ ] **Step 3: `src/lib/todayNotices.js` 구현** — 위 시그니처. 날짜 비교는 `Date.parse` 결과 숫자로. `n:2`가 `n:1`보다 앞인 이유는 마감 10/22 < 10/23.
- [ ] **Step 4: 통과 확인** — Run: `node --test tests/todayNotices.test.mjs` → `OK`, exit 0. 전체 `node --test tests/*.test.mjs` → 전부 PASS
- [ ] **Step 5: Commit**

```bash
git add src/lib/todayNotices.js tests/todayNotices.test.mjs
git commit -m "feat(today): 공고·예측 병합/상태/정렬 순수 함수 (P2)"
```

---

### Task 2: 추천 맵 useMemo (App.jsx, 읽기 전용)

**Files:**
- Modify: `src/App.jsx` — `predMap` useMemo(약 1102행) 바로 아래에 `todayRecMap` useMemo 추가, NoticesTab 마운트(약 2931~2941행)에 prop 3개 추가(`todayRecMap`, `predictions`, `loadPredFiles`).

**Interfaces:**
- Consumes: `getFinalRecommendation`(useCallback), `adjHist`, `ownScore`, `passKeyOf`, `passEffFrOf`, `resolveAdjHistory`, `passProbPct`, `impliedAdjOfBid` (전부 App.jsx에 이미 import·정의됨).
- Produces: `todayRecMap: { [predId]: { adj:number|null, bid:number|null, passPct:number|null, jongsim:boolean, estimated:boolean, source:string } }`

- [ ] **Step 1: useMemo 추가** — 예측 리스트 2847~2852행과 같은 계산을 그대로 쓴다.
  - `file_upload`: `r=getFinalRecommendation(p)`; `adj=r.adj`; `bid=r.bid1st||r.bid`; `jongsim=!!r.jongsim`; `estimated=false`.
  - 그 외 출처: `p.b_pred_mode==='B' && p.b_pred_adj!=null && p.b_pred_bid_amount!=null`이면 `adj=Number(p.b_pred_adj)`, `bid=Number(p.b_pred_bid_amount)`, `estimated=true`; 아니면 adj·bid null.
  - `passPct`: `!jongsim && bid && p.ba`일 때 `resolveAdjHistory(adjHist,passKeyOf(p))`가 있으면 `passProbPct(dist, impliedAdjOfBid({bid:Number(bid), ba:Number(p.ba), av:Number(p.av)||0, effFr:passEffFrOf(p,ownScore)}))`, 아니면 null.
  - `match_status==='matched'`인 행은 건너뛴다. deps: `[predictions, adjHist, ownScore, getFinalRecommendation]`.
- [ ] **Step 2: 마운트 prop 추가** — `<NoticesTab ... todayRecMap={todayRecMap} predictions={predictions} loadPredFiles={loadPredFiles} />`
- [ ] **Step 3: 빌드** — `npx vite build` → `✓ built`. PostToolUse 훅이 `getFinalRecommendation` 키워드로 알림을 띄우면 "호출 추가·본문 무변경·file_upload 필터 유지"로 기록.
- [ ] **Step 4: Generator diff 확인** — `git diff -- src/App.jsx | grep -c "^[-+].*\(const getFinalRecommendation\|recommendMain(\|b_pred_mode:\|bid1st_v2_adj:\)"` → `0` (백필 effect와 함수 본문이 안 바뀌었는지). `git diff --stat -- src/App.jsx` → 추가 약 20줄, 삭제 0줄.
- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "feat(today): 오늘의 공고용 추천 맵 — 예측 리스트와 동일 계산, 읽기 전용 (P2)"
```

---

### Task 3: NoticesTab을 "오늘의 공고" 표로 재작성

**Files:**
- Modify: `src/components/NoticesTab.jsx` (전면 재작성, 186줄 → 비슷한 규모)
- Modify: `src/App.jsx` 탭 라벨 1곳 `<Tb id="notices" ch="공고" …/>` → `ch="오늘의 공고"`

**Interfaces:**
- Consumes: Task 1 `buildTodayRows`, `filterRows`, `STATUS`; Task 2 `todayRecMap`; 기존 props `notices, setNotices, noticeFilter, setNoticeFilter, predMap, noticeLoadingIds, setNoticeLoadingIds, setFocusedPredId, setTab, refreshPredictions, pcDistMap`; 새 props `predictions, loadPredFiles`; `loadKeywords`(eligibility.js), `resolvePcDist`·`pcWinRateOf`·`PC_GRAIN_LABELS`(participantCount.js), `normalizeAgencyName`·`tc`(utils.js), `sbPredictNotice`.
- Produces: `export default function NoticesTab(props)` (시그니처 호환, 새 prop은 선택).

- [ ] **Step 1: 컴포넌트 재작성**
  - `keywords = loadKeywords()`(useMemo, 빈 deps). `pcOf = ({at, ag, amount}) => pcDistMap && at && amount ? resolvePcDist(pcDistMap, {at, canonicalAg: normalizeAgencyName(ag), ba: amount}) : null`.
  - `rows = useMemo(() => buildTodayRows({notices, predictions, keywords, pcOf, nowIso: new Date().toISOString()}), [notices, predictions, pcDistMap, keywords])`.
  - 뷰 상태: `noticeFilter`가 `'all'`이면 전체, 그 외(`'upcoming'` 포함 기존 값)는 `'target'`. `includeDone` 로컬 state(기본 false).
  - 상단 요약 3칸: 관내·소경쟁 예정 N건 / 오늘 마감 N건(closeAt이 오늘) / 예측 없음 N건(status NONE, 관내·소경쟁만). 버튼: [관내·소경쟁] [전체 예정] [마감·개찰 지난 것 포함 토글] [입찰서류함 엑셀 업로드](숨은 `<input type=file multiple accept=".xls,.xlsx">` → `loadPredFiles(files)`).
  - 표 열(좌→우): 구분(배지 `관내·소경쟁` 금색 / `일반` 회색) · 마감(`closeAt` MM/DD HH:mm, 없으면 "개찰 " + openAt 날짜; 2시간 내 빨강·24시간 내 노랑 — 기존 규칙 유지) · 발주처 · 공고명(말줄임, title 전체) · 기초금액(`tc(amount)`, `amountEstimated`면 `추정` 배지 + title "추정가격×1.1 — 기초금액 공개 후 엑셀 업로드로 확정") · 예상참가(`p50`, title에 p25~p75·n·grain, 지자체·AG grain이면 1순위율 괄호 병기) · 추천 사정률(`(100+adj).toFixed(4)+"%"`, 모노스페이스, `estimated`면 회색조) · 투찰금액(`tc(bid)+"원"`) · 통과 확률(`Math.round(passPct)+"%"`, 90 미만 빨강·이상 초록; null "—") · 상태/액션.
  - 상태/액션 셀: NONE이고 noticeId 있음 → [예측 등록] 버튼(기존 `handlePredictNotice`); PRED_FILE/PRED_AUTO → "예측(엑셀)"/"예측(자동)" 텍스트 + 클릭 시 `setFocusedPredId(predId); setTab("predict")`; BID → "투찰 기록"; CLOSED → "마감"; OPENED → "개찰 완료". UMM/민간 단독 행은 액션 없음.
  - 행 수 50개씩 "더 보기".
  - 삭제: 벤치마크 열, `pred_adj_rate + WIN_OPT_GAP` 계산, "저경쟁 지자체(<100)" 필터, 안내문 중 "예측탭에 즉시 반영" 문구는 "오늘의 공고 표에 즉시 반영"으로.
  - 이모지 없음. "낙찰 확률" 문구 없음.
- [ ] **Step 2: 빌드·테스트** — `npx vite build` → `✓ built`; `node --test tests/*.test.mjs` → 전부 PASS.
- [ ] **Step 3: 브라우저 확인** — dev 서버에서 로그인 후 "오늘의 공고":
  (a) 기본 뷰가 관내·소경쟁만, 마감 임박순. (b) 업로드 예측이 붙은 행 1건을 골라 추천 사정률·투찰금액·통과 확률이 예측 탭 같은 행과 **숫자까지 일치**. (c) 자동 예측 행에 `추정` 배지와 값 표시. (d) 군부대 업로드 예측(UMM)이 단독 행으로 보임. (e) [예측 등록] 클릭 → 행이 예측(자동)으로 바뀜. (f) 콘솔 에러 0. 스크린샷 1장.
- [ ] **Step 4: Commit**

```bash
git add src/components/NoticesTab.jsx src/App.jsx
git commit -m "feat(today): 공고 탭을 오늘의 공고 작업 목록으로 교체 — 관내·소경쟁 우선, 마감 임박순, 추천 3열 (P2)"
```

---

### Task 4: 마무리 검증·문서

**Files:**
- Modify: 스펙 §6.7 표 P2 행 "구현 완료(커밋)"; §6.2 상태 모델 문구를 구현(`STATUS` 6값)에 맞춤.

- [ ] **Step 1: Generator diff 0 재확인** — `git diff origin/main..HEAD -- src/lib/utils.js` → 0줄. `git diff origin/main..HEAD -- src/App.jsx | grep -c "^-"` → 1 이하(탭 라벨 1줄). 백필 effect 범위(`git diff origin/main..HEAD -- src/App.jsx | grep -c "b_pred_mode\|bid1st_v2_adj:"`) → 0.
- [ ] **Step 2: 전체 검증** — `npx vite build && node --test tests/*.test.mjs` → exit 0.
- [ ] **Step 3: 자동 예측 행 규칙 수동 확인** — 브라우저 콘솔에서 `b_pred_mode!=='B'`인 자동 예측이 있으면 추천이 "—"인지, 종심제 업로드 예측이 있으면 "—"인지(없으면 "해당 행 없음" 기록).
- [ ] **Step 4: 스펙 갱신·커밋** — `git commit -m "docs: P2 오늘의 공고 완료 표기"`
- [ ] **Step 5: push 전** — 사용자 승인 → deploy-gate PASS → push. Neutral이라 `/evaluate` 면제, 코드 리뷰는 `superpowers:requesting-code-review` 1회 권장(신규 lib + 전면 재작성 컴포넌트).

---

## 알려진 한계·보류

- 예측 탭은 그대로 남는다(엑셀 내보내기·삭제·매칭 비교). P3에서 정리.
- `bid_notices.pn_no`에 인덱스가 없다. 서버 필터는 `od`·`reg`·`ag`·`pn`만 쓰므로 영향 없음. 향후 공고번호 조인이 서버로 가면 인덱스 추가 필요.
- 자격 키워드는 로드 시 1회 읽는다. 성과 탭에서 바꾸면 새로고침 후 반영.

## Self-Review

- 스펙 §6.2 커버: 행 = 공고(+단독 업로드 예측) → Task 1. 열 10개(배지·마감·발주처·공고명·기초금액·예상참가·사정률·투찰금·통과확률·상태) → Task 3. 배지 정의(키워드 OR p50<300, AT_BA 제외) → Task 1. 기본 정렬·필터(관내·소경쟁, 마감 임박) → Task 1 `filterRows`/정렬 + Task 3. 추천 3열 = 업로드 행은 메인과 동일 경로, 자동 행은 저장 `b_pred_*` 읽기 + 추정 배지 → Task 2·3. 상태 6값 → Task 1 `STATUS`. 업로드 진입(엑셀 버튼) → Task 3. 유지·제거 목록(§6.2) → 예측 탭 유지는 "알려진 한계"에 명시, 벤치마크·WIN_OPT_GAP 제거는 Task 3. §10 통합 키·선택 규칙 → Task 1.
- 타입 일관성: `Row` 필드명(key, pnNo, predId, source, amount, amountEstimated, closeAt, openAt, participated, noticeId, p50, grain, group, status, sortAt)이 Task 1·3에서 동일. `todayRecMap[predId].{adj,bid,passPct,jongsim,estimated,source}`가 Task 2·3에서 동일.
- Review Focus 5건: 1·2·3·4는 Task 1 테스트 입력(두 차수, UMM 단독, pn_no null, 문자열 숫자·timestamptz)에 있고, 5는 Task 4 Step 3 수동 확인으로 고정(자동 테스트 불가: App.jsx 내부 useMemo).
- 비례: 계획 ≈ 스펙 §6.2의 2.5배. 코드 블록은 테스트와 시그니처만. Task 2는 기존 6줄 계산을 옮겨 적는 수준이라 본문 없이 규칙만 적었다.
