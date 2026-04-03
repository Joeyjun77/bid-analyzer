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
    updates.push({id:p.id,actual_adj_rate:actualAdj,actual_expected_price:match.xp,actual_bid_amount:match.bp,actual_winner:match.co,actual_participant_count:match.pc,adj_rate_error:adjErr,bid_amount_error:bidErr,match_status:"matched",matched_record_id:match.id,matched_at:new Date().toISOString()})
  }
  for(const u of updates){
    const{id,...data}=u;
    await fetch(SB_URL+"/rest/v1/bid_predictions?id=eq."+id,{method:"PATCH",headers:{...hdrs,"Prefer":"return=minimal"},body:JSON.stringify(data)})
  }
  return updates.length}

// ─── bid_details CRUD ────────────────────────────────────
export async function sbSaveDetail(detail){
  const body=sanitizeJson(JSON.stringify(detail));
  const res=await fetch(SB_URL+"/rest/v1/bid_details?on_conflict=pn_no",{method:"POST",headers:{...hdrs,"Prefer":"resolution=merge-duplicates,return=minimal"},body});
  return res.ok}
export async function sbFetchDetails(){
  try{const PAGE=1000;let all=[],offset=0;while(true){const res=await fetch(SB_URL+"/rest/v1/bid_details?select=*&order=od.desc&offset="+offset+"&limit="+PAGE,{headers:hdrsSel});if(!res.ok)return all;const rows=await res.json();if(!Array.isArray(rows))return all;all=all.concat(rows);if(rows.length<PAGE)break;offset+=PAGE}return all}catch(e){return[]}}
export async function sbFetchDetailsByAg(ag){
  try{const res=await fetch(SB_URL+"/rest/v1/bid_details?ag=eq."+encodeURIComponent(ag)+"&select=*&order=od.desc&limit=1000",{headers:hdrsSel});if(!res.ok)return[];return await res.json()}catch(e){return[]}}
