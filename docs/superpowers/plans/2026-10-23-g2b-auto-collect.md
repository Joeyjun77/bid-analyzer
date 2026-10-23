# G2B 양식 자동 수집 1차 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 나라장터 경기 전기공사업 개찰 공고를 매일 자동으로 G2B 양식 값(기초금액·A값·예정가격·하한가·발주처사정율·1위사정율)으로 만들고, 엑셀 대조 합격 후 G2B 양식 탭과 투찰 카드 1위 이력에 '자동' 표시와 함께 보여 준다.

**Architecture:** 서버는 새 edge function `fn-collect-g2b-sheet`가 기존 수집 데이터(bid_records API 행·bid_prelim_sets·bid_notices)와 기초금액 API를 합쳐 새 테이블 `g2b_auto_sheet`에만 쓴다(bid_records 불변 → 예측 엔진 불변). 계산은 Deno·Node 양쪽에서 import 되는 순수 모듈 `calc.js`. 앱은 플래그 `G2B_AUTO_SHOW`가 켜졌을 때만 이 테이블을 읽어 G2B 양식·투찰 카드 전용 목록에 합친다.

**Tech Stack:** Supabase Postgres(plpgsql, pg_cron, pg_net), Deno edge function, React 18 + Vite, node --test.

**Spec:** `docs/superpowers/specs/2026-10-23-g2b-auto-collect-design.md`

## Global Constraints

- bid_records·bid_predictions에 쓰지 않는다. 예측 엔진 입력(`recs`)은 그대로 둔다.
- Supabase SDK 금지. 앱은 기존 REST 래퍼, 함수는 기존 `_shared/db.ts`의 rpc/REST 패턴.
- 새 테이블은 같은 마이그레이션에서 RLS ON, anon 권한 회수, authenticated SELECT만, 쓰기는 service_role.
- 모든 DB 쿼리 `SET statement_timeout`(조회 ≤ 8s). 운영 DB 전수 쿼리 금지. 범위 쿼리는 1주 단위.
- 공공데이터 키 `prod_bid_public` 하루 1,000회: 이 함수 daily 300회·backfill 300회 상한. 호출마다 `incrementApiCall`.
- 대상: 공고번호 `^R`, `bid_notices.reg ILIKE '%경기%'` 또는 사용자 참여, 업종 = 전기공사업(공고명 추정만으로는 불포함). 과거분 2026-04-01 이후.
- 반영 시각: 매일 07:00 KST(22:00 UTC) 실행.
- 화면 노출은 Task 5 합격 전까지 `G2B_AUTO_SHOW = false`. 켜면 집계 포함 + "자동 N건 포함" 표기 + 행 '자동' 배지(툴팁 "나라장터 자동 수집 · 계산값 · 엑셀 대조 중").
- 마이그레이션 SQL은 `docs/v2/migrations/m64_*.sql`, 함수 소스는 `supabase/functions/fn-collect-g2b-sheet/`에 커밋.
- 커밋 말미 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. push는 사용자 승인 + deploy-gate.

## Review Focus

1. 1순위금액(bp)이 없는 공고(유찰·미확정, API 행의 33%) → status `pending`, missing에 `bp`; 화면에 안 나온다. 며칠 뒤 생기면 완성.
2. A값 미적용 공고(`bidPrceCalclAYn='N'`) → av = 0으로 계산, 항목 값이 있어도 합치지 않는다.
3. 같은 공고에 엑셀 행이 나중에 올라옴 → 화면은 엑셀 행만(자동 행 중복 집계 0).
4. 기초금액 API가 빈 응답·오류(키 한도 초과 포함) → 그 공고는 attempts+1 후 pending 유지, 함수 전체는 계속, 남은 예산 0이면 중단.
5. 업종 필드 전부 공백(원본 정리됨) → `trade_elec = null`이면 계산하지 않고 재조회 대상으로 남긴다(전기로 추정 금지).

---

### Task 0: 설계 영향도 검토 (predict-architect)

**Files:** 원장 `.superpowers/sdd/2026-10-23-g2b-auto/progress.md`(생성)

- [ ] **Step 1:** `predict-architect` 서브에이전트에 스펙 경로와 "bid_records·예측 엔진 무변경, 새 테이블+표시 전용" 요지를 넘겨 Generator/Neutral/Evaluator 분류와 핵심 영역(한전·고양시·군부대) 영향 표를 받는다. 서브에이전트는 DB에 못 붙으므로 DB 사실은 메인이 스펙 수치로 제공.
- [ ] **Step 2:** 결과를 원장에 기록. Generator 판정이면 계획 중단하고 사용자에게 보고.

### Task 1: 계산 순수 모듈

**Files:**
- Create: `supabase/functions/fn-collect-g2b-sheet/calc.js`
- Test: `tests/g2bSheetCalc.test.mjs`

**Interfaces:**
- Produces:
  - `sumAValue(item: object) -> { av: number, aApplies: boolean, items: object }` — item = 기초금액 API 응답 항목. 합산 키: `npnInsrprm, mrfnHealthInsrprm, rtrfundNon, odsnLngtrmrcprInsrprm, sftyMngcst, sftyChckMngcst` + `qltyMngcst`(`qltyMngcstAObjYn==='Y'`일 때). `bidPrceCalclAYn==='N'`이면 av 0. `items`는 위 키와 `envCnsrvcst, scontrctPayprcePayGrntyFee`의 숫자값(대조용 보존).
  - `computeSheet({ ba, av, xp, fr, bp }) -> { ar1, br1, floor_price, missing: string[] }` — ar1 = round4(xp/ba·100), br1 = round4((av + (bp−av)/(fr/100))/ba·100), floor_price = ceil(av + (xp−av)·fr/100). 입력 중 null·0 이하는 missing에 이름을 넣고 그 입력에 의존하는 값만 null.
  - `classifyTrade({ cat, mainCnsttyNm, licenseNames }) -> { elec: boolean|null, source: string|null }` — 어느 필드든 '전기공사' 포함 → true(source=필드명). 하나라도 값이 있는데 없음 → false. 전부 비면 null.

- [ ] **Step 1: 실패하는 테스트 작성** (`eq`/`near` 헬퍼 + `process.exit`, 기존 tests 스타일)

```js
// R26BK01766907 실측(2026-10-23 API·엑셀)
const a1 = sumAValue({ sftyMngcst:"4614958", sftyChckMngcst:"0", rtrfundNon:"1632474", mrfnHealthInsrprm:"0", npnInsrprm:"0", odsnLngtrmrcprInsrprm:"0", qltyMngcst:"0", qltyMngcstAObjYn:"Y", bidPrceCalclAYn:"Y" });
eq(a1.av, 6247432, "A값 합 1"); eq(a1.aApplies, true, "A 적용");
const a2 = sumAValue({ sftyMngcst:"1002713", sftyChckMngcst:"11151050", rtrfundNon:"891455", mrfnHealthInsrprm:"1393384", npnInsrprm:"1841049", odsnLngtrmrcprInsrprm:"183090", qltyMngcst:"0", qltyMngcstAObjYn:"Y", bidPrceCalclAYn:"Y" });
eq(a2.av, 16462741, "A값 합 2");
eq(sumAValue({ sftyMngcst:"5", bidPrceCalclAYn:"N" }).av, 0, "A 미적용은 0");
eq(sumAValue({ qltyMngcst:"7", qltyMngcstAObjYn:"N", bidPrceCalclAYn:"Y" }).av, 0, "품질관리비 대상 아님");
const s1 = computeSheet({ ba:232628000, av:6247432, xp:232673400, fr:89.745, bp:209456310 });
eq(s1.ar1, 100.0195, "ar1"); near(s1.br1, 100.0209, 0.0001, "br1"); eq(s1.floor_price, 209453417, "하한가 올림 1"); eq(s1.missing.length, 0, "완성");
eq(computeSheet({ ba:96200000, av:16462741, xp:96730375, fr:89.745, bp:88518497 }).floor_price, 88498930, "하한가 올림 2");
const s3 = computeSheet({ ba:96200000, av:0, xp:96730375, fr:89.745, bp:null });
eq(s3.br1, null, "bp 없으면 br1 없음"); eq(s3.ar1, 100.5513, "ar1은 계산"); eq(s3.missing.join(), "bp", "missing bp");
eq(computeSheet({ ba:null, av:0, xp:1, fr:89.745, bp:1 }).ar1, null, "ba 없음");
eq(classifyTrade({ cat:"", mainCnsttyNm:"전기공사업" }).elec, true, "주공종");
eq(classifyTrade({ cat:"정보통신공사업,전기공사업" }).elec, true, "복수 면허");
eq(classifyTrade({ cat:"건축공사업", mainCnsttyNm:"" }).elec, false, "다른 업종");
eq(classifyTrade({ cat:null, mainCnsttyNm:null, licenseNames:[] }).elec, null, "전부 공백은 모름");
```

- [ ] **Step 2:** `node tests/g2bSheetCalc.test.mjs` → import 실패로 FAIL 확인.
- [ ] **Step 3:** `calc.js`에 세 함수 구현(외부 import 없는 ESM, 숫자 문자열은 `Number`, 빈 문자열은 0으로 합산).
- [ ] **Step 4:** `node tests/g2bSheetCalc.test.mjs` → `OK g2bSheetCalc`, exit 0. `node --test tests/*.test.mjs` 전체 통과.
- [ ] **Step 5:** 커밋 `feat(g2b-auto): 계산 순수 모듈(A값 합·사정률·하한가·업종 판별)`.

### Task 2: DB 테이블·후보 함수·대조 보고 (m64)

**Files:**
- Create: `docs/v2/migrations/m64_g2b_auto_sheet.sql`

**Interfaces:**
- Produces:
  - 테이블 `g2b_auto_sheet` — `id bigint identity PK`, `bid_ntce_no text UNIQUE NOT NULL`, `bid_ntce_ord text NOT NULL DEFAULT '000'`, `status text CHECK (status IN ('complete','pending','not_target','gave_up'))`, `missing text[]`, `purpose text CHECK (purpose IN ('display','compare'))`, `excel_record_id bigint`, `api_record_id bigint`, `od date`, `pn text`, `ag text`, `canonical_ag text`, `at text`, `reg text`, `trade_elec boolean`, `trade_source text`, `ba numeric`, `av numeric`, `a_applies boolean`, `a_items jsonb`, `xp numeric`, `fr numeric`, `bp numeric`, `co text`, `co_no text`, `pc int`, `ar1 numeric`, `br1 numeric`, `floor_price numeric`, `attempts int NOT NULL DEFAULT 0`, `computed_at timestamptz`, `created_at/updated_at timestamptz DEFAULT now()`. 인덱스: `(status, od)`.
  - `g2b_auto_candidates(p_mode text, p_from date, p_to date, p_limit int) RETURNS SETOF jsonb` — SECURITY DEFINER, EXECUTE는 service_role만. `bid_notices`에서 `bid_ntce_no ~ '^R'`, `od::date BETWEEN p_from AND p_to`, (`reg ILIKE '%경기%'` OR `participated` OR 같은 공고번호 본체의 file_upload 예측 존재). 각 행에 붙이는 것: API 행(`bid_records.pn_no = bid_ntce_no AND g2b IS NULL`: id·pn·ag·canonical_ag·at·co·co_no·bp·pc), 복수예비가(`bid_prelim_sets.bid_ntce_no` 첫 행: bssamt·plnprc), 엑셀 행 id(`g2b IS NOT NULL`, pn_no 범위 조건 `~>=~ no||'-' AND ~<~ no||'.'`로 text_pattern_ops 인덱스 사용), `raw_json->>'sucsfbidLwltRate'`, `cat`, `raw_json->>'mainCnsttyNm'`, 기존 g2b_auto_sheet 행의 attempts. 제외: g2b_auto_sheet status가 complete·not_target·gave_up. `p_mode`: 'compare' = 엑셀 행 있음, 'fill' = 없음, 'daily' = 둘 다. `ORDER BY od, bid_ntce_no LIMIT p_limit`.
  - `g2b_auto_compare_report(p_from date DEFAULT '2026-04-01') RETURNS TABLE(metric text, n int, ok int, pct numeric, pass boolean)` — status complete·purpose compare 행을 `excel_record_id`로 엑셀 행과 비교. metric: `ar1`(|차| ≤ 0.0001, 기준 99%), `br1`(≤ 0.001, 98%), `floor_price`(≤ 10원, 98%), `ba`, `av`, `xp`, `trade_recall`(기간 내 엑셀 나라장터 경기 전기 공고 중 trade_elec=true 비율, 95%).

- [ ] **Step 1:** 마이그레이션 SQL 작성(테이블+RLS+REVOKE+GRANT, 두 함수, `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated; GRANT ... TO service_role`, 보고 함수는 authenticated에도 EXECUTE).
- [ ] **Step 2:** Supabase `apply_migration`(name `m64_g2b_auto_sheet`)으로 적용.
- [ ] **Step 3: 검증**
  - `SET ROLE anon; SELECT count(*) FROM g2b_auto_sheet;` → permission denied. `RESET ROLE;`
  - `SET statement_timeout='8s'; SELECT count(*) FROM g2b_auto_candidates('daily', CURRENT_DATE-7, CURRENT_DATE, 500);` → 1개 이상, 8초 안.
  - `SELECT count(*) FROM g2b_auto_candidates('compare','2026-09-01','2026-09-07',500);` → 1개 이상(9월 첫 주 엑셀 나라장터 공고 존재).
  - `SELECT * FROM g2b_auto_compare_report();` → 에러 없이 n=0 행들.
- [ ] **Step 4:** 커밋 `feat(g2b-auto): m64 g2b_auto_sheet 테이블·후보·대조 보고 함수`.

### Task 3: 수집 함수 daily 모드 + 매일 cron

**Files:**
- Create: `supabase/functions/fn-collect-g2b-sheet/index.ts`, `_shared/g2b.ts`, `_shared/db.ts`(배포된 `fn-collect-results`의 `_shared` 사본을 `get_edge_function`으로 받아 그대로 저장)
- Modify: `docs/v2/migrations/m64_g2b_auto_sheet.sql` 끝에 cron 등록 SQL 추가(실행은 Step 6)

**Interfaces:**
- Consumes: Task 1의 `sumAValue`, `computeSheet`, `classifyTrade`; Task 2의 `g2b_auto_candidates`, `g2b_auto_sheet`.
- Produces: `POST fn-collect-g2b-sheet` body `{ mode: 'daily'|'backfill', max_calls?: number (기본 300), dry_run?: boolean }` → `{ ok, mode, calls, processed, complete, pending, not_target, gave_up, errors: string[] }`.

- [ ] **Step 1: 공고 단건 조회 파라미터 확인.** `fn-test-bssamt-api`를 한 번 더 고쳐 `getBidPblancListInfoCnstwk`를 `inqryDiv=2`·`bidNtceNo`로 조회했을 때 그 공고 1건(`mainCnsttyNm`·`sucsfbidLwltRate` 포함)이 오는지, 오지 않으면 다른 inqryDiv 값으로 확인. 결과 파라미터를 원장에 기록. 원본이 남은 공고(daily)는 이 호출이 필요 없다.
- [ ] **Step 2: daily 처리 구현.** `p_from = 오늘(KST)−7일, p_to = 오늘`, `g2b_auto_candidates('daily', …, 500)` → 공고마다:
  1. 업종: `classifyTrade({cat, mainCnsttyNm})`. null이면 Step 1의 단건 조회(호출 1회)로 채우고 다시 판별. false → `not_target` 저장 후 다음.
  2. 하한율: `sucsfbidLwltRate`, 없으면 단건 조회 값.
  3. 1순위 정보: API 행이 없으면 낙찰정보 `getScsbidListSttusCnstwk`를 공고번호로 조회해 co·co_no·bp만 채운다(키 `prod_scsbid_info`, 이 테이블에만 저장).
  4. 기초금액 API(`getBidPblancListInfoCnstwkBsisAmount`, inqryDiv=2, bidNtceNo) 1회 → `sumAValue`.
  5. `computeSheet` → missing 없으면 `complete`, 있으면 `pending`(attempts+1). 개찰일 + 7일이 지나도 pending이면 `gave_up`.
  6. `purpose` = 엑셀 행 있으면 'compare', 없으면 'display'. `/rest/v1/g2b_auto_sheet?on_conflict=bid_ntce_no` upsert(Prefer `resolution=merge-duplicates`).
  - 호출 수가 `max_calls`에 닿거나 키의 `calls_today >= daily_limit`이면 중단. API 오류는 그 공고만 attempts+1.
- [ ] **Step 3:** `deploy_edge_function`(verify_jwt true)로 배포.
- [ ] **Step 4: dry_run 검증.** `SELECT public.invoke_edge_function('fn-collect-g2b-sheet','{"mode":"daily","dry_run":true,"max_calls":20}'::jsonb,140000);` → `net._http_response`에서 `ok:true`, processed ≥ 1, 테이블 행 수 변화 0. 이어서 `max_calls:0`으로 한 번 더 → `calls:0, processed:0, ok:true`(예산 소진 시 즉시 중단, Review Focus 4).
- [ ] **Step 5: 실제 1회 실행** (`max_calls` 60) → `SELECT status, purpose, count(*) FROM g2b_auto_sheet GROUP BY 1,2;`에 complete가 1건 이상. complete 중 엑셀 행 있는 것을 `g2b_auto_compare_report()`로 확인(ar1 일치).
- [ ] **Step 6: cron 등록.** jobname `g2b_auto_daily_07kst`, schedule `0 22 * * *`, 명령 `SELECT public.invoke_edge_function('fn-collect-g2b-sheet', jsonb_build_object('mode','daily','max_calls',300), 140000);` → `SELECT jobid FROM cron.job WHERE jobname='g2b_auto_daily_07kst'` 1행.
- [ ] **Step 7:** 커밋 `feat(g2b-auto): 수집 함수 daily 모드·매일 07시 cron`.

### Task 4: 과거분(backfill) 모드 + 야간 cron

**Files:**
- Modify: `supabase/functions/fn-collect-g2b-sheet/index.ts`, `docs/v2/migrations/m64_g2b_auto_sheet.sql`(cron 추가)

**Interfaces:**
- Consumes: Task 3의 처리 루프.
- Produces: `mode:'backfill'` — 범위 `2026-04-01 ~ 오늘−8일`, 순서 `compare` 후보를 먼저 다 처리하고 남으면 `fill`.

- [ ] **Step 1: 원본 없는 공고의 업종·하한율 채우기.** 과거분은 원본(raw_json)이 정리돼 대부분 trade=null이다. 공고별 단건 조회 대신 `getBidPblancListInfoCnstwk`를 공고게시일 창(`inqryDiv=1`, 하루 단위, `numOfRows=100`)으로 페이지 순회해, 후보 공고번호에 해당하는 항목의 `mainCnsttyNm`·`sucsfbidLwltRate`만 메모리 맵으로 모아 처리 루프에 넘긴다. 진행 위치(다음 게시일·페이지)는 m64에 추가하는 1행 테이블 `g2b_auto_backfill_state(id int PK CHECK (id=1), next_dt date, next_page int, done boolean)`에 저장. 게시일 시작점은 2026-03-01(개찰보다 최대 한 달 앞서 게시).
- [ ] **Step 2:** 배포 후 `{"mode":"backfill","dry_run":true,"max_calls":20}` → ok, 상태 테이블 next_dt 진행 확인(dry_run은 상태도 쓰지 않음 → 응답의 `next_dt`로 확인).
- [ ] **Step 3:** 실제 1회(`max_calls` 100) → compare 행 complete 증가.
- [ ] **Step 4: cron 등록.** jobname `g2b_auto_backfill_nightly`, schedule `15 20 * * *`(05:15 KST), max_calls 300. `done=true`가 되면 함수가 즉시 반환(호출 0).
- [ ] **Step 5:** 커밋 `feat(g2b-auto): 과거분 모드·야간 cron`.

### Task 5: 대조 합격 판정 (게이트)

**Files:** 원장, 필요 시 `calc.js`·테스트

- [ ] **Step 1:** backfill의 compare 단계가 끝날 때까지 대기(상태 테이블 또는 `g2b_auto_candidates('compare',…)` 0건).
- [ ] **Step 2:** `SELECT * FROM g2b_auto_compare_report();` → 7개 metric의 pass가 모두 true인지 확인, 결과를 원장에 붙인다.
- [ ] **Step 3: 불일치 처리.** fail metric이 있으면 차이 큰 행 20건을 보고 원인(A값 항목·반올림·하한율) 확정 → `calc.js`에 재현 테스트 추가(RED) → 수정(GREEN) → 함수 재배포 → 해당 행 status를 pending으로 되돌려 재계산 → Step 2 재실행. `trade_recall` < 95%면 면허제한 API(`getBidPblancListInfoLicenseLimit`)를 `classifyTrade.licenseNames`에 추가하는 방향으로 같은 절차.
- [ ] **Step 4: 정밀도 검수.** `purpose='display' AND status='complete'` 무작위 30건의 공고명·trade_source를 읽어 전기공사업이 아닌 것이 2건 이하인지 확인, 원장 기록.
- [ ] **Step 5:** 합격이면 사용자에게 결과 표를 보고하고 Task 7 진행 승인을 받는다. 불합격이면 멈추고 보고.

### Task 6: 화면 연결 (플래그 꺼진 채로 배포 가능하게)

**Files:**
- Create: `src/lib/g2bAuto.js`, `tests/g2bAuto.test.mjs`
- Modify: `src/lib/supabase.js`(읽기 함수 추가만), `src/lib/bidCard.js`(`agencyRecentHistory`), `tests/bidCard.test.mjs`, `src/App.jsx`, `src/components/G2BSheetTab.jsx`, `src/components/BidCard.jsx`

**Interfaces:**
- Produces:
  - `G2B_AUTO_SHOW = false` (export const, `src/lib/g2bAuto.js`)
  - `mergeAutoRows(recs: object[], autoRows: object[]) -> object[]` — 입력 불변. autoRows 중 `status==='complete'`이고, recs에 같은 공고번호 본체의 엑셀 행(`pn_no`가 `-\d{3}$`로 끝나고 `ar1 != null`)이 없는 것만 recs 모양으로 바꿔 뒤에 붙인다: `{ id: -row.id, pn_no: row.bid_ntce_no+'-'+row.bid_ntce_ord, pn, ag, canonical_ag, at, od, ba, av, xp, fr, bp, co, co_no, pc, ar1, br1, floor_price, cat:'전기공사업', is_excluded:false, _auto:true }`. autoRows가 비면 recs를 그대로(같은 참조) 반환.
  - `sbFetchG2BAuto() -> Promise<object[]>` (`src/lib/supabase.js`) — `/rest/v1/g2b_auto_sheet?select=…&status=eq.complete&order=id.asc`, 1000행 단위 페이징(id 정렬, 기존 tiebreaker 규칙).
  - `agencyRecentHistory` 반환에 `autoCount: number` 추가, rows 원소에 `auto: boolean`.

- [ ] **Step 1: 실패하는 테스트** (`tests/g2bAuto.test.mjs`)

```js
const recs = [{ id:1, pn_no:"R26BK1-000", ar1:100.1, br1:100.2, canonical_ag:"고양시", od:"2026-09-01" },
              { id:2, pn_no:"R26BK2", ar1:null, br1:90.3 }];               // API 불완전 행
const auto = [{ id:7, bid_ntce_no:"R26BK1", bid_ntce_ord:"000", status:"complete", ar1:100.1 },  // 엑셀 있음 → 제외
              { id:8, bid_ntce_no:"R26BK2", bid_ntce_ord:"000", status:"complete", ar1:100.3, br1:100.4, canonical_ag:"고양시", od:"2026-09-02" },
              { id:9, bid_ntce_no:"R26BK3", bid_ntce_ord:"000", status:"pending" }];         // 미완성 → 제외
const copy = JSON.stringify(recs);
const m = mergeAutoRows(recs, auto);
eq(JSON.stringify(recs), copy, "원본 불변");
eq(m.length, 3, "자동 1건만 추가"); eq(m[2].id, -8, "음수 id"); eq(m[2].pn_no, "R26BK2-000", "차수 붙임"); eq(m[2]._auto, true, "자동 표시");
eq(mergeAutoRows(recs, []), recs, "빈 자동 → 같은 참조");
eq(G2B_AUTO_SHOW, false, "합격 전 기본 꺼짐");
```

  `tests/bidCard.test.mjs`에 추가: 자동 행 1건 섞인 입력에서 `agencyRecentHistory(...).autoCount === 1`, 해당 row의 `auto === true`.
- [ ] **Step 2:** 두 테스트 FAIL 확인.
- [ ] **Step 3:** `g2bAuto.js`·`agencyRecentHistory` 구현, `sbFetchG2BAuto` 추가.
- [ ] **Step 4:** App.jsx — `G2B_AUTO_SHOW`일 때만 초기 로드에서 `sbFetchG2BAuto()`(실패해도 화면 영향 없게 단독 try) → state `g2bAuto`. `g2bRecs = useMemo(() => mergeAutoRows(recs, g2bAuto), [recs, g2bAuto])`를 `G2BSheetTab recs`와 `BidCard recs`에만 넘긴다. `refreshStats`·`recOf`·예측 계산에는 `recs` 그대로.
- [ ] **Step 5:** G2BSheetTab — 요약 패널 "표시 N행" 뒤에 ` · 자동 {k}건 포함`(k = 현재 빈도 기준 모집단의 `_auto` 수, 0이면 숨김), 목록 행·상세 모달에 '자동' 배지(툴팁 전역 제약 문구). BidCard — 1위 이력 제목을 `(최근 {count}건{autoCount>0 ? ` · 자동 ${autoCount}건 포함` : ""})`로, 이력 표의 자동 행에 같은 배지.
- [ ] **Step 6: 검증.** `node --test tests/*.test.mjs` 전부 통과, `npx vite build` 통과. 로컬에서만 `G2B_AUTO_SHOW`를 임시로 true로 두고 dev 서버(재시작 후)에서: G2B 양식에 자동 행 배지·"자동 N건 포함" 표시, 투찰 카드 1위 이력 표기, 콘솔 에러 0, 예측 기록 탭 값이 플래그 on/off에서 동일. 확인 후 false로 되돌린다.
- [ ] **Step 7:** 커밋 `feat(g2b-auto): G2B 양식·투찰 카드에 자동 수집 행 합치기(플래그 꺼짐)`.

### Task 7: 노출 켜기 (Task 5 합격 + 사용자 승인 후)

**Files:** `src/lib/g2bAuto.js`, `tests/g2bAuto.test.mjs`

- [ ] **Step 1:** `G2B_AUTO_SHOW = true`, 테스트 기대값을 true로.
- [ ] **Step 2:** 테스트·빌드 통과, 브라우저에서 Task 6 Step 6 항목 재확인.
- [ ] **Step 3:** 커밋 `feat(g2b-auto): 대조 합격 — 자동 수집 행 노출`. deploy-gate 실행, 사용자 승인 후 push. 라이브 번들 반영 확인.
- [ ] **Step 4:** 메모리·스펙 상태 갱신(1단계 운영 시작, 2단계는 별건).
