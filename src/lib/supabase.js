import { sanitizeJson } from "./utils.js";
import { authedFetch } from "../auth.js";

// 모든 Supabase REST 호출은 authedFetch 경유 — 401 시 refresh_token으로 자동 재시도.
// 공통 헤더 스니펫: body 있는 요청에는 Content-Type만, apikey/Authorization은 authedFetch가 주입.
const JSON_H = { "Content-Type": "application/json" };

// ─── Supabase CRUD ─────────────────────────────────────────
// 전송 최적화: select=* 대신 클라이언트가 실제 읽는 컬럼만 (모바일 초기 로딩 개선).
// calcStats 입력(br1,is_excluded,bp,xp,at,od,ag) 전부 포함 → 통계·예측 출력 불변.
// 드롭: dedup_key,co_no,g2b,reg,excl_reason,joint_contract_type,is_joint_contract,era_v2,is_duplicate,input_date,ar0,br0,raw_cost,has_a (어느 소비처도 미읽음).
// 주의: PAGE는 1000 고정 — PostgREST max-rows 캡이 1000이라 limit 상향해도 1000만 반환(실측: limit=5000→Content-Range 0-999/*). 올리면 페이지네이션 조기종료로 통계 오염.
// 주의: 읽기 전용 select — 이 결과를 그대로 sbUpsert에 넘기면 dedup_key 등 누락으로 깨짐. 쓰기 경로엔 쓰지 말 것.
export const BID_RECORDS_COLS="id,pn,pn_no,ag,at,ep,ba,av,xp,floor_price,ar1,co,bp,br1,base_ratio,pc,od,cat,era,fr,created_at,work_cat,canonical_ag,is_excluded,contract_method";
// 전송 최적화 2: 순차 66회 → 동시성 제한 병렬 페치 (모바일 벽시계 단축).
// 완전성 보장: 종료조건은 원본과 동일(페이지<PAGE이면 끝 — 1000캡이라 마지막 페이지만 <1000).
// 페이지 실패는 1회 재시도 후 throw → 부분 로드(통계 오염) 대신 호출부 에러 처리로 넘김.
export async function sbFetchAll(){
  const PAGE=1000;       // == PostgREST max-rows 캡 (상향 불가)
  const CONC=6;          // 동시 요청 수 (모바일/연결 한도 고려)
  const base="/rest/v1/bid_records?select="+BID_RECORDS_COLS+"&order=od.desc";
  const fetchPage=async(offset)=>{
    for(let attempt=0;attempt<2;attempt++){
      try{const res=await authedFetch(base+"&offset="+offset+"&limit="+PAGE);
        if(res.ok){const rows=await res.json();if(Array.isArray(rows))return rows;}
      }catch(e){/* 재시도 */}
    }
    throw new Error("bid_records page offset="+offset+" 로드 실패");
  };
  // 1) 첫 페이지 순차 — 토큰 갱신(401 재시도)을 1회로 수렴시켜 병렬 레이스 방지
  const first=await fetchPage(0);
  let all=first.slice();
  if(first.length<PAGE)return all;
  // 2) 나머지 페이지를 CONC개씩 병렬 (offset 순서 보존)
  let done=false,batchStart=1;
  while(!done){
    const offs=[];for(let i=0;i<CONC;i++)offs.push((batchStart+i)*PAGE);
    const results=await Promise.all(offs.map(fetchPage));
    for(const rows of results){all=all.concat(rows);if(rows.length<PAGE)done=true;}
    batchStart+=CONC;
  }
  return all;
}
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
export async function sbUpsert(rows){const BATCH=200;for(let i=0;i<rows.length;i+=BATCH){const batch=rows.slice(i,i+BATCH);const seen=new Set(),unique=[];for(const r of batch){if(!seen.has(r.dedup_key)){seen.add(r.dedup_key);unique.push(r)}}const body=sanitizeJson(JSON.stringify(unique));const res=await authedFetch("/rest/v1/bid_records?on_conflict=dedup_key",{method:"POST",headers:{...JSON_H,"Prefer":"resolution=merge-duplicates,return=minimal"},body});if(!res.ok)throw new Error(`Upsert: ${res.status}`)}}
export async function sbDeleteIds(ids){const BATCH=50;for(let i=0;i<ids.length;i+=BATCH){await authedFetch("/rest/v1/bid_records?id=in.("+ids.slice(i,i+BATCH).join(",")+")",{method:"DELETE"})}}
export async function sbDeleteAll(){await authedFetch("/rest/v1/bid_records?id=gt.0",{method:"DELETE"})}

// 예측 DB
export async function sbSavePredictions(preds){const BATCH=50;for(let i=0;i<preds.length;i+=BATCH){const batch=preds.slice(i,i+BATCH);const seen=new Set(),unique=[];for(const r of batch){if(!seen.has(r.dedup_key)){seen.add(r.dedup_key);unique.push(r)}}const body=sanitizeJson(JSON.stringify(unique));await authedFetch("/rest/v1/bid_predictions?on_conflict=dedup_key",{method:"POST",headers:{...JSON_H,"Prefer":"resolution=merge-duplicates,return=minimal"},body})}}
// order에 고유 tiebreaker(id) 필수: created_at 동률(배치 임포트 50건씩)이 offset 페이지 경계에 걸치면
// created_at.desc 단독 정렬은 비결정적이라 같은 row가 두 페이지에 중복 페치됨 → 예측 리스트 중복 행 버그.
// id 보조정렬로 전역 결정적 순서 보장 + 마지막에 id dedup(안전망).
export async function sbFetchPredictions(){try{const PAGE=1000;let all=[],offset=0;while(true){const res=await authedFetch("/rest/v1/bid_predictions?select=*&order=created_at.desc,id.desc&offset="+offset+"&limit="+PAGE);if(!res.ok)return[];const rows=await res.json();if(!Array.isArray(rows))return all;all=all.concat(rows);if(rows.length<PAGE)break;offset+=PAGE}const seen=new Set();return all.filter(p=>seen.has(p.id)?false:(seen.add(p.id),true))}catch(e){return[]}}

// 자동 매칭: bid_predictions.pn_no → bid_records.pn_no (날짜 검증 필수)
// Phase 21: pn_no prefix fallback 매칭 추가 (지자체 접미사 -000/-001/-002 대응)
export async function sbMatchPredictions(predictions,records){
  // pn_no 정확 매칭 맵 + prefix 매칭 맵 (접미사 제거)
  const recMap={};const prefixMap={};
  const stripSfx=(s)=>s.replace(/-\d{1,3}$/,''); // 마지막 -숫자 제거
  for(const r of records){
    if(r.pn_no&&r.pn_no.length>5){
      if(!recMap[r.pn_no])recMap[r.pn_no]=[];recMap[r.pn_no].push(r);
      const pfx=stripSfx(r.pn_no);
      if(pfx.length>5){if(!prefixMap[pfx])prefixMap[pfx]=[];prefixMap[pfx].push(r)}
    }
  }
  // ★ 이미 매칭된 record_id 수집 (중복 매칭 방지)
  // matched + actual_adj_rate 채워진 경우만 used로 등록. matched but actual NULL은 재매칭 대상이라 record 풀로 환원
  const usedRecIds=new Set(predictions.filter(p=>p.match_status==="matched"&&p.matched_record_id&&p.actual_adj_rate!=null).map(p=>p.matched_record_id));
  const updates=[];
  for(const p of predictions){
    // matched이지만 actual_adj_rate가 NULL이면 재매칭 시도 (ar1 늦게 도착 케이스 백필)
    if(p.match_status==="matched"&&p.actual_adj_rate!=null)continue;
    if(!p.pn_no)continue;
    // 1순위: 정확 pn_no 매칭
    let candidates=recMap[p.pn_no];
    // 2순위: prefix 매칭 (양방향 — prediction·record 어느 쪽이 접미사를 가져도 대응)
    if(!candidates||!candidates.length){
      const pPfx=stripSfx(p.pn_no);
      if(pPfx.length>5)candidates=prefixMap[pPfx];
    }
    if(!candidates||!candidates.length)continue;
    // prefix fallback 케이스에서는 ag 검증 필수 (오매칭 방지)
    const isPfxFallback=!recMap[p.pn_no]||!recMap[p.pn_no].length;
    let match=null;
    if(p.open_date){
      // 예측 개찰일과 가장 가까운 낙찰 건 선택 (이미 사용된 record 제외)
      // 인포21c는 같은 공고에 정상(ar1 채워짐)·간이(br1만) 두 종류 record를 발행 → ar1 있는 후보 우선
      const pOd=p.open_date;
      let bestDist=Infinity, bestHasAr1=false;
      for(const c of candidates){
        if(!c.od)continue;
        if(usedRecIds.has(c.id))continue; // ★ 중복 방지
        // prefix fallback일 때 ag 일치 검증 (발주기관 첫 4자 이상 공통)
        if(isPfxFallback&&p.ag&&c.ag){
          const p4=p.ag.replace(/\s/g,'').slice(0,4),c4=c.ag.replace(/\s/g,'').slice(0,4);
          if(p4&&c4&&!p.ag.includes(c4)&&!c.ag.includes(p4))continue;
        }
        const dist=Math.abs(new Date(pOd)-new Date(c.od));
        const hasAr1=c.ar1!=null;
        // ar1 있는 후보가 있으면 무조건 우선; 같은 등급 내에서는 od 가까운 것 우선
        if(hasAr1&&!bestHasAr1){bestHasAr1=true;bestDist=dist;match=c}
        else if(hasAr1===bestHasAr1&&dist<bestDist){bestDist=dist;match=c}
      }
      // 30일 초과 차이면 오매칭 → 스킵
      if(bestDist>30*24*60*60*1000)match=null;
    }else{
      match=null;
    }
    if(!match)continue;
    usedRecIds.add(match.id); // ★ 사용된 record 등록
    // 실측 사정률은 ar1(예가 사정률, xp/ba*100)만 사용. br1은 별도 정의의 비율 컬럼이라 사용 금지.
    // ar1 단위 자동 감지: 50 이상이면 100% 기준(통상 84~110), 50 미만이면 0% 기준(통상 -2~+2)
    const actualAdj=match.ar1!=null?Math.round((match.ar1>=50?match.ar1-100:match.ar1)*10000)/10000:null;
    const adjErr=p.pred_adj_rate!=null&&actualAdj!=null?Math.round((p.pred_adj_rate-actualAdj)*10000)/10000:null;
    const bidErr=p.pred_bid_amount!=null&&match.bp!=null?Math.round(p.pred_bid_amount-match.bp):null;
    updates.push({id:p.id,actual_adj_rate:actualAdj,actual_expected_price:match.xp,actual_bid_amount:match.bp,actual_winner:match.co,actual_participant_count:match.pc,adj_rate_error:adjErr,bid_amount_error:bidErr,match_status:"matched",matched_record_id:match.id,matched_at:new Date().toISOString(),
      // ★ rec_1st_possible: 각 전략이 1위 가능했는지 판정
      ...(match.xp&&match.bp&&match.fr?{rec_1st_possible:JSON.stringify({
        existing:p.pred_bid_amount!=null&&Number(p.pred_bid_amount)<=Number(match.bp)&&Number(p.pred_bid_amount)>=Number(match.xp)*Number(match.fr)/100,
        aggressive:p.rec_bid_p25!=null&&Number(p.rec_bid_p25)<=Number(match.bp)&&Number(p.rec_bid_p25)>=Number(match.xp)*Number(match.fr)/100,
        balanced:p.rec_bid_p50!=null&&Number(p.rec_bid_p50)<=Number(match.bp)&&Number(p.rec_bid_p50)>=Number(match.xp)*Number(match.fr)/100,
        conservative:p.rec_bid_p75!=null&&Number(p.rec_bid_p75)<=Number(match.bp)&&Number(p.rec_bid_p75)>=Number(match.xp)*Number(match.fr)/100
      })}:{})})
  }
  for(const u of updates){
    const{id,...data}=u;
    await authedFetch("/rest/v1/bid_predictions?id=eq."+id,{method:"PATCH",headers:{...JSON_H,"Prefer":"return=minimal"},body:JSON.stringify(data)})
  }
  // ★ V5.2: 매칭된 기관의 ag_assumed_stats 자동 갱신
  if(updates.length>0){
    const affectedAgs=[...new Set(updates.map(u=>{const rec=records.find(r=>r.id===u.matched_record_id);return rec?rec.ag:null}).filter(Boolean))];
    try{await sbRefreshAgAssumedStats(affectedAgs,records)}catch(e){console.warn("agAss 갱신 실패:",e)}
  }
  return updates.length}

// ★ V5.2: 매칭된 기관의 ag_assumed_stats를 bid_records 최신 데이터로 재계산
// 1순위 가정사정률 역산: 사정률(br1-100)을 가정사정률의 프록시로 사용
// (실제 가정사정률은 투찰금액에서 역산해야 하지만, A값/하한율 차이로 정확한 역산이 어려움)
// 따라서 사정률 P25/P50/P75를 가정사정률의 근사치로 활용
async function sbRefreshAgAssumedStats(agNames,records){
  for(const ag of agNames){
    const agRecs=records.filter(r=>r.ag===ag&&r.br1!=null&&r.br1>=95&&r.br1<=105&&r.od>="2025-07-01");
    if(agRecs.length<3)continue;
    for(const seg of["under300M","over300M"]){
      const filtered=seg==="under300M"?agRecs.filter(r=>(r.ep||r.ba||0)<300000000):agRecs.filter(r=>(r.ep||r.ba||0)>=300000000);
      if(filtered.length<3)continue;
      const adjs=filtered.map(r=>r.br1-100).sort((a,b)=>a-b);
      const len=adjs.length;
      const p25=Math.round(adjs[Math.floor(len*0.25)]*10000)/10000;
      const p50=Math.round(adjs[Math.floor(len*0.5)]*10000)/10000;
      const p75=Math.round(adjs[Math.floor(len*0.75)]*10000)/10000;
      const at=filtered[0].at||"지자체";
      const body=sanitizeJson(JSON.stringify({ag,at,seg,n:len,p25,p50,p75,updated_at:new Date().toISOString()}));
      await authedFetch("/rest/v1/ag_assumed_stats?ag=eq."+encodeURIComponent(ag)+"&seg=eq."+seg,
        {method:"DELETE"});
      await authedFetch("/rest/v1/ag_assumed_stats",
        {method:"POST",headers:{...JSON_H,"Prefer":"return=minimal"},body})
    }
  }
}

// ─── bid_predictions 삭제 ──────────────────────────────────
export async function sbDeletePredictions(ids){const BATCH=50;for(let i=0;i<ids.length;i+=BATCH){await authedFetch("/rest/v1/bid_predictions?id=in.("+ids.slice(i,i+BATCH).join(",")+")",{method:"DELETE"})}}

// ─── v7 Phase a-R2: prediction_snapshot / strategy_log 수집 훅 ──────
// 예측 저장 직후 각 pred_id에 대해 v7 snapshot 일괄 기록 (UPSERT). 실패는 경고만.
export async function sbRecordSnapshots(predIds,modelVersion="v7.0"){
  if(!Array.isArray(predIds)||!predIds.length)return 0;
  const BATCH=10;let ok=0;
  for(let i=0;i<predIds.length;i+=BATCH){
    const chunk=predIds.slice(i,i+BATCH);
    const results=await Promise.allSettled(chunk.map(id=>
      authedFetch("/rest/v1/rpc/record_prediction_snapshot",{
        method:"POST",
        headers:JSON_H,
        body:JSON.stringify({p_pred_id:id,p_model_version:modelVersion})
      }).then(r=>{if(!r.ok)throw new Error("HTTP "+r.status);return r})
    ));
    ok+=results.filter(r=>r.status==="fulfilled").length;
  }
  return ok;
}
// 사용자가 전략 카드를 "확정" 했을 때 strategy_log INSERT
export async function sbLogStrategy(payload){
  const body=sanitizeJson(JSON.stringify(payload));
  const res=await authedFetch("/rest/v1/strategy_log",{
    method:"POST",
    headers:{...JSON_H,"Prefer":"return=representation"},
    body
  });
  if(!res.ok)throw new Error("strategy_log insert: HTTP "+res.status);
  const rows=await res.json();
  return Array.isArray(rows)?rows[0]:rows;
}
// 기존 strategy_log에 낙찰 결과(actual_adj/would_have_won/regret) 백필
export async function sbUpdateStrategyOutcomes(since=null){
  const payload=since?{p_pred_id:null,p_since:since}:{p_pred_id:null,p_since:null};
  const res=await authedFetch("/rest/v1/rpc/update_strategy_log_outcomes",{
    method:"POST",
    headers:JSON_H,
    body:JSON.stringify(payload)
  });
  if(!res.ok)throw new Error("update_strategy_log_outcomes: HTTP "+res.status);
  return await res.json();
}
// 특정 예측의 기존 strategy_log rows 조회 (사용자 확정만; 백테스트 데이터 제외)
export async function sbFetchStrategyLog(predIds){
  if(!Array.isArray(predIds)||!predIds.length)return[];
  try{
    const res=await authedFetch("/rest/v1/strategy_log?select=id,pred_id,strategy_type,created_at,source&pred_id=in.("+predIds.join(",")+")&source=eq.user");
    if(!res.ok)return[];
    return await res.json();
  }catch(e){return[]}
}
// Phase v7-ops-2: 전략별 Pwin 캘리브레이션 현황 (sample_n, actual_rate, fallback 여부)
export async function sbFetchPwinCalibration(){
  try{
    const res=await authedFetch("/rest/v1/pwin_calibration_by_strategy?select=strategy_type,sample_n,actual_rate,use_fallback,updated_at");
    if(!res.ok)return{};
    const rows=await res.json();
    if(!Array.isArray(rows))return{};
    const out={};
    for(const r of rows){out[r.strategy_type]=r}
    return out;
  }catch(e){return{}}
}
// Phase v7-ops-4B: 모델 검증 대시보드용 helpers
export async function sbFetchQualityDaily(sinceDays=30){
  try{
    const since=new Date(Date.now()-sinceDays*86400000).toISOString().slice(0,10);
    const res=await authedFetch("/rest/v1/prediction_quality_daily?select=measured_on,model_version,route,at,n,mae,hit_0_5_pct,hit_0_3_pct,floor_safe_pct,direction_pct&measured_on=gte."+since+"&order=measured_on.desc");
    if(!res.ok)return[];
    return await res.json();
  }catch(e){return[]}
}
export async function sbFetchWeeklyQuality(limit=20){
  try{
    const res=await authedFetch("/rest/v1/weekly_quality_report?select=report_week,scope,dimension_value,n_week,mae_week,mae_delta,drift_flag,gate_status&order=report_week.desc&limit="+limit);
    if(!res.ok)return[];
    return await res.json();
  }catch(e){return[]}
}
export async function sbFetchBiasHotspots(minN=10,limit=30){
  try{
    const res=await authedFetch("/rest/v1/pred_bias_map?select=grain,key1,key2,n,bias&n=gte."+minN+"&order=bias.desc&limit="+limit);
    if(!res.ok)return[];
    const rows=await res.json();
    if(!Array.isArray(rows))return[];
    return rows.sort((a,b)=>Math.abs(Number(b.bias))-Math.abs(Number(a.bias)));
  }catch(e){return[]}
}
export async function sbFetchWatchlist(){
  try{
    const res=await authedFetch("/rest/v1/watchlist_segments?select=*");
    if(!res.ok)return[];
    const rows=await res.json();
    if(!Array.isArray(rows))return[];
    return rows;
  }catch(e){return[]}
}
export async function sbFetchWatchlistHistory(days=14){
  try{
    const since=new Date(Date.now()-days*86400000).toISOString().slice(0,10);
    const res=await authedFetch("/rest/v1/watchlist_snapshots?select=snapshot_date,at,tier,n_total,mae_total,bias_total,mae_drift,bias_drift,grade&snapshot_date=gte."+since+"&order=snapshot_date.desc,at.asc,tier.asc");
    if(!res.ok)return[];
    const rows=await res.json();
    if(!Array.isArray(rows))return[];
    return rows;
  }catch(e){return[]}
}

// ─── bid_details CRUD ────────────────────────────────────
export async function sbSaveDetail(detail){
  const body=sanitizeJson(JSON.stringify(detail));
  const res=await authedFetch("/rest/v1/bid_details?on_conflict=pn_no",{method:"POST",headers:{...JSON_H,"Prefer":"resolution=merge-duplicates,return=minimal"},body});
  return res.ok}
export async function sbFetchDetails(){
  try{const PAGE=1000;let all=[],offset=0;while(true){const res=await authedFetch("/rest/v1/bid_details?select=*&order=od.desc&offset="+offset+"&limit="+PAGE);if(!res.ok)return all;const rows=await res.json();if(!Array.isArray(rows))return all;all=all.concat(rows);if(rows.length<PAGE)break;offset+=PAGE}return all}catch(e){return[]}}
export async function sbFetchDetailsByAg(ag){
  try{const res=await authedFetch("/rest/v1/bid_details?ag=eq."+encodeURIComponent(ag)+"&select=*&order=od.desc&limit=1000");if(!res.ok)return[];return await res.json()}catch(e){return[]}}

// ─── Phase 4-C: 관리자 페이지 — auth.users 읽기 전용 조회 ──────
export async function sbAdminListUsers(){
  const res=await authedFetch("/rest/v1/rpc/admin_list_users",{
    method:"POST",
    headers:JSON_H,
    body:"{}"
  });
  if(!res.ok){
    const txt=await res.text().catch(()=> "");
    if(res.status===403||/FORBIDDEN/i.test(txt))throw new Error("관리자만 조회 가능합니다");
    throw new Error("사용자 목록 조회 실패 ("+res.status+")");
  }
  return await res.json();
}

// ─── Phase 23-4: SUCVIEW 기반 at × floor_rate 1위 마진 벤치마크 ──────
// floor_margin_benchmark VIEW → {`${at}|${floor_rate}` : {med, n, std}}
export async function sbFetchFloorBench(){
  try{
    const res=await authedFetch("/rest/v1/floor_margin_benchmark?select=at,floor_rate,n,med_margin,std_margin&limit=500");
    if(!res.ok)return{};
    const rows=await res.json();
    const m={};
    for(const r of rows){
      const key=r.at+"|"+Number(r.floor_rate).toFixed(3);
      m[key]={med:Number(r.med_margin),n:Number(r.n),std:Number(r.std_margin)};
    }
    return m;
  }catch(e){return{}}
}

// ─── Phase 23-2: 발주기관×금액대 동적 편향 보정 맵 ──────────
// pred_bias_map VIEW에서 4단계 grain (AG_BA, AG, AT_BA, AT) 다층 lookup용 map 생성
export async function sbFetchPredBiasMap(){
  try{
    const res=await authedFetch("/rest/v1/pred_bias_map?select=grain,key1,key2,n,bias&limit=2000");
    if(!res.ok)return{agBa:{},ag:{},atBa:{},at:{}};
    const rows=await res.json();
    const m={agBa:{},ag:{},atBa:{},at:{}};
    for(const r of rows){
      const b=Number(r.bias);if(!isFinite(b))continue;
      if(r.grain==='AG_BA')m.agBa[r.key1+'|'+r.key2]=b;
      else if(r.grain==='AG')m.ag[r.key1]=b;
      else if(r.grain==='AT_BA')m.atBa[r.key1+'|'+r.key2]=b;
      else if(r.grain==='AT')m.at[r.key1]=b;
    }
    return m;
  }catch(e){return{agBa:{},ag:{},atBa:{},at:{}}}
}

// agency_accuracy_map VIEW(실측 정확도) → 4단계 grain lookup용 map. 값 = {n,bias,mae,sd}.
// 신뢰도 V2(predConfidenceV2) 입력. pred_bias_map과 base 1:1 동일(drift 테스트로 고정), mae/sd만 추가.
export async function sbFetchAccuracyMap(){
  try{
    const res=await authedFetch("/rest/v1/agency_accuracy_map?select=grain,key1,key2,n,bias,mae,sd&limit=2000");
    if(!res.ok)return{agBa:{},ag:{},atBa:{},at:{}};
    const rows=await res.json();
    const m={agBa:{},ag:{},atBa:{},at:{}};
    for(const r of rows){
      const mae=Number(r.mae);if(!isFinite(mae))continue;
      const v={n:Number(r.n),bias:Number(r.bias),mae,sd:r.sd==null?null:Number(r.sd)};
      if(r.grain==='AG_BA')m.agBa[r.key1+'|'+r.key2]=v;
      else if(r.grain==='AG')m.ag[r.key1]=v;
      else if(r.grain==='AT_BA')m.atBa[r.key1+'|'+r.key2]=v;
      else if(r.grain==='AT')m.at[r.key1]=v;
    }
    return m;
  }catch(e){return{agBa:{},ag:{},atBa:{},at:{}}}
}

// ─── Phase 23-9 + B2.4: V2 신규 컬럼 PATCH (A안 INSERT-only) ─────────────
// 허용 컬럼: bid1st_v2_* 6개 + b_pred_* 6개 (총 12개)
// 보호 컬럼: opt_adj, actual_adj_rate, matched_at, opt_bid 등은 PATCH 금지
// 근거: docs/v2/HANDOFF_V2_PREDICTION_DEFINITION §8 (A안), 코덱스 라운드 3 권고 #3
// 호출자가 임의 컬럼을 전달해도 함수 내부에서 강제 필터링 — 게이트 우회 방지
const ALLOWED_V2_COLUMNS = new Set([
  // Phase 23-9 V2 1차 (bid1st_v2_*)
  'bid1st_v2_adj','bid1st_v2_bid','bid1st_v2_win_prob',
  'bid1st_v2_floor_safe','bid1st_v2_grain','bid1st_v2_src',
  // B2 Mode B 엔진 (b_pred_*)
  'b_pred_mode','b_pred_adj','b_pred_bid_amount',
  'b_pred_floor_pass_prob','b_pred_grain','b_pred_src',
  // m22 own_score 컬럼 (라운드 12 critical fix — allowlist 누락 수정)
  'own_score'
]);

export async function sbUpdatePredictionsV2(updates){
  if(!updates||!updates.length)return 0;
  let ok=0;
  for(const u of updates){
    const{id,...rawFields}=u;
    if(!id)continue;
    // A안 allowlist 강제 — 허용 컬럼만 통과
    const fields={};
    for(const k of Object.keys(rawFields)){
      if(ALLOWED_V2_COLUMNS.has(k)) fields[k]=rawFields[k];
    }
    if(Object.keys(fields).length===0)continue;
    try{
      const res=await authedFetch(`/rest/v1/bid_predictions?id=eq.${id}`,{
        method:"PATCH",
        headers:{...JSON_H,"Prefer":"return=minimal"},
        body:JSON.stringify(fields)
      });
      if(res.ok)ok++;
    }catch(e){}
  }
  return ok;
}

// ─── Phase 23-9: 1위 사정률 분포 다단 fallback map ──────────
// win1st_dist_map VIEW (AG_BA → AG → AT_BA → AT) → JS map
export async function sbFetchWin1stDistMap(){
  try{
    const res=await authedFetch("/rest/v1/win1st_dist_map?select=grain,key1,key2,n,mean,std&limit=2000");
    if(!res.ok)return{agBa:{},ag:{},atBa:{},at:{}};
    const rows=await res.json();
    const m={agBa:{},ag:{},atBa:{},at:{}};
    for(const r of rows){
      const v={n:Number(r.n),mean:Number(r.mean),std:Number(r.std)};
      if      (r.grain==='AG_BA') m.agBa[r.key1+'|'+r.key2]=v;
      else if (r.grain==='AG')    m.ag[r.key1]=v;
      else if (r.grain==='AT_BA') m.atBa[r.key1+'|'+r.key2]=v;
      else if (r.grain==='AT')    m.at[r.key1]=v;
    }
    return m;
  }catch(e){return{agBa:{},ag:{},atBa:{},at:{}}}
}

// ─── Phase 23-3: 한전·고양시 (canonical_ag, at, ba_seg) median fine-tune 맵 ──
// pred_baseg_finetune VIEW에서 (ag|at|seg) → median lookup, 50:50 블렌드용
export async function sbFetchBasegFinetune(){
  try{
    const res=await authedFetch("/rest/v1/pred_baseg_finetune?select=canonical_ag,at,ba_seg,n,ba_seg_median&limit=500");
    if(!res.ok)return{};
    const rows=await res.json();
    const m={};
    for(const r of rows){
      const v=Number(r.ba_seg_median);if(!isFinite(v))continue;
      m[r.canonical_ag+'|'+r.at+'|'+r.ba_seg]={n:Number(r.n),median:v};
    }
    return m;
  }catch(e){return{}}
}

// ─── 발주기관별 가정사정률 통계 ─────────────────────────
export async function sbFetchAgAssumedStats(){
  try{const res=await authedFetch("/rest/v1/ag_assumed_stats?select=ag,at,seg,n,p25,p50,p75&order=n.desc&limit=1000");if(!res.ok)return{};const rows=await res.json();const map={};for(const r of rows){const k=r.ag+"|"+r.seg;map[k]={at:r.at,n:Number(r.n),p25:Number(r.p25),p50:Number(r.p50),p75:Number(r.p75)}}return map}catch(e){return{}}}

// Phase 6~10 no-op 스텁(sbFetchScoring / sbBatchUpsertScoring / sbFetchRoiMatrix /
// sbFetchBiasMap / sbFetchTrendMap / sbSaveAiAnalysis / sbFetchAiAnalysis)은
// App.jsx 호출부와 함께 정리되어 제거됨.

// ─── Phase 12: 타깃팅 데이터 로딩 ────────────────────────
export async function sbFetchTargetMatrix(){
  try{const res=await authedFetch("/rest/v1/target_matrix?select=*&order=priority_tier.asc");if(!res.ok)return[];return await res.json()}catch(e){return[]}
}
export async function sbFetchSweetSpotAgencies(){
  try{const res=await authedFetch("/rest/v1/sweet_spot_agencies?select=*&order=sweet_spot_count.desc");if(!res.ok)return[];return await res.json()}catch(e){return[]}
}
// ─── Phase 12-C: 발주사별 낙찰 예측 ────────────────────────
export async function sbFetchAgencyWinStats(){
  try{const res=await authedFetch("/rest/v1/agency_win_stats?select=*&order=theoretical_win_rate.desc");if(!res.ok)return[];return await res.json()}catch(e){return[]}
}
export async function sbFetchAgencyPredictor(){
  try{const res=await authedFetch("/rest/v1/agency_predictor?select=*");if(!res.ok)return[];return await res.json()}catch(e){return[]}
}
// Phase 14-3: 분산 투찰 시뮬레이터
export async function sbFetchSimulator(){
  try{const res=await authedFetch("/rest/v1/v_simulator_api?select=*");if(!res.ok)return[];return await res.json()}catch(e){return[]}
}
// ─── v7.2 이번 주 타깃 뷰 ─────────────────────────────────
// v_this_week_targets_v72: match_status IS NULL & 최근 7일 공고에 predict_v7_2() 적용한 뷰
// pred_id → v7.2 3종 추천 매핑용. 로드 실패는 빈 map 반환 (graceful degradation).
export async function sbFetchV72Targets(){
  try{
    const res=await authedFetch("/rest/v1/v_this_week_targets_v72?select=pred_id,사정률_공격,사정률_균형,사정률_안전,투찰금액_공격,투찰금액_균형,투찰금액_안전,확률_공격,확률_균형,확률_안전,금액대,공사성격_적용,신뢰도,표본수,소스,발주사_오프셋,변동성_조정,tier,tier_label");
    if(!res.ok)return{};
    const rows=await res.json();
    if(!Array.isArray(rows))return{};
    const map={};
    for(const r of rows){
      if(r.pred_id==null)continue;
      map[r.pred_id]={
        aggressive:{rate:r["사정률_공격"],amount:r["투찰금액_공격"],probability:r["확률_공격"]??85},
        balanced:{rate:r["사정률_균형"],amount:r["투찰금액_균형"],probability:r["확률_균형"]??60},
        safe:{rate:r["사정률_안전"],amount:r["투찰금액_안전"],probability:r["확률_안전"]??35},
        bucket:r["금액대"],
        appliedWorkCat:r["공사성격_적용"],
        confidence:r["신뢰도"],
        sampleSize:r["표본수"],
        source:r["소스"],
        agencyOffset:r["발주사_오프셋"]??0,
        volatilityAdj:r["변동성_조정"]??0,
        tier:r["tier"],
        tierLabel:r["tier_label"],
      };
    }
    return map;
  }catch(e){return{}}
}

// ─── 발주사별 최근 15건 낙찰 이력 통계 (배치 RPC) ─────────────────
// canonical_ag[] → map: canonical_ag → {nRaw, nFiltered, p10~p75, mean, std, latestOd, layer}
// layer: 'active'(n_filtered≥8) / 'ref'(n_filtered≥4) / 'insufficient'
export async function sbFetchAgencyHistMap(canonicalAgs){
  if(!canonicalAgs||!canonicalAgs.length)return{};
  try{
    const unique=[...new Set(canonicalAgs.filter(Boolean))];
    const res=await authedFetch("/rest/v1/rpc/get_agency_hist_stats_batch",{
      method:"POST",headers:JSON_H,body:JSON.stringify({p_ags:unique})
    });
    if(!res.ok)return{};
    const rows=await res.json();
    if(!Array.isArray(rows))return{};
    const map={};
    for(const r of rows){
      if(!r.canonical_ag)continue;
      map[r.canonical_ag]={
        nRaw:Number(r.n_raw),nFiltered:Number(r.n_filtered),
        p10:Number(r.p10),p25:Number(r.p25),p50:Number(r.p50),p75:Number(r.p75),
        mean:Number(r.mean_br1),std:Number(r.std_br1),
        latestOd:r.latest_od,layer:r.layer,
      };
    }
    return map;
  }catch(e){return{}}
}

// ─── v8 예측 뷰 (v_v8_predictions) ──────────────────────────────────
// pred_id → {rate, p25, p50, p75, confidence, sampleSize, scope, source}
export async function sbFetchV8Predictions(){
  try{
    // m35: Supabase 서버 max-rows=1000 hard cap → chunk 페이징 (sbFetchPredictions 패턴)
    // limit=10000도 서버가 1,000으로 잘라서 응답 (Content-Range: 0-999/2252). offset 페이징 필수.
    const PAGE=1000;let all=[];let offset=0;
    while(true){
      const res=await authedFetch("/rest/v1/v_v8_predictions?select=pred_id,v8_rate,v8_p25,v8_p50,v8_p75,v8_confidence,v8_sample_size,v8_scope,v8_source&order=pred_id.asc&offset="+offset+"&limit="+PAGE);
      if(!res.ok)return{};
      const rows=await res.json();
      if(!Array.isArray(rows))break;
      all=all.concat(rows);
      if(rows.length<PAGE)break;
      offset+=PAGE;
    }
    const map={};
    for(const r of all){
      if(r.pred_id==null)continue;
      map[r.pred_id]={
        rate:r.v8_rate!=null?Number(r.v8_rate):null,
        p25:r.v8_p25!=null?Number(r.v8_p25):null,
        p50:r.v8_p50!=null?Number(r.v8_p50):null,
        p75:r.v8_p75!=null?Number(r.v8_p75):null,
        confidence:r.v8_confidence,
        sampleSize:r.v8_sample_size,
        scope:r.v8_scope,
        source:r.v8_source,
      };
    }
    return map;
  }catch(e){return{}}
}

// 나라장터 공고 목록 (bid_notices)
export async function sbFetchNotices(){
  try{const res=await authedFetch("/rest/v1/bid_notices?select=id,pn,pn_no,ag,at,ep,ba,av,od,status,is_target,prediction_id,api_fetched_at&order=od.asc&limit=1000");if(!res.ok)return[];return await res.json()}catch(e){return[]}
}
// 단건 공고 예측 등록 (predict_notice DB 함수 호출)
export async function sbPredictNotice(noticeId){
  try{const res=await authedFetch("/rest/v1/rpc/predict_notice",{method:"POST",headers:{...JSON_H,"Prefer":"return=representation"},body:JSON.stringify({p_notice_id:noticeId})});if(!res.ok)return null;const rows=await res.json();return rows[0]||null}catch(e){return null}
}


// ─── V6-B1: 발주처 예측 탭 (2026-05-13) ──────────────────────
// 디자인 문서: docs/superpowers/specs/2026-05-13-agency-predictor-v6b1-mvp-design.md
// 4개 헬퍼: (1) predict_with_history RPC, (2) bid_history file_upload 일괄 INSERT,
//          (3) bid_predictions_v3 일괄 INSERT, (4) 최근 예측 조회.

// (1) predict_with_history RPC 호출 — 행 1건당
export async function sbCallPredictWithHistory({bid_no,canonical_ag,industry,base_amount,a_value,floor_rate}){
  try{
    const body=JSON.stringify({
      p_bid_no:bid_no,p_canonical_ag:canonical_ag,p_industry:industry,
      p_base_amount:base_amount,p_a_value:a_value,p_floor_rate:floor_rate
    });
    const res=await authedFetch("/rest/v1/rpc/predict_with_history",{method:"POST",headers:JSON_H,body});
    if(!res.ok)return null;
    const rows=await res.json();
    return Array.isArray(rows)&&rows[0]?rows[0]:null;
  }catch(e){return null}
}

// (2) bid_history file_upload 일괄 INSERT — UNIQUE (bid_no, source) ON CONFLICT DO NOTHING
//     rows: [{bid_no,ag,industry,opened_at,base_amount,a_value,floor_rate,notice_title,contract_method}]
export async function sbBatchInsertBidHistoryUpload(rows){
  if(!rows||!rows.length)return;
  const BATCH=100;
  for(let i=0;i<rows.length;i+=BATCH){
    const batch=rows.slice(i,i+BATCH).map(r=>({...r,source:"file_upload"}));
    const body=sanitizeJson(JSON.stringify(batch));
    await authedFetch("/rest/v1/bid_history?on_conflict=bid_no,source",{
      method:"POST",
      headers:{...JSON_H,"Prefer":"resolution=merge-duplicates,return=minimal"},
      body
    });
  }
}

// (3) bid_predictions_v3 일괄 INSERT — model_version DEFAULT 'v3.0' (DB 측)
export async function sbBatchInsertBidPredictionsV3(rows){
  if(!rows||!rows.length)return;
  const BATCH=50;
  for(let i=0;i<rows.length;i+=BATCH){
    const batch=rows.slice(i,i+BATCH);
    const body=sanitizeJson(JSON.stringify(batch));
    const res=await authedFetch("/rest/v1/bid_predictions_v3",{
      method:"POST",
      headers:{...JSON_H,"Prefer":"return=minimal"},
      body
    });
    if(!res.ok)throw new Error(`bpv3 INSERT: ${res.status}`);
  }
}

// (4) 최근 예측 조회 — 탭 진입 시 첫 표시
export async function sbFetchAgencyPredictionsV3(limit=200){
  try{
    const cols="id,bid_no,canonical_ag,industry,amount_tier,base_amount,"
      +"predicted_ratio,predicted_floor_amount,"
      +"strategy_aggressive_bid,strategy_balanced_bid,strategy_safe_bid,"
      +"aggressive_margin,balanced_margin,safe_margin,"
      +"disq_risk_aggressive,disq_risk_balanced,disq_risk_safe,"
      +"confidence_tier,signal_stage,sample_size_used,model_version,"
      +"match_status,actual_ratio,result,created_at";
    const res=await authedFetch(
      "/rest/v1/bid_predictions_v3?select="+cols
      +"&order=created_at.desc&limit="+limit
    );
    if(!res.ok)return[];
    const rows=await res.json();
    return Array.isArray(rows)?rows:[];
  }catch(e){return[]}
}

// ─── V1: 발주사 하한 예측탭 (2026-05-13) ──────────────────
// 디자인 문서: docs/superpowers/specs/2026-05-13-agency-floor-prediction-tab-v1-design.md
// 4개 헬퍼: (1) file_upload 예측 리스트, (2) 발주사 사정률 분포 신호,
//          (3) 매칭된 bid_records 일괄, (4) 펼침 시 발주사 최근 이력.

// (1) 예측 리스트 — source=file_upload, 필요 컬럼만 select
export async function sbFetchAgencyFloorPredictions(limit=500){
  try{
    const cols="id,ag,canonical_ag,cat,ba,ep,av,open_date,"
      +"actual_adj_rate,actual_bid_amount,actual_winner,"
      +"match_status,matched_record_id,is_cancelled,created_at";
    const res=await authedFetch(
      "/rest/v1/bid_predictions?source=eq.file_upload"
      +"&select="+cols
      +"&order=open_date.desc.nullslast&limit="+limit
    );
    if(!res.ok)return[];
    const rows=await res.json();
    return Array.isArray(rows)?rows:[];
  }catch(e){return[]}
}

// (2) 발주사 사정률 분포 신호 — canonical_ag in.() 일괄, 100건 청크
//     반환: {rows:[{canonical_ag,cat,median_adj_ratio,p25_adj_ratio,p75_adj_ratio,
//                   std_adj_ratio,sample_size,tier,confidence}]}
export async function sbFetchAgencyRateDistribution(canonicalAgs){
  if(!canonicalAgs||!canonicalAgs.length)return{rows:[]};
  try{
    const unique=[...new Set(canonicalAgs.filter(Boolean))];
    const CHUNK=100;let all=[];
    for(let i=0;i<unique.length;i+=CHUNK){
      const c=unique.slice(i,i+CHUNK);
      const qs="canonical_ag=in.("+c.map(s=>encodeURIComponent('"'+s+'"')).join(",")+")";
      const res=await authedFetch(
        "/rest/v1/agency_rate_distribution?"+qs
        +"&select=canonical_ag,cat,median_adj_ratio,p25_adj_ratio,p75_adj_ratio,"
        +"std_adj_ratio,sample_size,tier,confidence"
      );
      if(!res.ok)continue;
      const rows=await res.json();
      if(Array.isArray(rows))all=all.concat(rows);
    }
    return{rows:all};
  }catch(e){return{rows:[]}}
}

// (3) 매칭된 bid_records 일괄 — matched_record_id 집합 → {id:{ar1,base_ratio,fr,bp,co}}
export async function sbFetchMatchedRecords(ids){
  if(!ids||!ids.length)return{};
  try{
    const unique=[...new Set(ids.filter(v=>v!=null))];
    const CHUNK=100;const out={};
    for(let i=0;i<unique.length;i+=CHUNK){
      const c=unique.slice(i,i+CHUNK);
      const res=await authedFetch(
        "/rest/v1/bid_records?id=in.("+c.join(",")+")"
        +"&select=id,ar1,base_ratio,fr,bp,co"
      );
      if(!res.ok)continue;
      const rows=await res.json();
      if(Array.isArray(rows))for(const r of rows)out[r.id]=r;
    }
    return out;
  }catch(e){return{}}
}

// (4) 발주사 최근 입찰 이력 — 펼침 시 lazy fetch
//     ar1 not null + is_excluded=false 필터, od desc 30건
export async function sbFetchAgencyHistoryByName(canonicalAg,limit=30){
  if(!canonicalAg)return[];
  try{
    const res=await authedFetch(
      "/rest/v1/bid_records?canonical_ag=eq."+encodeURIComponent(canonicalAg)
      +"&ar1=not.is.null&is_excluded=eq.false"
      +"&order=od.desc.nullslast&limit="+limit
      +"&select=id,od,pn,ba,ar1,base_ratio,fr,bp,co,pc"
    );
    if(!res.ok)return[];
    const rows=await res.json();
    return Array.isArray(rows)?rows:[];
  }catch(e){return[]}
}
