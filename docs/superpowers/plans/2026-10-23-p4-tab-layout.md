# P4 탭 재배치 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상단 탭을 [오늘의 공고][예측 기록][성과][G2B 양식][데이터] + 보조 메뉴 + 관리자로 정리하고, 대시보드·V2 미리보기를 없애며, 개찰 후 ✓/✗ 판정을 서버와 같은 정의로 통일한다.

**Architecture:** 탭 구성은 순수 모듈 `src/lib/tabs.js`의 상수로 두고 App.jsx 탭 바가 그것을 읽는다. 대시보드에서 업로드·만료 경고·최근 활동만 새 `DataTab.jsx`로 옮기고 나머지는 지운다. ✓/✗ 판정은 `rec1stPossible.js`에 `bidVerdict`를 추가해 예측 기록 표·엑셀 내보내기·투찰 카드가 함께 쓴다.

**Tech Stack:** React 18 + Vite, node --test.

**Spec:** `docs/superpowers/specs/2026-10-22-bid-ops-funnel-redesign-design.md` §6.1·§6.5·§10(P4 행)·§6.1 공식 추천 단일화 문구

## Global Constraints

- 사용자 결정(2026-10-23): 예측 기록·G2B 양식은 상단 유지(스펙의 '흡수'·'링크로만 진입'을 대체), 분석은 보조로 이동, 데이터 탭 = 업로드 + 만료 경고 + 최근 활동(요약 카드·복수예가 상세 목록·시뮬레이션은 삭제).
- 예측 계산 코드(getFinalRecommendation 본문, bid1st_v2·b_pred 백필 effect, loadPredFiles의 dbRows, utils.js 산식)는 바꾸지 않는다. 업로드 핸들러 `loadFiles`·`loadPredFiles`는 그대로 두고 호출 위치만 옮긴다.
- 보조 메뉴(로그인 사용자 전원): 분석, AI 상담, 피드백, 검증, 발주처 예측 V6, 발주사 하한. V2 미리보기는 삭제. 관리자 탭은 `ADMIN_EMAILS` 전용 그대로.
- 보조의 발주처 예측 V6·발주사 하한·AI 상담 화면 상단에 배너 문구 정확히: `참고용 — 공식 추천 아님 (공식 추천은 오늘의 공고·투찰 카드)`.
- bid_records DELETE 금지(CLAUDE.md) → 대시보드의 '전체 삭제' 버튼은 옮기지 않고 삭제.
- "확정/제출" 류 UI 금지. 커밋 말미 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. push는 사용자 승인 + deploy-gate.

## Review Focus

1. 로그인 직후·새로고침 직후 첫 화면 → 오늘의 공고(옛 코드는 데이터가 있으면 대시보드로 보냄).
2. 보조 메뉴가 접힌 상태에서 보조 탭이 활성 → 그 탭 버튼은 계속 보인다(기존 동작 유지).
3. 개찰 매칭됐는데 연결 낙찰 기록이 메모리에 없음(recs에 해당 id 없음) → ✓/✗ 대신 판정 없음(빈칸), 오류 없음.
4. 1위 금액과 추천 투찰금이 같음(동액) → ✗(1위보다 높음 취급) — 서버 정의와 같음.
5. 투찰 카드의 'G2B 양식에서 전체 보기'로 들어간 뒤 상단 탭으로 G2B 양식을 다시 누름 → 발주처 선택이 풀린 처음 화면(P3 미룬 #4).

---

### Task 1: 탭 구성 상수 + ✓/✗ 판정 순수 함수

**Files:**
- Create: `src/lib/tabs.js`, `tests/tabs.test.mjs`
- Modify: `src/lib/rec1stPossible.js`, `tests/rec1stPossible.test.mjs`

**Interfaces:**
- Produces:
  - `TOP_TABS: {id, ch}[]` = `[{id:"notices",ch:"오늘의 공고"},{id:"predict",ch:"예측 기록"},{id:"performance",ch:"성과"},{id:"g2b_sheet",ch:"G2B 양식"},{id:"data",ch:"데이터"}]`
  - `SUB_TABS: {id, ch}[]` = `[{id:"analysis",ch:"📊 분석"},{id:"chat",ch:"💬 AI 상담"},{id:"feedback",ch:"📈 피드백"},{id:"quality",ch:"🔬 검증"},{id:"agency_predict_v6",ch:"💎 발주처 예측 V6"},{id:"agency_floor",ch:"🎯 발주사 하한"}]`
  - `DEFAULT_TAB = "notices"`, `REF_ONLY_TABS = new Set(["agency_predict_v6","agency_floor","chat"])`, `REF_ONLY_BANNER = "참고용 — 공식 추천 아님 (공식 추천은 오늘의 공고·투찰 카드)"`
  - `bidVerdict(bid: number, rec: {bp, floor_price} | null) -> "possible" | "above" | "below_floor" | null` (`src/lib/rec1stPossible.js`) — bp·floor_price·bid 중 하나라도 없으면 null. `bid >= bp` → "above"(동액 포함), `bid < floor_price` → "below_floor", 그 외 "possible". 판정 순서: above 먼저.

- [ ] **Step 1: 실패하는 테스트**

```js
// tests/tabs.test.mjs
eq(TOP_TABS.map(t => t.id).join(), "notices,predict,performance,g2b_sheet,data", "상단 탭 순서");
eq(SUB_TABS.some(t => t.id === "v2_preview"), false, "V2 미리보기 삭제");
eq(SUB_TABS.some(t => t.id === "dash") || TOP_TABS.some(t => t.id === "dash"), false, "대시보드 삭제");
eq(SUB_TABS.map(t => t.id).includes("analysis") && SUB_TABS.map(t => t.id).includes("chat"), true, "분석·AI 상담은 보조");
eq(DEFAULT_TAB, "notices", "첫 화면");
eq(REF_ONLY_TABS.has("agency_predict_v6") && REF_ONLY_TABS.has("agency_floor") && REF_ONLY_TABS.has("chat"), true, "참고용 배너 대상");
// tests/rec1stPossible.test.mjs 에 추가
const R = { bp: 1000, floor_price: 900 };
eq(bidVerdict(950, R), "possible", "하한~1위 사이"); eq(bidVerdict(1000, R), "above", "동액은 1위 아님");
eq(bidVerdict(1001, R), "above", "1위보다 높음"); eq(bidVerdict(899, R), "below_floor", "하한 미달");
eq(bidVerdict(900, R), "possible", "하한과 같으면 통과"); eq(bidVerdict(950, null), null, "기록 없음");
eq(bidVerdict(950, { bp: 1000, floor_price: null }), null, "하한가 없음"); eq(bidVerdict(null, R), null, "투찰금 없음");
```

- [ ] **Step 2:** `node tests/tabs.test.mjs` → 모듈 없음 FAIL, `node tests/rec1stPossible.test.mjs` → bidVerdict import FAIL 확인.
- [ ] **Step 3:** `tabs.js`(상수만), `bidVerdict` 구현.
- [ ] **Step 4:** `node --test tests/*.test.mjs` 전부 통과.
- [ ] **Step 5:** 커밋 `feat(p4): 탭 구성 상수·개찰 판정 bidVerdict(서버 정의와 동일)`.

### Task 2: 데이터 탭 신설 + 대시보드 삭제

**Files:**
- Create: `src/components/DataTab.jsx`
- Modify: `src/App.jsx`(대시보드 블록 `{tab==="dash"&&…}` 전체, 기본 탭, 로드 후 `setTab("dash")`), `src/lib/supabase.js`(`sbDeleteAll` 삭제)

**Interfaces:**
- Consumes: Task 1 `DEFAULT_TAB`.
- Produces: `DataTab({ busy, drag, setDrag, loadFiles, loadPredFiles, uploadLog, dbLoading, compStats, dataStatus, bidDetails })` — App이 `tab==="data"`일 때 렌더.

- [ ] **Step 1:** DataTab에 대시보드의 세 구획을 그대로 옮긴다: ① 드롭존(`loadFiles`, 숨은 input id `fi`)과 `uploadLog` 줄, ② '입찰서류함 엑셀 업로드' 버튼(NoticesTab과 같은 방식: 숨은 input → `loadPredFiles`), ③ 만료 경고 카드(`compStats.expired>0`), ④ 최근 활동. 시스템 버전 배너·요약 카드 5개·복수예가 상세 목록·SUCVIEW 시뮬레이션·'전체 삭제' 버튼은 옮기지 않는다.
- [ ] **Step 2:** App.jsx — 대시보드 블록 삭제, `useState("dash")` → `useState(DEFAULT_TAB)`, 로드 후 `if(rows.length>0)setTab("dash")` 삭제, `{tab==="data"&&<DataTab …/>}` 추가.
- [ ] **Step 3: 끊긴 참조 정리.** 삭제로 읽는 곳이 0이 된 식별자를 지운다. 후보: `SimView`, `simDraws`, `simResult`(+ `loadFiles` 안의 `setSimResult` 호출 한 줄), `expandedDetail`, `abnormalStats`, `delConfirm`, 삭제 대화상자의 `"all"` 분기, `sbDeleteAll`(import·supabase.js 정의). 각 이름을 `grep -n`으로 확인해 정의만 남은 것만 지운다. 분석 탭의 선택 삭제(`dlgType==="sel"`)는 그대로 둔다.
- [ ] **Step 4: 검증.** `npx vite build` 통과, `node --test tests/*.test.mjs` 통과, 위 후보 이름 grep 0(남긴 것은 원장에 이유).
- [ ] **Step 5:** 커밋 `refactor(p4): 대시보드 → 데이터 탭(업로드·만료 경고·최근 활동), 전체 삭제 버튼 제거`.

### Task 3: 탭 바·보조 메뉴 재배치, V2 미리보기 삭제, 참고용 배너

**Files:**
- Modify: `src/App.jsx`(탭 바 `<Tb …/>` 줄과 보조 메뉴 `SUB` 배열, `{tab==="v2_preview"…}`, import), `src/lib/modeResolver.js`(`getMainMetricLabel`·`getModeNotice` 삭제)
- Delete: `src/components/V2PreviewTab.jsx`, `RecommendPanel.jsx`, `WhyPanel.jsx`, `ModeBadge.jsx`

**Interfaces:**
- Consumes: Task 1 `TOP_TABS`, `SUB_TABS`, `REF_ONLY_TABS`, `REF_ONLY_BANNER`.

- [ ] **Step 1:** 탭 바를 `TOP_TABS.map(t => <Tb …/>)`로 바꾼다. 배지: `predict`는 기존 `compStats.pending`, `notices`는 Task 4가 채우기 전까지 기존 식 유지. 보조 메뉴는 기존 접기 동작(접혀도 활성 탭은 노출) 그대로 `SUB_TABS`를 쓴다. 'AI 상담' 상단 버튼은 지운다(보조로 이동). 관리자 버튼은 그대로.
- [ ] **Step 2:** `REF_ONLY_TABS.has(tab)`이면 해당 탭 본문 위에 `REF_ONLY_BANNER` 한 줄 배너(작은 글씨, 주의 색). 
- [ ] **Step 3:** V2 미리보기 렌더·import 삭제, 컴포넌트 4개 파일 삭제, modeResolver의 두 함수 삭제(다른 사용처 grep 0 확인 — 2026-10-23 기준 RecommendPanel만 사용).
- [ ] **Step 4: 투찰 카드 → G2B 양식 발주처 유지 해제(P3 미룬 #4).** 탭 바에서 `g2b_sheet`를 누르면 `setG2bAgency("")`. 카드 링크(`onOpenG2B`)는 지금처럼 발주처를 넣는다.
- [ ] **Step 5: 검증.** 빌드·테스트 통과, `grep -rn "V2PreviewTab\|RecommendPanel\|WhyPanel\|ModeBadge\|getMainMetricLabel\|getModeNotice" src tests` → 0.
- [ ] **Step 6:** 커밋 `refactor(p4): 탭 바 재배치·보조 메뉴(분석·AI 상담 이동)·V2 미리보기 삭제·참고용 배너`.

### Task 4: ✓/✗ 판정 통일 + 오늘의 공고 배지 정합

**Files:**
- Modify: `src/App.jsx`(예측 기록 표 `canWin`, 엑셀 내보내기 `optWin`), `src/components/BidCard.jsx`(`floorLine`·`result`), `src/lib/todayNotices.js`, `tests/todayNotices.test.mjs`

**Interfaces:**
- Consumes: Task 1 `bidVerdict`.
- Produces: `countTodayActions(rows) -> number` (`src/lib/todayNotices.js`) — `filterRows(rows,"target",false,["elec"])` 중 `status === STATUS.NONE`(예측 없음) 개수.

- [ ] **Step 1: 실패하는 테스트** (`tests/todayNotices.test.mjs`): 대상·전기·개찰 예정 행 중 status none 2건, pred_file 1건, 일반 그룹 none 1건, 마감 지남 none 1건을 만들고 `eq(countTodayActions(rows), 2, "관내·소경쟁 전기 예정 중 예측 없음")`.
- [ ] **Step 2:** FAIL 확인 → 구현 → PASS.
- [ ] **Step 3:** 판정 통일. App에 `recById = useMemo(() => new Map(recs.map(r => [r.id, r])), [recs])`. 예측 기록 표 `canWin` = `bidVerdict(finalBid, recById.get(p.matched_record_id)) === "possible"`(기존 `!isAnomaly` 조건 유지), 판정 null이면 ✓/✗ 칸 빈칸. 엑셀 `optWin`도 같은 식. 투찰 카드 `result`는 `recs`(prop)에서 `matched_record_id`로 찾은 기록과 `bidVerdict`로 계산, 라벨 매핑 possible→"1위 가능 금액", above→"1위보다 높음", below_floor→"하한 미달", null→개찰 결과 줄에서 판정 부분만 생략. `floorLine` 삭제.
- [ ] **Step 4: 배지.** App에서 오늘의 공고 배지를 `countTodayActions(buildTodayRows({...}))`로 — NoticesTab과 같은 입력(notices, predictions, 키워드 `loadKeywords()`, pcOf, 지금 시각, 로컬 날짜)을 `useMemo`로. pcOf는 NoticesTab과 같은 식(`resolvePcDist(pcDistMap,{at, canonicalAg: normalizeAgencyName(ag), ba})`).
- [ ] **Step 5: 검증.** 빌드·테스트 통과. 브라우저: 예측 기록에서 매칭 행 몇 건의 ✓/✗가 카드의 판정과 같은지, 동액 사례가 있으면 ✗인지.
- [ ] **Step 6:** 커밋 `fix(p4): 개찰 판정 서버 정의로 통일(표·엑셀·카드), 오늘의 공고 배지 = 할 일 수`.

### Task 5: 브라우저 확인·마무리

- [ ] **Step 1:** dev 서버(재시작 후 — 낡은 모듈 캐시 주의)에서: 첫 화면 오늘의 공고, 상단 5개 탭·보조 6개·관리자, 데이터 탭 업로드 2종 버튼과 최근 활동, 참고용 배너 3곳, V2 미리보기 없음, G2B 양식 상단 클릭 시 발주처 초기화, 콘솔 에러 0.
- [ ] **Step 2:** 스펙 §10 P4 행에 완료 표기, 메모리 갱신.
- [ ] **Step 3:** 커밋 `docs(p4): 완료 표기`.

## 범위 밖 (설계자 판단)

- 스펙의 "App.jsx 화면 JSX 분리"는 데이터 탭 신설로 한정한다. 분석·예측 기록 JSX는 App state를 수십 개 쓰고 있어 옮기면 prop 전달만 커지고 이득이 작다. 필요해지면 별도 작업.
- 분석 탭의 '선택 삭제'(bid_records DELETE)는 금기와 충돌하지만 기존 기능이라 이번에 건드리지 않는다 — 사용자에게 별도로 묻는다.
- getFinalRecommendation 안의 낡은 격리 주석(P3 미룬 #9)은 예측 코드 본문이라 손대지 않는다.
