import React, { useState, useCallback, useMemo, useEffect } from "react";
import * as XLSX from "xlsx";
import { C, PAGE, inpS } from "./lib/constants.js";
import { clsAg, clean, tc, tn, pDt, mSch, md5, parseFile, toRecord, toRecords, parseBidDoc, calcStats, predictV5, calcDataStatus, isSucviewFile, parseSucview, simDraws, pnv, sn, eraFR, isNewEra, sanitizeJson } from "./lib/utils.js";
import { sbFetchAll, sbUpsert, sbDeleteIds, sbDeleteAll, sbSavePredictions, sbFetchPredictions, sbMatchPredictions, sbSaveDetail, sbFetchDetails, sbFetchDetailsByAg } from "./lib/supabase.js";

// ─── 컴포넌트 ──────────────────────────────────────────────
function NI({value,onChange}){return<input value={value==="0"?"0":tc(value)} onChange={e=>{const r=e.target.value.replace(/,/g,"").replace(/[^0-9]/g,"");onChange(r===""?"0":r)}} style={{...inpS,textAlign:"right",fontFamily:"monospace"}}/>}

// 발주기관 자동완성 드롭다운 (초성 검색 지원)
function AgencyInput({value,onChange,agencies,placeholder,stats}){
  const[open,setOpen]=useState(false);
  const[focus,setFocus]=useState(false);
  const ref=useCallback(node=>{if(node){const handler=e=>{if(!node.contains(e.target))setOpen(false)};document.addEventListener("mousedown",handler);return()=>document.removeEventListener("mousedown",handler)}},[]);
  const filtered=useMemo(()=>{
    if(!value||!value.trim())return agencies.slice(0,30);
    return agencies.filter(a=>mSch(a,value.trim())).slice(0,30)},[value,agencies]);
  const statMap=useMemo(()=>{if(!stats)return{};const m={};Object.entries(stats).forEach(([k,v])=>{m[k]=v});return m},[stats]);
  return<div ref={ref} style={{position:"relative"}}>
    <input value={value} onChange={e=>{onChange(e.target.value);setOpen(true)}} onFocus={()=>{setOpen(true);setFocus(true)}} onBlur={()=>setFocus(false)}
      placeholder={placeholder||"발주기관 검색 (초성 가능: ㅅㅇㄱㅌ)"} style={inpS}/>
    {open&&filtered.length>0&&<div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:50,background:"#12122a",border:"1px solid #353550",borderRadius:6,maxHeight:240,overflowY:"auto",marginTop:2,boxShadow:"0 4px 16px rgba(0,0,0,0.4)"}}>
      {filtered.map((a,i)=>{
        const st=statMap[a];
        return<div key={a} style={{padding:"8px 12px",cursor:"pointer",borderBottom:"1px solid #1a1a30",fontSize:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}
          onMouseDown={e=>{e.preventDefault();onChange(a);setOpen(false)}}>
          <div style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{a}</div>
          {st&&<div style={{flexShrink:0,marginLeft:8,display:"flex",gap:8,fontSize:10,color:C.txd}}>
            <span>{st.n}건</span>
            <span style={{color:"#5dca96"}}>{(100+st.avg).toFixed(2)}%</span>
          </div>}
        </div>})}
      {filtered.length===0&&<div style={{padding:"10px 12px",color:C.txd,fontSize:12}}>검색 결과 없음</div>}
    </div>}
  </div>}


// ═══════════════════════════════════════════════════════════
export default function App(){
  const[tab,setTab]=useState("dash");
  const[recs,setRecs]=useState([]);
  const[allS,setAllS]=useState({ts:{},as:{}});const[newS,setNewS]=useState({ts:{},as:{}});const[oldS,setOldS]=useState({ts:{},as:{}});
  const[drag,setDrag]=useState(false);const[dragPred,setDragPred]=useState(false);const[busy,setBusy]=useState(false);const[msg,setMsg]=useState({type:"",text:""});
  const[uploadLog,setUploadLog]=useState([]);const[dataStatus,setDataStatus]=useState(null);
  const[inp,setInp]=useState({agency:"",baseAmount:"0",estimatedPrice:"0",aValue:"0"});const[pred,setPred]=useState(null);
  const[search,setSearch]=useState("");const[agSch,setAgSch]=useState("");const[eF,setEF]=useState("all");const[atF,setAtF]=useState("all");
  const[sel,setSel]=useState({});const[dlgType,setDlgType]=useState("");const[dataPage,setDataPage]=useState(0);const[dbLoading,setDbLoading]=useState(true);
  const[hideAbnormal,setHideAbnormal]=useState(false); // D-1: 비정상 데이터 필터
  const[predResults,setPredResults]=useState([]);
  const[predictions,setPredictions]=useState([]);
  const[compFilter,setCompFilter]=useState("all");
  const[bidDetails,setBidDetails]=useState([]);
  const[simResult,setSimResult]=useState(null);
  const[expandedDetail,setExpandedDetail]=useState(null);
  const[simSlider,setSimSlider]=useState(0); // Phase 3: 투찰 시뮬레이터 사정률 슬라이더
  const[aiAdvice,setAiAdvice]=useState("");const[aiLoading,setAiLoading]=useState(false); // Phase 4-A: AI 어드바이저
  const[batchAi,setBatchAi]=useState({});const[batchAiLoading,setBatchAiLoading]=useState(null);const[expandedBatch,setExpandedBatch]=useState(null); // 일괄 AI
  // AI 프롬프트 생성 (공통)
  const buildAiPrompt=(r)=>{
    const p=r.pred;if(!p)return null;
    const agType=r.at||clsAg(r.ag);const agName=r.ag||"";
    const curStat=allS.as?.[agName];const typeStat=allS.ts?.[agType];
    const agDets=bidDetails.filter(d=>d.ag===agName);
    return`당신은 한국 공공조달 입찰 전문가 AI입니다. 다음 입찰건에 대해 맞춤형 투찰 전략을 200자 이내로 간결하게 조언해주세요.

■ 입찰 정보
- 공고명: ${(r.pn||"").slice(0,50)}
- 발주기관: ${agName} (${agType})
- 기초금액: ${r.ba?Number(r.ba).toLocaleString():"미입력"}원
- 추정가격: ${r.ep?Number(r.ep).toLocaleString():"미입력"}원
- A값: ${r.av?Number(r.av).toLocaleString()+"원":"없음"}
- 적용 낙찰하한율: ${p.fr}%

■ 예측 결과
- 예측 사정율: ${p.adj>=0?"+":""}${p.adj}% (중앙값)
- 신뢰구간 70%: ${p.ci70?p.ci70.low+"% ~ "+p.ci70.high+"%":"N/A"}
- 추천 투찰금액: ${p.bid?p.bid.toLocaleString()+"원":"N/A"}
- 예상 투찰율: ${p.xp>0?(p.bid/p.xp*100).toFixed(3)+"%":"N/A"}
- 근거: ${p.src}

■ 기관 통계 (${agType})
- 평균 사정률: ${typeStat?typeStat.avg.toFixed(4)+"%":"N/A"} (${typeStat?typeStat.n+"건":"N/A"})
- 표준편차: ${typeStat?typeStat.std.toFixed(4)+"%":"N/A"}
${curStat?`- 발주기관 개별: 평균 ${curStat.avg.toFixed(4)}%, ${curStat.n}건`:"- 발주기관 개별 데이터: 없음"}
${agDets.length>0?`- 복수예가 상세: ${agDets.length}건 보유`:""}

■ 핵심 제약
- 복수예비가격 C(15,4) 추첨의 노이즈 바닥 = 0.642%
- 1순위 업체의 낙찰하한율 대비 마진: 중앙값 0.004%

위 정보를 바탕으로:
1. 이 입찰건의 특성과 리스크를 한 줄로 요약
2. 추천 투찰 전략 (보수/균형/공격 중)과 그 이유
3. 투찰 시 유의사항 한 가지`};
  const callAi=async(prompt)=>{
    const res=await fetch("/api/ai",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:500,messages:[{role:"user",content:prompt}]})});
    if(!res.ok){const err=await res.json().catch(()=>({}));throw new Error(err.error?.message||err.error||`API ${res.status}`)}
    const data=await res.json();return data.content?.map(c=>c.text||"").join("")||"응답 없음"};
  // 정렬 상태
  const[dataSort,setDataSort]=useState({key:"od",dir:"desc"}); // 분석 탭 데이터
  const[predSort,setPredSort]=useState({key:"open_date",dir:"desc"}); // 예측 탭 내역

  const refreshStats=useCallback(rows=>{setAllS(calcStats(rows));setNewS(calcStats(rows,r=>r.era==="new"));setOldS(calcStats(rows,r=>r.era==="old"))},[]);

  // 예측 리스트 새로고침 (수동 + 탭 전환 시)
  const refreshPredictions=useCallback(async()=>{
    try{const preds=await sbFetchPredictions();setPredictions(preds||[]);return preds}catch(e){return predictions}},[predictions]);
  // ★ 전체 데이터 새로고침 (새로고침 버튼용)
  const refreshAll=useCallback(async()=>{
    try{const[rows,preds,dets]=await Promise.all([sbFetchAll(),sbFetchPredictions(),sbFetchDetails()]);
      setRecs(rows);refreshStats(rows);setDataStatus(calcDataStatus(rows));
      setPredictions(preds||[]);setBidDetails(dets||[]);
      // 자동 매칭 시도
      const matched=await sbMatchPredictions(preds,rows);
      if(matched>0){const updPreds=await sbFetchPredictions();setPredictions(updPreds)}
      return{records:rows.length,predictions:(preds||[]).length,details:(dets||[]).length,matched}
    }catch(e){return null}},[refreshStats]);

  // DB 로드
  useEffect(()=>{(async()=>{
    try{const rows=await sbFetchAll();setRecs(rows);refreshStats(rows);setDataStatus(calcDataStatus(rows));if(rows.length>0)setTab("dash")}catch(e){setMsg({type:"err",text:"DB 로드 실패: "+e.message})}
    try{const preds=await sbFetchPredictions();setPredictions(preds||[])}catch(e){setPredictions([])}
    try{const dets=await sbFetchDetails();setBidDetails(dets||[])}catch(e){setBidDetails([])}
    setDbLoading(false)
  })()},[refreshStats]);

  // 예측 탭 진입 시 자동 새로고침
  useEffect(()=>{if(tab==="predict"&&!dbLoading){refreshPredictions()}},[tab,dbLoading]);

  // 파일 업로드 (3종 자동 판별: SUCVIEW / 입찰서류함 / 낙찰정보리스트)
  const loadFiles=useCallback(async(fileList)=>{
    const files=Array.from(fileList).filter(Boolean);if(!files.length)return;setBusy(true);setMsg({type:"",text:""});setUploadLog([]);const logs=[];
    let accPredResults=[]; // ★ 여러 파일 예측 누적
    for(const file of files){
      try{
        const{rows:raw,format}=await parseFile(file);if(!raw.length)throw new Error("빈 파일");
        // 1) SUCVIEW 상세 파일
        if(isSucviewFile(raw)){
          const detail=parseSucview(raw,file.name);if(!detail.pn_no)throw new Error("공고번호 없음");
          await sbSaveDetail(detail);const sim=simDraws(detail.pre_rates);setSimResult(sim);
          logs.push({name:file.name,type:"ok",text:`[상세] ${detail.ag} | 예가15개 + 참여${detail.participant_count}건`});
          setUploadLog([...logs]);continue}
        // 2) 입찰서류함 (기초금액/추정가격 컬럼이 있는 경우) → 예측으로 처리
        const hdr0=(raw[0]||[]).map(v=>String(v).trim());const hdr1=(raw[1]||[]).map(v=>String(v).trim());
        const allHdr=[...hdr0,...hdr1].join("|");
        const isBidDoc=allHdr.includes("기초금액")&&allHdr.includes("공고명")&&(allHdr.includes("추정가격")||allHdr.includes("A값"));
        const isNakList=hdr0.some(v=>v.includes("공고명"))&&(hdr0.some(v=>v.includes("낙찰"))||hdr0.some(v=>v.includes("1순위"))||hdr0.length>=15);
        if(isBidDoc&&!isNakList){
          // 입찰서류함 → 예측 처리
          if(!Object.keys(allS.ts||{}).length){throw new Error("낙찰 통계가 로드되지 않았습니다. 낙찰정보리스트를 먼저 업로드해주세요.")}
          const items=parseBidDoc(raw);if(!items.length)throw new Error("입찰서류함: 예측 대상 0건");
          const results=items.map(item=>{const p=predictV5({at:item.at,agName:item.ag,ba:item.ba,ep:item.ep,av:item.av},allS.ts,allS.as,bidDetails);return{...item,pred:p}}).filter(r=>r.pred);
          if(!results.length)throw new Error("예측 결과 0건");
          accPredResults=accPredResults.concat(results);setPredResults([...accPredResults]); // ★ 누적 표시
          const dbRows=results.map(r=>({dedup_key:r.dedup_key,pn:r.pn,pn_no:r.pn_no,ag:r.ag,at:r.at,ep:r.ep,ba:r.ba,av:r.av,raw_cost:r.raw_cost,cat:r.cat,open_date:r.open_date,pred_adj_rate:r.pred.adj,pred_expected_price:r.pred.xp,pred_floor_rate:r.pred.fr,pred_bid_amount:r.pred.bid,pred_source:r.pred.src,pred_base_adj:r.pred.baseAdj,source:"file_upload",match_status:"pending"}));
          await sbSavePredictions(dbRows);
          logs.push({name:file.name,type:"ok",text:`[예측] ${results.length}건 예측 완료`});
          setUploadLog([...logs]);continue}
        // 3) 낙찰정보리스트
        if(!hdr0.some(v=>v.includes("공고명")))throw new Error("지원하지 않는 파일 형식");
        const nr=toRecords(raw.slice(1));await sbUpsert(nr);
        const nc=nr.filter(r=>r.era==="new").length,oc=nr.filter(r=>r.era==="old").length;
        logs.push({name:file.name,type:"ok",text:`[${format}] ${nr.length}건 | 신${nc}·구${oc}`});setUploadLog([...logs])
      }catch(e){logs.push({name:file.name,type:"err",text:e.message});setUploadLog([...logs])}}
    try{const[rows,preds,dets]=await Promise.all([sbFetchAll(),sbFetchPredictions(),sbFetchDetails()]);
      setRecs(rows);refreshStats(rows);setDataStatus(calcDataStatus(rows));setBidDetails(dets||[]);
      const matched=await sbMatchPredictions(preds,rows);
      if(matched>0){const updPreds=await sbFetchPredictions();setPredictions(updPreds);setMsg({type:"ok",text:`업로드 완료 · ${matched}건 예측 자동 매칭`})}
      else{setPredictions(preds);if(!logs.some(l=>l.type==="err"))setMsg({type:"ok",text:"업로드 완료"})}
    }catch(e){setMsg({type:"err",text:"DB 재로드 실패"})}
    setSel({});setBusy(false)},[refreshStats,allS,bidDetails]);

  // 입찰서류함 예측 (복수 파일 지원)
  const loadPredFiles=useCallback(async(fileList)=>{
    if(!fileList||!fileList.length)return;
    if(!Object.keys(allS.ts||{}).length){setMsg({type:"err",text:"낙찰 데이터를 먼저 로드해주세요 (통계 없음)"});return}
    setBusy(true);setMsg({type:"",text:""});
    let totalResults=[];let successCount=0;let failCount=0;const logs=[];
    for(const file of Array.from(fileList)){
      try{const{rows}=await parseFile(file);const items=parseBidDoc(rows);if(!items.length){logs.push({name:file.name,ok:false,msg:"예측 대상 0건"});failCount++;continue}
        const results=items.map(item=>{const p=predictV5({at:item.at,agName:item.ag,ba:item.ba,ep:item.ep,av:item.av},allS.ts,allS.as,bidDetails);return{...item,pred:p}}).filter(r=>r.pred);
        if(!results.length){logs.push({name:file.name,ok:false,msg:"예측 결과 0건"});failCount++;continue}
        totalResults=totalResults.concat(results);
        logs.push({name:file.name,ok:true,msg:`${results.length}건 예측`});successCount++;
      }catch(e){logs.push({name:file.name,ok:false,msg:e.message});failCount++}}
    if(totalResults.length>0){
      setPredResults(prev=>{const dkSet=new Set(totalResults.map(r=>r.dedup_key));const kept=prev.filter(p=>!dkSet.has(p.dedup_key));return[...kept,...totalResults]});
      const dbRows=totalResults.map(r=>({dedup_key:r.dedup_key,pn:r.pn,pn_no:r.pn_no,ag:r.ag,at:r.at,ep:r.ep,ba:r.ba,av:r.av,raw_cost:r.raw_cost,cat:r.cat,open_date:r.open_date,pred_adj_rate:r.pred.adj,pred_expected_price:r.pred.xp,pred_floor_rate:r.pred.fr,pred_bid_amount:r.pred.bid,pred_source:r.pred.src,pred_base_adj:r.pred.baseAdj,source:"file_upload",match_status:"pending"}));
      await sbSavePredictions(dbRows);const preds=await sbFetchPredictions();setPredictions(preds)}
    const summary=fileList.length===1?logs[0]?.ok?`${totalResults.length}건 예측 완료 · DB 저장`:logs[0]?.msg
      :`${fileList.length}개 파일 처리: 성공 ${successCount} · 실패 ${failCount} · 총 ${totalResults.length}건 예측`;
    setMsg({type:failCount>0&&successCount===0?"err":"ok",text:summary});setBusy(false)},[allS,bidDetails]);

  // 수동 예측
  const doManualPred=useCallback(async()=>{
    if(!Object.keys(allS.ts||{}).length){setMsg({type:"err",text:"낙찰 데이터가 없습니다. 먼저 데이터를 업로드해주세요."});return}
    const p=predictV5({at:clsAg(inp.agency),agName:inp.agency.trim(),ba:tn(inp.baseAmount),ep:tn(inp.estimatedPrice),av:tn(inp.aValue)},allS.ts,allS.as,bidDetails);
    if(!p){setMsg({type:"err",text:"예측 실패: 기관 또는 금액 정보를 확인해주세요."});return}
    setPred(p);if(p)setSimSlider(Math.round(p.adj*100));
    if(p){const dk=md5("pred|manual|"+inp.agency+"|"+inp.baseAmount+"|"+Date.now());
      const row={dedup_key:dk,pn:"수동입력: "+inp.agency,pn_no:null,ag:inp.agency.trim(),at:clsAg(inp.agency),ep:tn(inp.estimatedPrice)||null,ba:tn(inp.baseAmount),av:tn(inp.aValue),raw_cost:null,cat:null,open_date:null,pred_adj_rate:p.adj,pred_expected_price:p.xp,pred_floor_rate:p.fr,pred_bid_amount:p.bid,pred_source:p.src,pred_base_adj:p.baseAdj,source:"manual",match_status:"pending"};
      try{await sbSavePredictions([row]);const preds=await sbFetchPredictions();setPredictions(preds)}catch(e){/* silent */}}},[inp,allS]);

  // 삭제
  const selCount=Object.keys(sel).filter(k=>sel[k]).length;
  const[delConfirm,setDelConfirm]=useState("");
  const doDelete=useCallback(async()=>{
    if(dlgType==="all"&&delConfirm!=="삭제")return;
    setBusy(true);try{if(dlgType==="all"){await sbDeleteAll();setRecs([]);refreshStats([]);setDataStatus(null);setMsg({type:"ok",text:"전체 삭제 완료"})}else if(dlgType==="sel"){const ids=Object.keys(sel).filter(k=>sel[k]).map(Number);await sbDeleteIds(ids);setRecs(prev=>{const next=prev.filter(r=>!sel[r.id]);refreshStats(next);setDataStatus(calcDataStatus(next));return next});setMsg({type:"ok",text:`${ids.length}건 삭제`});setSel({})}}catch(e){setMsg({type:"err",text:"삭제 실패"})}setDlgType("");setDelConfirm("");setBusy(false)},[dlgType,sel,refreshStats,delConfirm]);

  // 파생 데이터
  const curSt=eF==="new"?newS:eF==="old"?oldS:allS;
  // 범용 정렬 함수
  const sortFn=(a,b,key,dir)=>{
    let va=a[key],vb=b[key];
    if(va==null)va="";if(vb==null)vb="";
    if(typeof va==="string"&&typeof vb==="string"){const cmp=va.localeCompare(vb,"ko");return dir==="asc"?cmp:-cmp}
    if(typeof va==="number"&&typeof vb==="number")return dir==="asc"?va-vb:vb-va;
    const sa=String(va),sb=String(vb);const cmp=sa.localeCompare(sb,"ko");return dir==="asc"?cmp:-cmp};
  const filteredRecs=useMemo(()=>{const t=search.toLowerCase();let src=recs;
    if(eF==="new")src=recs.filter(r=>r.era==="new");else if(eF==="old")src=recs.filter(r=>r.era==="old");
    if(atF!=="all")src=src.filter(r=>r.at===atF);
    if(hideAbnormal)src=src.filter(r=>{const y=r.co==="유찰"||r.co==="유찰(무)";const b=!y&&(r.br1==null&&(r.ba==null||r.ba===0));const o=!y&&!b&&r.br1!=null&&(r.br1<95||r.br1>105);return!y&&!b&&!o});
    if(t)src=src.filter(r=>((r.pn||"")+(r.ag||"")+(r.co||"")).toLowerCase().includes(t));
    return[...src].sort((a,b)=>sortFn(a,b,dataSort.key,dataSort.dir))},[recs,search,eF,atF,dataSort,hideAbnormal]);
  const pagedRecs=useMemo(()=>filteredRecs.slice(dataPage*PAGE,(dataPage+1)*PAGE),[filteredRecs,dataPage]);
  const totalPages=Math.max(1,Math.ceil(filteredRecs.length/PAGE));
  const abnormalStats=useMemo(()=>{const y=recs.filter(r=>r.co==="유찰"||r.co==="유찰(무)").length;const b=recs.filter(r=>r.co!=="유찰"&&r.co!=="유찰(무)"&&r.br1==null&&(r.ba==null||r.ba===0)).length;const o=recs.filter(r=>r.br1!=null&&(r.br1<95||r.br1>105)).length;return{yuchal:y,broken:b,outlier:o,total:y+b+o}},[recs]);
  const fAg=useMemo(()=>{const t=agSch.toLowerCase();return Object.entries(curSt.as||{}).filter(([k])=>!t||mSch(k,t)).sort((a,b)=>b[1].n-a[1].n)},[curSt.as,agSch]);
  const agencyList=useMemo(()=>Object.keys(allS.as||{}).sort(),[allS.as]);
  const nC=recs.filter(r=>r.era==="new").length,oC=recs.filter(r=>r.era==="old").length;
  const allSel=pagedRecs.length>0&&pagedRecs.every(r=>sel[r.id]);

  const compStats=useMemo(()=>{
    const preds=predictions||[];const matched=preds.filter(p=>p.match_status==="matched");const pending=preds.filter(p=>p.match_status==="pending");
    const errors=matched.filter(p=>p.adj_rate_error!=null).map(p=>Number(p.adj_rate_error));
    const absErrors=errors.map(e=>Math.abs(e));
    const avgErr=absErrors.length?Math.round(absErrors.reduce((a,b)=>a+b,0)/absErrors.length*10000)/10000:0;
    const bias=errors.length?Math.round(errors.reduce((a,b)=>a+b,0)/errors.length*10000)/10000:0;
    const within05=absErrors.filter(e=>e<=0.5).length;
    const byType={};matched.forEach(p=>{const t=p.at||"기타";if(!byType[t])byType[t]={n:0,errSum:0};byType[t].n++;if(p.adj_rate_error!=null)byType[t].errSum+=Math.abs(p.adj_rate_error)});
    Object.values(byType).forEach(v=>{v.avgErr=v.n?Math.round(v.errSum/v.n*10000)/10000:0});
    return{total:preds.length,matched:matched.length,pending:pending.length,avgErr,bias,within05,byType}},[predictions]);
  const compList=useMemo(()=>{const p=predictions||[];let list;if(compFilter==="matched")list=p.filter(x=>x.match_status==="matched");else if(compFilter==="pending")list=p.filter(x=>x.match_status==="pending");else list=p;
    return[...list].sort((a,b)=>sortFn(a,b,predSort.key,predSort.dir))},[predictions,compFilter,predSort]);

  // 스타일
  const btnS=(act,c)=>({padding:"4px 12px",fontSize:11,fontWeight:act?600:400,background:act?c+"22":"#1a1a30",color:act?c:"#888",border:"1px solid "+(act?c+"44":"#252540"),borderRadius:5,cursor:"pointer"});
  const Tb=({id,ch,badge})=>(<button onClick={()=>{setTab(id);setDataPage(0)}} style={{padding:"10px 20px",fontSize:12,fontWeight:tab===id?600:400,background:tab===id?C.bg3:"transparent",color:tab===id?C.gold:C.txm,border:"none",borderBottom:tab===id?`2px solid ${C.gold}`:"2px solid transparent",cursor:"pointer",position:"relative"}}>{ch}{badge>0&&<span style={{position:"absolute",top:4,right:4,background:"#e24b4a",color:"#fff",fontSize:8,padding:"1px 5px",borderRadius:8,minWidth:14,textAlign:"center"}}>{badge}</span>}</button>);
  // 정렬 가능 헤더
  const SortTh=({label,sortKey,current,setCurrent,align,style:sx})=>{
    const active=current.key===sortKey;
    const arrow=active?(current.dir==="asc"?" ▲":" ▼"):"";
    return<th style={{padding:"8px 4px",textAlign:align||"left",color:active?C.gold:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:11,cursor:"pointer",userSelect:"none",...sx}}
      onClick={()=>{setCurrent(prev=>prev.key===sortKey?{key:sortKey,dir:prev.dir==="asc"?"desc":"asc"}:{key:sortKey,dir:"desc"});setDataPage(0)}}>{label}{arrow}</th>};

  // 시뮬레이션 인라인 뷰 컴포넌트
  const SimView=({sim})=>{
    if(!sim)return null;
    return<div style={{padding:"12px 14px",background:"rgba(168,180,255,0.05)",border:"1px solid rgba(168,180,255,0.15)",borderRadius:8,marginTop:8,fontSize:12}}>
      <div style={{fontWeight:600,color:"#a8b4ff",marginBottom:8}}>추첨 시뮬레이션 ({sim.total}가지)</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6,marginBottom:8}}>
        {[{l:"P10",v:sim.p10},{l:"P25",v:sim.p25},{l:"중앙값",v:sim.p50},{l:"P75",v:sim.p75},{l:"P90",v:sim.p90}].map((s,i)=>
          <div key={i} style={{background:C.bg3,borderRadius:6,padding:"6px",textAlign:"center"}}>
            <div style={{fontSize:10,color:C.txd}}>{s.l}</div>
            <div style={{fontSize:14,fontWeight:600,color:i===2?"#a8b4ff":C.txt}}>{(100+s.v).toFixed(4)}%</div>
          </div>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:8}}>
        <div style={{background:C.bg3,borderRadius:6,padding:"5px",textAlign:"center"}}><div style={{fontSize:10,color:C.txd}}>음수 확률</div><div style={{fontWeight:600,color:sim.negPct>50?"#e24b4a":"#5dca96"}}>{sim.negPct}%</div></div>
        <div style={{background:C.bg3,borderRadius:6,padding:"5px",textAlign:"center"}}><div style={{fontSize:10,color:C.txd}}>-0.5% 이하</div><div style={{fontWeight:600,color:sim.belowMinus05>30?"#e24b4a":"#d4a834"}}>{sim.belowMinus05}%</div></div>
        <div style={{background:C.bg3,borderRadius:6,padding:"5px",textAlign:"center"}}><div style={{fontSize:10,color:C.txd}}>-1.0% 이하</div><div style={{fontWeight:600,color:sim.belowMinus10>15?"#e24b4a":"#5dca96"}}>{sim.belowMinus10}%</div></div>
      </div>
      <div style={{display:"flex",alignItems:"flex-end",gap:2,height:50}}>
        {Object.entries(sim.hist).sort((a,b)=>parseFloat(a[0])-parseFloat(b[0])).map(([k,v])=>{
          const pct=v/sim.total*100;const h=Math.max(2,pct/25*50);
          return<div key={k} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
            <div style={{width:"100%",height:h,background:parseFloat(k)<0?"rgba(226,75,74,0.5)":"rgba(93,202,165,0.5)",borderRadius:"2px 2px 0 0"}}/>
            <div style={{fontSize:8,color:C.txd}}>{k}</div>
          </div>})}
      </div>
    </div>};

  return(<div style={{fontFamily:"system-ui,sans-serif",background:C.bg,color:C.txt,minHeight:"100vh",fontSize:13}}>
    {/* ★ 전체 로딩 오버레이 */}
    {dbLoading&&<div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:C.bg,zIndex:200,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12}}>
      <div style={{fontSize:18,fontWeight:700,color:C.gold}}>입찰 분석 시스템</div>
      <div style={{fontSize:13,color:C.txm}}>데이터 로딩 중...</div>
      <div style={{width:120,height:3,background:C.bg3,borderRadius:2,overflow:"hidden",marginTop:4}}><div style={{width:"60%",height:"100%",background:C.gold,borderRadius:2,animation:"pulse 1.5s infinite"}}></div></div>
      <style>{`@keyframes pulse{0%,100%{opacity:0.4;width:30%}50%{opacity:1;width:80%}}`}</style>
    </div>}
    {/* ★ 파일 처리 중 오버레이 */}
    {busy&&!dbLoading&&<div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(12,12,26,0.7)",zIndex:150,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,padding:"24px 32px",textAlign:"center"}}>
        <div style={{fontSize:14,color:C.gold,fontWeight:600,marginBottom:6}}>처리 중...</div>
        <div style={{fontSize:11,color:C.txm}}>파일 파싱 및 예측 진행 중</div>
      </div>
    </div>}
    {/* 삭제 다이얼로그 */}
    {dlgType&&<div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,.6)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>{setDlgType("");setDelConfirm("")}}><div onClick={e=>e.stopPropagation()} style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,padding:24,maxWidth:380,width:"90%"}}>
      <div style={{fontSize:14,fontWeight:600,color:"#e24b4a",marginBottom:8}}>{dlgType==="sel"?selCount+"건 삭제":"전체 삭제"}</div>
      <div style={{fontSize:12,color:C.txm,marginBottom:12}}>DB에서 영구 삭제됩니다. 복구할 수 없습니다.</div>
      {dlgType==="all"&&<div style={{marginBottom:12}}><div style={{fontSize:11,color:C.txd,marginBottom:4}}>확인: <span style={{color:"#e24b4a",fontWeight:600}}>"삭제"</span> 입력</div><input value={delConfirm} onChange={e=>setDelConfirm(e.target.value)} placeholder="삭제" style={{...inpS,borderColor:"#e24b4a44"}}/></div>}
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <button onClick={()=>{setDlgType("");setDelConfirm("")}} style={{padding:"7px 16px",background:C.bg3,border:"1px solid "+C.bdr,borderRadius:5,color:C.txt,fontSize:12,cursor:"pointer"}}>취소</button>
        <button onClick={doDelete} disabled={busy||(dlgType==="all"&&delConfirm!=="삭제")} style={{padding:"7px 16px",background:dlgType==="all"&&delConfirm!=="삭제"?"#555":"#e24b4a",border:"none",borderRadius:5,color:"#fff",fontSize:12,fontWeight:600,cursor:dlgType==="all"&&delConfirm!=="삭제"?"not-allowed":"pointer"}}>{busy?"처리중...":"삭제 실행"}</button>
      </div></div></div>}

    {/* 헤더 + 3탭 */}
    <div style={{padding:"10px 20px",borderBottom:"1px solid "+C.bdr,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <span style={{fontSize:16,fontWeight:700,color:C.gold}}>입찰 분석 시스템</span>
        <span style={{fontSize:10,color:C.txd}}>{recs.length.toLocaleString()}건 (신{nC}/구{oC})</span>
      </div>
      <div style={{display:"flex",gap:0}}><Tb id="dash" ch="대시보드"/><Tb id="analysis" ch="분석"/><Tb id="predict" ch="예측" badge={compStats.pending}/></div>
    </div>
    {msg.text&&<div style={{margin:"0 auto",maxWidth:1000,padding:"8px 16px"}}><div style={{padding:"8px 14px",background:msg.type==="ok"?"rgba(93,202,165,0.08)":"rgba(220,50,50,0.08)",border:`1px solid ${msg.type==="ok"?"rgba(93,202,165,0.3)":"rgba(220,50,50,0.3)"}`,borderRadius:6,fontSize:12,color:msg.type==="ok"?"#5ca":"#e55"}}>{msg.type==="ok"?"✓ ":"✕ "}{msg.text}</div></div>}

    <div style={{maxWidth:1000,margin:"0 auto",padding:"16px 16px"}}>

    {/* ═══ 대시보드 탭 ═══ */}
    {tab==="dash"&&<div>
      {/* 드롭존 */}
      <div style={{border:`2px dashed ${drag?C.gold:C.bdr}`,borderRadius:10,padding:"20px",textAlign:"center",cursor:busy?"default":"pointer",background:drag?"rgba(212,168,52,0.04)":"transparent",marginBottom:16}}
        onDrop={e=>{e.preventDefault();setDrag(false);if(!busy)loadFiles(e.dataTransfer.files)}} onDragOver={e=>{e.preventDefault();if(!busy)setDrag(true)}} onDragLeave={()=>setDrag(false)}
        onClick={()=>{if(!busy)document.getElementById("fi").click()}}>
        <input id="fi" type="file" accept=".xls,.xlsx" multiple style={{display:"none"}} onChange={e=>{if(e.target.files?.length){loadFiles(e.target.files);e.target.value=""}}}/>
        {busy?<div style={{color:C.gold,fontSize:14}}>처리 중...</div>:<>
          <div style={{fontSize:13,fontWeight:600,marginBottom:4}}>파일을 드래그하거나 클릭하세요</div>
          <div style={{fontSize:11,color:C.txd}}>낙찰정보리스트 / SUCVIEW 상세 / 입찰서류함 — 자동 판별</div>
          {dbLoading&&<div style={{marginTop:8,fontSize:11,color:C.txd}}>DB 연결 중...</div>}
        </>}
      </div>
      {uploadLog.length>0&&<div style={{marginBottom:12}}>{uploadLog.map((l,i)=><div key={i} style={{padding:"6px 12px",fontSize:12,color:l.type==="ok"?"#5ca":"#e55",borderBottom:"1px solid "+C.bdr}}>{l.type==="ok"?"✓":"✕"} {l.name} — {l.text}</div>)}</div>}

      {/* 요약 카드 5개 */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:16}}>
        {[
          {l:"낙찰 데이터",v:recs.length.toLocaleString(),s:dataStatus?.latestDate?"최신 "+dataStatus.latestDate:"",c:C.txt},
          {l:"상세 데이터",v:String(bidDetails.length),s:bidDetails.length+"건 · "+new Set(bidDetails.map(d=>d.at)).size+"유형",c:"#a8b4ff"},
          {l:"모델 MAE",v:compStats.matched>0?compStats.avgErr.toFixed(2)+"%":"—",s:compStats.matched+"건 매칭 · 적중 "+compStats.within05,c:"#d4a834"},
          {l:"예측 대기",v:String(compStats.pending),s:compStats.pending>0?"낙찰리스트 필요":"완료",c:compStats.pending>0?"#e24b4a":"#5dca96"},
          {l:"비정상",v:String(abnormalStats.total),s:"유찰"+abnormalStats.yuchal+" 내역"+abnormalStats.broken+" 이상"+abnormalStats.outlier,c:abnormalStats.total>0?"#666680":"#5dca96"}
        ].map((c,i)=><div key={i} style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,padding:"10px 8px",textAlign:"center",cursor:"pointer"}} onClick={()=>{if(i<=1)setTab("analysis");if(i>=2&&i<=3)setTab("predict")}}>
          <div style={{fontSize:10,color:C.txd,marginBottom:3}}>{c.l}</div>
          <div style={{fontSize:18,fontWeight:600,color:c.c}}>{c.v}</div>
          <div style={{fontSize:9,color:C.txd,marginTop:2}}>{c.s}</div>
        </div>)}
      </div>

      {/* 복수예가 상세 데이터 */}
      {bidDetails.length>0&&<div style={{marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:600,color:C.gold,marginBottom:8}}>복수예가 상세 데이터 ({bidDetails.length}건)</div>
        {/* 기관유형별 요약 */}
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
          {Object.entries(bidDetails.reduce((m,d)=>{m[d.at]=(m[d.at]||0)+1;return m},{})).sort((a,b)=>b[1]-a[1]).map(([t,n])=>
            <span key={t} style={{fontSize:10,padding:"3px 8px",borderRadius:4,background:"rgba(168,180,255,0.1)",color:"#a8b4ff",border:"1px solid rgba(168,180,255,0.15)"}}>{t} {n}건</span>)}
        </div>
        {/* 최근 5건만 표시 */}
        {bidDetails.slice(0,5).map((d,i)=><div key={d.id||i} style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,marginBottom:6,overflow:"hidden"}}>
          <div style={{padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}
            onClick={()=>setExpandedDetail(expandedDetail===d.pn_no?null:d.pn_no)}>
            <div style={{display:"flex",gap:8,alignItems:"center",flex:1,minWidth:0}}>
              <span style={{fontSize:9,padding:"2px 7px",borderRadius:4,background:"rgba(168,180,255,0.15)",color:"#a8b4ff",flexShrink:0}}>상세</span>
              <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:12,fontWeight:500}}>{d.ag} — {(d.pn||"").length>40?(d.pn||"").slice(0,40)+"…":d.pn}</span>
            </div>
            <div style={{fontSize:11,color:C.txd,flexShrink:0,marginLeft:8}}>{d.od} <span style={{color:"#a8b4ff"}}>{expandedDetail===d.pn_no?"접기":"펼치기"}</span></div>
          </div>
          <div style={{padding:"0 14px 8px",display:"flex",gap:12,fontSize:11,color:C.txm}}>
            <span>기초 {d.ba?tc(d.ba):""}</span>
            <span>사정율 <span style={{color:"#5dca96"}}>{d.adj_rate!=null?(100+Number(d.adj_rate)).toFixed(4)+"%":""}</span></span>
            <span>참여 {d.participant_count}건</span>
          </div>
          {expandedDetail===d.pn_no&&<div style={{borderTop:"1px solid "+C.bdr,padding:"12px 14px",background:"#0e0e22"}}>
            <SimView sim={simDraws(d.pre_rates)}/>
          </div>}
        </div>)}
      </div>}

      {/* SUCVIEW 업로드 직후 시뮬레이션 */}
      {simResult&&bidDetails.length===0&&<SimView sim={simResult}/>}

      {/* 최근 활동 */}
      {(dataStatus||compStats.matched>0)&&<div>
        <div style={{fontSize:13,fontWeight:600,color:C.gold,marginBottom:8}}>최근 활동</div>
        <div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,overflow:"hidden"}}>
          {dataStatus?.uploadTime&&<div style={{padding:"8px 12px",borderBottom:"1px solid "+C.bdr,fontSize:12,display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:"#5dca96",flexShrink:0}}/>
            <span>낙찰정보 {dataStatus.uploadBatchCount}건 업로드</span>
            <span style={{color:C.txd,marginLeft:"auto",fontSize:10}}>{dataStatus.uploadTime?.slice(0,16).replace("T"," ")}</span>
          </div>}
          {bidDetails.length>0&&<div style={{padding:"8px 12px",borderBottom:"1px solid "+C.bdr,fontSize:12,display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:"#a8b4ff",flexShrink:0}}/>
            <span>SUCVIEW 상세 {bidDetails.length}건 저장</span>
          </div>}
          {compStats.matched>0&&<div style={{padding:"8px 12px",fontSize:12,display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:"#d4a834",flexShrink:0}}/>
            <span>{compStats.matched}건 예측 자동 매칭 (평균 오차 {compStats.avgErr.toFixed(4)}%)</span>
          </div>}
        </div>
      </div>}

      {recs.length>0&&<div style={{marginTop:16}}><button onClick={()=>setDlgType("all")} style={{padding:"6px 14px",background:"rgba(220,50,50,0.1)",border:"1px solid rgba(220,50,50,0.3)",borderRadius:5,color:"#e55",fontSize:11,cursor:"pointer"}}>전체 삭제 ({recs.length}건)</button></div>}
    </div>}

    {/* ═══ 분석 탭 (통계 + 데이터 통합) ═══ */}
    {tab==="analysis"&&<div>
      {/* 통합 필터 바 */}
      <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
        {["all","new","old"].map(id=><button key={id} onClick={()=>{setEF(id);setDataPage(0)}} style={btnS(eF===id,id==="new"?"#5dca96":id==="old"?"#e24b4a":C.gold)}>{id==="all"?"전체":id==="new"?"신기준":"구기준"}</button>)}
        <div style={{width:1,height:20,background:C.bdr,margin:"0 4px"}}/>
        {["all","지자체","교육청","군시설","한전","조달청","LH","수자원공사"].map(id=><button key={id} onClick={()=>{setAtF(id);setDataPage(0)}} style={btnS(atF===id,"#a8b4ff")}>{id==="all"?"전체 기관":id}</button>)}
        <div style={{width:1,height:20,background:C.bdr,margin:"0 4px"}}/>
        <button onClick={()=>{setHideAbnormal(!hideAbnormal);setDataPage(0)}} style={{...btnS(hideAbnormal,"#e24b4a"),fontSize:10}}>
          {hideAbnormal?"비정상 숨김":"비정상 "+abnormalStats.total+"건"}
        </button>
        <div style={{flex:1,minWidth:180}}>
          <AgencyInput value={search} onChange={v=>{setSearch(v);setDataPage(0)}} agencies={agencyList} stats={allS.as} placeholder="발주기관 또는 공고명 검색 (초성 가능)"/>
        </div>
      </div>

      {/* 통계 카드 */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
        {[
          {l:"필터 건수",v:filteredRecs.length.toLocaleString()},
          {l:"사정율 평균(100%)",v:curSt.ts&&Object.keys(curSt.ts).length?((100+(atF!=="all"&&curSt.ts[atF]?curSt.ts[atF].avg:Object.values(curSt.ts).reduce((s,v)=>s+v.sum,0)/Math.max(1,Object.values(curSt.ts).reduce((s,v)=>s+v.n,0)))).toFixed(4)+"%"):"—",c:"#5dca96"},
          {l:"사정율 표준편차",v:curSt.ts&&Object.keys(curSt.ts).length?((atF!=="all"&&curSt.ts[atF]?curSt.ts[atF].std:0.7).toFixed(4)+"%"):"—"},
          {l:"투찰율 중앙값",v:curSt.ts&&Object.keys(curSt.ts).length?((atF!=="all"&&curSt.ts[atF]?curSt.ts[atF].bidMed:0).toFixed(2)+"%"):"—",c:"#d4a834"}
        ].map((c,i)=><div key={i} style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,padding:"10px",textAlign:"center"}}>
          <div style={{fontSize:10,color:C.txd,marginBottom:3}}>{c.l}</div>
          <div style={{fontSize:16,fontWeight:600,color:c.c||C.txt}}>{c.v}</div>
        </div>)}
      </div>

      {/* 기관유형별 테이블 */}
      <div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,overflow:"hidden",marginBottom:14}}>
        <div style={{padding:"8px 14px",fontSize:12,fontWeight:600,color:C.gold,borderBottom:"1px solid "+C.bdr}}>기관유형별 사정율</div>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead><tr style={{background:C.bg3}}>{["기관유형","건수","평균(100%)","중앙값(100%)","표준편차"].map((h,i)=><th key={i} style={{padding:"8px 10px",textAlign:i>0?"right":"left",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr}}>{h}</th>)}</tr></thead>
          <tbody>{Object.entries(curSt.ts||{}).sort((a,b)=>b[1].n-a[1].n).map(([k,v])=><tr key={k} style={{borderBottom:"1px solid "+C.bdr,background:atF===k?"rgba(168,180,255,0.06)":"transparent",cursor:"pointer"}} onClick={()=>{setAtF(atF===k?"all":k);setDataPage(0)}}>
            <td style={{padding:"8px 10px",color:C.gold}}>{k}</td>
            <td style={{padding:"8px 10px",textAlign:"right"}}>{v.n.toLocaleString()}</td>
            <td style={{padding:"8px 10px",textAlign:"right",color:"#5dca96"}}>{(100+v.avg).toFixed(4)}%</td>
            <td style={{padding:"8px 10px",textAlign:"right"}}>{(100+v.med).toFixed(4)}%</td>
            <td style={{padding:"8px 10px",textAlign:"right",color:C.txd}}>{v.std.toFixed(4)}%</td>
          </tr>)}</tbody>
        </table>
      </div>

      {/* ★ D-2: 전략 참조 대시보드 */}
      {(()=>{
        const st=atF!=="all"&&curSt.ts[atF]?curSt.ts[atF]:null;
        const vals=st?st.vals:Object.values(curSt.ts||{}).flatMap(v=>v.vals);
        if(!vals||vals.length<20)return null;
        // 소수점 1자리 구간 분포
        const bins={};vals.forEach(v=>{const b=(Math.floor(v*10)/10).toFixed(1);bins[b]=(bins[b]||0)+1});
        const sortedBins=Object.entries(bins).sort((a,b)=>parseFloat(a[0])-parseFloat(b[0]));
        const maxCnt=Math.max(...sortedBins.map(b=>b[1]));
        // 핵심 구간만 (-1.5 ~ +1.5)
        const coreBins=sortedBins.filter(([k])=>{const v=parseFloat(k);return v>=-1.5&&v<=1.4});
        // 누적 확률 (사정률 X 이상일 확률 = 예정가격 이하 확률)
        const total=vals.length;const sorted=[...vals].sort((a,b)=>a-b);
        const cumBelow=(x)=>Math.round(sorted.filter(v=>v>=x).length/total*1000)/10;
        // TIP 자동 생성
        const med=st?st.med:sorted[Math.floor(sorted.length/2)];
        const std=st?st.std:0.7;
        const typeName=atF!=="all"?atF:"전체";
        const negPct=Math.round(vals.filter(v=>v<0).length/total*100);
        const tip=negPct>55?`${typeName} 사정률은 ${negPct}%가 음수입니다. 기초금액보다 낮은 예정가격이 형성될 가능성이 높으므로, 안전 전략(-0.3% 이하)을 권장합니다.`
          :negPct<45?`${typeName} 사정률은 양수 비율이 ${100-negPct}%로, 예정가격이 기초금액보다 높게 형성되는 경향이 있습니다. 균형~공격 전략이 유리합니다.`
          :`${typeName} 사정률은 음수/양수 비율이 거의 균등(${negPct}/${100-negPct})합니다. 중앙값 ${(100+med).toFixed(4)}% 기준으로 밴드 전략을 권장합니다.`;
        return<div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,overflow:"hidden",marginBottom:14}}>
          <div style={{padding:"8px 14px",fontSize:12,fontWeight:600,color:"#a8b4ff",borderBottom:"1px solid "+C.bdr}}>
            전략 참조 — {typeName} ({vals.length.toLocaleString()}건)
          </div>
          {/* 히스토그램 */}
          <div style={{padding:"10px 14px"}}>
            <div style={{display:"flex",alignItems:"flex-end",gap:1,height:80,marginBottom:4}}>
              {coreBins.map(([k,cnt])=>{const h=Math.max(2,cnt/maxCnt*80);const neg=parseFloat(k)<0;
                return<div key={k} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end",height:"100%"}}>
                  <div style={{width:"100%",height:h,background:neg?"rgba(226,75,74,0.4)":"rgba(93,202,165,0.4)",borderRadius:"2px 2px 0 0",minWidth:2}}/>
                </div>})}
            </div>
            <div style={{display:"flex",gap:1}}>
              {coreBins.map(([k])=><div key={k} style={{flex:1,textAlign:"center",fontSize:8,color:C.txd}}>{parseFloat(k)===0?"0":parseFloat(k)%0.5===0?k:""}</div>)}
            </div>
          </div>
          {/* 확률 테이블 */}
          <div style={{padding:"0 14px 10px",overflow:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{background:C.bg3}}>
                <th style={{padding:"5px 6px",textAlign:"left",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:10}}>투찰 사정률</th>
                {["-0.5%","-0.3%","-0.1%","0.0%","+0.1%","+0.3%","+0.5%"].map(h=><th key={h} style={{padding:"5px 6px",textAlign:"center",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:10}}>{h}</th>)}
              </tr></thead>
              <tbody><tr>
                <td style={{padding:"5px 6px",fontWeight:500}}>예정가 이하 확률</td>
                {[-0.5,-0.3,-0.1,0,0.1,0.3,0.5].map(x=>{const p=cumBelow(x);return<td key={x} style={{padding:"5px 6px",textAlign:"center",fontWeight:500,color:p>=60?"#5dca96":p>=40?"#d4a834":"#e24b4a"}}>{p}%</td>})}
              </tr></tbody>
            </table>
          </div>
          {/* TIP */}
          <div style={{padding:"8px 14px",borderTop:"1px solid "+C.bdr,fontSize:11,color:"#a8b4ff",background:"rgba(168,180,255,0.04)",lineHeight:1.5}}>
            TIP: {tip}
          </div>
        </div>})()}

      {/* 낙찰 데이터 목록 */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <span style={{fontSize:12,fontWeight:600,color:C.gold}}>낙찰 데이터 ({filteredRecs.length.toLocaleString()}건)</span>
        {selCount>0&&<button onClick={()=>setDlgType("sel")} style={{padding:"4px 12px",background:"rgba(220,50,50,0.1)",border:"1px solid rgba(220,50,50,0.3)",borderRadius:5,color:"#e55",fontSize:11,cursor:"pointer"}}>{selCount}건 삭제</button>}
      </div>
      <div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,overflow:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,tableLayout:"fixed"}}>
          <colgroup><col style={{width:30}}/><col style={{width:"22%"}}/><col style={{width:"12%"}}/><col style={{width:"6%"}}/><col style={{width:"12%"}}/><col style={{width:"10%"}}/><col style={{width:"10%"}}/><col style={{width:"10%"}}/><col style={{width:"5%"}}/></colgroup>
          <thead><tr style={{background:C.bg3}}><th style={{padding:6}}><input type="checkbox" checked={allSel} onChange={()=>{const n={};if(!allSel)pagedRecs.forEach(r=>{n[r.id]=true});setSel(n)}}/></th>
            <SortTh label="공고명" sortKey="pn" current={dataSort} setCurrent={setDataSort}/>
            <SortTh label="발주기관" sortKey="ag" current={dataSort} setCurrent={setDataSort}/>
            <SortTh label="유형" sortKey="at" current={dataSort} setCurrent={setDataSort}/>
            <SortTh label="기초금액" sortKey="ba" current={dataSort} setCurrent={setDataSort} align="right"/>
            <SortTh label="사정율(100%)" sortKey="ar1" current={dataSort} setCurrent={setDataSort} align="right"/>
            <SortTh label="1순위" sortKey="br1" current={dataSort} setCurrent={setDataSort} align="right"/>
            <SortTh label="개찰일" sortKey="od" current={dataSort} setCurrent={setDataSort} align="right"/>
            <SortTh label="시대" sortKey="era" current={dataSort} setCurrent={setDataSort} align="center"/>
          </tr></thead>
          <tbody>{pagedRecs.map(r=>{
            const isYuchal=r.co==="유찰"||r.co==="유찰(무)";const isBroken=!isYuchal&&(r.br1==null&&(r.ba==null||r.ba===0));const isOutlier=!isYuchal&&!isBroken&&r.br1!=null&&(r.br1<95||r.br1>105);
            const isAbnormal=isYuchal||isBroken||isOutlier;const rowBg=isYuchal?"rgba(226,75,74,0.04)":isBroken?"rgba(168,180,255,0.04)":isOutlier?"rgba(212,168,52,0.04)":"transparent";
            return<tr key={r.id} style={{borderBottom:"1px solid "+C.bdr,background:rowBg}}>
              <td style={{padding:4,textAlign:"center"}}><input type="checkbox" checked={!!sel[r.id]} onChange={()=>setSel(p=>({...p,[r.id]:!p[r.id]}))}/></td>
              <td style={{padding:"6px 4px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",opacity:isAbnormal?.5:1}} title={r.pn}>
                {isYuchal&&<span style={{fontSize:8,padding:"1px 5px",borderRadius:3,background:"rgba(226,75,74,0.15)",color:"#e24b4a",marginRight:4}}>유찰</span>}
                {isBroken&&<span style={{fontSize:8,padding:"1px 5px",borderRadius:3,background:"rgba(168,180,255,0.15)",color:"#a8b4ff",marginRight:4}}>내역</span>}
                {isOutlier&&<span style={{fontSize:8,padding:"1px 5px",borderRadius:3,background:"rgba(212,168,52,0.15)",color:"#d4a834",marginRight:4}}>이상</span>}
                {r.pn||"(없음)"}
              </td>
              <td style={{padding:"6px 4px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={r.ag}>{r.ag||""}</td>
              <td style={{padding:"6px 4px",color:C.txd,fontSize:10}}>{r.at}</td>
              <td style={{padding:"6px 4px",textAlign:"right",fontFamily:"monospace"}}>{r.ba?tc(r.ba):""}</td>
              <td style={{padding:"6px 4px",textAlign:"right",color:"#5dca96"}}>{r.ar1!=null?Number(r.ar1).toFixed(4)+"%":""}</td>
              <td style={{padding:"6px 4px",textAlign:"right",color:C.gold}}>{r.br1!=null?Number(r.br1).toFixed(4):""}</td>
              <td style={{padding:"6px 4px",textAlign:"right"}}>{r.od||""}</td>
              <td style={{padding:"6px 4px",textAlign:"center",color:r.era==="new"?"#5dca96":"#e24b4a",fontSize:10}}>{r.era==="new"?"신":"구"}</td>
            </tr>})}</tbody>
        </table>
      </div>
      <div style={{display:"flex",justifyContent:"center",gap:8,marginTop:10,alignItems:"center"}}><button disabled={dataPage===0} onClick={()=>setDataPage(p=>p-1)} style={{padding:"5px 12px",fontSize:11,background:C.bg3,border:"1px solid "+C.bdr,borderRadius:5,color:C.txt,cursor:dataPage===0?"default":"pointer"}}>◀</button><span style={{fontSize:11,color:C.txd}}>{dataPage+1}/{totalPages}</span><button disabled={dataPage>=totalPages-1} onClick={()=>setDataPage(p=>p+1)} style={{padding:"5px 12px",fontSize:11,background:C.bg3,border:"1px solid "+C.bdr,borderRadius:5,color:C.txt,cursor:dataPage>=totalPages-1?"default":"pointer"}}>▶</button></div>
    </div>}

    {/* ═══ 예측 탭 (수동 + 파일 + 내역 + 비교 통합) ═══ */}
    {tab==="predict"&&<div>
      {/* 수동 입력 + 파일 업로드 나란히 */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
        {/* 수동 입력 */}
        <div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,padding:16}}>
          <div style={{fontSize:12,fontWeight:600,color:C.gold,marginBottom:10}}>수동 입력</div>
          <div style={{marginBottom:8}}><div style={{fontSize:11,color:C.txm,marginBottom:3}}>발주기관</div><AgencyInput value={inp.agency} onChange={v=>setInp(p=>({...p,agency:v}))} agencies={agencyList} stats={allS.as} placeholder="기관명 검색 (초성 가능: ㅅㅇㄱㅌ)"/></div>
          {inp.agency&&<div style={{fontSize:11,color:C.txd,marginBottom:8}}>유형: <span style={{color:C.gold}}>{clsAg(inp.agency)}</span></div>}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
            <div><div style={{fontSize:11,color:C.txm,marginBottom:3}}>기초금액</div><NI value={inp.baseAmount} onChange={v=>setInp(p=>({...p,baseAmount:v}))}/></div>
            <div><div style={{fontSize:11,color:C.txm,marginBottom:3}}>추정가격</div><NI value={inp.estimatedPrice} onChange={v=>setInp(p=>({...p,estimatedPrice:v}))}/></div>
          </div>
          <div style={{marginBottom:10}}><div style={{fontSize:11,color:C.txm,marginBottom:3}}>A값 (없으면 0)</div><NI value={inp.aValue} onChange={v=>setInp(p=>({...p,aValue:v}))}/></div>
          <button onClick={doManualPred} style={{width:"100%",padding:"10px",background:C.gold,border:"none",borderRadius:6,color:"#000",fontWeight:700,fontSize:13,cursor:"pointer"}}>예측 실행</button>
        </div>
        {/* 파일 업로드 (드래그앤드롭 수정) */}
        <div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,overflow:"hidden"}}>
          <div style={{border:`2px dashed ${dragPred?C.gold:C.bdr}`,borderRadius:10,padding:"30px 16px",textAlign:"center",cursor:busy?"default":"pointer",height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:dragPred?"rgba(212,168,52,0.04)":"transparent"}}
            onDrop={e=>{e.preventDefault();setDragPred(false);if(!busy&&e.dataTransfer.files?.length)loadPredFiles(e.dataTransfer.files)}}
            onDragOver={e=>{e.preventDefault();if(!busy)setDragPred(true)}} onDragLeave={()=>setDragPred(false)}
            onClick={()=>{if(!busy)document.getElementById("pfi").click()}}>
            <input id="pfi" type="file" accept=".xls,.xlsx" multiple style={{display:"none"}} onChange={e=>{if(e.target.files?.length){loadPredFiles(e.target.files);e.target.value=""}}}/>
            {busy?<div style={{color:C.gold,fontSize:14}}>예측 처리 중...</div>:<>
              <div style={{fontSize:28,opacity:0.3,marginBottom:6}}>↑</div>
              <div style={{fontSize:13,fontWeight:600,marginBottom:4}}>입찰서류함 드래그 또는 클릭</div>
              <div style={{fontSize:11,color:C.txd}}>복수 XLS 파일 드래그 가능 · 각 건에 대해 일괄 예측 + DB 저장</div>
            </>}
          </div>
        </div>
      </div>

      {/* 일괄 예측 결과 + 엑셀 다운로드 */}
      {predResults.length>0&&<div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,padding:16,marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={{fontWeight:600,color:"#a8b4ff",fontSize:13}}>일괄 예측 결과 ({predResults.length}건)</div>
          <button onClick={()=>{
            const wb=XLSX.utils.book_new();
            const data=predResults.map(r=>({
              "공고명":r.pn,"공고번호":r.pn_no,"발주기관":r.ag,"기관유형":r.at,
              "기초금액":r.ba,"추정가격":r.ep,"A값":r.av,
              "예측사정률(100%)":r.pred?(100+r.pred.adj).toFixed(4):"",
              "예측사정률":r.pred?r.pred.adj.toFixed(4):"",
              "예정가격(예측)":r.pred?r.pred.xp:"",
              "투찰금액(추천)":r.pred?r.pred.bid:"",
              "낙찰하한율":r.pred?r.pred.fr:"",
              "예상투찰율":r.pred&&r.pred.xp>0?(r.pred.bid/r.pred.xp*100).toFixed(3):"",
              "근거":r.pred?r.pred.src:"",
              "개찰일":r.open_date||""
            }));
            const ws=XLSX.utils.json_to_sheet(data);
            XLSX.utils.book_append_sheet(wb,ws,"예측결과");
            XLSX.writeFile(wb,"예측결과_"+new Date().toISOString().slice(0,10)+".xlsx");
          }} style={{padding:"5px 14px",fontSize:11,background:"rgba(168,180,255,0.1)",border:"1px solid rgba(168,180,255,0.3)",borderRadius:5,color:"#a8b4ff",cursor:"pointer",fontWeight:500}}>
            엑셀 다운로드
          </button>
        </div>
        <div style={{overflow:"auto",maxHeight:500}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,tableLayout:"fixed"}}>
            <colgroup><col style={{width:"21%"}}/><col style={{width:"12%"}}/><col style={{width:"10%"}}/><col style={{width:"10%"}}/><col style={{width:"10%"}}/><col style={{width:"8%"}}/><col style={{width:"9%"}}/><col style={{width:"10%"}}/><col style={{width:"10%"}}/></colgroup>
            <thead><tr style={{background:C.bg3}}>
              {["공고명","발주기관","사정률(100%)","예정가격","투찰금액","투찰율","하한율","개찰일","AI"].map((h,i)=>
                <th key={i} style={{padding:"6px 4px",textAlign:i>=2?"right":i===8?"center":"left",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:10}}>{h}</th>)}
            </tr></thead>
            <tbody>{predResults.slice(0,50).map((r,i)=>{
              const isExpanded=expandedBatch===i;
              const hasAi=!!batchAi[i];
              const isLoading=batchAiLoading===i;
              return<React.Fragment key={i}>
              <tr style={{borderBottom:isExpanded?"none":"1px solid "+C.bdr,cursor:"pointer",background:isExpanded?"rgba(168,180,255,0.04)":"transparent"}}
                onClick={()=>setExpandedBatch(isExpanded?null:i)}>
                <td style={{padding:"5px 4px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={r.pn}>{r.pn}</td>
                <td style={{padding:"5px 4px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.ag}</td>
                <td style={{padding:"5px 4px",textAlign:"right",color:"#5dca96",fontWeight:500}}>{r.pred?(100+r.pred.adj).toFixed(4)+"%":""}</td>
                <td style={{padding:"5px 4px",textAlign:"right",fontFamily:"monospace"}}>{r.pred?tc(r.pred.xp):""}</td>
                <td style={{padding:"5px 4px",textAlign:"right",fontWeight:600,color:C.gold,fontFamily:"monospace"}}>{r.pred?tc(r.pred.bid):""}</td>
                <td style={{padding:"5px 4px",textAlign:"right",color:"#85b7eb",fontFamily:"monospace"}}>{r.pred&&r.pred.xp>0?(r.pred.bid/r.pred.xp*100).toFixed(3)+"%":""}</td>
                <td style={{padding:"5px 4px",textAlign:"right",fontSize:10}}>{r.pred?r.pred.fr+"%":""}</td>
                <td style={{padding:"5px 4px",textAlign:"right",fontSize:10}}>{r.open_date||""}</td>
                <td style={{padding:"5px 4px",textAlign:"center"}}>{hasAi?<span style={{fontSize:9,color:"#5dca96"}}>완료</span>:isLoading?<span style={{fontSize:9,color:"#a8b4ff"}}>...</span>:<span style={{fontSize:9,color:C.txd}}>클릭</span>}</td>
              </tr>
              {isExpanded&&<tr><td colSpan={9} style={{padding:"10px 8px",background:"rgba(168,180,255,0.03)",borderBottom:"1px solid "+C.bdr}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  <div>
                    <div style={{fontSize:11,color:C.txd,marginBottom:6}}>예측 상세</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,fontSize:11}}>
                      <div><span style={{color:C.txd}}>예측사정률:</span> <span style={{color:"#5dca96"}}>{r.pred?(100+r.pred.adj).toFixed(4)+"%":""}</span></div>
                      <div><span style={{color:C.txd}}>낙찰하한율:</span> {r.pred?r.pred.fr+"%":""}</div>
                      <div><span style={{color:C.txd}}>추천투찰금액:</span> <span style={{color:C.gold,fontWeight:600}}>{r.pred?tc(r.pred.bid)+"원":""}</span></div>
                      <div><span style={{color:C.txd}}>예상투찰율:</span> <span style={{color:"#85b7eb"}}>{r.pred&&r.pred.xp>0?(r.pred.bid/r.pred.xp*100).toFixed(3)+"%":""}</span></div>
                      {r.pred?.ci70&&<div style={{gridColumn:"1/3"}}><span style={{color:C.txd}}>CI 70%:</span> {r.pred.ci70.low}% ~ {r.pred.ci70.high}%</div>}
                      <div style={{gridColumn:"1/3"}}><span style={{color:C.txd}}>근거:</span> {r.pred?.src||""}</div>
                    </div>
                  </div>
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                      <div style={{fontSize:11,color:"#a8b4ff",fontWeight:500}}>AI 전략 코멘트</div>
                      {!hasAi&&<button disabled={isLoading} onClick={async(e)=>{
                        e.stopPropagation();
                        setBatchAiLoading(i);
                        try{const prompt=buildAiPrompt(r);if(!prompt){setBatchAi(p=>({...p,[i]:"예측 데이터 없음"}));return}
                          const text=await callAi(prompt);setBatchAi(p=>({...p,[i]:text}))}
                        catch(e){setBatchAi(p=>({...p,[i]:"⚠ "+e.message}))}
                        finally{setBatchAiLoading(null)}
                      }} style={{padding:"3px 10px",fontSize:10,background:"rgba(168,180,255,0.1)",border:"1px solid rgba(168,180,255,0.3)",borderRadius:4,color:"#a8b4ff",cursor:isLoading?"default":"pointer"}}>
                        {isLoading?"분석 중...":"분석 요청"}
                      </button>}
                    </div>
                    {hasAi?<div style={{fontSize:12,lineHeight:1.7,color:C.txt,whiteSpace:"pre-wrap"}}>{batchAi[i]}</div>
                      :<div style={{fontSize:11,color:C.txd}}>분석 요청 버튼을 클릭하면 AI가 이 입찰건의 맞춤 전략을 제안합니다</div>}
                  </div>
                </div>
              </td></tr>}
              </React.Fragment>})}</tbody>
          </table>
        </div>
        {predResults.length>50&&<div style={{textAlign:"center",fontSize:10,color:C.txd,marginTop:6}}>상위 50건 표시 중 (전체 {predResults.length}건은 엑셀 다운로드)</div>}
      </div>}

      {/* 수동 예측 결과 */}
      {pred&&<div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,padding:16,marginBottom:16}}>
        <div style={{fontWeight:600,color:C.gold,marginBottom:8,fontSize:14}}>예측 결과</div>
        <div style={{fontSize:11,color:C.txd,marginBottom:10}}>근거: {pred.src} | 표준편차 {pred.adjStd.toFixed(4)}%</div>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,marginBottom:12}}>
          <thead><tr style={{background:C.bg3}}>{["시나리오","사정율(100%)","사정율","예정가격","투찰금액"].map((h,i)=><th key={i} style={{padding:"7px 10px",textAlign:i>=3?"right":i>=1?"right":"left",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr}}>{h}</th>)}</tr></thead>
          <tbody>{pred.scenarios.map((s,i)=><tr key={i} style={{borderBottom:"1px solid "+C.bdr,background:i===1?"rgba(212,168,52,0.06)":"transparent"}}>
            <td style={{padding:"7px 10px",fontWeight:i===1?600:400}}>{s.name}</td>
            <td style={{padding:"7px 10px",textAlign:"right",color:"#5dca96",fontWeight:500}}>{(100+s.adj).toFixed(4)}%</td>
            <td style={{padding:"7px 10px",textAlign:"right",color:C.txd,fontSize:11}}>{s.adj.toFixed(4)}%</td>
            <td style={{padding:"7px 10px",textAlign:"right",fontFamily:"monospace"}}>{tc(s.xp)}</td>
            <td style={{padding:"7px 10px",textAlign:"right",fontWeight:600,color:C.gold,fontFamily:"monospace"}}>{tc(s.bid)}</td>
          </tr>)}</tbody>
        </table>
        <div style={{padding:"10px 12px",background:"rgba(93,202,165,0.06)",border:"1px solid rgba(93,202,165,0.15)",borderRadius:6,marginBottom:8}}>
          <div style={{fontWeight:600,color:"#5dca96",marginBottom:6,fontSize:12}}>투찰율 기반 추천</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,fontSize:11,marginBottom:6}}>
            <div><span style={{color:C.txd}}>Q1:</span> {pred.bidRateRec.q1}%</div>
            <div><span style={{color:C.txd}}>중앙값:</span> <span style={{color:"#5dca96",fontWeight:600}}>{pred.bidRateRec.med}%</span></div>
            <div><span style={{color:C.txd}}>Q3:</span> {pred.bidRateRec.q3}%</div>
            <div><span style={{color:C.txd}}>표준편차:</span> {pred.bidRateRec.std}%</div>
          </div>
          <div style={{fontSize:13}}>추천금액: <span style={{fontWeight:700,color:C.gold,fontSize:15}}>{tc(pred.bidByRate)}원</span></div>
        </div>
        <div style={{fontSize:11,color:C.txd}}>낙찰하한율: {pred.fr}%</div>
        {/* ★ 3-A-2: 기관별 최적 투찰 포인트 */}
        {(()=>{
          const agType=clsAg(inp.agency);const agName=inp.agency.trim();
          const ba=tn(inp.baseAmount);const av=tn(inp.aValue);const fr=pred.fr;
          if(!ba||!fr)return null;
          // 해당 기관의 bid_details에서 1순위 마진 분석
          const agDets=bidDetails.filter(d=>d.ag===agName&&d.win_bid_rate&&d.floor_rate>0);
          const typeDets=bidDetails.filter(d=>d.at===agType&&d.win_bid_rate&&d.floor_rate>0);
          const dets=agDets.length>=3?agDets:typeDets;
          if(dets.length<5)return null;
          const margins=dets.map(d=>Math.round((d.win_bid_rate-d.floor_rate)*10000)/10000).sort((a,b)=>a-b);
          const mLen=margins.length;
          const p10=margins[Math.floor(mLen*0.1)];
          const p25=margins[Math.floor(mLen*0.25)];
          const p50=margins[Math.floor(mLen*0.5)];
          const optRate=Math.round((fr+p10)*10000)/10000; // P10 마진 = 상위 10% 진입 목표
          const safeRate=Math.round((fr+p25)*10000)/10000;
          // 최적 투찰금액 역산
          const calcOptBid=(rate)=>{
            // 투찰률 = 투찰금액/예정가격 → 투찰금액 = 예정가격 × 투찰률
            // 사정률에서 예정가격 = ba × (1+adj/100)
            // 투찰률 = rate → adj를 모르므로, 전 시나리오에서 예정가격 범위를 사용
            // 간단 산식: 투찰금액 ≈ ba × rate/100 (A값 무시 시)
            return av>0?Math.ceil(av+(ba*(1+pred.adj/100)-av)*(rate/100)):Math.ceil(ba*(1+pred.adj/100)*(rate/100))};
          const optBid=calcOptBid(optRate);
          const safeBid=calcOptBid(safeRate);
          const srcLabel=agDets.length>=3?agName+" ("+agDets.length+"건)":agType+" ("+typeDets.length+"건)";
          return<div style={{marginTop:10,padding:"10px 12px",background:"rgba(212,168,52,0.06)",border:"1px solid rgba(212,168,52,0.15)",borderRadius:6}}>
            <div style={{fontWeight:600,color:C.gold,marginBottom:6,fontSize:12}}>최적 투찰 포인트 ({srcLabel})</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:8}}>
              <div style={{background:C.bg3,borderRadius:6,padding:"8px 10px"}}>
                <div style={{fontSize:10,color:C.txd,marginBottom:2}}>1순위 목표 (상위 10%)</div>
                <div style={{fontSize:15,fontWeight:600,color:"#5dca96"}}>{optRate.toFixed(4)}%</div>
                <div style={{fontSize:12,color:C.gold,fontFamily:"monospace",marginTop:2}}>{tc(optBid)}원</div>
                <div style={{fontSize:9,color:C.txd}}>마진 +{p10.toFixed(4)}% (낙찰하한율 대비)</div>
              </div>
              <div style={{background:C.bg3,borderRadius:6,padding:"8px 10px"}}>
                <div style={{fontSize:10,color:C.txd,marginBottom:2}}>안전 진입 (상위 25%)</div>
                <div style={{fontSize:15,fontWeight:600,color:"#d4a834"}}>{safeRate.toFixed(4)}%</div>
                <div style={{fontSize:12,color:C.gold,fontFamily:"monospace",marginTop:2}}>{tc(safeBid)}원</div>
                <div style={{fontSize:9,color:C.txd}}>마진 +{p25.toFixed(4)}% (낙찰하한율 대비)</div>
              </div>
            </div>
            <div style={{fontSize:10,color:C.txd,lineHeight:1.5}}>
              {srcLabel} 기준 1순위 마진 중앙값 {p50.toFixed(4)}%. 투찰 시뮬레이터에서 위 투찰률 근처로 슬라이더를 조정하세요.
            </div>
          </div>})()}
        {/* ★ 신뢰구간 + 보정 정보 */}
        {pred.ci70&&<div style={{marginTop:10,padding:"10px 12px",background:"rgba(93,202,165,0.04)",border:"1px solid rgba(93,202,165,0.12)",borderRadius:6}}>
          <div style={{fontWeight:600,color:"#5dca96",marginBottom:6,fontSize:12}}>신뢰구간</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,fontSize:12,marginBottom:6}}>
            <div><span style={{color:C.txd}}>70% 확률:</span> <span style={{color:C.txt}}>{pred.ci70.low>=0?"+":""}{pred.ci70.low}% ~ {pred.ci70.high>=0?"+":""}{pred.ci70.high}%</span></div>
            <div><span style={{color:C.txd}}>90% 확률:</span> <span style={{color:C.txt}}>{pred.ci90.low>=0?"+":""}{pred.ci90.low}% ~ {pred.ci90.high>=0?"+":""}{pred.ci90.high}%</span></div>
          </div>
          {pred.biasAdj!==0&&<div style={{fontSize:11,marginBottom:4}}>
            <span style={{color:C.txd}}>편향 보정:</span> <span style={{color:"#a8b4ff",fontWeight:500}}>{pred.biasAdj>=0?"+":""}{pred.biasAdj}%</span>
            {pred.driftUsed!==0&&<span style={{color:C.txd,marginLeft:8}}>(drift {pred.driftUsed>=0?"+":""}{pred.driftUsed}%)</span>}
          </div>}
          <div style={{fontSize:10,color:C.txd,fontStyle:"italic"}}>복수예가 추첨 특성상 실제 사정율은 70% 확률로 위 범위 내에 있습니다.</div>
        </div>}
        {/* 복수예가 보정 정보 */}
        {pred.detailInsight&&<div style={{marginTop:10,padding:"10px 12px",background:"rgba(168,180,255,0.06)",border:"1px solid rgba(168,180,255,0.15)",borderRadius:6}}>
          <div style={{fontWeight:600,color:"#a8b4ff",marginBottom:6,fontSize:12}}>복수예가 패턴 보정 적용</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,fontSize:11,marginBottom:6}}>
            <div><span style={{color:C.txd}}>참조:</span> {pred.detailInsight.source} ({pred.detailInsight.count}건)</div>
            <div><span style={{color:C.txd}}>15개 평균편향:</span> <span style={{color:pred.detailInsight.avgBias<0?"#e24b4a":"#5dca96"}}>{pred.detailInsight.avgBias>=0?"+":""}{pred.detailInsight.avgBias}%</span></div>
            <div><span style={{color:C.txd}}>음수 비율:</span> <span style={{color:pred.detailInsight.negRatio>55?"#e24b4a":"#5dca96"}}>{pred.detailInsight.negRatio}%</span></div>
            <div><span style={{color:C.txd}}>보정량:</span> <span style={{color:"#a8b4ff"}}>{pred.detailInsight.biasAdj>=0?"+":""}{pred.detailInsight.biasAdj}%</span></div>
          </div>
          <div style={{fontSize:10,color:C.txd}}>상세 데이터의 복수예가 15개 편향 패턴을 기반으로 사정율 예측값을 보정했습니다.</div>
        </div>}
        {/* ★ Level 2: 밴드 전략 + 최적 투찰 */}
        {(()=>{
          const ba=tn(inp.baseAmount);const av=tn(inp.aValue);if(!ba||!pred)return null;
          const fr=pred.fr;const med=pred.adj;const std=pred.adjStd||0.7;
          // 사정률별 예정가격 이하 확률 (정규분포 근사)
          const normCdf=(x)=>{const t=1/(1+0.2316419*Math.abs(x));const d=0.3989422804*Math.exp(-x*x/2);const p=d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));return x>0?1-p:p};
          const probBelow=(adjRate)=>normCdf((med-adjRate)/Math.max(std,0.642))*100;
          // 투찰금액 계산
          const calcBid=(adjRate)=>{const xp=ba*(1+adjRate/100);return av>0?Math.ceil(av+(xp-av)*(fr/100)):Math.ceil(xp*(fr/100))};
          const calcXp=(adjRate)=>Math.round(ba*(1+adjRate/100));
          // 전략 밴드
          const strategies=[
            {name:"안전",adj:Math.round((med-std*0.52)*10000)/10000,color:"#5dca96",desc:"예정가 이하 70%"},
            {name:"균형",adj:Math.round(med*10000)/10000,color:"#d4a834",desc:"예정가 이하 50%"},
            {name:"공격",adj:Math.round((med+std*0.52)*10000)/10000,color:"#e24b4a",desc:"예정가 이하 30%"}];
          return<div style={{marginTop:10,padding:"12px 14px",background:"rgba(212,168,52,0.06)",border:"1px solid rgba(212,168,52,0.2)",borderRadius:8}}>
            <div style={{fontWeight:600,color:C.gold,marginBottom:8,fontSize:13}}>투찰 전략 (Level 2)</div>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,marginBottom:10}}>
              <thead><tr style={{background:C.bg3}}>{["전략","사정률","예정가격 이하","예정가격","투찰금액"].map((h,i)=><th key={i} style={{padding:"6px 8px",textAlign:i>=3?"right":i===2?"center":"left",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:11}}>{h}</th>)}</tr></thead>
              <tbody>{strategies.map((s,i)=>{const prob=probBelow(s.adj);return<tr key={i} style={{borderBottom:"1px solid "+C.bdr,background:i===0?"rgba(93,202,165,0.04)":"transparent"}}>
                <td style={{padding:"6px 8px"}}><span style={{color:s.color,fontWeight:600}}>{s.name}</span> <span style={{fontSize:10,color:C.txd}}>{s.desc}</span></td>
                <td style={{padding:"6px 8px",color:s.color,fontWeight:500}}>{(100+s.adj).toFixed(4)}%</td>
                <td style={{padding:"6px 8px",textAlign:"center"}}><span style={{fontSize:11,padding:"2px 8px",borderRadius:4,background:prob>=60?"rgba(93,202,165,0.15)":prob>=40?"rgba(212,168,52,0.15)":"rgba(226,75,74,0.15)",color:prob>=60?"#5dca96":prob>=40?"#d4a834":"#e24b4a"}}>{Math.round(prob)}%</span></td>
                <td style={{padding:"6px 8px",textAlign:"right",fontFamily:"monospace",fontSize:11}}>{tc(calcXp(s.adj))}</td>
                <td style={{padding:"6px 8px",textAlign:"right",fontWeight:600,fontFamily:"monospace",color:i===0?C.gold:C.txt}}>{tc(calcBid(s.adj))}</td>
              </tr>})}</tbody>
            </table>
            <div style={{fontSize:10,color:C.txd,lineHeight:1.6}}>
              낙찰하한율 {fr}% 적용. 1순위 낙찰자는 낙찰하한율 대비 0.001% 이내에서 투찰합니다 (162건 분석 결과). 안전 전략은 예정가격 이하 진입 확률을 높이고, 공격 전략은 낙찰 금액을 극대화합니다.
            </div>
          </div>})()}
        {/* ★ Phase 3: 투찰 시뮬레이터 */}
        {(()=>{
          const ba=tn(inp.baseAmount);const av=tn(inp.aValue);if(!ba||!pred)return null;
          const fr=pred.fr;const med=pred.adj;const std=Math.max(pred.adjStd||0.7,0.642);
          const normCdf=(x)=>{const t=1/(1+0.2316419*Math.abs(x));const d=0.3989422804*Math.exp(-x*x/2);const p=d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));return x>0?1-p:p};
          const adjVal=simSlider/100; // 슬라이더는 -150~150 → -1.5~+1.5
          const prob=normCdf((med-adjVal)/std)*100;
          const xp=Math.round(ba*(1+adjVal/100));
          const bid=av>0?Math.ceil(av+(xp-av)*(fr/100)):Math.ceil(xp*(fr/100));
          const bidRate=xp>0?Math.round(bid/xp*10000000)/100000:0;
          // 참여자 투찰 분포 (bid_details에서 현재 기관유형 필터)
          const agType=clsAg(inp.agency);
          const typeDets=bidDetails.filter(d=>d.at===agType&&d.bid_dist);
          const distBuckets=["<89","89-89.5","89.5-90","90-90.5","90.5-91","91-91.5","91.5-92",">92"];
          const distSums={};distBuckets.forEach(k=>{distSums[k]=0});
          typeDets.forEach(d=>{if(d.bid_dist){distBuckets.forEach(k=>{distSums[k]+=(d.bid_dist[k]||0)})}});
          const distTotal=Object.values(distSums).reduce((a,b)=>a+b,0);
          const distMax=Math.max(...Object.values(distSums),1);
          // 마진 분석
          const marginFromFloor=bidRate-fr;
          const marginColor=marginFromFloor<0?"#e24b4a":marginFromFloor<0.01?"#5dca96":marginFromFloor<0.1?"#d4a834":"#a8b4ff";
          return<div style={{marginTop:12,padding:"14px",background:"rgba(93,202,165,0.04)",border:"1px solid rgba(93,202,165,0.15)",borderRadius:8}}>
            <div style={{fontWeight:600,color:"#5dca96",marginBottom:10,fontSize:13}}>투찰 시뮬레이터 (Phase 3)</div>
            {/* 슬라이더 */}
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
              <span style={{fontSize:11,color:C.txd,minWidth:50}}>사정률</span>
              <input type="range" min={-150} max={150} step={1} value={simSlider}
                onChange={e=>setSimSlider(Number(e.target.value))}
                style={{flex:1,accentColor:"#5dca96"}}/>
              <span style={{fontSize:14,fontWeight:600,color:adjVal>=0?"#5dca96":"#e24b4a",minWidth:70,textAlign:"right"}}>
                {adjVal>=0?"+":""}{adjVal.toFixed(2)}%
              </span>
            </div>
            {/* 실시간 계산 결과 */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:12}}>
              {[
                {l:"사정률(100%)",v:(100+adjVal).toFixed(4)+"%",c:adjVal>=0?"#5dca96":"#e24b4a"},
                {l:"예정가격 이하",v:Math.round(prob)+"%",c:prob>=60?"#5dca96":prob>=40?"#d4a834":"#e24b4a"},
                {l:"예정가격",v:tc(xp),c:C.txt},
                {l:"투찰금액",v:tc(bid),c:C.gold},
                {l:"투찰률",v:bidRate.toFixed(4)+"%",c:marginColor}
              ].map((c,i)=><div key={i} style={{background:C.bg3,borderRadius:6,padding:"6px",textAlign:"center"}}>
                <div style={{fontSize:9,color:C.txd}}>{c.l}</div>
                <div style={{fontSize:i===3?14:12,fontWeight:i===3?600:500,color:c.c,fontFamily:i>=2?"monospace":"inherit"}}>{c.v}</div>
              </div>)}
            </div>
            {/* 낙찰하한율 마진 경고 */}
            <div style={{padding:"6px 10px",borderRadius:5,fontSize:11,marginBottom:10,
              background:marginFromFloor<0?"rgba(226,75,74,0.1)":marginFromFloor<0.01?"rgba(93,202,165,0.1)":"rgba(212,168,52,0.06)",
              color:marginFromFloor<0?"#e24b4a":marginFromFloor<0.01?"#5dca96":"#d4a834"}}>
              {marginFromFloor<0
                ?"투찰률이 낙찰하한율("+fr+"%) 미만입니다. 적격심사 탈락 위험."
                :marginFromFloor<0.005
                ?"낙찰하한율 대비 +"+marginFromFloor.toFixed(4)+"% — 1순위 경쟁 구간 (598건 중 52%가 이 범위)"
                :marginFromFloor<0.01
                ?"낙찰하한율 대비 +"+marginFromFloor.toFixed(4)+"% — 상위 경쟁 구간"
                :"낙찰하한율 대비 +"+marginFromFloor.toFixed(3)+"% — 여유 있는 마진"}
            </div>
            {/* 참여자 투찰 분포 히트맵 */}
            {distTotal>0&&<div>
              <div style={{fontSize:11,color:C.txd,marginBottom:6}}>참여자 투찰 분포 ({agType}, {typeDets.length}건 합산)</div>
              <div style={{display:"flex",gap:2,height:40,alignItems:"flex-end",marginBottom:4}}>
                {distBuckets.map(k=>{const pct=distSums[k]/distTotal;const h=Math.max(2,pct*40/0.5);
                  const isActive=k==="<89"?bidRate<89:k===">92"?bidRate>=92:bidRate>=parseFloat(k)&&bidRate<parseFloat(k)+0.5;
                  return<div key={k} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end",height:40}}>
                    <div style={{width:"100%",height:h,borderRadius:"2px 2px 0 0",
                      background:isActive?"rgba(212,168,52,0.7)":"rgba(168,180,255,0.3)",
                      border:isActive?"1px solid #d4a834":"none"}}/>
                  </div>})}
              </div>
              <div style={{display:"flex",gap:2}}>
                {distBuckets.map(k=><div key={k} style={{flex:1,textAlign:"center",fontSize:8,color:C.txd}}>{k}</div>)}
              </div>
              <div style={{display:"flex",gap:2,marginTop:2}}>
                {distBuckets.map(k=><div key={k} style={{flex:1,textAlign:"center",fontSize:8,color:C.txd}}>{distTotal>0?Math.round(distSums[k]/distTotal*100)+"%":""}</div>)}
              </div>
            </div>}
            {/* ★ Phase 3-B: 1순위 밀집 분석 + 회피 전략 */}
            {(()=>{
              // 현재 기관유형의 bid_details에서 1순위 마진 분포 계산
              const marginDets=typeDets.filter(d=>d.win_bid_rate&&d.floor_rate>0);
              if(marginDets.length<5)return null;
              const margins=marginDets.map(d=>Math.round((d.win_bid_rate-d.floor_rate)*10000)/10000);
              margins.sort((a,b)=>a-b);
              const mLen=margins.length;
              const mMed=margins[Math.floor(mLen/2)];
              const mP25=margins[Math.floor(mLen*0.25)];
              const mP75=margins[Math.floor(mLen*0.75)];
              const within001=margins.filter(m=>m<0.01).length;
              const within005=margins.filter(m=>m<0.005).length;
              // 현재 시뮬레이터 투찰률의 마진
              const myMargin=Math.round((bidRate-fr)*10000)/10000;
              // 마진 히스토그램 (0.001% 단위)
              const mBins={};margins.forEach(m=>{const b=Math.min(Math.floor(m*1000)/1000,0.01).toFixed(3);mBins[b]=(mBins[b]||0)+1});
              const mBinKeys=Object.keys(mBins).sort((a,b)=>parseFloat(a)-parseFloat(b));
              const mBinMax=Math.max(...Object.values(mBins),1);
              // 순위 추정: 현재 마진이면 몇 % 안에 드는가
              const rankPct=myMargin>=0?Math.round(margins.filter(m=>m>=myMargin).length/mLen*100):0;
              // 회피 전략: 밀집 구간 바로 위를 추천
              const hotzone=fr+mMed;
              const avoidTarget=Math.round((fr+mP25)*10000)/10000;
              return<div style={{marginTop:10,padding:"10px 12px",background:"rgba(168,180,255,0.04)",border:"1px solid rgba(168,180,255,0.12)",borderRadius:6}}>
                <div style={{fontWeight:600,color:"#a8b4ff",marginBottom:8,fontSize:12}}>1순위 경쟁 분석 ({agType}, {marginDets.length}건)</div>
                {/* 마진 분포 바 */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:8}}>
                  {[
                    {l:"마진 중앙값",v:mMed.toFixed(4)+"%",c:"#5dca96"},
                    {l:"0.005% 미만",v:Math.round(within005/mLen*100)+"%",c:"#d4a834"},
                    {l:"0.01% 미만",v:Math.round(within001/mLen*100)+"%",c:"#a8b4ff"},
                    {l:"내 마진 순위",v:myMargin>=0?rankPct+"%":"탈락",c:myMargin<0?"#e24b4a":rankPct<=30?"#5dca96":"#d4a834"}
                  ].map((c,i)=><div key={i} style={{background:C.bg3,borderRadius:5,padding:"5px",textAlign:"center"}}>
                    <div style={{fontSize:8,color:C.txd}}>{c.l}</div>
                    <div style={{fontSize:13,fontWeight:500,color:c.c}}>{c.v}</div>
                  </div>)}
                </div>
                {/* 전략 추천 */}
                <div style={{padding:"6px 10px",borderRadius:5,fontSize:11,lineHeight:1.6,
                  background:myMargin<0?"rgba(226,75,74,0.08)":rankPct<=20?"rgba(93,202,165,0.08)":"rgba(212,168,52,0.06)",
                  color:myMargin<0?"#e24b4a":rankPct<=20?"#5dca96":"#d4a834"}}>
                  {myMargin<0
                    ?"낙찰하한율 미만입니다. 슬라이더를 낮춰 "+fr+"% 이상으로 조정하세요."
                    :rankPct<=10
                    ?"현재 투찰률은 상위 "+rankPct+"% — 1순위 경쟁권입니다. "+marginDets.length+"건 중 "+Math.round(mLen*rankPct/100)+"건만 이보다 밀착했습니다."
                    :rankPct<=30
                    ?"상위 "+rankPct+"% 구간입니다. 1순위에 근접하려면 투찰률을 "+avoidTarget.toFixed(4)+"% 근처로 낮추세요 (마진 "+mP25.toFixed(4)+"%)."
                    :"마진이 넓습니다 ("+myMargin.toFixed(4)+"%). 1순위권 진입을 위해 낙찰하한율 +0.001~0.005% 구간("+fr+"~"+(fr+0.005).toFixed(3)+"%)을 목표로 슬라이더를 조정하세요."}
                </div>
              </div>})()}
          </div>})()}
      </div>}

      {/* ★ Phase 4-A: AI 전략 어드바이저 */}
      {pred&&<div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,padding:16,marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={{fontWeight:600,color:"#a8b4ff",fontSize:13}}>AI 전략 어드바이저</div>
          <button disabled={aiLoading} onClick={async()=>{
            setAiLoading(true);setAiAdvice("");
            try{const prompt=buildAiPrompt({pn:"수동입력: "+inp.agency,ag:inp.agency.trim(),at:clsAg(inp.agency),ba:tn(inp.baseAmount),ep:tn(inp.estimatedPrice),av:tn(inp.aValue),pred});
              if(!prompt)throw new Error("예측 데이터 없음");
              const text=await callAi(prompt);setAiAdvice(text)}
            catch(e){setAiAdvice("⚠ "+e.message)}finally{setAiLoading(false)}
          }} style={{padding:"5px 14px",fontSize:11,background:aiLoading?"rgba(168,180,255,0.05)":"rgba(168,180,255,0.1)",border:"1px solid rgba(168,180,255,0.3)",borderRadius:5,color:"#a8b4ff",cursor:aiLoading?"default":"pointer",fontWeight:500}}>
            {aiLoading?"분석 중...":"전략 분석 요청"}
          </button>
        </div>
        {aiAdvice&&<div style={{padding:"12px 14px",background:"rgba(168,180,255,0.04)",border:"1px solid rgba(168,180,255,0.12)",borderRadius:6,fontSize:13,lineHeight:1.8,color:C.txt,whiteSpace:"pre-wrap"}}>{aiAdvice}</div>}
        {!aiAdvice&&!aiLoading&&<div style={{fontSize:11,color:C.txd,textAlign:"center",padding:12}}>예측 결과를 기반으로 AI가 맞춤형 투찰 전략을 분석합니다</div>}
      </div>}
      {compStats.matched>=3&&<div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,padding:16,marginBottom:12}}>
        <div style={{fontSize:13,fontWeight:600,color:"#a8b4ff",marginBottom:10}}>모델 성능 (v5 · {compStats.matched}건 검증)</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:10}}>
          {[
            {l:"MAE",v:compStats.avgErr.toFixed(4)+"%",c:"#d4a834",sub:"평균절대오차"},
            {l:"Bias",v:(compStats.bias>=0?"+":"")+compStats.bias.toFixed(4)+"%",c:Math.abs(compStats.bias)<0.1?"#5dca96":"#e24b4a",sub:"편향"},
            {l:"적중률 (±0.5%)",v:compStats.matched>0?Math.round(compStats.within05/compStats.matched*100)+"%":"—",c:"#5dca96",sub:"실전 정확도"},
            {l:"노이즈 바닥",v:"0.6420%",c:C.txd,sub:"이론적 한계"}
          ].map((c,i)=>
            <div key={i} style={{background:C.bg3,borderRadius:6,padding:"8px 6px",textAlign:"center"}}>
              <div style={{fontSize:9,color:C.txd}}>{c.l}</div>
              <div style={{fontSize:16,fontWeight:600,color:c.c}}>{c.v}</div>
              <div style={{fontSize:8,color:C.txd}}>{c.sub}</div>
            </div>)}
        </div>
        {Object.keys(compStats.byType).length>1&&<div>
          <div style={{fontSize:10,color:C.txd,marginBottom:4}}>기관유형별 MAE</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {Object.entries(compStats.byType).sort((a,b)=>b[1].n-a[1].n).map(([t,v])=>
              <div key={t} style={{background:C.bg,borderRadius:5,padding:"4px 8px",fontSize:10,border:"1px solid "+C.bdr}}>
                <span style={{color:C.txm}}>{t}</span>
                <span style={{color:v.avgErr<0.5?"#5dca96":v.avgErr<0.8?"#d4a834":"#e24b4a",fontWeight:600,marginLeft:4}}>{v.avgErr.toFixed(4)}%</span>
                <span style={{color:C.txd,marginLeft:2}}>({v.n}건)</span>
              </div>)}
          </div>
        </div>}
      </div>}

      {/* 예측 내역 + 비교 통합 */}
      <div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,padding:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={{fontSize:13,fontWeight:600,color:C.gold}}>예측 내역 + 정확도 비교</div>
          <button onClick={async()=>{setBusy(true);const r=await refreshAll();setBusy(false);setMsg({type:"ok",text:r?`전체 새로고침 완료 (낙찰 ${r.records.toLocaleString()} · 상세 ${r.details} · 예측 ${r.predictions}${r.matched>0?" · "+r.matched+"건 매칭":""})`:"새로고침 실패"})}} disabled={busy}
            style={{padding:"5px 12px",fontSize:11,background:C.bg3,border:"1px solid "+C.bdr,borderRadius:5,color:C.txt,cursor:busy?"default":"pointer"}}>
            {busy?"갱신중...":"새로고침"}
          </button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:12}}>
          {[{l:"총 예측",v:compStats.total,c:C.txt},{l:"매칭 완료",v:compStats.matched,c:"#5dca96"},{l:"MAE",v:compStats.matched>0?compStats.avgErr.toFixed(4)+"%":"—",c:"#d4a834"},{l:"Bias",v:compStats.matched>0?(compStats.bias>=0?"+":"")+compStats.bias.toFixed(4)+"%":"—",c:compStats.bias<0?"#e24b4a":"#5dca96"},{l:"대기 중",v:compStats.pending,c:"#e24b4a"}].map((c,i)=>
            <div key={i} style={{background:C.bg3,borderRadius:6,padding:"8px",textAlign:"center"}}>
              <div style={{fontSize:10,color:C.txd}}>{c.l}</div>
              <div style={{fontSize:16,fontWeight:600,color:c.c}}>{c.v}</div>
            </div>)}
        </div>
        <div style={{display:"flex",gap:4,marginBottom:10}}>
          <button onClick={()=>setCompFilter("all")} style={btnS(compFilter==="all",C.gold)}>전체 ({compStats.total})</button>
          <button onClick={()=>setCompFilter("matched")} style={btnS(compFilter==="matched","#5dca96")}>매칭 ({compStats.matched})</button>
          <button onClick={()=>setCompFilter("pending")} style={btnS(compFilter==="pending","#e24b4a")}>대기 ({compStats.pending})</button>
        </div>
        {compList.length>0?<div style={{overflow:"auto",maxHeight:500}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,tableLayout:"fixed"}}>
            <colgroup><col style={{width:"18%"}}/><col style={{width:"8%"}}/><col style={{width:"8%"}}/><col style={{width:"8%"}}/><col style={{width:"6%"}}/><col style={{width:"8%"}}/><col style={{width:"8%"}}/><col style={{width:"9%"}}/><col style={{width:"8%"}}/><col style={{width:"7%"}}/><col style={{width:"7%"}}/><col style={{width:"5%"}}/></colgroup>
            <thead><tr style={{background:C.bg3}}>
              <SortTh label="공고명" sortKey="pn" current={predSort} setCurrent={setPredSort}/>
              <SortTh label="발주기관" sortKey="ag" current={predSort} setCurrent={setPredSort}/>
              <SortTh label="예측사정률" sortKey="pred_adj_rate" current={predSort} setCurrent={setPredSort} align="right"/>
              <SortTh label="실제사정률" sortKey="actual_adj_rate" current={predSort} setCurrent={setPredSort} align="right"/>
              <SortTh label="오차" sortKey="adj_rate_error" current={predSort} setCurrent={setPredSort} align="right"/>
              <th style={{padding:"7px 6px",textAlign:"right",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:11}}>예상투찰율</th>
              <th style={{padding:"7px 6px",textAlign:"right",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:11}}>실제투찰율</th>
              <th style={{padding:"7px 6px",textAlign:"right",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:11}}>추천금액</th>
              <th style={{padding:"7px 6px",textAlign:"right",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:11}}>실제금액</th>
              <SortTh label="개찰일" sortKey="open_date" current={predSort} setCurrent={setPredSort} align="right"/>
              <th style={{padding:"7px 6px",textAlign:"left",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:11}}>근거</th>
              <SortTh label="상태" sortKey="match_status" current={predSort} setCurrent={setPredSort} align="center"/>
            </tr></thead>
            <tbody>{compList.slice(0,100).map(p=>{
              const errColor=p.adj_rate_error!=null?(Math.abs(p.adj_rate_error)<0.3?"#5dca96":Math.abs(p.adj_rate_error)<1?"#d4a834":"#e24b4a"):C.txd;
              const predBidRate=(p.pred_bid_amount&&p.pred_expected_price&&p.pred_expected_price>0)?Number(p.pred_bid_amount)/Number(p.pred_expected_price)*100:null;
              const actBidRate=(p.actual_bid_amount&&p.actual_expected_price&&p.actual_expected_price>0)?Number(p.actual_bid_amount)/Number(p.actual_expected_price)*100:null;
              return<tr key={p.id} style={{borderBottom:"1px solid "+C.bdr}}>
                <td style={{padding:"6px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={p.pn}>{p.pn}</td>
                <td style={{padding:"6px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.ag}</td>
                <td style={{padding:"6px",textAlign:"right",color:"#5dca96"}}>{p.pred_adj_rate!=null?(100+Number(p.pred_adj_rate)).toFixed(4)+"%":""}</td>
                <td style={{padding:"6px",textAlign:"right",color:C.gold}}>{p.actual_adj_rate!=null?(100+Number(p.actual_adj_rate)).toFixed(4)+"%":""}</td>
                <td style={{padding:"6px",textAlign:"right",color:errColor,fontWeight:600}}>{p.adj_rate_error!=null?Number(p.adj_rate_error).toFixed(4):""}</td>
                <td style={{padding:"6px",textAlign:"right",fontFamily:"monospace",color:"#85b7eb"}}>{predBidRate!=null?predBidRate.toFixed(3)+"%":""}</td>
                <td style={{padding:"6px",textAlign:"right",fontFamily:"monospace",color:actBidRate!=null?"#d4a834":C.txd}}>{actBidRate!=null?actBidRate.toFixed(3)+"%":""}</td>
                <td style={{padding:"6px",textAlign:"right",fontFamily:"monospace"}}>{p.pred_bid_amount?tc(p.pred_bid_amount):""}</td>
                <td style={{padding:"6px",textAlign:"right",fontFamily:"monospace"}}>{p.actual_bid_amount?tc(p.actual_bid_amount):""}</td>
                <td style={{padding:"6px",textAlign:"right"}}>{p.open_date||""}</td>
                <td style={{padding:"6px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:10,color:C.txd}} title={p.pred_source||""}>{p.pred_source||""}</td>
                <td style={{padding:"6px",textAlign:"center"}}><span style={{fontSize:10,padding:"2px 6px",borderRadius:4,background:p.match_status==="matched"?"rgba(93,202,165,0.15)":"rgba(226,75,74,0.15)",color:p.match_status==="matched"?"#5dca96":"#e24b4a"}}>{p.match_status==="matched"?"매칭":"대기"}</span></td>
              </tr>})}</tbody>
          </table>
        </div>:<div style={{textAlign:"center",padding:30,color:C.txd,fontSize:12}}>예측 내역이 없습니다.</div>}
      </div>
    </div>}

    </div>
  </div>)}
