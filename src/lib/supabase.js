import { SB_URL, hdrs, hdrsSel } from "./constants.js";
import { sanitizeJson } from "./utils.js";

// ─── Supabase CRUD ─────────────────────────────────────────
export async function sbFetchAll(){const PAGE=1000;let all=[],offset=0;while(true){const res=await fetch(SB_URL+"/rest/v1/bid_records?select=*&order=od.desc&offset="+offset+"&limit="+PAGE,{headers:hdrsSel});const rows=await res.json();if(!Array.isArray(rows))break;all=all.concat(rows);if(rows.length<PAGE)break;offset+=PAGE}return all}
export async function sbUpsert(rows){const BATCH=200;for(let i=0;i<rows.length;i+=BATCH){const batch=rows.slice(i,i+BATCH);const seen=new Set(),unique=[];for(const r of batch){if(!seen.has(r.dedup_key)){seen.add(r.dedup_key);unique.push(r)}}const body=sanitizeJson(JSON.stringify(unique));const res=await fetch(SB_URL+"/rest/v1/bid_records?on_conflict=dedup_key",{method:"POST",headers:{...hdrs,"Prefer":"resolution=merge-duplicates,return=minimal"},body});if(!res.ok)throw new Error(`Upsert: ${res.status}`)}}
export async function sbDeleteIds(ids){const BATCH=50;for(let i=0;i<ids.length;i+=BATCH){await fetch(SB_URL+"/rest/v1/bid_records?id=in.("+ids.slice(i,i+BATCH).join(",")+")",{method:"DELETE",headers:hdrs})}}
export async function sbDeleteAll(){await fetch(SB_URL+"/rest/v1/bid_records?id=gt.0",{method:"DELETE",headers:hdrs})}

// 예측 DB
export async function sbSavePredictions(preds){const BATCH=50;for(let i=0;i<preds.length;i+=BATCH){const batch=preds.slice(i,i+BATCH);const seen=new Set(),unique=[];for(const r of batch){if(!seen.has(r.dedup_key)){seen.add(r.dedup_key);unique.push(r)}}const body=sanitizeJson(JSON.stringify(unique));await fetch(SB_URL+"/rest/v1/bid_predictions?on_conflict=dedup_key",{method:"POST",headers:{...hdrs,"Prefer":"resolution=merge-duplicates,return=minimal"},body})}}
export async function sbFetchPredictions(){try{const PAGE=1000;let all=[],offset=0;while(true){const res=await fetch(SB_URL+"/rest/v1/bid_predictions?select=*&order=created_at.desc&offset="+offset+"&limit="+PAGE,{headers:hdrsSel});if(!res.ok)return[];const rows=await res.json();if(!Array.isArray(rows))return all;all=all.concat(rows);if(rows.length<PAGE)break;offset+=PAGE}return all}catch(e){return[]}}

// 자동 매칭: bid_predictions.pn_no → bid_records.pn_no (날짜 검증 필수)
export async function sbMatchPredictions(predictions,records){
  // pn_no 기준으로 모든 후보를 배열로 저장 (동일 pn_no 복수 존재 가능)
  const recMap={};for(const r of records){if(r.pn_no&&r.pn_no.length>5){if(!recMap[r.pn_no])recMap[r.pn_no]=[];recMap[r.pn_no].push(r)}}
  // ★ 이미 매칭된 record_id 수집 (중복 매칭 방지)
  const usedRecIds=new Set(predictions.filter(p=>p.match_status==="matched"&&p.matched_record_id).map(p=>p.matched_record_id));
  const updates=[];
  for(const p of predictions){
    if(p.match_status==="matched")continue;
    if(!p.pn_no)continue;
    const candidates=recMap[p.pn_no];
    if(!candidates||!candidates.length)continue;
    let match=null;
    if(p.open_date){
      // 예측 개찰일과 가장 가까운 낙찰 건 선택 (이미 사용된 record 제외)
      const pOd=p.open_date;
      let bestDist=Infinity;
      for(const c of candidates){
        if(!c.od)continue;
        if(usedRecIds.has(c.id))continue; // ★ 중복 방지
        const dist=Math.abs(new Date(pOd)-new Date(c.od));
        if(dist<bestDist){bestDist=dist;match=c}
      }
      // 30일 초과 차이면 오매칭 → 스킵
      if(bestDist>30*24*60*60*1000)match=null;
    }else{
      match=null;
    }
    if(!match)continue;
    usedRecIds.add(match.id); // ★ 사용된 record 등록
    const actualAdj=match.br1!=null?Math.round((match.br1-100)*10000)/10000:null;
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
    await fetch(SB_URL+"/rest/v1/bid_predictions?id=eq."+id,{method:"PATCH",headers:{...hdrs,"Prefer":"return=minimal"},body:JSON.stringify(data)})
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
      await fetch(SB_URL+"/rest/v1/ag_assumed_stats?ag=eq."+encodeURIComponent(ag)+"&seg=eq."+seg,
        {method:"DELETE",headers:hdrs});
      await fetch(SB_URL+"/rest/v1/ag_assumed_stats",
        {method:"POST",headers:{...hdrs,"Prefer":"return=minimal"},body})
    }
  }
}

// ─── bid_predictions 삭제 ──────────────────────────────────
export async function sbDeletePredictions(ids){const BATCH=50;for(let i=0;i<ids.length;i+=BATCH){await fetch(SB_URL+"/rest/v1/bid_predictions?id=in.("+ids.slice(i,i+BATCH).join(",")+")",{method:"DELETE",headers:hdrs})}}

// ─── bid_details CRUD ────────────────────────────────────
export async function sbSaveDetail(detail){
  const body=sanitizeJson(JSON.stringify(detail));
  const res=await fetch(SB_URL+"/rest/v1/bid_details?on_conflict=pn_no",{method:"POST",headers:{...hdrs,"Prefer":"resolution=merge-duplicates,return=minimal"},body});
  return res.ok}
export async function sbFetchDetails(){
  try{const PAGE=1000;let all=[],offset=0;while(true){const res=await fetch(SB_URL+"/rest/v1/bid_details?select=*&order=od.desc&offset="+offset+"&limit="+PAGE,{headers:hdrsSel});if(!res.ok)return all;const rows=await res.json();if(!Array.isArray(rows))return all;all=all.concat(rows);if(rows.length<PAGE)break;offset+=PAGE}return all}catch(e){return[]}}
export async function sbFetchDetailsByAg(ag){
  try{const res=await fetch(SB_URL+"/rest/v1/bid_details?ag=eq."+encodeURIComponent(ag)+"&select=*&order=od.desc&limit=1000",{headers:hdrsSel});if(!res.ok)return[];return await res.json()}catch(e){return[]}}

// ─── 발주기관별 가정사정률 통계 ─────────────────────────
export async function sbFetchAgAssumedStats(){
  try{const res=await fetch(SB_URL+"/rest/v1/ag_assumed_stats?select=ag,at,seg,n,p25,p50,p75&order=n.desc&limit=1000",{headers:hdrsSel});if(!res.ok)return{};const rows=await res.json();const map={};for(const r of rows){const k=r.ag+"|"+r.seg;map[k]={at:r.at,n:Number(r.n),p25:Number(r.p25),p50:Number(r.p50),p75:Number(r.p75)}}return map}catch(e){return{}}}

// ─── Phase 12: Phase 6~10 스텁 (드롭된 테이블 참조 제거) ─────
// 이 함수들은 Phase 6~10에서 만들어졌으나, 여성기업 가산 오염으로 백지화됨.
// App.jsx 호환성 유지를 위해 no-op으로 유지. 다음 정리 시 App.jsx에서 호출 제거 예정.
export async function sbFetchScoring(){return[]}
export async function sbBatchUpsertScoring(rows){return}
export async function sbFetchRoiMatrix(){return[]}
export async function sbFetchBiasMap(){return{agency:{},at:{}}}
export async function sbFetchTrendMap(){return{}}
export async function sbSaveAiAnalysis(predId,analysis){return}
export async function sbFetchAiAnalysis(){return{}}

// ─── Phase 12: 타깃팅 데이터 로딩 ────────────────────────
export async function sbFetchTargetMatrix(){
  try{const res=await fetch(SB_URL+"/rest/v1/target_matrix?select=*&order=priority_tier.asc",{headers:hdrsSel});if(!res.ok)return[];return await res.json()}catch(e){return[]}
}
export async function sbFetchSweetSpotAgencies(){
  try{const res=await fetch(SB_URL+"/rest/v1/sweet_spot_agencies?select=*&order=sweet_spot_count.desc",{headers:hdrsSel});if(!res.ok)return[];return await res.json()}catch(e){return[]}
}
// ─── Phase 12-C: 발주사별 낙찰 예측 ────────────────────────
export async function sbFetchAgencyWinStats(){
  try{const res=await fetch(SB_URL+"/rest/v1/agency_win_stats?select=*&order=theoretical_win_rate.desc",{headers:hdrsSel});if(!res.ok)return[];return await res.json()}catch(e){return[]}
}
export async function sbFetchAgencyPredictor(){
  try{const res=await fetch(SB_URL+"/rest/v1/agency_predictor?select=*",{headers:hdrsSel});if(!res.ok)return[];return await res.json()}catch(e){return[]}
}
