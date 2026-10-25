// IndexedDB 증분 캐시 — bid_records 델타 동기화 오케스트레이터
// 설계: docs/superpowers/specs/2026-05-24-indexeddb-incremental-cache-design.md
import { sbFetchAll, sbFetchSyncMeta, sbFetchRecordsSince, BID_RECORDS_COLS } from "./supabase.js";
import { decideSyncAction, needsReconcile, sortByOdDesc } from "./bidCacheLogic.js";

const DB_NAME="bid-analyzer-cache", DB_VERSION=2; // v2: 시작 화면 스냅샷(kv) 추가
const STORE_ROWS="bid_records", STORE_META="meta", META_KEY="bid_records", STORE_KV="kv";

// ── IndexedDB IO ──────────────────────────────────────────
function openCache(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(STORE_ROWS))db.createObjectStore(STORE_ROWS,{keyPath:"id"});
      if(!db.objectStoreNames.contains(STORE_META))db.createObjectStore(STORE_META,{keyPath:"key"});
      if(!db.objectStoreNames.contains(STORE_KV))db.createObjectStore(STORE_KV,{keyPath:"key"});
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
// shown: 화면에 이미 띄운 캐시 행(readCachedRows 결과 또는 그 Promise) — hit이면 다시 읽지 않고 같은 배열을 돌려준다(호출 측이 === 로 재계산 생략)
export async function sbFetchAllCached(shown){
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
      const prev=await shown;
      if(prev){console.log(`[cache] hit (0 fetched, reuse ${prev.length})`);return prev}
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

// ── 시작 화면용 캐시 읽기(네트워크 없음) ─────────────────────
// 지난 동기화 결과로 화면을 먼저 띄우고, sbFetchAllCached가 뒤에서 최신으로 바꾼다. 없거나 컬럼 구성이 바뀌었으면 null.
export async function readCachedRows(){
  if(typeof indexedDB==="undefined")return null;
  let db=null;
  try{
    db=await openCache();
    const meta=await readMeta(db);
    if(!meta||JSON.stringify(meta.cols)!==JSON.stringify(BID_RECORDS_COLS))return null;
    const rows=await readAllRows(db);
    return rows.length?sortByOdDesc(rows):null;
  }catch(_){return null}finally{try{db&&db.close()}catch(_){}}
}

// 시작 화면 스냅샷(예측·공고·보정표 등) — 실패해도 앱 동작에는 영향 없음(null/무시)
export async function kvGet(key){
  if(typeof indexedDB==="undefined")return null;
  let db=null;
  try{db=await openCache();const r=await reqP(store(db,STORE_KV,"readonly").get(key));return r?r.value:null}
  catch(_){return null}finally{try{db&&db.close()}catch(_){}}
}
export async function kvSet(key,value){
  if(typeof indexedDB==="undefined")return;
  let db=null;
  try{db=await openCache();await reqP(store(db,STORE_KV,"readwrite").put({key,value}))}
  catch(e){console.warn("[cache] kvSet 실패:",e?.message||e)}finally{try{db&&db.close()}catch(_){}}
}
