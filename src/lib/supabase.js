import { SB_URL, getHdrs, getHdrsSel } from "./constants.js";
import { sanitizeJson } from "./utils.js";
import { authedFetch } from "../auth.js";

// ─── Supabase CRUD ─────────────────────────────────────────
export async function sbFetchAll(){const PAGE=1000;let all=[],offset=0;while(true){const res=await fetch(SB_URL+"/rest/v1/bid_records?select=*&order=od.desc&offset="+offset+"&limit="+PAGE,{headers:getHdrsSel()});const rows=await res.json();if(!Array.isArray(rows))break;all=all.concat(rows);if(rows.length<PAGE)break;offset+=PAGE}return all}
export async function sbUpsert(rows){const BATCH=200;for(let i=0;i<rows.length;i+=BATCH){const batch=rows.slice(i,i+BATCH);const seen=new Set(),unique=[];for(const r of batch){if(!seen.has(r.dedup_key)){seen.add(r.dedup_key);unique.push(r)}}const body=sanitizeJson(JSON.stringify(unique));const res=await fetch(SB_URL+"/rest/v1/bid_records?on_conflict=dedup_key",{method:"POST",headers:{...getHdrs(),"Prefer":"resolution=merge-duplicates,return=minimal"},body});if(!res.ok)throw new Error(`Upsert: ${res.status}`)}}
export async function sbDeleteIds(ids){const BATCH=50;for(let i=0;i<ids.length;i+=BATCH){await fetch(SB_URL+"/rest/v1/bid_records?id=in.("+ids.slice(i,i+BATCH).join(",")+")",{method:"DELETE",headers:getHdrs()})}}
export async function sbDeleteAll(){await fetch(SB_URL+"/rest/v1/bid_records?id=gt.0",{method:"DELETE",headers:getHdrs()})}

// 예측 DB
export async function sbSavePredictions(preds){const BATCH=50;for(let i=0;i<preds.length;i+=BATCH){const batch=preds.slice(i,i+BATCH);const seen=new Set(),unique=[];for(const r of batch){if(!seen.has(r.dedup_key)){seen.add(r.dedup_key);unique.push(r)}}const body=sanitizeJson(JSON.stringify(unique));await fetch(SB_URL+"/rest/v1/bid_predictions?on_conflict=dedup_key",{method:"POST",headers:{...getHdrs(),"Prefer":"resolution=merge-duplicates,return=minimal"},body})}}
export async function sbFetchPredictions(){try{const PAGE=1000;let all=[],offset=0;while(true){const res=await fetch(SB_URL+"/rest/v1/bid_predictions?select=*&order=created_at.desc&offset="+offset+"&limit="+PAGE,{headers:getHdrsSel()});if(!res.ok)return[];const rows=await res.json();if(!Array.isArray(rows))return all;all=all.concat(rows);if(rows.length<PAGE)break;offset+=PAGE}return all}catch(e){return[]}}

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
  const usedRecIds=new Set(predictions.filter(p=>p.match_status==="matched"&&p.matched_record_id).map(p=>p.matched_record_id));
  const updates=[];
  for(const p of predictions){
    if(p.match_status==="matched")continue;
    if(!p.pn_no)continue;
    // 1순위: 정확 pn_no 매칭
    let candidates=recMap[p.pn_no];
    // 2순위: prefix 매칭 (bid_predictions에만 접미사 있는 경우)
    if(!candidates||!candidates.length){
      const pPfx=stripSfx(p.pn_no);
      if(pPfx.length>5&&pPfx!==p.pn_no)candidates=prefixMap[pPfx]||recMap[pPfx];
    }
    if(!candidates||!candidates.length)continue;
    // prefix fallback 케이스에서는 ag 검증 필수 (오매칭 방지)
    const isPfxFallback=!recMap[p.pn_no]||!recMap[p.pn_no].length;
    let match=null;
    if(p.open_date){
      // 예측 개찰일과 가장 가까운 낙찰 건 선택 (이미 사용된 record 제외)
      const pOd=p.open_date;
      let bestDist=Infinity;
      for(const c of candidates){
        if(!c.od)continue;
        if(usedRecIds.has(c.id))continue; // ★ 중복 방지
        // prefix fallback일 때 ag 일치 검증 (발주기관 첫 4자 이상 공통)
        if(isPfxFallback&&p.ag&&c.ag){
          const p4=p.ag.replace(/\s/g,'').slice(0,4),c4=c.ag.replace(/\s/g,'').slice(0,4);
          if(p4&&c4&&!p.ag.includes(c4)&&!c.ag.includes(p4))continue;
        }
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
    // br1 우선, 없으면 ar1 폴백 (수의계약 등 br1만 누락된 케이스 대응)
    const rawRate=match.br1!=null?match.br1:(match.ar1!=null?match.ar1:null);
    const actualAdj=rawRate!=null?Math.round((rawRate-100)*10000)/10000:null;
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
    await fetch(SB_URL+"/rest/v1/bid_predictions?id=eq."+id,{method:"PATCH",headers:{...getHdrs(),"Prefer":"return=minimal"},body:JSON.stringify(data)})
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
        {method:"DELETE",headers:getHdrs()});
      await fetch(SB_URL+"/rest/v1/ag_assumed_stats",
        {method:"POST",headers:{...getHdrs(),"Prefer":"return=minimal"},body})
    }
  }
}

// ─── bid_predictions 삭제 ──────────────────────────────────
export async function sbDeletePredictions(ids){const BATCH=50;for(let i=0;i<ids.length;i+=BATCH){await fetch(SB_URL+"/rest/v1/bid_predictions?id=in.("+ids.slice(i,i+BATCH).join(",")+")",{method:"DELETE",headers:getHdrs()})}}

// ─── v7 Phase a-R2: prediction_snapshot / strategy_log 수집 훅 ──────
// 예측 저장 직후 각 pred_id에 대해 v7 snapshot 일괄 기록 (UPSERT). 실패는 경고만.
export async function sbRecordSnapshots(predIds,modelVersion="v7.0"){
  if(!Array.isArray(predIds)||!predIds.length)return 0;
  const BATCH=10;let ok=0;
  for(let i=0;i<predIds.length;i+=BATCH){
    const chunk=predIds.slice(i,i+BATCH);
    const results=await Promise.allSettled(chunk.map(id=>
      fetch(SB_URL+"/rest/v1/rpc/record_prediction_snapshot",{
        method:"POST",
        headers:{...getHdrs(),"Content-Type":"application/json"},
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
  const res=await fetch(SB_URL+"/rest/v1/strategy_log",{
    method:"POST",
    headers:{...getHdrs(),"Prefer":"return=representation"},
    body
  });
  if(!res.ok)throw new Error("strategy_log insert: HTTP "+res.status);
  const rows=await res.json();
  return Array.isArray(rows)?rows[0]:rows;
}
// 기존 strategy_log에 낙찰 결과(actual_adj/would_have_won/regret) 백필
export async function sbUpdateStrategyOutcomes(since=null){
  const payload=since?{p_pred_id:null,p_since:since}:{p_pred_id:null,p_since:null};
  const res=await fetch(SB_URL+"/rest/v1/rpc/update_strategy_log_outcomes",{
    method:"POST",
    headers:{...getHdrs(),"Content-Type":"application/json"},
    body:JSON.stringify(payload)
  });
  if(!res.ok)throw new Error("update_strategy_log_outcomes: HTTP "+res.status);
  return await res.json();
}
// 특정 예측의 기존 strategy_log rows 조회 (사용자 확정만; 백테스트 데이터 제외)
export async function sbFetchStrategyLog(predIds){
  if(!Array.isArray(predIds)||!predIds.length)return[];
  try{
    const res=await fetch(SB_URL+"/rest/v1/strategy_log?select=id,pred_id,strategy_type,created_at,source&pred_id=in.("+predIds.join(",")+")&source=eq.user",{headers:getHdrsSel()});
    if(!res.ok)return[];
    return await res.json();
  }catch(e){return[]}
}
// Phase v7-ops-2: 전략별 Pwin 캘리브레이션 현황 (sample_n, actual_rate, fallback 여부)
export async function sbFetchPwinCalibration(){
  try{
    const res=await fetch(SB_URL+"/rest/v1/pwin_calibration_by_strategy?select=strategy_type,sample_n,actual_rate,use_fallback,updated_at",{headers:getHdrsSel()});
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
    const res=await fetch(SB_URL+"/rest/v1/prediction_quality_daily?select=measured_on,model_version,route,at,n,mae,hit_0_5_pct,hit_0_3_pct,floor_safe_pct,direction_pct&measured_on=gte."+since+"&order=measured_on.desc",{headers:getHdrsSel()});
    if(!res.ok)return[];
    return await res.json();
  }catch(e){return[]}
}
export async function sbFetchWeeklyQuality(limit=20){
  try{
    const res=await fetch(SB_URL+"/rest/v1/weekly_quality_report?select=report_week,scope,dimension_value,n_week,mae_week,mae_delta,drift_flag,gate_status&order=report_week.desc&limit="+limit,{headers:getHdrsSel()});
    if(!res.ok)return[];
    return await res.json();
  }catch(e){return[]}
}
export async function sbFetchBiasHotspots(minN=10,limit=30){
  try{
    const res=await fetch(SB_URL+"/rest/v1/pred_bias_map?select=grain,key1,key2,n,bias&n=gte."+minN+"&order=bias.desc&limit="+limit,{headers:getHdrsSel()});
    if(!res.ok)return[];
    const rows=await res.json();
    if(!Array.isArray(rows))return[];
    return rows.sort((a,b)=>Math.abs(Number(b.bias))-Math.abs(Number(a.bias)));
  }catch(e){return[]}
}
export async function sbFetchWatchlist(){
  try{
    const res=await fetch(SB_URL+"/rest/v1/watchlist_segments?select=*",{headers:getHdrsSel()});
    if(!res.ok)return[];
    const rows=await res.json();
    if(!Array.isArray(rows))return[];
    return rows;
  }catch(e){return[]}
}
export async function sbFetchWatchlistHistory(days=14){
  try{
    const since=new Date(Date.now()-days*86400000).toISOString().slice(0,10);
    const res=await fetch(SB_URL+"/rest/v1/watchlist_snapshots?select=snapshot_date,at,tier,n_total,mae_total,bias_total,mae_drift,bias_drift,grade&snapshot_date=gte."+since+"&order=snapshot_date.desc,at.asc,tier.asc",{headers:getHdrsSel()});
    if(!res.ok)return[];
    const rows=await res.json();
    if(!Array.isArray(rows))return[];
    return rows;
  }catch(e){return[]}
}

// ─── bid_details CRUD ────────────────────────────────────
export async function sbSaveDetail(detail){
  const body=sanitizeJson(JSON.stringify(detail));
  const res=await fetch(SB_URL+"/rest/v1/bid_details?on_conflict=pn_no",{method:"POST",headers:{...getHdrs(),"Prefer":"resolution=merge-duplicates,return=minimal"},body});
  return res.ok}
export async function sbFetchDetails(){
  try{const PAGE=1000;let all=[],offset=0;while(true){const res=await fetch(SB_URL+"/rest/v1/bid_details?select=*&order=od.desc&offset="+offset+"&limit="+PAGE,{headers:getHdrsSel()});if(!res.ok)return all;const rows=await res.json();if(!Array.isArray(rows))return all;all=all.concat(rows);if(rows.length<PAGE)break;offset+=PAGE}return all}catch(e){return[]}}
export async function sbFetchDetailsByAg(ag){
  try{const res=await fetch(SB_URL+"/rest/v1/bid_details?ag=eq."+encodeURIComponent(ag)+"&select=*&order=od.desc&limit=1000",{headers:getHdrsSel()});if(!res.ok)return[];return await res.json()}catch(e){return[]}}

// ─── Phase 4-C: 관리자 페이지 — auth.users 읽기 전용 조회 ──────
export async function sbAdminListUsers(){
  const res=await authedFetch("/rest/v1/rpc/admin_list_users",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
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
    const res=await fetch(SB_URL+"/rest/v1/floor_margin_benchmark?select=at,floor_rate,n,med_margin,std_margin&limit=500",{headers:getHdrsSel()});
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
    const res=await fetch(SB_URL+"/rest/v1/pred_bias_map?select=grain,key1,key2,n,bias&limit=2000",{headers:getHdrsSel()});
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

// ─── Phase 23-3: 한전·고양시 (canonical_ag, at, ba_seg) median fine-tune 맵 ──
// pred_baseg_finetune VIEW에서 (ag|at|seg) → median lookup, 50:50 블렌드용
export async function sbFetchBasegFinetune(){
  try{
    const res=await fetch(SB_URL+"/rest/v1/pred_baseg_finetune?select=canonical_ag,at,ba_seg,n,ba_seg_median&limit=500",{headers:getHdrsSel()});
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
  try{const res=await fetch(SB_URL+"/rest/v1/ag_assumed_stats?select=ag,at,seg,n,p25,p50,p75&order=n.desc&limit=1000",{headers:getHdrsSel()});if(!res.ok)return{};const rows=await res.json();const map={};for(const r of rows){const k=r.ag+"|"+r.seg;map[k]={at:r.at,n:Number(r.n),p25:Number(r.p25),p50:Number(r.p50),p75:Number(r.p75)}}return map}catch(e){return{}}}

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
  try{const res=await fetch(SB_URL+"/rest/v1/target_matrix?select=*&order=priority_tier.asc",{headers:getHdrsSel()});if(!res.ok)return[];return await res.json()}catch(e){return[]}
}
export async function sbFetchSweetSpotAgencies(){
  try{const res=await fetch(SB_URL+"/rest/v1/sweet_spot_agencies?select=*&order=sweet_spot_count.desc",{headers:getHdrsSel()});if(!res.ok)return[];return await res.json()}catch(e){return[]}
}
// ─── Phase 12-C: 발주사별 낙찰 예측 ────────────────────────
export async function sbFetchAgencyWinStats(){
  try{const res=await fetch(SB_URL+"/rest/v1/agency_win_stats?select=*&order=theoretical_win_rate.desc",{headers:getHdrsSel()});if(!res.ok)return[];return await res.json()}catch(e){return[]}
}
export async function sbFetchAgencyPredictor(){
  try{const res=await fetch(SB_URL+"/rest/v1/agency_predictor?select=*",{headers:getHdrsSel()});if(!res.ok)return[];return await res.json()}catch(e){return[]}
}
// Phase 14-3: 분산 투찰 시뮬레이터
export async function sbFetchSimulator(){
  try{const res=await fetch(SB_URL+"/rest/v1/v_simulator_api?select=*",{headers:getHdrsSel()});if(!res.ok)return[];return await res.json()}catch(e){return[]}
}
// 나라장터 공고 목록 (bid_notices)
export async function sbFetchNotices(){
  try{const res=await fetch(SB_URL+"/rest/v1/bid_notices?select=id,pn,pn_no,ag,at,ep,ba,av,od,status,is_target,prediction_id,api_fetched_at&order=od.asc&limit=1000",{headers:getHdrsSel()});if(!res.ok)return[];return await res.json()}catch(e){return[]}
}
// 단건 공고 예측 등록 (predict_notice DB 함수 호출)
export async function sbPredictNotice(noticeId){
  try{const res=await fetch(SB_URL+"/rest/v1/rpc/predict_notice",{method:"POST",headers:{...getHdrs(),"Prefer":"return=representation"},body:JSON.stringify({p_notice_id:noticeId})});if(!res.ok)return null;const rows=await res.json();return rows[0]||null}catch(e){return null}
}
