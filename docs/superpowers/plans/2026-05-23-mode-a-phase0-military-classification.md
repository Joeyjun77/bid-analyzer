# 군부대 Mode A — Phase 0: 군 기관 분류 정제 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `clsAg`/`classify_agency_type`의 군시설 오탐(맨앞 `군` → 가평군 등 행정구역, `사단` → 사단법인)을 교정해 Mode A의 군부대 모집단을 깨끗하게 만든다.

**Architecture:** 순수 분류 함수를 `src/lib/agencyClass.js`로 분리(node 단위 테스트 가능)하고 `utils.js`에서 re-export(호출부 무파급). DB 미러 함수 `classify_agency_type`도 동일 정규식·순서로 동기 수정. 실데이터 diff로 검증.

**Tech Stack:** React+Vite(테스트 러너 없음 → node .mjs 단위검증 + `vite build` + Supabase SQL diff + `/evaluate`).

**상위 설계:** `docs/v2/A_MODE_A_MILITARY_WIN_DESIGN_2026-05-23.md` §13.2-1, §14 Phase 0.

---

## 배경 / 중요 사실 (구현 전 필독)

- **오탐 실측**: 현재 `at='군시설'` 모집단 중 행정구역 "OO군"(가평군·연천군·군포시·양평군·해남군·군산시 등) + 사단법인(한국석면안전협회 등 14기관/53건)이 섞여 있음. `bid_records` 기준 약 **291개 기관 / 4,189건**이 잘못된 군시설.
- **확정 교정 정규식** (실데이터 검증 완료, 코드리뷰 반영):
  - 군시설: `사단|여단|군단|국방|국군|육군|해군|공군|해병|사령부|[0-9]부대|군부대|병참|방위사업`
  - **가드**: `사단법인` → `지자체` (군시설 체크보다 먼저)
  - `사단` 유지 필수 — 제8기동사단·제1보병사단·수도기계화보병사단 등 진짜 군.
  - **`부대`는 `[0-9]부대|군부대`로 앵커링** — 코드리뷰 지적 + 실데이터 확인: 비앵커 `부대`는 "중부대학교"(대학교)를 군시설로 오분류. 진짜 군 부대는 전부 숫자형(제2136부대·4284부대 등).
- **Generator 영향 (양방향, 실측)**: 재분류 시 낙찰하한율 테이블이 바뀐다(군시설 86.25% ↔ 지자체 88.25~90.25%).
  - **DROPPED 291개 기관**: 행정구역("OO군"·산림조합 등) 군시설→지자체
  - **NEW_CAPTURE 78개 기관**: 기존 bare `군`이 놓치던 진짜 군(수도방위사령부·드론작전사령부·제NNNN부대·기갑여단 등) 지자체→군시설
  - 양방향 모두 추천 투찰값 변동 → **Phase 0은 Generator, `/evaluate` 필수.**
- **라이브 반영**: 추론 경로는 `at=clsAg(ag)`를 매번 재계산(App.jsx:595/1015, AgencyPredictorTab.jsx:51) → JS 수정 즉시 신규 예측에 반영. 과거 `bid_records.at` 백필은 선택(§Task 5).
- **호출부**: `clsAg`는 `utils.js`에서 App.jsx·AgencyPredictorTab.jsx로 export. re-export 유지 시 import 구문 무변경.

## 파일 구조

| 파일 | 책임 | 변경 |
|---|---|---|
| `src/lib/agencyClass.js` | 발주기관명→유형 순수 분류 (Vite/DB 의존 없음) | **신규** |
| `src/lib/utils.js:45` | clsAg 정의 → agencyClass.js re-export | 수정 |
| `tests/agencyClass.test.mjs` | node 단위 검증 | **신규** |
| DB `classify_agency_type(text)` | clsAg SQL 미러 | 수정(migration) |
| `docs/v2/migrations/m34_fix_classify_agency_type.sql` | 마이그레이션 기록 | **신규** |

---

## Task 1: 순수 분류 모듈 분리 + 오탐 교정

**Files:**
- Create: `src/lib/agencyClass.js`
- Create: `tests/agencyClass.test.mjs`
- Modify: `src/lib/utils.js:45`

- [ ] **Step 1: 실패하는 node 테스트 작성**

`tests/agencyClass.test.mjs`:
```js
import { clsAg, isMilitaryAgency } from "../src/lib/agencyClass.js";

const cases = [
  // 군시설 (유지 + bare 군이 놓치던 신규 포착)
  ["수도방위사령부", "군시설"], ["육군항공사령부", "군시설"], ["제7862부대", "군시설"],
  ["제8기동사단", "군시설"], ["제1보병사단", "군시설"], ["수도기계화보병사단", "군시설"],
  ["제5군단사령부", "군시설"], ["국군재정관리단", "군시설"], ["공군제10전투비행단", "군시설"],
  ["국방부", "군시설"], ["해군본부", "군시설"], ["방위사업청", "군시설"],
  ["제2136부대", "군시설"], ["4284부대", "군시설"], ["드론작전사령부", "군시설"], ["제2기갑여단", "군시설"],
  // 오탐 교정 → 지자체
  ["경기도 가평군", "지자체"], ["경기도 연천군", "지자체"], ["경기도 군포시", "지자체"],
  ["전라남도 해남군", "지자체"], ["전북특별자치도 군산시", "지자체"], ["가평군청", "지자체"],
  ["사단법인 한국석면안전협회", "지자체"], ["사단법인경기도새마을회", "지자체"],
  ["중부대학교", "지자체"],   // 대학교 — [0-9]부대 앵커링이 '부대' 단독 매칭 차단
  // 타 유형 회귀 없음
  ["경기도교육청", "교육청"], ["한국전력공사", "한전"], ["조달청", "조달청"],
  ["한국토지주택공사", "LH"], ["한국수자원공사", "수자원공사"], ["고양시", "지자체"],
];
let bad = 0;
for (const [n, exp] of cases) {
  const got = clsAg(n);
  if (got !== exp) { console.error(`XX ${n} -> ${got} (expect ${exp})`); bad++; }
}
// isMilitaryAgency 회귀 가드
if (isMilitaryAgency("수도방위사령부") !== true) { console.error("XX isMilitaryAgency(수도방위사령부) !== true"); bad++; }
if (isMilitaryAgency("고양시") !== false) { console.error("XX isMilitaryAgency(고양시) !== false"); bad++; }
console.log(bad === 0 ? `OK all ${cases.length} cases + isMilitaryAgency` : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `node tests/agencyClass.test.mjs`
Expected: FAIL — `Cannot find module ... agencyClass.js`

- [ ] **Step 3: `agencyClass.js` 작성 (교정 로직)**

`src/lib/agencyClass.js`:
```js
// 발주기관명 → 기관유형 분류. 순수 함수(Vite/DB 의존 없음)라 node 단위 테스트 가능.
// !! DB classify_agency_type(text) 와 정규식·순서 동일 유지 필수 !!
// 2026-05-23: 군시설 오탐 수정 —
//   (1) 맨앞 '군' 제거: '가평군/군포시' 등 행정구역 오탐 차단
//   (2) '사단법인' 가드: 사단법인 OO 협회가 '사단'에 걸려 군시설로 오분류되던 것 차단
//   '사단' 자체는 유지 (제8기동사단·제1보병사단 등 진짜 군).
// '부대'는 [0-9]부대|군부대로 앵커링: 진짜 군 부대는 전부 숫자형(제2136부대 등).
// 비앵커 '부대'는 '중부대학교'(대학교)를 오분류 → 앵커링으로 차단. (실데이터 검증)
const MIL = /사단|여단|군단|국방|국군|육군|해군|공군|해병|사령부|[0-9]부대|군부대|병참|방위사업/;
export function clsAg(n){
  if(!n)return"조달청";
  const s=String(n).trim();
  if(/조달청/.test(s))return"조달청";
  if(/교육/.test(s))return"교육청";
  if(/한국전력|한전/.test(s))return"한전";
  if(/LH|주택공사|토지주택/.test(s))return"LH";
  if(/사단법인/.test(s))return"지자체";   // 군시설 체크보다 먼저 — 사단법인은 군시설 아님
  if(MIL.test(s))return"군시설";
  if(/수자원/.test(s))return"수자원공사";
  return"지자체";
}
export function isMilitaryAgency(n){return clsAg(n)==="군시설";}
```

- [ ] **Step 4: `utils.js`의 clsAg를 re-export로 교체**

`src/lib/utils.js:45` 한 줄(`export function clsAg(n){...}` 전체)을 삭제하고 아래로 교체. 파일 상단 import 영역(1~5행 부근)에 추가:
```js
export { clsAg, isMilitaryAgency } from "./agencyClass.js";
```
주의: 45행의 기존 `clsAg` 정의 전체를 제거(중복 정의 금지). 다른 함수(`isNewEra`, `eraFR` 등)는 그대로 둔다.

- [ ] **Step 5: 테스트 실행 → 통과 확인**

Run: `node tests/agencyClass.test.mjs`
Expected: `OK all 31 cases + isMilitaryAgency`, exit 0 (케이스 수 다르면 배열 길이 확인)

- [ ] **Step 6: 빌드 검증**

Run: `npx vite build`
Expected: 빌드 성공(에러 0). CRLF 경고는 무시.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/agencyClass.js src/lib/utils.js tests/agencyClass.test.mjs
git commit -m "fix(a-phase0): 군시설 분류 오탐 교정 — 맨앞 군 제거 + 사단법인 가드

clsAg를 agencyClass.js 순수모듈로 분리(node 테스트 가능), utils.js는 re-export.
가평군/군포시 등 행정구역, 사단법인 14기관을 지자체로 교정. 사단/군단/부대 유지.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: DB `classify_agency_type` 동기 수정 + 실데이터 검증

**Files:**
- Create: `docs/v2/migrations/m34_fix_classify_agency_type.sql`
- DB: `apply_migration` 으로 함수 교체

- [ ] **Step 1: 교정 전 baseline 수치 고정 (검증 기준)**

아래 SQL을 실행해 결과를 기록(교정 후 비교용):
```sql
SELECT classify_agency_type(ag) AS at, COUNT(*) n
FROM bid_records
WHERE ag ~ '군|사단|국방|해군|공군|육군|해병'
  AND ag !~ '조달청' AND ag !~ '교육' AND ag !~ '한국전력|한전' AND ag !~ 'LH|주택공사|토지주택'
GROUP BY 1 ORDER BY n DESC;
```
Expected (교정 전): 대부분 `군시설`(가평군 등 오탐 포함).

- [ ] **Step 2: 마이그레이션 파일 작성**

`docs/v2/migrations/m34_fix_classify_agency_type.sql`:
```sql
-- m34: classify_agency_type 군시설 오탐 교정 (JS agencyClass.js 와 동기)
-- 맨앞 '군' 제거(행정구역 오탐) + '사단법인' 가드. '사단' 유지(진짜 군 사단).
CREATE OR REPLACE FUNCTION public.classify_agency_type(p_ag text)
 RETURNS text LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_ag ~ '조달청'                THEN '조달청'
    WHEN p_ag ~ '교육'                  THEN '교육청'
    WHEN p_ag ~ '한국전력|한전'         THEN '한전'
    WHEN p_ag ~ 'LH|주택공사|토지주택'  THEN 'LH'
    WHEN p_ag ~ '사단법인'              THEN '지자체'
    WHEN p_ag ~ '사단|여단|군단|국방|국군|육군|해군|공군|해병|사령부|[0-9]부대|군부대|병참|방위사업' THEN '군시설'
    WHEN p_ag ~ '수자원'                THEN '수자원공사'
    ELSE '지자체'
  END;
$function$;
```

- [ ] **Step 3: 마이그레이션 적용**

`apply_migration` 도구로 name=`m34_fix_classify_agency_type`, query=위 SQL 적용.

- [ ] **Step 4: 교정 후 검증 — 방향 확인**

교정 함수가 (옛 분류) 대비 양방향으로 어떻게 바뀌는지 전수 검증:
```sql
WITH dist AS (SELECT DISTINCT ag FROM bid_records WHERE ag IS NOT NULL),
cls AS (
  SELECT ag,
    (ag ~ '군|사단|국방|해군|공군|육군|해병' AND ag !~ '조달청' AND ag !~ '교육'
      AND ag !~ '한국전력|한전' AND ag !~ 'LH|주택공사|토지주택') AS old_mil,
    (classify_agency_type(ag) = '군시설') AS new_mil
  FROM dist
)
SELECT CASE WHEN new_mil AND NOT old_mil THEN 'NEW_CAPTURE'
            WHEN old_mil AND NOT new_mil THEN 'DROPPED'
            ELSE 'same' END AS change,
       COUNT(*) distinct_ag, (array_agg(ag ORDER BY ag))[1:15] sample
FROM cls WHERE new_mil <> old_mil GROUP BY 1 ORDER BY 1;
```
Expected:
- **DROPPED ≈ 291개 기관**: 전부 행정구역(고성군·양구군·가평군 보건소·산림조합 등) → 지자체. 군사 기관이 섞이면 FAIL.
- **NEW_CAPTURE ≈ 78개 기관**: 전부 진짜 군(수도방위사령부·드론작전사령부·제2136부대·제2기갑여단·3공수특전여단 등). 비군사("중부대학교" 등)가 섞이면 FAIL.
- 별도 확인: `classify_agency_type('사단법인 한국석면안전협회')`→`지자체`, `classify_agency_type('제8기동사단')`→`군시설`, `classify_agency_type('중부대학교')`→`지자체`.

- [ ] **Step 5: 커밋 (마이그레이션 기록)**

```bash
git add docs/v2/migrations/m34_fix_classify_agency_type.sql
git commit -m "fix(a-phase0): classify_agency_type 군시설 오탐 교정 (m34, JS와 동기)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `/evaluate` 게이트 (Generator — 낙찰하한율 변동)

**Files:** 없음 (검증만)

- [ ] **Step 1: `/evaluate` 실행**

Run: `/evaluate` 슬래시 커맨드.
근거: 재분류 기관(가평군 등)의 낙찰하한율이 군시설→지자체로 바뀌어 추천 투찰값 변동. G-단위/G-A안/G-bias/G-모드표시 4대 게이트 + 핵심영역(한전·고양시·군부대) MAE 확인.

- [ ] **Step 2: 판정 처리**

- PASS/WARN → Task 4(선택) 또는 Phase 1 진입 가능.
- **FAIL → 중단. git push 금지.** 원인 분석 후 정규식/가드 수정하고 Task 1~3 재실행.
- 핵심영역(한전·고양시·군부대) MAE +0.02 이상 악화 시 즉시 FAIL 처리.

- [ ] **Step 3: deploy-gate (push 직전)**

push 전 `deploy-gate` 서브에이전트 호출. 통합 PASS 시에만 push.

---

## Task 4 (선택): 과거 `bid_records.at` 백필

> 라이브 추론은 `clsAg(ag)` 재계산이라 자동 교정됨. 과거 집계 일관성이 필요할 때만 수행. **`bid_records` DELETE 금지(CLAUDE.md), UPDATE만.**

- [ ] **Step 1: dry-run 카운트 (영향 범위 확인)**

```sql
SELECT at AS old_at, classify_agency_type(ag) AS new_at, COUNT(*) n
FROM bid_records
WHERE at IS DISTINCT FROM classify_agency_type(ag)
GROUP BY 1,2 ORDER BY n DESC;
```

- [ ] **Step 2: 백필 UPDATE (검토 후)**

```sql
UPDATE bid_records SET at = classify_agency_type(ag)
WHERE at IS DISTINCT FROM classify_agency_type(ag);
```
Expected: Step 1 합계와 동일 건수 갱신. 이후 동일 SELECT 0건.

- [ ] **Step 3: 영향받는 캐시/뷰 재생성** (있을 경우 agency_win_stats 등 재집계 — 별도 확인)

---

## Self-Review

- **Spec coverage**: 설계 §13.2-1(분류 오탐 36%)·§14 Phase 0 충족. floorErr(Phase 1)·recommendModeA(Phase 2)·백테스트(Phase 3)는 본 계획 범위 밖(후속 계획).
- **Placeholder 없음**: 정규식·SQL·테스트 코드·기대 수치 전부 명시.
- **타입/시그니처 일관**: `clsAg(n)`·`isMilitaryAgency(n)` JS와 `classify_agency_type(p_ag)` SQL 정규식 문자열 동일(`사단|여단|군단|국방|국군|육군|해군|공군|해병|사령부|부대|병참|방위사업` + 사단법인 가드).

---

## 후속 Phase 로드맵 (각자 별도 계획서)

Phase 0 PASS·안정 후 진행. 각 Phase는 독립 계획서로 작성.
- **Phase 1**: floorErr 분포 소스 구축 — 신규 뷰/RPC, era 필터, 군부대 정식 분류 기반. (DB 인프라)
- **Phase 2**: `recommendModeA` 교체 — floorErr 분위수 + alpha 제약, **adj↔bid_rate 공간 정합**(G-단위 FAIL 회피). 호출부(`recommendV2` utils.js:1082, `resolveGapDist` modeResolver.js:49) 동시 수정.
- **Phase 3**: 백테스트 alpha sweep (0.10~0.15 → sweet spot → 0.25 방향).
- **Phase 4**: `/evaluate`(G-hit 포함) → deploy-gate → 7~14일 누적 효과 판정.

---
_작성: Claude Opus 4.7 / 2026-05-23 / 다음: subagent-driven-development 또는 executing-plans로 Task 1부터 실행_
