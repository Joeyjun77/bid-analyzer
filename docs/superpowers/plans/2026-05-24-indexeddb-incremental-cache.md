# IndexedDB 증분 캐시 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `bid_records` 전량(65,115행) 페치를 델타 동기화로 축소해 복귀 사용자 초기 로드를 단축한다.

**Architecture:** DB에 `updated_at` 컬럼+트리거를 추가해 in-place 변경까지 추적한다. 클라이언트는 전체 행을 IndexedDB에 캐시하고, 매 로드마다 `(count, max(updated_at))` 싼 게이트로 변경 여부를 확인해 변경분만 델타 페치한다. 캐시 실패는 기존 `sbFetchAll` 전체 페치로 폴백한다. 순수 결정 로직은 별도 모듈로 격리해 node로 단위 테스트하고, IndexedDB/네트워크 오케스트레이션은 build + 수동 브라우저 시나리오로 검증한다.

**Tech Stack:** React + Vite, Supabase REST(authedFetch, SDK 미사용), IndexedDB(브라우저 네이티브), 테스트는 `node tests/*.test.mjs`(프레임워크·신규 의존성 없음).

**선행 설계:** `docs/superpowers/specs/2026-05-24-indexeddb-incremental-cache-design.md`

---

## 파일 구조

| 파일 | 책임 | 작업 |
|---|---|---|
| `db/migrations/2026-05-24-bid-records-updated-at.sql` | DB 변경 보존(updated_at+트리거+RPC) | Create |
| `src/lib/bidCacheLogic.js` | 순수 결정 로직(의존성 0) — decideSyncAction/needsReconcile/sortByOdDesc | Create |
| `tests/bidCacheLogic.test.mjs` | 순수 로직 node 단위 테스트 | Create |
| `src/lib/supabase.js` | BID_RECORDS_COLS export + sbFetchSyncMeta + sbFetchRecordsSince | Modify |
| `src/lib/bidCache.js` | IndexedDB IO + 오케스트레이터 sbFetchAllCached | Create |
| `src/App.jsx` | 3개 호출부(752/768/909) sbFetchAll → sbFetchAllCached | Modify |

**격리 근거:** `bidCacheLogic.js`는 어떤 import도 없는 순수 함수만 담아 node에서 즉시 테스트 가능(supabase→auth→utils→xlsx 체인 회피). `bidCache.js`는 IDB/네트워크를 다뤄 브라우저에서만 동작하므로 build+수동 검증.

---

## Task 1: DB 변경 (updated_at + 트리거 + RPC)

**Files:**
- Create: `db/migrations/2026-05-24-bid-records-updated-at.sql`

> DB 객체는 git에 자동 반영되지 않으므로(Supabase 직접 적용) SQL을 repo에 보존한다. 적용은 Supabase(MCP `apply_migration` 또는 SQL Editor, service_role)로 한다.

- [ ] **Step 1: 마이그레이션 SQL 파일 작성**

`db/migrations/2026-05-24-bid-records-updated-at.sql`:
```sql
-- bid_records 증분 캐시용 updated_at 인프라 (설계: docs/superpowers/specs/2026-05-24-indexeddb-incremental-cache-design.md)

-- 1) 컬럼 + 기존행 백필
ALTER TABLE bid_records ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
UPDATE bid_records SET updated_at = COALESCE(created_at, now());

-- 2) 델타 쿼리 인덱스
CREATE INDEX IF NOT EXISTS idx_br_updated_at ON bid_records(updated_at, id);

-- 3) BEFORE UPDATE 트리거 — upsert merge 포함 모든 UPDATE에서 updated_at 갱신
CREATE OR REPLACE FUNCTION set_br_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_br_updated_at ON bid_records;
CREATE TRIGGER trg_br_updated_at BEFORE UPDATE ON bid_records
  FOR EACH ROW EXECUTE FUNCTION set_br_updated_at();

-- 4) 싼 변경 게이트 RPC
CREATE OR REPLACE FUNCTION bid_records_sync_meta()
  RETURNS TABLE(cnt bigint, max_updated timestamptz)
  LANGUAGE sql STABLE AS $$ SELECT count(*), max(updated_at) FROM bid_records $$;
GRANT EXECUTE ON FUNCTION bid_records_sync_meta() TO authenticated;
```

- [ ] **Step 2: Supabase에 적용**

Supabase MCP `apply_migration`(name: `bid_records_updated_at`) 또는 SQL Editor에서 위 SQL 실행.
Expected: 에러 없음. 백필 UPDATE가 65,115행 갱신.

- [ ] **Step 3: 트리거 fire 실측 검증 (in-place UPDATE)**

SQL Editor에서:
```sql
-- (a) 직접 UPDATE 시 updated_at 갱신 확인
SELECT id, updated_at FROM bid_records ORDER BY id LIMIT 1;  -- id, 기존 updated_at 기록
UPDATE bid_records SET pc = pc WHERE id = (SELECT min(id) FROM bid_records);
SELECT id, updated_at FROM bid_records ORDER BY id LIMIT 1;  -- updated_at가 now()로 전진했는지 확인
```
Expected: 두 번째 SELECT의 updated_at가 첫 번째보다 큼(트리거 동작).

- [ ] **Step 4: upsert merge 경로 트리거 검증 (ar1 백필 시뮬레이션)**

```sql
-- ar1 NULL 행 1건의 dedup_key로 ON CONFLICT DO UPDATE 발생 → updated_at 전진 확인
WITH t AS (SELECT id, dedup_key, updated_at FROM bid_records WHERE ar1 IS NULL ORDER BY od DESC LIMIT 1)
SELECT * FROM t;  -- id, dedup_key, before_updated_at 기록
-- 동일 dedup_key로 ar1만 채워 upsert (merge)
INSERT INTO bid_records (dedup_key, ar1) VALUES ((SELECT dedup_key FROM bid_records WHERE ar1 IS NULL ORDER BY od DESC LIMIT 1), 100.0)
  ON CONFLICT (dedup_key) DO UPDATE SET ar1 = EXCLUDED.ar1;
-- 같은 id의 updated_at가 전진했는지
SELECT id, ar1, updated_at FROM bid_records WHERE dedup_key = (SELECT dedup_key FROM bid_records WHERE ar1=100.0 ORDER BY updated_at DESC LIMIT 1);
```
Expected: updated_at가 before보다 큼 = upsert merge에서도 트리거 fire 입증. (테스트로 채운 ar1=100.0 행은 이후 정상 데이터 재업로드 시 덮어쓰여지나, 검증 후 원복하려면 해당 행 ar1을 NULL로 되돌릴 것.)

- [ ] **Step 5: RPC 동작 확인**

```sql
SELECT * FROM bid_records_sync_meta();
```
Expected: `cnt` = 현재 행수(≈65,115), `max_updated` = 방금 갱신된 시각.

- [ ] **Step 6: Commit**

```bash
git add db/migrations/2026-05-24-bid-records-updated-at.sql
git commit -m "feat(db): bid_records updated_at 컬럼+트리거+sync_meta RPC (증분 캐시 인프라)"
```

---

## Task 2: 순수 결정 로직 + node 단위 테스트 (TDD)

**Files:**
- Create: `src/lib/bidCacheLogic.js`
- Test: `tests/bidCacheLogic.test.mjs`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/bidCacheLogic.test.mjs`:
```js
import { decideSyncAction, needsReconcile, sortByOdDesc } from "../src/lib/bidCacheLogic.js";

let bad = 0;
const eq = (got, exp, msg) => { if (got !== exp) { console.error(`XX ${msg}: got ${got} expect ${exp}`); bad++; } };

// decideSyncAction(server, meta, cols)
const COLS = "id,ag,od,ar1";
// 최초(meta 없음) → full
eq(decideSyncAction({ count: 10, maxUpdated: "T1" }, null, COLS), "full", "no-meta→full");
// 스키마 변경 → full
eq(decideSyncAction({ count: 10, maxUpdated: "T1" }, { lastSyncUpdatedAt: "T1", cachedCount: 10, cols: "id,ag" }, COLS), "full", "cols-changed→full");
// 무변경 → hit
eq(decideSyncAction({ count: 10, maxUpdated: "T1" }, { lastSyncUpdatedAt: "T1", cachedCount: 10, cols: COLS }, COLS), "hit", "unchanged→hit");
// max 변함 → delta
eq(decideSyncAction({ count: 10, maxUpdated: "T2" }, { lastSyncUpdatedAt: "T1", cachedCount: 10, cols: COLS }, COLS), "delta", "max-changed→delta");
// count 변함 → delta
eq(decideSyncAction({ count: 11, maxUpdated: "T1" }, { lastSyncUpdatedAt: "T1", cachedCount: 10, cols: COLS }, COLS), "delta", "count-changed→delta");

// needsReconcile(idbCount, serverCount)
eq(needsReconcile(10, 10), false, "count-match→no-reconcile");
eq(needsReconcile(9, 10), true, "count-mismatch→reconcile");

// sortByOdDesc: od 내림차순, null od는 끝
const sorted = sortByOdDesc([{ id: 1, od: "2026-01-01" }, { id: 2, od: null }, { id: 3, od: "2026-05-01" }]);
eq(sorted.map(r => r.id).join(","), "3,1,2", "sortByOdDesc order");

console.log(bad === 0 ? "OK bidCacheLogic all cases" : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node tests/bidCacheLogic.test.mjs`
Expected: FAIL — `Cannot find module '../src/lib/bidCacheLogic.js'` (모듈 미존재).

- [ ] **Step 3: 순수 로직 모듈 구현**

`src/lib/bidCacheLogic.js`:
```js
// IndexedDB 증분 캐시 순수 결정 로직 (의존성 0 — node 단위 테스트 대상)
// 설계: docs/superpowers/specs/2026-05-24-indexeddb-incremental-cache-design.md

// 동기화 액션 결정.
// server: {count, maxUpdated}  meta: {lastSyncUpdatedAt, cachedCount, cols} | null  cols: 현재 BID_RECORDS_COLS
// 반환: 'full'(최초·스키마변경) | 'hit'(무변경) | 'delta'(변경)
export function decideSyncAction(server, meta, cols) {
  if (!meta || meta.cols !== cols) return "full";
  if (server.maxUpdated === meta.lastSyncUpdatedAt && server.count === meta.cachedCount) return "hit";
  return "delta";
}

// 델타 후 IDB 행수가 서버 count와 다르면 삭제/발산 → 전체 reconcile 필요.
export function needsReconcile(idbCount, serverCount) {
  return idbCount !== serverCount;
}

// od 내림차순 정렬 (sbFetchAll의 order=od.desc 계약과 동일). null od는 맨 뒤.
export function sortByOdDesc(rows) {
  return rows.slice().sort((a, b) => {
    const ao = a.od || "", bo = b.od || "";
    if (ao === bo) return 0;
    if (!ao) return 1;
    if (!bo) return -1;
    return ao < bo ? 1 : -1;
  });
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node tests/bidCacheLogic.test.mjs`
Expected: `OK bidCacheLogic all cases`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bidCacheLogic.js tests/bidCacheLogic.test.mjs
git commit -m "feat(cache): 증분 캐시 순수 결정 로직 + node 테스트"
```

---

## Task 3: supabase.js — cols export + 델타 페치 헬퍼

**Files:**
- Modify: `src/lib/supabase.js:14`(BID_RECORDS_COLS export), `src/lib/supabase.js:43`(sbFetchAll 뒤 신규 함수 추가)

> 네트워크 함수라 node 단위 테스트 불가 → build 통과 + Task 6 수동 시나리오로 검증.

- [ ] **Step 1: BID_RECORDS_COLS export**

`src/lib/supabase.js:14` 변경:
```js
// 변경 전
const BID_RECORDS_COLS="id,pn,pn_no,ag,at,ep,ba,av,xp,floor_price,ar1,co,bp,br1,base_ratio,pc,od,cat,era,fr,created_at,work_cat,canonical_ag,is_excluded,contract_method";
// 변경 후 (export 추가)
export const BID_RECORDS_COLS="id,pn,pn_no,ag,at,ep,ba,av,xp,floor_price,ar1,co,bp,br1,base_ratio,pc,od,cat,era,fr,created_at,work_cat,canonical_ag,is_excluded,contract_method";
```

- [ ] **Step 2: 싼 게이트 + 델타 페치 함수 추가**

`src/lib/supabase.js`의 `sbFetchAll` 함수 종료(`}` 다음, 라인 43 `export async function sbUpsert` 직전)에 추가:
```js
// ─── 증분 캐시: 싼 변경 게이트 + 델타 페치 ───────────────────
// bid_records_sync_meta() RPC → {count, maxUpdated}. 무변경 판정용(행 페치 0).
export async function sbFetchSyncMeta(){
  const res=await authedFetch("/rest/v1/rpc/bid_records_sync_meta",{method:"POST",headers:JSON_H,body:"{}"});
  if(!res.ok)return null;
  const rows=await res.json();
  const r=Array.isArray(rows)?rows[0]:rows;
  if(!r)return null;
  return{count:Number(r.cnt),maxUpdated:r.max_updated};
}
// updated_at >= since 인 행만 페치 (sbFetchAll과 동일 컬럼셋 → 캐시 행 형태 일관).
// >= 사용: 경계 timestamp 동시쓰기 레이스 방지, IDB upsert가 idempotent라 중복 무해.
// offset 페이징: 델타는 작고, 완전성은 호출부 count 게이트가 backstop(불일치 시 reconcile).
export async function sbFetchRecordsSince(sinceUpdatedAt){
  const PAGE=1000;
  const base="/rest/v1/bid_records?select="+BID_RECORDS_COLS
    +"&updated_at=gte."+encodeURIComponent(sinceUpdatedAt)
    +"&order=updated_at.asc,id.asc";
  let all=[],offset=0;
  while(true){
    const res=await authedFetch(base+"&offset="+offset+"&limit="+PAGE);
    if(!res.ok)throw new Error("delta page offset="+offset+" 로드 실패");
    const rows=await res.json();
    if(!Array.isArray(rows))throw new Error("delta 비배열 응답");
    all=all.concat(rows);
    if(rows.length<PAGE)break;
    offset+=PAGE;
  }
  return all;
}
```

- [ ] **Step 3: build 통과 확인**

Run: `npx vite build`
Expected: `✓ built` 에러 없음.

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabase.js
git commit -m "feat(supabase): sbFetchSyncMeta + sbFetchRecordsSince (증분 델타 페치)"
```

---

## Task 4: bidCache.js — IndexedDB IO + 오케스트레이터

**Files:**
- Create: `src/lib/bidCache.js`

> IndexedDB/네트워크 코드 → node 테스트 불가. build 통과 + Task 6 수동 시나리오로 검증.

- [ ] **Step 1: bidCache.js 구현**

`src/lib/bidCache.js`:
```js
// IndexedDB 증분 캐시 — bid_records 델타 동기화 오케스트레이터
// 설계: docs/superpowers/specs/2026-05-24-indexeddb-incremental-cache-design.md
import { sbFetchAll, sbFetchSyncMeta, sbFetchRecordsSince, BID_RECORDS_COLS } from "./supabase.js";
import { decideSyncAction, needsReconcile, sortByOdDesc } from "./bidCacheLogic.js";

const DB_NAME="bid-analyzer-cache", DB_VERSION=1;
const STORE_ROWS="bid_records", STORE_META="meta", META_KEY="bid_records";

// ── IndexedDB IO ──────────────────────────────────────────
function openCache(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(STORE_ROWS))db.createObjectStore(STORE_ROWS,{keyPath:"id"});
      if(!db.objectStoreNames.contains(STORE_META))db.createObjectStore(STORE_META,{keyPath:"key"});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
const reqP=(r)=>new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
function store(db,name,mode){return db.transaction(name,mode).objectStore(name)}
async function readMeta(db){return (await reqP(store(db,STORE_META,"readonly").get(META_KEY)))||null}
async function writeMeta(db,meta){return reqP(store(db,STORE_META,"readwrite").put({key:META_KEY,...meta}))}
async function readAllRows(db){return reqP(store(db,STORE_ROWS,"readonly").getAll())}
async function countRows(db){return reqP(store(db,STORE_ROWS,"readonly").count())}
function upsertRows(db,rows){
  return new Promise((res,rej)=>{
    const t=db.transaction(STORE_ROWS,"readwrite"),s=t.objectStore(STORE_ROWS);
    for(const r of rows)s.put(r);
    t.oncomplete=()=>res();t.onerror=()=>rej(t.error);
  });
}
function replaceAllRows(db,rows){
  return new Promise((res,rej)=>{
    const t=db.transaction(STORE_ROWS,"readwrite"),s=t.objectStore(STORE_ROWS);
    s.clear();for(const r of rows)s.put(r);
    t.oncomplete=()=>res();t.onerror=()=>rej(t.error);
  });
}

// ── 오케스트레이터 ────────────────────────────────────────
// sbFetchAll 드롭인 대체. 캐시 hit 시 행 페치 0, 변경 시 델타만, 실패 시 전체 페치 폴백.
export async function sbFetchAllCached(){
  if(typeof indexedDB==="undefined"||(typeof localStorage!=="undefined"&&localStorage.getItem("cacheDisabled")==="true")){
    return sbFetchAll();
  }
  let db=null;
  try{
    db=await openCache();
    const meta=await readMeta(db);
    const server=await sbFetchSyncMeta();
    if(!server)throw new Error("sync meta 실패");
    const action=decideSyncAction(server,meta,BID_RECORDS_COLS);

    if(action==="full"){
      const rows=await sbFetchAll();
      await replaceAllRows(db,rows);
      await writeMeta(db,{lastSyncUpdatedAt:server.maxUpdated,cachedCount:rows.length,cols:BID_RECORDS_COLS});
      console.log(`[cache] full ${rows.length}`);
      return sortByOdDesc(rows);
    }
    if(action==="hit"){
      const rows=await readAllRows(db);
      console.log(`[cache] hit (0 fetched, ${rows.length})`);
      return sortByOdDesc(rows);
    }
    // delta
    const delta=await sbFetchRecordsSince(meta.lastSyncUpdatedAt);
    await upsertRows(db,delta);
    let cnt=await countRows(db);
    if(needsReconcile(cnt,server.count)){
      const rows=await sbFetchAll();
      await replaceAllRows(db,rows);
      cnt=rows.length;
      console.log(`[cache] reconcile ${rows.length}`);
    }else{
      console.log(`[cache] delta ${delta.length}`);
    }
    await writeMeta(db,{lastSyncUpdatedAt:server.maxUpdated,cachedCount:cnt,cols:BID_RECORDS_COLS});
    return sortByOdDesc(await readAllRows(db));
  }catch(e){
    console.warn("[cache] fallback (error):",e?.message||e);
    return sbFetchAll();
  }finally{
    try{db&&db.close()}catch(_){}
  }
}
```

- [ ] **Step 2: build 통과 확인**

Run: `npx vite build`
Expected: `✓ built` 에러 없음 (52→53 모듈).

- [ ] **Step 3: Commit**

```bash
git add src/lib/bidCache.js
git commit -m "feat(cache): IndexedDB IO + sbFetchAllCached 오케스트레이터"
```

---

## Task 5: App.jsx — 호출부 교체

**Files:**
- Modify: `src/App.jsx:18`(import 추가), `src/App.jsx:752,768,909`(호출 교체)

- [ ] **Step 1: sbFetchAllCached import 추가**

`src/App.jsx:18`의 supabase import 라인 **다음 줄**에 추가:
```js
import { sbFetchAllCached } from "./lib/bidCache.js";
```

- [ ] **Step 2: 3개 호출부 교체**

`src/App.jsx:752`:
```js
// 변경 전
    try{const[rows,preds,dets,agStats]=await Promise.all([sbFetchAll(),sbFetchPredictions(),sbFetchDetails(),sbFetchAgAssumedStats()]);
// 변경 후
    try{const[rows,preds,dets,agStats]=await Promise.all([sbFetchAllCached(),sbFetchPredictions(),sbFetchDetails(),sbFetchAgAssumedStats()]);
```

`src/App.jsx:768`:
```js
// 변경 전
    try{const rows=await sbFetchAll();setRecs(rows);refreshStats(rows);setDataStatus(calcDataStatus(rows));if(rows.length>0)setTab("dash")}catch(e){setMsg({type:"err",text:"DB 로드 실패: "+e.message})}
// 변경 후
    try{const rows=await sbFetchAllCached();setRecs(rows);refreshStats(rows);setDataStatus(calcDataStatus(rows));if(rows.length>0)setTab("dash")}catch(e){setMsg({type:"err",text:"DB 로드 실패: "+e.message})}
```

`src/App.jsx:909`:
```js
// 변경 전
    try{const[rows,preds,dets]=await Promise.all([sbFetchAll(),sbFetchPredictions(),sbFetchDetails()]);
// 변경 후
    try{const[rows,preds,dets]=await Promise.all([sbFetchAllCached(),sbFetchPredictions(),sbFetchDetails()]);
```

> `sbFetchAll`은 App.jsx import에 남겨둔다(bidCache.js가 내부적으로 사용, 미사용 import는 무해). 굳이 제거하지 않아 diff 위험 최소화.

- [ ] **Step 3: build 통과 확인**

Run: `npx vite build`
Expected: `✓ built` 에러 없음.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "feat(cache): App.jsx 로드 경로 sbFetchAll→sbFetchAllCached (3개 호출부)"
```

---

## Task 6: 수동 브라우저 검증 (완전성·시나리오)

**Files:** 없음 (검증 전용)

> IndexedDB/네트워크 동작은 node로 테스트 불가 → 실제 앱에서 검증. `npm run dev`(로컬) 또는 배포 후 라이브.

- [ ] **Step 1: 최초 로드 (full)**

브라우저 콘솔 열고 앱 로드. DevTools > Application > IndexedDB에서 `bid-analyzer-cache` > `bid_records` 생성 확인.
Expected: 콘솔 `[cache] full 65115`(또는 현재 행수). 대시보드 "낙찰 데이터" KPI == 65,115.

- [ ] **Step 2: 재로드 (hit, 0 페치)**

새로고침(F5). Network 탭에서 `bid_records` 행 페치 GET이 없고 `rpc/bid_records_sync_meta` 1회만 호출되는지 확인.
Expected: 콘솔 `[cache] hit (0 fetched, 65115)`. KPI == 65,115. 초기 표시가 Step 1보다 빠름.

- [ ] **Step 3: 신규 업로드 후 델타**

낙찰 리스트 파일 업로드(신규 행 발생) → 재로드.
Expected: 콘솔 `[cache] delta N`(N = 신규/변경 행수, 전체 아님). KPI 증가분 반영.

- [ ] **Step 4: ar1 백필 in-place 변경 포착 (핵심 — 트리거 연동)**

이미 캐시된 `ar1 NULL` 공고의 사정률 결과(SUCVIEW)를 업로드해 같은 dedup_key UPDATE 발생 → 재로드.
Expected: 콘솔 `[cache] delta N`. 해당 공고 상세에서 actual 사정률이 NULL→채워진 값으로 갱신(트리거가 updated_at bump → 델타 재페치 입증). 캐시가 stale 안 됨.

- [ ] **Step 5: 삭제 후 reconcile**

(관리자 경로로 행 삭제 가능 시) 행 삭제 → 재로드.
Expected: 콘솔 `[cache] reconcile M`(count 불일치 감지 → 전체 재적재). KPI == 새 서버 행수.

- [ ] **Step 6: 에러 폴백 + 킬 스위치**

콘솔에서 `localStorage.setItem('cacheDisabled','true')` 후 재로드.
Expected: 캐시 우회, `bid_records` 전체 페치(기존 동작), 앱 정상. KPI == 65,115. (확인 후 `localStorage.removeItem('cacheDisabled')`.)

- [ ] **Step 7: colsVersion 무효화 (선택)**

DevTools > Application에서 `meta` 레코드의 `cols` 값을 임의로 변경 후 재로드.
Expected: 콘솔 `[cache] full ...`(스키마 불일치 감지 → 캐시 폐기·재적재).

- [ ] **Step 8: 완전성 최종 확인**

모든 시나리오 후 대시보드 "낙찰 데이터" KPI가 서버 실제 count(`SELECT count(*) FROM bid_records`)와 일치하는지 확인.
Expected: 일치 (65,115 불변식 유지).

---

## 배포 게이트

- 이 변경은 예측 로직(predict_v6/getFinalRecommendation/낙찰하한율) 무관 → `/evaluate` 비해당.
- push 전 `deploy-gate` 서브에이전트: build + 핵심영역 MAE + evaluate_model_release 통합 PASS 확인(데이터 공급 경로라 MAE/완전성 회귀 가드).
- 롤아웃 순서: Task 1(DB) 적용·검증 → Task 2~5 코드 배포 → Task 6 라이브 검증 → 이상 시 `cacheDisabled` 즉시 폴백.

---

## Self-Review 결과

**스펙 커버리지:** §3 DB변경→Task1 / §4 IDB스키마→Task4 / §5 동기화흐름→Task2(결정)+Task4(오케스트레이션) / §6 colsVersion→Task2+Task4 / §7 에러폴백·킬스위치→Task4 / §8 테스트→Task2(단위)+Task6(수동) / §9 롤아웃→배포게이트 섹션. 누락 없음.

**플레이스홀더:** 없음 (모든 step에 실제 코드/명령/기대값).

**타입 일관성:** `decideSyncAction`/`needsReconcile`/`sortByOdDesc` 시그니처가 Task2 정의 ↔ Task4 사용 일치. `sbFetchSyncMeta` 반환 `{count,maxUpdated}` ↔ Task4 `server.count`/`server.maxUpdated` 일치. meta 형태 `{lastSyncUpdatedAt,cachedCount,cols}` Task2 테스트 ↔ Task4 writeMeta 일치. RPC 컬럼 `cnt`/`max_updated`(Task1) ↔ sbFetchSyncMeta 파싱(Task3) 일치.

**스펙 deviation 1건:** 스펙 §5는 키셋 페이징 제안. 구현은 offset 페이징 채택 — 근거: 델타는 작고, in-place UPDATE는 offset을 흔들지 않으며, 동시 insert/delete는 count 게이트가 reconcile로 자가치유(완전성 backstop). 단일 운영자 앱이라 수용 가능.
