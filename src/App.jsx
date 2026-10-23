import React, { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { C, PAGE, inpS } from "./lib/constants.js";
import PredictionFeedback from "./components/PredictionFeedback.jsx";
import NoticesTab from "./components/NoticesTab.jsx";
import BidCard from "./components/BidCard.jsx";
import { recOfPred } from "./lib/bidCard.js";
import { buildTodayRows, countTodayActions } from "./lib/todayNotices.js";
import { loadKeywords } from "./lib/eligibility.js";
import { bidVerdict } from "./lib/rec1stPossible.js";
import DataTab from "./components/DataTab.jsx";
import { TOP_TABS, SUB_TABS, DEFAULT_TAB, REF_ONLY_TABS, REF_ONLY_BANNER } from "./lib/tabs.js";
import { G2B_AUTO_SHOW, mergeAutoRows } from "./lib/g2bAuto.js";
import { sbFetchG2BAuto } from "./lib/supabase.js";
import PerformanceTab from "./components/PerformanceTab.jsx";
import AdminTab from "./components/AdminTab.jsx";
import AgencyPredictorTab from "./components/AgencyPredictorTab.jsx";
import G2BSheetTab from "./components/G2BSheetTab.jsx";
import OwnScoreInput from "./components/OwnScoreInput.jsx";
import { calcEffectiveFloorRate, parseOwnScore } from "./lib/effectiveFloor.js";
import { clean, tc, pDt, mSch, md5, parseFile, toRecord, toRecords, parseBidDoc, calcStats, predictV5, calcDataStatus, isSucviewFile, parseSucview, pnv, sn, eraFR, isNewEra, isLhJongsim, sanitizeJson, recommendAssumedAdj, calcRoiV2, WIN_OPT_GAP, calcWin1stBid, calcBenchmarkAdj, getBiasArrow, normalizeAgencyName, recommendMain, recommendV2, baSegOf, predConfidence, predConfidenceV2 } from "./lib/utils.js";
import { resolveMode } from "./lib/modeResolver.js";
import { floorModeOf, riskColor, riskLabel } from "./lib/floorRisk.js";
import { buildAdjHistory, resolveAdjHistory, impliedAdjOfBid, passProbPct, passRiskSnapshot } from "./lib/passProb.js";
import { buildPcDistMap, resolvePcDist, pcBucketOf, pcColor, pcSnapshot, PC_GRAIN_LABELS } from "./lib/participantCount.js";
import { sbFetchAll, sbUpsert, sbSavePredictions, sbFetchPredictions, sbMatchPredictions, sbDeletePredictions, sbSaveDetail, sbSaveParticipants, sbRefreshParticipantDistFor, sbFetchDetails, sbFetchDetailsByAg, sbFetchAgAssumedStats, sbFetchPredBiasMap, sbFetchAccuracyMap, sbFetchFloorBench, sbFetchBasegFinetune, sbFetchAgencyPredictor, sbFetchNotices, sbRecordSnapshots, sbUpdateStrategyOutcomes, sbFetchQualityDaily, sbFetchWeeklyQuality, sbFetchBiasHotspots, sbFetchWatchlist, sbFetchWatchlistHistory, sbFetchWin1stDistMap, sbUpdatePredictionsV2, sbFetchAgencyFloorPredictions, sbFetchAgencyRateDistribution, sbFetchMatchedRecords, sbFetchAgencyHistoryByName } from "./lib/supabase.js";
import { sbFetchAllCached } from "./lib/bidCache.js";
import { useAuth, getSession } from "./auth.js";

// 하한 통과 확률 계산의 공통 입력 — 저장 스냅샷·상세·목록이 같은 기준 기록·같은 요율을 쓰게 한다.
//   기준 기록 키: DB가 저장 시 붙이는 canonical_ag와 같은 값(normalizeAgencyName = DB normalize_agency_name과 같은 규칙).
//     업로드 직후의 행에는 canonical_ag가 아직 없다 — ag를 그대로 쓰면 교육청·조달청 13%가 기관유형 기준으로 떨어진다.
//   요율: 개찰일 기준 현재 요율표 + 현재 자사 점수. bid_predictions에는 공고일이 저장되지 않아 세 곳 모두 개찰일로 통일한다.
const passKeyOf=(x)=>({at:x.at,canonicalAg:x.canonical_ag||normalizeAgencyName(x.ag)});
const passEffFrOf=(x,ownScore)=>calcEffectiveFloorRate(x.at,eraFR(x.at,Number(x.ep)||Number(x.ba),x.open_date||new Date().toISOString().slice(0,10)),ownScore);

// ─── 컴포넌트 ──────────────────────────────────────────────

// 취소 공고 식별 — pn 텍스트에 (취소) 또는 [취소] 포함. 매칭 불가 + UI에서 "취소" 라벨로 분리 표시.
const isCancelledPred=(p)=>!!(p&&p.pn&&/[\(\[]\s*취소\s*[\)\]]/.test(p.pn));


// 계정 배지 (헤더 우측: 이메일 + 로그아웃) — useAuth() 로 Context 에서 받음
function UserBadge(){
  const {user,signOut}=useAuth();
  if(!user)return null;
  const email=user.email||"";
  // 이메일을 @ 앞부분만 표시 (공간 절약). 툴팁엔 전체 이메일.
  const shortName=email.includes("@")?email.split("@")[0]:email;
  return<div style={{display:"flex",alignItems:"center",gap:8,paddingLeft:12,marginLeft:4,borderLeft:"1px solid "+C.bdr}}>
    <span title={email} style={{fontSize:11,color:C.txm,maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{shortName}</span>
    <button onClick={signOut} title="로그아웃"
      style={{padding:"4px 10px",fontSize:10,background:"transparent",border:"1px solid "+C.bdr,borderRadius:5,color:C.txd,cursor:"pointer",whiteSpace:"nowrap"}}
      onMouseEnter={e=>{e.currentTarget.style.color=C.txt;e.currentTarget.style.borderColor=C.txm}}
      onMouseLeave={e=>{e.currentTarget.style.color=C.txd;e.currentTarget.style.borderColor=C.bdr}}>
      로그아웃
    </button>
  </div>
}

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


// ─── Phase 12-C: 발주사별 낙찰 예측 헬퍼 ──────────────────
// 사정률(100%) 표기: br1 값 그대로 또는 (100 + 0-base사정률)

// ─── V1: 발주사 하한 예측탭 (2026-05-13) ──────────────────
// 펼침 패널: 해당 canonical_ag의 최근 30건 + 평균/std 요약
function AgencyFloorHistoryPanel({canonicalAg}){
  const [rows,setRows]=useState(null);
  const [loading,setLoading]=useState(false);
  useEffect(()=>{
    if(!canonicalAg)return;
    let cancel=false;
    setLoading(true);
    sbFetchAgencyHistoryByName(canonicalAg,30).then(r=>{
      if(cancel)return;
      setRows(Array.isArray(r)?r:[]);
      setLoading(false);
    });
    return()=>{cancel=true};
  },[canonicalAg]);
  if(loading)return<tr><td colSpan={8} style={{padding:"10px 14px",color:C.txd,fontSize:11,background:C.bg2}}>이력 로딩 중...</td></tr>;
  if(!rows)return null;
  if(rows.length===0)return<tr><td colSpan={8} style={{padding:"10px 14px",color:C.txd,fontSize:11,background:C.bg2}}>이전 입찰 없음</td></tr>;
  const ar1s=rows.map(r=>Number(r.ar1)).filter(v=>isFinite(v));
  const ar1Mean=ar1s.length?ar1s.reduce((a,b)=>a+b,0)/ar1s.length:NaN;
  const ar1Std=ar1s.length?Math.sqrt(ar1s.reduce((s,v)=>s+(v-ar1Mean)**2,0)/ar1s.length):NaN;
  const brs=rows.map(r=>Number(r.base_ratio)).filter(v=>isFinite(v));
  const brMean=brs.length?brs.reduce((a,b)=>a+b,0)/brs.length:NaN;
  const frs=rows.map(r=>Number(r.fr)).filter(v=>isFinite(v));
  const frMean=frs.length?frs.reduce((a,b)=>a+b,0)/frs.length:NaN;
  return<tr><td colSpan={8} style={{padding:0,background:C.bg2}}>
    <div style={{padding:"10px 14px"}}>
      <div style={{fontSize:11,color:C.txm,marginBottom:8,fontWeight:600}}>
        {canonicalAg} — 이전 입찰 이력 (최근 {rows.length}건)
      </div>
      <table style={{width:"100%",fontSize:11,borderCollapse:"collapse"}}>
        <thead><tr style={{color:C.txd}}>
          <th style={{textAlign:"left",padding:"3px 6px"}}>개찰일</th>
          <th style={{textAlign:"left",padding:"3px 6px"}}>공고명</th>
          <th style={{textAlign:"right",padding:"3px 6px"}}>기초(억)</th>
          <th style={{textAlign:"right",padding:"3px 6px"}}>1위 사정률</th>
          <th style={{textAlign:"right",padding:"3px 6px"}}>낙찰가/기초</th>
          <th style={{textAlign:"right",padding:"3px 6px"}}>fr</th>
          <th style={{textAlign:"right",padding:"3px 6px"}}>낙찰가(원)</th>
          <th style={{textAlign:"left",padding:"3px 6px"}}>1위 업체</th>
        </tr></thead>
        <tbody>{rows.map(r=>(
          <tr key={r.id} style={{borderTop:"1px solid "+C.bdr}}>
            <td style={{padding:"3px 6px"}}>{r.od||"-"}</td>
            <td style={{padding:"3px 6px",maxWidth:240,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={r.pn||""}>{(r.pn||"").slice(0,35)}{(r.pn||"").length>35?"...":""}</td>
            <td style={{padding:"3px 6px",textAlign:"right",fontFamily:"monospace"}}>{r.ba!=null?(Number(r.ba)/1e8).toFixed(2):"-"}</td>
            <td style={{padding:"3px 6px",textAlign:"right",fontFamily:"monospace"}}>{r.ar1!=null?Number(r.ar1).toFixed(4)+"%":"-"}</td>
            <td style={{padding:"3px 6px",textAlign:"right",fontFamily:"monospace"}}>{r.base_ratio!=null?Number(r.base_ratio).toFixed(4)+"%":"-"}</td>
            <td style={{padding:"3px 6px",textAlign:"right",fontFamily:"monospace"}}>{r.fr!=null?Number(r.fr).toFixed(3)+"%":"-"}</td>
            <td style={{padding:"3px 6px",textAlign:"right",fontFamily:"monospace"}}>{r.bp!=null?Number(r.bp).toLocaleString():"-"}</td>
            <td style={{padding:"3px 6px"}}>{r.co||"-"}</td>
          </tr>
        ))}</tbody>
      </table>
      <div style={{fontSize:10,color:C.txd,marginTop:8}}>
        평균 1위 사정률 {isFinite(ar1Mean)?ar1Mean.toFixed(4)+"%":"-"} · std {isFinite(ar1Std)?ar1Std.toFixed(4)+"pp":"-"} · 평균 낙찰가/기초 {isFinite(brMean)?brMean.toFixed(4)+"%":"-"} (fr 평균 {isFinite(frMean)?frMean.toFixed(3)+"%":"-"} · 마진 {isFinite(brMean-frMean)?(brMean-frMean).toFixed(4)+"pp":"-"})
      </div>
    </div>
  </td></tr>;
}

// 메인 테이블 한 행 — 클릭 시 펼침 토글
function AgencyFloorRow({pred,signal,matched,expanded,onToggle}){
  const predRate=signal?signal.median:null;
  const actRate=pred.actual_adj_rate!=null?(100+Number(pred.actual_adj_rate)):null;
  const error=(predRate!=null&&actRate!=null)?(predRate-actRate):null;
  const errColor=error==null?C.txd:(Math.abs(error)>=0.5?"#e24b4a":C.txd);
  const stageBadge=signal?(
    signal.stage===1?"업종·"+(signal.confidence||""):
    signal.stage===2?"발주사평균":
    signal.stage===3?"글로벌":""
  ):"";
  return<>
    <tr style={{borderTop:"1px solid "+C.bdr,cursor:"pointer"}}
        onClick={onToggle}
        title={expanded?"클릭하여 닫기":"클릭하여 이전 입찰 이력 보기"}>
      <td style={{padding:"6px 8px",fontSize:11}}>{pred.open_date||"-"}</td>
      <td style={{padding:"6px 8px",fontSize:11}}>
        <div style={{fontWeight:600}}>{pred.ag||"-"}</div>
        <div style={{fontSize:9,color:C.txd}}>{pred.cat||"-"}</div>
      </td>
      <td style={{padding:"6px 8px",fontSize:11,textAlign:"right",fontFamily:"monospace"}}>
        {pred.ba!=null?(Number(pred.ba)/1e8).toFixed(2):"-"}
      </td>
      <td style={{padding:"6px 8px",fontSize:11,textAlign:"right",fontFamily:"monospace"}}>
        {predRate!=null?<>
          <div style={{fontWeight:600}}>{Number(predRate).toFixed(4)}%</div>
          {stageBadge&&<div style={{fontSize:9,color:C.txd}}>[{stageBadge}·n={signal.n||0}]</div>}
        </>:<span style={{color:C.txd}}>예측 불가</span>}
      </td>
      <td style={{padding:"6px 8px",fontSize:11,textAlign:"right",fontFamily:"monospace"}}>
        {actRate!=null?Number(actRate).toFixed(4)+"%":<span style={{color:C.txd}}>—</span>}
      </td>
      <td style={{padding:"6px 8px",fontSize:11,textAlign:"right",fontFamily:"monospace"}}>
        {matched&&matched.base_ratio!=null?Number(matched.base_ratio).toFixed(4)+"%":<span style={{color:C.txd}}>—</span>}
      </td>
      <td style={{padding:"6px 8px",fontSize:11,textAlign:"right",fontFamily:"monospace"}}>
        {matched&&matched.fr!=null?Number(matched.fr).toFixed(3)+"%":<span style={{color:C.txd}}>—</span>}
      </td>
      <td style={{padding:"6px 8px",fontSize:11,textAlign:"right",fontFamily:"monospace",color:errColor,fontWeight:Math.abs(error||0)>=0.5?700:400}}>
        {error!=null?(error>0?"+":"")+Number(error).toFixed(4):<span style={{color:C.txd}}>—</span>}
      </td>
    </tr>
    {expanded&&<AgencyFloorHistoryPanel canonicalAg={pred.canonical_ag}/>}
  </>;
}

// 메인 컨테이너 — 데이터 fetch + 신호 4단계 폴백 + 요약 헤더 + 테이블
function AgencyFloorTab(){
  const [preds,setPreds]=useState(null);
  const [sigRows,setSigRows]=useState([]);
  const [matched,setMatched]=useState({});
  const [expandedId,setExpandedId]=useState(null);
  const [loading,setLoading]=useState(false);

  useEffect(()=>{
    let cancel=false;
    setLoading(true);
    (async()=>{
      const p=await sbFetchAgencyFloorPredictions(500);
      if(cancel)return;
      const filtered=(p||[]).filter(x=>!x.is_cancelled);
      setPreds(filtered);
      const ags=[...new Set(filtered.map(x=>x.canonical_ag).filter(Boolean))];
      const matchedIds=[...new Set(filtered.map(x=>x.matched_record_id).filter(v=>v!=null))];
      const [d,mr]=await Promise.all([
        sbFetchAgencyRateDistribution(ags),
        sbFetchMatchedRecords(matchedIds)
      ]);
      if(cancel)return;
      setSigRows((d&&d.rows)||[]);
      setMatched(mr||{});
      setLoading(false);
    })().catch(()=>{if(!cancel)setLoading(false)});
    return()=>{cancel=true};
  },[]);

  // 신호 매핑 함수 (3단계 폴백: 업종 정확 → 발주사 평균 → 글로벌 중앙값)
  const sigLookup=useMemo(()=>{
    const byKey={};const byAg={};const allMed=[];
    for(const r of sigRows){
      const med=Number(r.median_adj_ratio);
      if(!isFinite(med))continue;
      const k=r.canonical_ag+"|"+(r.cat||"");
      byKey[k]={median:med,n:Number(r.sample_size)||0,confidence:r.confidence,tier:r.tier};
      if(!byAg[r.canonical_ag])byAg[r.canonical_ag]={sum:0,cnt:0,n:0};
      byAg[r.canonical_ag].sum+=med;
      byAg[r.canonical_ag].cnt+=1;
      byAg[r.canonical_ag].n+=Number(r.sample_size)||0;
      allMed.push(med);
    }
    let globalMed=100;
    if(allMed.length){
      const sorted=allMed.slice().sort((a,b)=>a-b);
      globalMed=sorted[Math.floor(sorted.length/2)];
    }
    return function lookup(canonicalAg,cat){
      if(!canonicalAg)return null;
      const k=canonicalAg+"|"+(cat||"");
      const s1=byKey[k];
      if(s1&&(s1.confidence==="high"||s1.confidence==="medium")&&s1.n>=5){
        return{stage:1,median:s1.median,n:s1.n,confidence:s1.confidence};
      }
      const s2=byAg[canonicalAg];
      if(s2&&s2.cnt>0){
        return{stage:2,median:s2.sum/s2.cnt,n:s2.n,confidence:"avg"};
      }
      return{stage:3,median:globalMed,n:allMed.length,confidence:"global"};
    };
  },[sigRows]);

  // 요약 통계 (전체 n / matched / 데이터대기 / 평균 |오차| / 1pp 적중률)
  // 데이터대기: matched이나 actual_adj_rate NULL — 사정률 데이터 미수집 (인포21c 별도 파일 업로드 필요)
  const summary=useMemo(()=>{
    if(!preds)return null;
    const n=preds.length;
    const matchedCnt=preds.filter(p=>p.match_status==="matched"&&p.actual_adj_rate!=null).length;
    const dataWaitCnt=preds.filter(p=>p.match_status==="matched"&&p.actual_adj_rate==null).length;
    const errs=[];let hit1=0;
    for(const p of preds){
      if(p.actual_adj_rate==null)continue;
      const sig=sigLookup(p.canonical_ag,p.cat);
      if(!sig)continue;
      const act=100+Number(p.actual_adj_rate);
      const err=Math.abs(sig.median-act);
      if(!isFinite(err))continue;
      errs.push(err);
      if(err<1.0)hit1++;
    }
    return{
      n:n,
      matched:matchedCnt,
      dataWait:dataWaitCnt,
      mae:errs.length?(errs.reduce((a,b)=>a+b,0)/errs.length):null,
      hit1pp:errs.length?((hit1/errs.length)*100):null
    };
  },[preds,sigLookup]);

  if(loading||preds==null){
    return<div style={{padding:24,color:C.txd,fontSize:12}}>발주사 하한 예측 데이터 로딩 중...</div>;
  }

  return<div>
    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12,padding:"10px 12px",background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,fontSize:12,flexWrap:"wrap"}}>
      <span style={{fontWeight:700,color:C.gold}}>발주사 하한 예측</span>
      <span style={{color:C.bdr}}>|</span>
      <span>예측 대상 <strong>{summary?summary.n:0}건</strong></span>
      <span style={{color:C.bdr}}>·</span>
      <span>매칭 <strong>{summary?summary.matched:0}건</strong></span>
      {summary&&summary.dataWait>0&&<>
        <span style={{color:C.bdr}}>·</span>
        <span title="매칭됐으나 사정률(ar1) 미수집. 인포21c에서 사정률 파일 별도 업로드 필요. 업로드 후 다음 시간 cron(매시간 15분)이 자동 백필.">
          데이터대기 <strong style={{color:"#8a93a8"}}>{summary.dataWait}건</strong>
        </span>
      </>}
      {summary&&summary.mae!=null&&<>
        <span style={{color:C.bdr}}>·</span>
        <span>평균 |오차| <strong>{summary.mae.toFixed(4)}pp</strong></span>
      </>}
      {summary&&summary.hit1pp!=null&&<>
        <span style={{color:C.bdr}}>·</span>
        <span>1pp 적중률 <strong>{summary.hit1pp.toFixed(1)}%</strong></span>
      </>}
    </div>
    {preds.length===0?
      <div style={{padding:24,color:C.txd,textAlign:"center",fontSize:12,background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8}}>업로드된 file_upload 예측이 없습니다.</div>
      :
      <table style={{width:"100%",fontSize:11,borderCollapse:"collapse",background:C.bg2,border:"1px solid "+C.bdr,borderRadius:6,overflow:"hidden"}}>
        <thead><tr style={{color:C.txd,background:C.bg3}}>
          <th style={{textAlign:"left",padding:"6px 8px",fontWeight:600}}>개찰일</th>
          <th style={{textAlign:"left",padding:"6px 8px",fontWeight:600}}>발주사 / 업종</th>
          <th style={{textAlign:"right",padding:"6px 8px",fontWeight:600}}>기초(억)</th>
          <th style={{textAlign:"right",padding:"6px 8px",fontWeight:600}}>예측 1위 사정률</th>
          <th style={{textAlign:"right",padding:"6px 8px",fontWeight:600}}>실측 1위 사정률</th>
          <th style={{textAlign:"right",padding:"6px 8px",fontWeight:600}}>낙찰가/기초</th>
          <th style={{textAlign:"right",padding:"6px 8px",fontWeight:600}}>낙찰하한율</th>
          <th style={{textAlign:"right",padding:"6px 8px",fontWeight:600}}>오차(pp)</th>
        </tr></thead>
        <tbody>{preds.map(p=>{
          const sig=sigLookup(p.canonical_ag,p.cat);
          const m=p.matched_record_id?matched[p.matched_record_id]:null;
          return<AgencyFloorRow key={p.id} pred={p} signal={sig} matched={m}
            expanded={expandedId===p.id}
            onToggle={()=>setExpandedId(expandedId===p.id?null:p.id)} />;
        })}</tbody>
      </table>
    }
  </div>;
}


// ═══════════════════════════════════════════════════════════
export default function App(){
  const{isAdmin}=useAuth();
  const[tab,setTab]=useState(DEFAULT_TAB);
  const[moreTabs,setMoreTabs]=useState(false); // 보조 메뉴(피드백·검증·V6·하한·V2) 접기 — 자주 쓰는 5개만 기본 노출
  const[recs,setRecs]=useState([]);
  const[allS,setAllS]=useState({ts:{},as:{}});const[newS,setNewS]=useState({ts:{},as:{}});const[oldS,setOldS]=useState({ts:{},as:{}});
  const[drag,setDrag]=useState(false);const[dragPred,setDragPred]=useState(false);const[busy,setBusy]=useState(false);const[msg,setMsg]=useState({type:"",text:""});
  const[uploadLog,setUploadLog]=useState([]);const[dataStatus,setDataStatus]=useState(null);
  const[search,setSearch]=useState("");const[agSch,setAgSch]=useState("");const[eF,setEF]=useState("all");const[atF,setAtF]=useState("all");
  const[dataPage,setDataPage]=useState(0);const[dbLoading,setDbLoading]=useState(true);
  const[hideAbnormal,setHideAbnormal]=useState(false); // D-1: 비정상 데이터 필터
  const[predResults,setPredResults]=useState([]);
  const[predictions,setPredictions]=useState([]);
  const[lastG2bAt,setLastG2bAt]=useState(null); // 나라장터 자동 예측 마지막 갱신 시각
  const[lastSucviewAt,setLastSucviewAt]=useState(null); // SUCVIEW 마지막 업로드 시각
  const[notices,setNotices]=useState([]); // 나라장터 공고 목록
  const[g2bAuto,setG2bAuto]=useState([]); // G2B 양식 자동 수집 완성 행 — G2B 양식·투찰 카드 1위 이력 전용(예측 계산에 넘기지 말 것)
  const[noticeLoadingIds,setNoticeLoadingIds]=useState(new Set()); // 예측 등록 중인 notice id
  const[noticeFilter,setNoticeFilter]=useState("upcoming"); // upcoming/all/registered
  const[predBiasMap,setPredBiasMap]=useState({agBa:{},ag:{},atBa:{},at:{}}); // Phase 23-2: 동적 편향 보정 (AG×금액대 다층)
  const[accuracyMap,setAccuracyMap]=useState({agBa:{},ag:{},atBa:{},at:{}}); // Track2: 실측 정확도(n/bias/mae/sd) — 신뢰도 V2 표시용
  // 하한 통과 확률용 과거 발주처 사정율 기록 (발주기관·기관유형별, 최근 3년) — passProb.js. recs가 바뀔 때만 다시 만든다.
  const adjHist=useMemo(()=>buildAdjHistory(recs,new Date().toISOString().slice(0,10)),[recs]);
  const pcDistMap=useMemo(()=>buildPcDistMap(recs,new Date().toISOString().slice(0,10)),[recs]); // 예상 참가자수: 발주기관×금액대 직전 365일 중앙값 (2026-10-21, 표시·선별 전용)
  const[pcFilter,setPcFilter]=useState(""); // 예측 리스트 참가자수 버킷 필터 (""=전체, small/mid/large)
  const[basegFinetune,setBasegFinetune]=useState({}); // Phase 23-3: 한전·고양시 (ag,at,seg) median fine-tune
  // V2_DOMAIN_RULES_CHECK #1 — 자사 비가격 점수 (0~20, 디폴트 20=만점)
  // v2 키: 구 키에는 초기화 결함(키 없음 → Number(null)=0)이 써 둔 "0"이 남아 있다. 의도한 0과 구분할 수 없어
  // 구 키의 0은 20으로 보고(사용자 확인: 0 입력 없음, 2026-10-12), 1~20은 사용자가 넣은 값이므로 승계한다.
  const OWN_SCORE_KEY='bidAnalyzer.ownScore.v2';
  const[ownScore,setOwnScore]=useState(()=>{
    try{
      const cur=localStorage.getItem(OWN_SCORE_KEY);
      if(cur!=null)return parseOwnScore(cur,20);
      return parseOwnScore(localStorage.getItem('bidAnalyzer.ownScore'),20)||20;
    }catch{return 20;}
  });
  useEffect(()=>{try{localStorage.setItem(OWN_SCORE_KEY,String(ownScore));}catch{}},[ownScore]);
  const[claudeApiKey,setClaudeApiKey]=useState(""); // Phase 5.4-B: Edge Function 프록시 사용, 레거시 호환 유지
  const[compFilter,setCompFilter]=useState("all");
  const[agFilter,setAgFilter]=useState(""); // 예측 리스트 발주기관 필터 (""=전체)
  const[predListShow,setPredListShow]=useState(50); // 리스트 표시 건수 (더보기)
  const[hideYuchal,setHideYuchal]=useState(true); // 유찰 건 숨김 (기본 ON)
  const[hideSuui,setHideSuui]=useState(true); // 수의계약 건 숨김 (기본 ON)
  const[bidDetails,setBidDetails]=useState([]);
  const[agAss,setAgAss]=useState({});
  const[cardPredId,setCardPredId]=useState(null); // 투찰 카드로 연 예측 id (P3)
  const[g2bAgency,setG2bAgency]=useState(""); // 카드 → G2B 양식 이동 시 선택할 발주처
  // ★ v7-ops-4B: 모델 검증 탭 데이터
  const[qualityDaily,setQualityDaily]=useState([]);
  const[weeklyQuality,setWeeklyQuality]=useState([]);
  const[biasHotspots,setBiasHotspots]=useState([]);
  const[watchlist,setWatchlist]=useState([]);
  const[watchHistory,setWatchHistory]=useState([]);
  const[qualityLoading,setQualityLoading]=useState(false);
  // 발주처 예측기 (predictV5 입력)
  const[agencyPred,setAgencyPred]=useState({}); // ag → {offset, strategy}
  const[floorBench,setFloorBench]=useState({}); // Phase 23-4: at|floor_rate → {med, n, std}
  const[win1stDistMap,setWin1stDistMap]=useState({agBa:{},ag:{},atBa:{},at:{}}); // Phase 23-9: 1위 사정률 분포 다단 fallback
  // ★ AI 챗봇 (localStorage 세션 관리)
  const[chatSessions,setChatSessions]=useState(()=>{try{return JSON.parse(localStorage.getItem("bid_chat_sessions")||"[]")}catch(e){return[]}});
  const[chatSid,setChatSid]=useState(()=>localStorage.getItem("bid_chat_active")||"");
  const[chatMsgs,setChatMsgs]=useState(()=>{if(!chatSid)return[];try{return JSON.parse(localStorage.getItem("bid_chat_msg_"+chatSid)||"[]")}catch(e){return[]}});
  const[chatInput,setChatInput]=useState("");const[chatLoading,setChatLoading]=useState(false);
  const[chatSideOpen,setChatSideOpen]=useState(true);
  const chatRef=useCallback(node=>{if(node)setTimeout(()=>{node.scrollTop=node.scrollHeight},50)},[chatMsgs]);
  // 채팅 영역 높이 = 화면 높이 − 실제 시작 위치 − 본문 아래 패딩(16). 헤더 줄바꿈·알림 줄·참고용 배너 높이가 달라 고정값으로는 입력창이 화면 밖으로 밀림
  const chatBoxRef=useRef(null);const[chatH,setChatH]=useState(null);
  useLayoutEffect(()=>{if(tab!=="chat")return;const fit=()=>{const el=chatBoxRef.current;if(el)setChatH(Math.max(320,window.innerHeight-(el.getBoundingClientRect().top+window.scrollY)-16))};fit();window.addEventListener("resize",fit);return()=>window.removeEventListener("resize",fit)},[tab,msg.text]);
  // 세션 저장 헬퍼
  const saveSessions=(sessions)=>{setChatSessions(sessions);try{localStorage.setItem("bid_chat_sessions",JSON.stringify(sessions))}catch(e){}};
  const saveMsgs=(sid,msgs)=>{setChatMsgs(msgs);try{localStorage.setItem("bid_chat_msg_"+sid,JSON.stringify(msgs));localStorage.setItem("bid_chat_active",sid)}catch(e){}};
  // 새 대화 시작
  const newChat=()=>{const id="c_"+Date.now();const s={id,title:"새 대화",created:new Date().toISOString().slice(0,16)};
    const next=[s,...chatSessions];saveSessions(next);setChatSid(id);saveMsgs(id,[]);localStorage.setItem("bid_chat_active",id)};
  // 대화 선택
  const selectChat=(id)=>{setChatSid(id);localStorage.setItem("bid_chat_active",id);
    try{setChatMsgs(JSON.parse(localStorage.getItem("bid_chat_msg_"+id)||"[]"))}catch(e){setChatMsgs([])}};
  // 대화 삭제
  const deleteChat=(id)=>{const next=chatSessions.filter(s=>s.id!==id);saveSessions(next);
    try{localStorage.removeItem("bid_chat_msg_"+id)}catch(e){}
    if(chatSid===id){if(next.length>0){selectChat(next[0].id)}else{setChatSid("");setChatMsgs([])}}};

  // ★ Phase 6-A (2026-04-11): 추천 사정률 단순화 — opt_adj 단일 소스
  // 화면의 "추천 사정률(100%)"은 오직 opt_adj (편향 보정된 통계 예측) 하나만 사용.
  // AI 권장과 매트릭스는 참고용 (별도 탭에서 표시, 최종 추천에 영향 없음).
  // 이유: 140건 백테스트상 opt_adj가 검증된 유일한 값.
  // 4월 14일 개찰 이후 실제 1위 사정률(100%)과 이 값을 직접 비교하여 낙찰 여부 판정 가능.
  const getFinalRecommendation=useCallback((p)=>{
    if(!p)return{adj:null,bid:null,source:null};
    // LH 종심제/순심제 대형 공사 — 예측 모델 구조적 미지원 (고정 -2.941 수렴)
    if(isLhJongsim(p.at,p.ba,p.pn))return{adj:null,bid:null,bid1st:null,source:'jongsim_unsupported',jongsim:true};

    // Phase 23-9: bid1st_v2 우선 — 채워진 행은 신규 추천 사용
    if(p.bid1st_v2_adj!=null){
      return{
        adj:Number(p.bid1st_v2_adj),
        bid:Number(p.bid1st_v2_bid),
        bid1st:Number(p.bid1st_v2_bid),
        winProb:p.bid1st_v2_win_prob!=null?Number(p.bid1st_v2_win_prob):null,
        floorSafe:p.bid1st_v2_floor_safe===true,
        source:`v2(${p.bid1st_v2_grain||'기본'}: ${p.bid1st_v2_src||'-'})`
      };
    }

    const ba=p.ba?Number(p.ba):0;
    const av=p.av?Number(p.av):0;
    const fr=Number(p.pred_floor_rate||0);
    // 격리: 이 함수는 업로드 예측(source='file_upload') 행만 받는다 — 호출처는 compList와 거기서 여는 상세 모달뿐.
    // 자동 예측(g2b_auto·g2b_manual)의 opt_adj에는 서버 보정(predictor_bias_correction)이 이미 들어 있어,
    // 그 행을 여기로 넘기면 아래 biasFix와 보정이 2겹이 된다. 호출처를 늘릴 때는 출처 필터를 유지할 것.
    // Phase 23-2 (2026-04-19): 동적 편향 보정 (AG×금액대 다층 lookup)
    // 우선순위: AG×BA(n≥10) > AG(n≥15) > AT×BA(n≥20) > AT(n≥30) > 보정 없음
    // 핵심 영역(고양시 +0.10, 한전 -0.03, 군부대 -0.04)에서 고정 +0.09 적용 시 정확도 악화 → 영역별 역보정
    const seg=ba<1e8?'S1':ba<3e8?'S2':ba<1e9?'S3':ba<3e9?'S4':'S5';
    const m=predBiasMap||{};
    let biasFix=0,biasSrc='없음';
    if(p.ag&&m.agBa&&m.agBa[p.ag+'|'+seg]!=null){biasFix=-m.agBa[p.ag+'|'+seg];biasSrc='AG×금액대'}
    else if(p.ag&&m.ag&&m.ag[p.ag]!=null){biasFix=-m.ag[p.ag];biasSrc='AG'}
    else if(p.at&&m.atBa&&m.atBa[p.at+'|'+seg]!=null){biasFix=-m.atBa[p.at+'|'+seg];biasSrc='AT×금액대'}
    else if(p.at&&m.at&&m.at[p.at]!=null){biasFix=-m.at[p.at];biasSrc='AT'}
    const fixStr=(biasFix>=0?'+':'')+biasFix.toFixed(3);
    // Phase 23-3: 한전·고양시 ba_seg fine-tune (50:50 블렌드, 다른 영역은 무영향)
    const ftKey=(p.canonical_ag||p.ag)+'|'+p.at+'|'+seg;
    const ftHit=basegFinetune&&basegFinetune[ftKey];
    const calcBid=(adj)=>{
      if(!ba||!fr)return null;
      const xp=ba*(1+adj/100);
      return av>0?Math.ceil(av+(xp-av)*(fr/100)):Math.ceil(xp*(fr/100));
    };
    // Phase 23-3 A0: 낙찰하한 +0.001%p 방어 가드 (활성화 0% 예측, 미래 안전장치)
    const frFloorAdj=fr>0?(fr-100+0.001):null;
    const clampToFloor=(adj)=>(frFloorAdj!=null&&adj<frFloorAdj)?frFloorAdj:adj;
    // 1순위: opt_adj + 동적 보정 (+ ba_seg 블렌드)
    if(p.opt_adj!=null){
      let base=Number(p.opt_adj);
      let ftSrc='';
      if(ftHit){base=(base+ftHit.median)/2;ftSrc=` +FT(${ftHit.median.toFixed(2)},n${ftHit.n})`}
      const rawAdj=base+biasFix;
      const adjNum=clampToFloor(rawAdj);
      const clampSrc=(adjNum!==rawAdj)?' +CLAMP':'';
      const bid=calcBid(adjNum);
      const bid1st=calcWin1stBid(bid,fr,p.at);
      return{adj:adjNum,bid,bid1st,source:`추천(보정:${biasSrc} ${fixStr}${ftSrc}${clampSrc})`};
    }
    // 2순위 fallback: pred_adj_rate + 동적 보정
    if(p.pred_adj_rate!=null){
      const rawAdj=Number(p.pred_adj_rate)+biasFix;
      const adjNum=clampToFloor(rawAdj);
      const clampSrc=(adjNum!==rawAdj)?' +CLAMP':'';
      const bid=calcBid(adjNum);
      const bid1st=calcWin1stBid(bid,fr,p.at);
      return{adj:adjNum,bid,bid1st,source:`순수예측(보정:${biasSrc} ${fixStr}${clampSrc})`};
    }
    return{adj:null,bid:null,bid1st:null,source:null};
  },[predBiasMap,basegFinetune]);


  // ★ AI 챗봇 시스템 프롬프트 (현재 데이터 통계 동적 포함)
  const buildChatSystem=()=>{
    const ts=allS.ts||{};const typeStats=Object.entries(ts).map(([k,v])=>`${k}: 평균(100%)${(100+Number(v.avg||0)).toFixed(3)}%, std${v.std?.toFixed(3)||0}%, ${v.n||0}건`).join(" / ");
    const matched=predictions.filter(p=>p.match_status==="matched"&&p.source==='file_upload');
    const mae=matched.length?Math.round(matched.filter(p=>p.adj_rate_error!=null).map(p=>Math.abs(p.adj_rate_error)).reduce((a,b)=>a+b,0)/matched.length*10000)/10000:0;
    return`당신은 한국 공공조달 입찰(전기/통신/소방) 전문 AI 어드바이저입니다.

■ 시스템 현황
- 낙찰 데이터: ${recs.length.toLocaleString()}건 (${Object.keys(ts).length}개 기관유형)
- 복수예가 상세: ${bidDetails.length}건
- 예측 성능: MAE ${mae}% / ${matched.length}건 매칭
- 기관유형별: ${typeStats}
- 이론적 노이즈 바닥: 0.642% (C(15,4) 추첨의 구조적 한계)

■ 핵심 도메인 지식
- 복수예비가격: 기초금액 기준 ±3%(또는 ±2%) 범위에서 15개 비공개 예비가격 생성, 참여업체가 2개씩 추첨, 다빈도 4개의 산술평균이 예정가격
- 사정률 표기는 100% 기준: 예정가격/기초금액 × 100. 예) 99.780%는 기초금액보다 0.22% 낮은 예정가격
- 투찰금액 산출: A값 있을 때 = A값 + (예정가격-A값) × 낙찰하한율, A값 없을 때 = 예정가격 × 낙찰하한율
- 낙찰하한율: 기관·금액구간별 상이 (조달청/지자체 89.745%, 3억 미만 기준, 2026 개정)
- 1순위 업체는 낙찰하한율 대비 +0.001~0.005% 마진으로 투찰 (162건 분석)
- 투찰율 = 입찰가격/예정가격 × 100. 이것은 사정률의 결과(종속변수)이므로 예측 변수로는 무용

■ 적격심사 기준 (전기/통신/소방)
- 종합평점 95점 이상이 낙찰자
- 입찰가격평가 배점: 3억 미만 90점(하한85점, 낙찰율87.745%), 3억~50억 70점(하한65점, 낙찰율86.745%)
- 산식: 90-20×|88/100-입찰가격/예정가격|×100 (3억 미만), 70-4×|88/100-입찰가격/예정가격|×100 (3억 이상)
- 시공경험평가 + 경영상태평가로 나머지 점수 충당
- 경영상태 부족 시 투찰율을 87.795%로 높여 입찰가격점수 86점을 받아 보완 가능

■ 언어 규칙 (최우선)
- 반드시 한국어로만 답변하세요. 질문, 역질문, 확인 요청 등 모든 텍스트를 한국어로 작성하세요.
- 영어 사용 절대 금지 (전문 용어 약어 제외: MAE, RLS 등)

■ 응답 규칙
- 입찰 전략과 관련된 질문에는 구체적 수치와 근거를 제시
- 추정가격/기초금액/A값 등 용어는 정확하게 사용
- 모르는 정보는 솔직히 모른다고 답변
- 답변은 간결하게, 핵심 위주로

■ 응답 포맷
- 마크다운 형식으로 답변 (제목, 볼드, 리스트 활용)
- 데이터가 여러 건일 때는 마크다운 테이블 사용 (| 헤더1 | 헤더2 | 형식)
- 숫자 데이터는 반드시 기관명, 날짜 등 컨텍스트와 함께 제시
- 사정률은 소수점 4자리, 금액은 원 단위로 표시
- 핵심 결론을 먼저 제시하고, 근거 데이터를 뒤에 배치`};

  const sendChat=async()=>{
    const text=chatInput.trim();if(!text||chatLoading)return;
    // 세션이 없으면 자동 생성
    let sid=chatSid;
    if(!sid){const id="c_"+Date.now();const s={id,title:text.slice(0,20),created:new Date().toISOString().slice(0,16)};
      saveSessions([s,...chatSessions]);sid=id;setChatSid(id);localStorage.setItem("bid_chat_active",id)}
    const userMsg={role:"user",content:text};
    const newMsgs=[...chatMsgs,userMsg];
    saveMsgs(sid,newMsgs);setChatInput("");setChatLoading(true);
    // 첫 메시지면 세션 제목 업데이트
    if(chatMsgs.length===0){const updated=chatSessions.map(s=>s.id===sid?{...s,title:text.slice(0,20)}:s);saveSessions(updated.length?updated:[{id:sid,title:text.slice(0,20),created:new Date().toISOString().slice(0,16)}])}
    try{
      const _sess2=getSession();
      const res=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json","Authorization":_sess2?.access_token?`Bearer ${_sess2.access_token}`:""},
        body:JSON.stringify({systemBase:buildChatSystem(),messages:newMsgs.slice(-20)})});
      if(!res.ok){const err=await res.json().catch(()=>({}));throw new Error(err.error?.message||err.error||`API ${res.status}`)}
      const data=await res.json();
      const reply=data.content?.map(c=>c.text||"").join("")||"응답을 받지 못했습니다.";
      const finalMsgs=[...newMsgs,{role:"assistant",content:reply}];
      saveMsgs(sid,finalMsgs)}
    catch(e){const finalMsgs=[...newMsgs,{role:"assistant",content:"⚠ 오류: "+e.message}];saveMsgs(sid,finalMsgs)}
    finally{setChatLoading(false)}};
  // 정렬 상태
  const[dataSort,setDataSort]=useState({key:"od",dir:"desc"}); // 분석 탭 데이터
  const[predSort,setPredSort]=useState({key:"open_date",dir:"desc"}); // 예측 탭 내역

  const refreshStats=useCallback(rows=>{setAllS(calcStats(rows));setNewS(calcStats(rows,r=>r.era==="new"));setOldS(calcStats(rows,r=>r.era==="old"))},[]);

  // 예측 리스트 새로고침 (수동 + 탭 전환 시)
  const refreshPredictions=useCallback(async()=>{
    try{const preds=await sbFetchPredictions();setPredictions(preds||[]);return preds}catch(e){return predictions}},[predictions]);
  // ★ 전체 데이터 새로고침 (새로고침 버튼용)
  const refreshAll=useCallback(async()=>{
    try{const[rows,preds,dets,agStats]=await Promise.all([sbFetchAllCached(),sbFetchPredictions(),sbFetchDetails(),sbFetchAgAssumedStats()]);
      setRecs(rows);refreshStats(rows);setDataStatus(calcDataStatus(rows));
      setPredictions(preds||[]);setBidDetails(dets||[]);setAgAss(agStats||{});
      // 자동 매칭 시도
      const matched=await sbMatchPredictions(preds,rows);
      if(matched>0){const updPreds=await sbFetchPredictions();setPredictions(updPreds)}
      // ★ v7 a-R2: 매칭된 예측의 strategy_log outcome 백필 (최근 60일)
      if(matched>0){try{
        const since=new Date(Date.now()-60*86400000).toISOString().slice(0,10);
        await sbUpdateStrategyOutcomes(since);
      }catch(e){console.warn("strategy outcome 백필 실패:",e.message)}}
      return{records:rows.length,predictions:(preds||[]).length,details:(dets||[]).length,matched}
    }catch(e){return null}},[refreshStats]);;

  // DB 로드
  useEffect(()=>{(async()=>{
    try{const rows=await sbFetchAllCached();setRecs(rows);refreshStats(rows);setDataStatus(calcDataStatus(rows))}catch(e){setMsg({type:"err",text:"DB 로드 실패: "+e.message})}
    try{const preds=await sbFetchPredictions();setPredictions(preds||[]);
      const g2bP=(preds||[]).filter(p=>p.source==="g2b_auto"&&p.created_at);
      if(g2bP.length>0){const lat=g2bP.reduce((a,b)=>a.created_at>b.created_at?a:b);setLastG2bAt(lat.created_at)}
      // ★ file_upload 예측을 predResults로 복원 (새로고침 시 유지)
      const filePreds=(preds||[]).filter(p=>p.source==="file_upload"&&p.pred_adj_rate!=null);
      if(filePreds.length>0){setPredResults(filePreds.map(p=>({
        pn:p.pn,pn_no:p.pn_no,ag:p.ag,at:p.at,
        ba:p.ba?Number(p.ba):null,ep:p.ep?Number(p.ep):null,av:p.av?Number(p.av):0,
        raw_cost:p.raw_cost,cat:p.cat,open_date:p.open_date,dedup_key:p.dedup_key,
        pred:{adj:Number(p.pred_adj_rate),xp:Number(p.pred_expected_price),
          fr:Number(p.pred_floor_rate),bid:Number(p.pred_bid_amount),
          src:p.pred_source||"",baseAdj:Number(p.pred_base_adj||0),
          ci70:null,ci90:null,scenarios:[],bidRateRec:{avg:0,med:0,q1:0,q3:0,std:0},
          bidByRate:0,adjAvg:0,adjStd:0,biasAdj:0,driftUsed:0,detailInsight:null}
      })))}
    }catch(e){setPredictions([])}
    try{const dets=await sbFetchDetails();setBidDetails(dets||[]);
      if(dets&&dets.length>0){const latest=dets.reduce((a,b)=>(a.created_at>b.created_at?a:b));setLastSucviewAt(latest.created_at)}
    }catch(e){setBidDetails([])}
    try{const agStats=await sbFetchAgAssumedStats();setAgAss(agStats||{})}catch(e){setAgAss({})}
    try{const pbm=await sbFetchPredBiasMap();if(pbm)setPredBiasMap(pbm)}catch(e){}
    try{const acc=await sbFetchAccuracyMap();if(acc)setAccuracyMap(acc)}catch(e){}
    try{const fb=await sbFetchFloorBench();if(fb)setFloorBench(fb)}catch(e){}
    try{const wd=await sbFetchWin1stDistMap();if(wd)setWin1stDistMap(wd)}catch(e){}
    try{const bf=await sbFetchBasegFinetune();if(bf)setBasegFinetune(bf)}catch(e){}
    // 발주처 예측기 — predictV5 입력(Generator)이라 유지
    try{
      const apr=await sbFetchAgencyPredictor();
      const aprMap={};(apr||[]).forEach(r=>{aprMap[r.ag]=r});setAgencyPred(aprMap);
    }catch(e){setAgencyPred({})}
    // 나라장터 공고 로드
    try{const nots=await sbFetchNotices();setNotices(nots||[])}catch(e){setNotices([])}
    if(G2B_AUTO_SHOW){try{setG2bAuto(await sbFetchG2BAuto())}catch(e){setG2bAuto([])}}
    setDbLoading(false)
  })()},[refreshStats]);

  // 예측 탭 진입 시 자동 새로고침
  useEffect(()=>{if(tab==="predict"&&!dbLoading){refreshPredictions()}},[tab,dbLoading]);

  // ★ v7-ops-4B: 모델 검증 탭 진입 시 1회 로드
  useEffect(()=>{
    if(tab!=="quality")return;
    if(qualityDaily.length||weeklyQuality.length||biasHotspots.length||watchlist.length)return;
    setQualityLoading(true);
    Promise.all([
      sbFetchQualityDaily(30),
      sbFetchWeeklyQuality(40),
      sbFetchBiasHotspots(10,25),
      sbFetchWatchlist(),
      sbFetchWatchlistHistory(14),
    ]).then(([d,w,b,wl,wh])=>{setQualityDaily(d||[]);setWeeklyQuality(w||[]);setBiasHotspots(b||[]);setWatchlist(wl||[]);setWatchHistory(wh||[])})
      .catch(e=>console.warn("quality load failed:",e.message))
      .finally(()=>setQualityLoading(false));
  },[tab]);


  // 파일 업로드 (3종 자동 판별: SUCVIEW / 입찰서류함 / 낙찰정보리스트)
  const loadFiles=useCallback(async(fileList)=>{
    const files=Array.from(fileList).filter(Boolean);if(!files.length)return;setBusy(true);setMsg({type:"",text:""});setUploadLog([]);const logs=[];
    let accPredResults=[]; // ★ 여러 파일 예측 누적
    // ★ agAss guard: 비어있으면 자동 fetch
    let curAgAss=agAss;
    if(!Object.keys(curAgAss).length){try{curAgAss=await sbFetchAgAssumedStats()||{};setAgAss(curAgAss)}catch(e){curAgAss={}}}
    for(const file of files){
      try{
        const{rows:raw,format}=await parseFile(file);if(!raw.length)throw new Error("빈 파일");
        // 1) SUCVIEW 상세 파일
        if(isSucviewFile(raw)){
          const detail=parseSucview(raw,file.name);if(!detail.pn_no)throw new Error("공고번호 없음");
          await sbSaveDetail(detail);
          if(detail.participants&&detail.participants.length){
            try{
              await sbSaveParticipants({pn_no:detail.pn_no,od:detail.od,ag:detail.ag,canonical_ag:detail.ag,at:detail.at},detail.participants);
              sbRefreshParticipantDistFor([detail.pn_no]); // 분포 층 즉시 반영 (m46, fire-and-forget — 실패 시 일배치가 보정)
            }
            catch(e){console.warn("참여업체 저장 실패:",e.message);}
          }
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
          const results=items.map(item=>{const p=predictV5({at:item.at,agName:item.ag,ba:item.ba,ep:item.ep,av:item.av,ownScore,od:item.notice_date||item.open_date},allS.ts,allS.as,bidDetails,agencyPred,floorBench);const rec=recommendAssumedAdj({at:item.at,agName:item.ag,ba:item.ba,ep:item.ep,av:item.av,ownScore,od:item.notice_date||item.open_date},allS.ts,allS.as,curAgAss);return{...item,pred:p,rec}}).filter(r=>r.pred);
          if(!results.length)throw new Error("예측 결과 0건");
          // 이 경로는 메인 추천(bid1st_v2)을 저장하지 않아 화면에 보일 투찰금을 아직 모른다 — 실격위험 스냅샷은 비우고(기준 건수·안전선만 저장) 캘리브레이션 채점에서 빠지게 한다.
          const dbRows=results.map(r=>({dedup_key:r.dedup_key,pn:r.pn,pn_no:r.pn_no,ag:r.ag,at:r.at,ep:r.ep,ba:r.ba,av:r.av,raw_cost:r.raw_cost,cat:r.cat,open_date:r.open_date,pred_adj_rate:r.pred.adj,pred_expected_price:r.pred.xp,pred_floor_rate:r.pred.fr,pred_bid_amount:r.pred.bid,pred_source:r.pred.src,pred_base_adj:r.pred.baseAdj,opt_adj:r.pred.optAdj,opt_bid:r.pred.optBid,opt_adj_router:r.pred.route,benchmark_bid:r.pred.benchmarkBid,benchmark_rate:r.pred.benchmarkRate,benchmark_n:r.pred.benchmarkN,rec_adj_p25:r.rec?.aggressive?.adj,rec_adj_p50:r.rec?.balanced?.adj,rec_adj_p75:r.rec?.conservative?.adj,rec_bid_p25:r.rec?.aggressive?.bid,rec_bid_p50:r.rec?.balanced?.bid,rec_bid_p75:r.rec?.conservative?.bid,rec_strategy:r.rec?.strategy,own_score:ownScore,source:"file_upload",match_status:"pending",...passRiskSnapshot(adjHist,{...passKeyOf(r),ba:r.ba,av:r.av,effFr:passEffFrOf(r,ownScore),jongsim:isLhJongsim(r.at,r.ba,r.pn),withSafeLine:floorModeOf(r.at)==="B"}),...pcSnapshot(pcDistMap,{at:r.at,canonicalAg:r.ag,ba:r.ba,jongsim:isLhJongsim(r.at,r.ba,r.pn)})}));
          // 이미 매칭된 건은 DB에서 보호되어 갱신되지 않는다 — 화면에도 재계산값을 띄우지 않는다
          const protectedKeys=await sbSavePredictions(dbRows);
          accPredResults=accPredResults.concat(results.filter(r=>!protectedKeys.has(r.dedup_key)));setPredResults([...accPredResults]); // ★ 누적 표시
          logs.push({name:file.name,type:"ok",text:`[예측] ${results.length-protectedKeys.size}건 예측 완료`+(protectedKeys.size?` · 이미 매칭된 ${protectedKeys.size}건은 보호되어 갱신하지 않음`:"")});
          setUploadLog([...logs]);continue}
        // 3) 낙찰정보리스트
        if(!hdr0.some(v=>v.includes("공고명")))throw new Error("지원하지 않는 파일 형식");
        const nr=toRecords(raw.slice(1));await sbUpsert(nr);
        const nc=nr.filter(r=>r.era==="new").length,oc=nr.filter(r=>r.era==="old").length;
        // 공종 비율 검증 (비대상 공종 50% 초과 시 경고)
        const tgtKw=/전기|통신|소방/i;
        const catValid=nr.filter(r=>r.cat&&tgtKw.test(r.cat)).length;
        const catEmpty=nr.filter(r=>!r.cat).length;
        const nonTgtRatio=Math.round((nr.length-catValid)/Math.max(nr.length,1)*100);
        const catWarn=nonTgtRatio>=50?` ⚠ 비대상 공종 ${nonTgtRatio}% (전기/통신/소방 외, 분석 제외됨)`:catEmpty>=nr.length*0.3?` ⚠ 공종 미기재 ${catEmpty}건`:"";
        logs.push({name:file.name,type:catWarn?"warn":"ok",text:`[${format}] ${nr.length}건 | 신${nc}·구${oc}${catWarn}`});setUploadLog([...logs])
      }catch(e){logs.push({name:file.name,type:"err",text:e.message});setUploadLog([...logs])}}
    try{const[rows,preds,dets]=await Promise.all([sbFetchAllCached(),sbFetchPredictions(),sbFetchDetails()]);
      setRecs(rows);refreshStats(rows);setDataStatus(calcDataStatus(rows));setBidDetails(dets||[]);
      const matched=await sbMatchPredictions(preds,rows);
      // ★ v7 a-R2: 매칭 후 strategy_log outcome 백필 (최근 60일)
      if(matched>0){try{
        const since=new Date(Date.now()-60*86400000).toISOString().slice(0,10);
        await sbUpdateStrategyOutcomes(since);
      }catch(e){console.warn("strategy outcome 백필 실패:",e.message)}}
      // Phase 5.2: 신규 예측에 대해 자동 scoring
      const newPreds=matched>0?await sbFetchPredictions():preds; // 신규 예측 전부 snapshot UPSERT (옛 scoringMap 필터는 항상 비어 동작 동일)
      if(newPreds.length>0){
        // ★ v7 a-R2: 신규 예측에 대해 snapshot 기록 (UPSERT, 실패는 경고만)
        try{await sbRecordSnapshots(newPreds.map(p=>p.id))}catch(e){console.warn("snapshot 실패:",e.message)}
      }
      if(matched>0){const updPreds=await sbFetchPredictions();setPredictions(updPreds);setMsg({type:"ok",text:`업로드 완료 · ${matched}건 예측 자동 매칭 · 신규 ${newPreds.length}건`})}
      else{setPredictions(preds);if(!logs.some(l=>l.type==="err"))setMsg({type:"ok",text:`업로드 완료 · 신규 ${newPreds.length}건`})}
    }catch(e){setMsg({type:"err",text:"DB 재로드 실패"})}
    setBusy(false)},[refreshStats,allS,bidDetails,agencyPred,floorBench,agAss,ownScore,adjHist,pcDistMap]);

  // 입찰서류함 예측 (복수 파일 지원)
  const loadPredFiles=useCallback(async(fileList)=>{
    if(!fileList||!fileList.length)return;
    if(!Object.keys(allS.ts||{}).length){setMsg({type:"err",text:"낙찰 데이터를 먼저 로드해주세요 (통계 없음)"});return}
    setBusy(true);setMsg({type:"",text:""});
    // ★ agAss guard: 비어있으면 자동 fetch
    let curAgAss=agAss;
    if(!Object.keys(curAgAss).length){try{curAgAss=await sbFetchAgAssumedStats()||{};setAgAss(curAgAss)}catch(e){curAgAss={}}}
    let totalResults=[];let successCount=0;let failCount=0;const logs=[];
    for(const file of Array.from(fileList)){
      try{const{rows}=await parseFile(file);
        // ★ 가드: SUCVIEW 상세·낙찰정보리스트를 예측탭에 잘못 업로드 차단 (입찰서류함만 허용)
        if(isSucviewFile(rows)){logs.push({name:file.name,ok:false,msg:"SUCVIEW 상세 파일은 데이터탭에 업로드해주세요"});failCount++;continue}
        const hdr0=(rows[0]||[]).map(v=>String(v).trim());
        const hdr1=(rows[1]||[]).map(v=>String(v).trim());
        const allHdr=[...hdr0,...hdr1].join("|");
        const isBidDoc=allHdr.includes("기초금액")&&allHdr.includes("공고명")&&(allHdr.includes("추정가격")||allHdr.includes("A값"));
        const isNakList=hdr0.some(v=>v.includes("공고명"))&&(hdr0.some(v=>v.includes("낙찰"))||hdr0.some(v=>v.includes("1순위"))||hdr0.length>=15);
        if(isNakList&&!isBidDoc){logs.push({name:file.name,ok:false,msg:"낙찰정보리스트는 데이터탭에 업로드해주세요"});failCount++;continue}
        if(!isBidDoc){logs.push({name:file.name,ok:false,msg:"입찰서류함 형식이 아닙니다 (공고명·기초금액·추정가격/A값 헤더 필요)"});failCount++;continue}
        const items=parseBidDoc(rows);if(!items.length){logs.push({name:file.name,ok:false,msg:"예측 대상 0건"});failCount++;continue}
        const results=items.map(item=>{
          const p=predictV5({at:item.at,agName:item.ag,ba:item.ba,ep:item.ep,av:item.av,ownScore,od:item.notice_date||item.open_date},allS.ts,allS.as,bidDetails,agencyPred,floorBench);
          const rec=recommendAssumedAdj({at:item.at,agName:item.ag,ba:item.ba,ep:item.ep,av:item.av,ownScore,od:item.notice_date||item.open_date},allS.ts,allS.as,curAgAss);
          // 메인 추천: 군시설 외 = 하한 통과 95% 안착안, 군시설 = 1위 평균 (recommendMain, 2026-10-21)
          const fr=p?p.fr:eraFR(item.at,item.ep||item.ba,item.notice_date||item.open_date||new Date().toISOString().slice(0,10));
          const v2=recommendMain(
            {at:item.at,agName:item.ag,ba:item.ba,ep:item.ep,av:item.av,fr},
            {distMap:win1stDistMap,ownScore}
          );
          return{...item,pred:p,rec,v2};
        }).filter(r=>r.pred);
        if(!results.length){logs.push({name:file.name,ok:false,msg:"예측 결과 0건"});failCount++;continue}
        totalResults=totalResults.concat(results);
        logs.push({name:file.name,ok:true,msg:`${results.length}건 예측`});successCount++;
      }catch(e){logs.push({name:file.name,ok:false,msg:e.message});failCount++}}
    let protectedKeys=new Set();
    if(totalResults.length>0){
      const dbRows=totalResults.map(r=>({dedup_key:r.dedup_key,pn:r.pn,pn_no:r.pn_no,ag:r.ag,at:r.at,ep:r.ep,ba:r.ba,av:r.av,raw_cost:r.raw_cost,cat:r.cat,open_date:r.open_date,pred_adj_rate:r.pred.adj,pred_expected_price:r.pred.xp,pred_floor_rate:r.pred.fr,pred_bid_amount:r.pred.bid,pred_source:r.pred.src,pred_base_adj:r.pred.baseAdj,opt_adj:r.pred.optAdj,opt_bid:r.pred.optBid,opt_adj_router:r.pred.route,benchmark_bid:r.pred.benchmarkBid,benchmark_rate:r.pred.benchmarkRate,benchmark_n:r.pred.benchmarkN,rec_adj_p25:r.rec?.aggressive?.adj,rec_adj_p50:r.rec?.balanced?.adj,rec_adj_p75:r.rec?.conservative?.adj,rec_bid_p25:r.rec?.aggressive?.bid,rec_bid_p50:r.rec?.balanced?.bid,rec_bid_p75:r.rec?.conservative?.bid,rec_strategy:r.rec?.strategy,bid1st_v2_adj:r.v2?.auto?.adj??null,bid1st_v2_bid:r.v2?.auto?.bid??null,bid1st_v2_win_prob:r.v2?.auto?.winProb??null,bid1st_v2_floor_safe:r.v2?.auto?.floorSafe??null,bid1st_v2_grain:r.v2?.distribution?.grain??null,bid1st_v2_src:r.v2?.distribution?.src??null,own_score:ownScore,source:"file_upload",match_status:"pending",...passRiskSnapshot(adjHist,{...passKeyOf(r),ba:r.ba,av:r.av,effFr:passEffFrOf(r,ownScore),bid:r.v2?.auto?.bid??r.pred.optBid??r.pred.bid,jongsim:isLhJongsim(r.at,r.ba,r.pn),withSafeLine:floorModeOf(r.at)==="B"}),...pcSnapshot(pcDistMap,{at:r.at,canonicalAg:r.ag,ba:r.ba,jongsim:isLhJongsim(r.at,r.ba,r.pn)})}));
      try{protectedKeys=await sbSavePredictions(dbRows)}catch(e){setMsg({type:"err",text:"예측 DB 저장 실패: "+e.message});setBusy(false);return}
      // 저장된 건만 화면 결과에 반영 — 이미 매칭돼 보호된 건은 재계산값을 띄우지 않는다(DB 값과 화면이 어긋나지 않게)
      const shown=totalResults.filter(r=>!protectedKeys.has(r.dedup_key));
      setPredResults(prev=>{const dkSet=new Set(shown.map(r=>r.dedup_key));const kept=prev.filter(p=>!dkSet.has(p.dedup_key));return[...kept,...shown]});
      const preds=await sbFetchPredictions();setPredictions(preds);
      const newPreds=preds; // 신규 예측 전부 snapshot UPSERT
      if(newPreds.length>0){
        // ★ v7 a-R2: 신규 예측에 대해 snapshot 기록 (UPSERT, 실패는 경고만)
        try{await sbRecordSnapshots(newPreds.map(p=>p.id))}catch(e){console.warn("snapshot 실패:",e.message)}
      }
    }
    const summary=fileList.length===1?logs[0]?.ok?`${totalResults.length}건 예측 완료 · DB 저장`:logs[0]?.msg
      :`${fileList.length}개 파일 처리: 성공 ${successCount} · 실패 ${failCount} · 총 ${totalResults.length}건 예측`;
    const protectedNote=protectedKeys.size?` · 이미 매칭된 ${protectedKeys.size}건은 보호되어 갱신하지 않음`:"";
    setMsg({type:failCount>0&&successCount===0?"err":"ok",text:summary+protectedNote});setBusy(false)},[allS,bidDetails,agencyPred,floorBench,agAss,win1stDistMap,ownScore,adjHist,pcDistMap]);

  // ★ 마크다운 → HTML 변환 (공통)
  const md2html=(text)=>{if(!text)return"";
    const tables=[];
    let result=text.replace(/^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)+)/gm,(match,hdr,sep,body)=>{
      const hs=hdr.split("|").filter(c=>c.trim()).map(c=>c.trim());
      const rs=body.trim().split("\n").map(l=>l.split("|").filter(c=>c.trim()).map(c=>c.trim()));
      let h=`<table style="width:100%;border-collapse:collapse;font-size:12px;margin:8px 0"><thead><tr>`;
      hs.forEach(c=>{h+=`<th style="padding:6px 8px;text-align:left;border-bottom:1px solid ${C.bdr};color:${C.txm};font-weight:500">${c}</th>`});
      h+=`</tr></thead><tbody>`;
      rs.forEach(r=>{h+=`<tr style="border-bottom:1px solid ${C.bdr}22">`;r.forEach(c=>{h+=`<td style="padding:4px 8px;color:${C.txt}">${c}</td>`});h+=`</tr>`});
      h+=`</tbody></table>`;tables.push(h);return`__TBL${tables.length-1}__`});
    result=result.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    result=result
      .replace(/^### (.+)$/gm,`<div style="font-size:14px;font-weight:600;color:${C.gold};margin:12px 0 6px">$1</div>`)
      .replace(/^## (.+)$/gm,`<div style="font-size:15px;font-weight:600;color:${C.gold};margin:14px 0 8px">$1</div>`)
      .replace(/^# (.+)$/gm,`<div style="font-size:16px;font-weight:600;color:${C.gold};margin:16px 0 8px">$1</div>`)
      .replace(/\*\*(.+?)\*\*/g,`<span style="font-weight:600;color:${C.txt}">$1</span>`)
      .replace(/\*(.+?)\*/g,"<em>$1</em>")
      .replace(/`(.+?)`/g,`<code style="background:${C.bg3};padding:1px 5px;border-radius:3px;font-size:12px;font-family:monospace">$1</code>`)
      .replace(/^- (.+)$/gm,`<div style="padding:2px 0 2px 16px;position:relative"><span style="position:absolute;left:0;color:${C.txd}">·</span>$1</div>`)
      .replace(/^(\d+)\. (.+)$/gm,`<div style="padding:2px 0 2px 20px;position:relative"><span style="position:absolute;left:0;color:${C.gold};font-weight:500">$1.</span>$2</div>`)
      .replace(/^■ (.+)$/gm,`<div style="font-weight:600;color:#a8b4ff;margin:10px 0 4px">■ $1</div>`)
      .replace(/^→ (.+)$/gm,`<div style="padding-left:14px;color:#5dca96">→ $1</div>`)
      .replace(/^---$/gm,`<hr style="border:none;border-top:1px solid ${C.bdr};margin:12px 0"/>`)
      .replace(/\n{2,}/g,'<div style="height:8px"></div>')
      .replace(/\n/g,"<br/>");
    tables.forEach((t,i)=>{result=result.replace(`__TBL${i}__`,t)});
    return result};

  // 수동 예측 (DB 저장 안 함 — 시뮬레이션 전용)


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
    if(hideAbnormal)src=src.filter(r=>{const y=r.co==="유찰"||r.co==="유찰(무)";const b=!y&&(r.br1==null&&(r.ba==null||r.ba===0));const o=!y&&!b&&r.br1!=null&&(r.br1<87||r.br1>110);return!y&&!b&&!o});
    if(t)src=src.filter(r=>((r.pn||"")+(r.ag||"")+(r.co||"")).toLowerCase().includes(t));
    return[...src].sort((a,b)=>sortFn(a,b,dataSort.key,dataSort.dir))},[recs,search,eF,atF,dataSort,hideAbnormal]);
  const pagedRecs=useMemo(()=>filteredRecs.slice(dataPage*PAGE,(dataPage+1)*PAGE),[filteredRecs,dataPage]);
  const totalPages=Math.max(1,Math.ceil(filteredRecs.length/PAGE));
  const abnormalStats=useMemo(()=>{const y=recs.filter(r=>r.co==="유찰"||r.co==="유찰(무)").length;const b=recs.filter(r=>r.co!=="유찰"&&r.co!=="유찰(무)"&&r.br1==null&&(r.ba==null||r.ba===0)).length;const o=recs.filter(r=>r.br1!=null&&(r.br1<87||r.br1>110)).length;return{yuchal:y,broken:b,outlier:o,total:y+b+o}},[recs]);
  const fAg=useMemo(()=>{const t=agSch.toLowerCase();return Object.entries(curSt.as||{}).filter(([k])=>!t||mSch(k,t)).sort((a,b)=>b[1].n-a[1].n)},[curSt.as,agSch]);
  const agencyList=useMemo(()=>Object.keys(allS.as||{}).sort(),[allS.as]);
  const nC=recs.filter(r=>r.era==="new").length,oC=recs.filter(r=>r.era==="old").length;
  const predMap=useMemo(()=>{const m={};predictions.forEach(p=>{m[p.id]=p});return m},[predictions]);
  // P2 오늘의 공고용 추천 맵 — 예측 리스트 행(compList 렌더)과 같은 계산을 읽기 전용으로 모아 둔다.
  // 업로드 예측만 getFinalRecommendation(출처 필터 유지 — 함수 격리 주석 참조). 자동 예측은 저장된 안착안(b_pred_*, Mode B)만 읽는다.
  // 행 추천값 — 오늘의 공고 표와 투찰 카드가 같은 계산을 쓴다(bidCard.js recOfPred: 업로드 예측만 getFinalRecommendation, 출처 격리는 테스트로 고정).
  const recOf=useCallback((p)=>recOfPred(p,{getFinal:getFinalRecommendation,adjHist,ownScore,passKeyOf,passEffFrOf,resolveAdjHistory,passProbPct,impliedAdjOfBid}),[getFinalRecommendation,adjHist,ownScore]);
  // G2B 양식·투찰 카드 1위 이력 전용 목록(자동 수집 행 합침). 예측 입력(adjHist·pcDistMap·refreshStats·recOf)은 recs 그대로 — 여기 넘기면 저장 예측값이 바뀐다.
  const g2bRecs=useMemo(()=>mergeAutoRows(recs,g2bAuto),[recs,g2bAuto]);
  // 개찰 판정(✓/✗)은 매칭된 낙찰 기록의 실제 1위 금액·하한가로 — 서버 rec_1st_possible과 같은 정의(bidVerdict)
  const recById=useMemo(()=>new Map(recs.map(r=>[r.id,r])),[recs]);
  // 오늘의 공고 배지 = 탭 기본 화면(관내·소경쟁·개찰 예정·전기) 중 예측 없는 공고 수. NoticesTab과 같은 입력으로 계산
  const todayBadge=useMemo(()=>{const nowIso=new Date().toISOString();const today=new Date().toLocaleDateString("sv-SE");
    const pcOf=({at,ag,amount})=>pcDistMap&&at&&amount?resolvePcDist(pcDistMap,{at,canonicalAg:normalizeAgencyName(ag),ba:amount}):null;
    return countTodayActions(buildTodayRows({notices,predictions,keywords:loadKeywords(),pcOf,nowIso,today}))},[notices,predictions,pcDistMap]);
  const todayRecMap=useMemo(()=>{
    const m={};
    predictions.forEach(p=>{if(p&&p.match_status!=="matched")m[p.id]=recOf(p)});
    return m;
  },[predictions,recOf]);
  const cardPred=cardPredId!=null?predMap[cardPredId]:null; // id로 찾아 백필 후에도 최신값
  const fmtRelTime=(iso)=>{if(!iso)return null;const d=Date.now()-new Date(iso).getTime();const m=Math.floor(d/60000);if(m<1)return"방금";if(m<60)return m+"분 전";const h=Math.floor(m/60);if(h<24)return h+"시간 전";return new Date(iso).toLocaleDateString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})};

  const compStats=useMemo(()=>{
    const preds=(predictions||[]).filter(p=>p.source==='file_upload');const matched=preds.filter(p=>p.match_status==="matched");
    // 취소 공고는 "pending"이지만 매칭 불가 → 별도 카운트로 분리, pending에서 제외
    const cancelled=preds.filter(p=>p.match_status!=="matched"&&p.match_status!=="expired"&&isCancelledPred(p));
    const pending=preds.filter(p=>p.match_status==="pending"&&!isCancelledPred(p));
    const expired=preds.filter(p=>p.match_status==="expired");
    const errors=matched.filter(p=>p.adj_rate_error!=null).map(p=>Number(p.adj_rate_error));
    const absErrors=errors.map(e=>Math.abs(e));
    const avgErr=absErrors.length?Math.round(absErrors.reduce((a,b)=>a+b,0)/absErrors.length*10000)/10000:0;
    const bias=errors.length?Math.round(errors.reduce((a,b)=>a+b,0)/errors.length*10000)/10000:0;
    const within05=absErrors.filter(e=>e<=0.5).length;
    const byType={};matched.forEach(p=>{const t=p.at||"기타";if(!byType[t])byType[t]={n:0,errSum:0};byType[t].n++;if(p.adj_rate_error!=null)byType[t].errSum+=Math.abs(p.adj_rate_error)});
    Object.values(byType).forEach(v=>{v.avgErr=v.n?Math.round(v.errSum/v.n*10000)/10000:0});
    return{total:preds.length,matched:matched.length,pending:pending.length,cancelled:cancelled.length,expired:expired.length,avgErr,bias,within05,byType}},[predictions]);
  // 예측 리스트 발주기관 드랍/검색 옵션 (file_upload 예측의 distinct ag, 가나다순)
  const agOptions=useMemo(()=>{const s=new Set();(predictions||[]).forEach(x=>{if(x.source==='file_upload'&&x.ag)s.add(x.ag)});return[...s].sort((a,b)=>a.localeCompare(b,'ko'))},[predictions]);
  // br1(1순위사정율) 조회 맵 — 예측 리스트 "실제 1위 사정률" 표시·오차를 ar1 대신 br1 기준으로 (표시 전용; actual_adj_rate/검증 인프라는 ar1 유지)
  const recBr1=useMemo(()=>{const m=new Map();for(const r of recs){if(r&&r.id!=null&&r.br1!=null)m.set(r.id,Number(r.br1))}return m},[recs]);
  const compList=useMemo(()=>{const p=(predictions||[]).filter(x=>x.source==='file_upload');let list;
    // 기본: expired 자동 제외 (명시적 expired 필터 선택 시에만 표시)
    if(compFilter==="matched")list=p.filter(x=>x.match_status==="matched");
    else if(compFilter==="pending")list=p.filter(x=>x.match_status==="pending"&&!isCancelledPred(x));
    else if(compFilter==="cancelled")list=p.filter(x=>x.match_status!=="matched"&&x.match_status!=="expired"&&isCancelledPred(x));
    else if(compFilter==="expired")list=p.filter(x=>x.match_status==="expired");
    else list=p.filter(x=>x.match_status!=="expired"); // 전체에서 expired 제외 (cancelled는 포함 — 취소 라벨로 표시)
    if(hideYuchal)list=list.filter(x=>!(x.actual_winner&&(x.actual_winner==="유찰"||x.actual_winner==="유찰(무)")));
    if(hideSuui)list=list.filter(x=>!(x.is_negotiation===true&&x.actual_adj_rate==null));
    if(agFilter){const q=agFilter.trim().toLowerCase();if(q)list=list.filter(x=>(x.ag||"").trim().toLowerCase()===q)} // 발주기관 정확일치 (각 기관 개별 — 고양시≠고양시 덕양구)
    // Phase ①: 예상 참가자수 버킷 필터 (분포 미해석·종심제 행은 필터 활성 시 제외)
    if(pcFilter&&pcDistMap){list=list.filter(x=>{if(isLhJongsim(x.at,x.ba,x.pn))return false;const d=resolvePcDist(pcDistMap,{at:x.at,canonicalAg:x.canonical_ag||x.ag,ba:x.ba});return d&&pcBucketOf(d.p50)===pcFilter})}
    // Phase ①: 예상 참가자수 정렬 (계산 필드 — 공용 sortFn 미변경, null은 항상 뒤로)
    if(predSort.key==="exp_pc"){const val=x=>{const d=pcDistMap?resolvePcDist(pcDistMap,{at:x.at,canonicalAg:x.canonical_ag||x.ag,ba:x.ba}):null;return d?d.p50:null};
      return[...list].sort((a,b)=>{const va=val(a),vb=val(b);if(va==null&&vb==null)return 0;if(va==null)return 1;if(vb==null)return -1;return predSort.dir==="asc"?va-vb:vb-va})}
    return[...list].sort((a,b)=>sortFn(a,b,predSort.key,predSort.dir))},[predictions,compFilter,agFilter,predSort,hideYuchal,hideSuui,pcFilter,pcDistMap]);

  // Phase 23-9: pending 건 v2 backfill (분포 map 로드 후 NULL 행에 적용)
  // 라운드 11 권고: ref를 scoreSnap으로 변환 — ownScore 변경 시 stale row 재계산
  const v2BackfillDone=useRef(null); // null | ownScore 값 저장
  useEffect(()=>{
    if(v2BackfillDone.current===ownScore)return; // 같은 score로 이미 실행됨
    if(!Object.keys(win1stDistMap?.agBa||{}).length&&!Object.keys(win1stDistMap?.at||{}).length)return;
    if(!predictions||!predictions.length)return;
    // NULL≡20 동치 규칙: stale row 감지 — bid1st_v2_adj NULL 또는 own_score≠current
    const targets=predictions.filter(p=>
      p.match_status==='pending'
      &&p.source==='file_upload'
      &&p.ba!=null
      &&p.pred_floor_rate!=null
      &&(p.bid1st_v2_adj==null||(p.own_score??20)!==ownScore)
    );
    if(!targets.length){v2BackfillDone.current=ownScore;return;}
    v2BackfillDone.current=ownScore; // 동시 진입 방지
    (async()=>{
      const updates=[];
      for(const p of targets){
        const v2=recommendMain(
          {at:p.at,agName:p.ag,ba:Number(p.ba),ep:Number(p.ep)||Number(p.ba),av:Number(p.av)||0,fr:Number(p.pred_floor_rate)},
          {distMap:win1stDistMap,ownScore}
        );
        if(!v2)continue;
        updates.push({
          id:p.id,
          bid1st_v2_adj:v2.auto.adj,
          bid1st_v2_bid:v2.auto.bid,
          bid1st_v2_win_prob:v2.auto.winProb,
          bid1st_v2_floor_safe:v2.auto.floorSafe,
          bid1st_v2_grain:v2.distribution.grain,
          bid1st_v2_src:v2.distribution.src,
          own_score:ownScore // 라운드 11 권고: 적재 시점 score 기록
        });
      }
      if(!updates.length)return;
      try{
        const ok=await sbUpdatePredictionsV2(updates);
        if(ok>0){
          const refreshed=await sbFetchPredictions();
          setPredictions(refreshed);
        }
      }catch(e){console.warn("v2 backfill 실패:",e?.message);}
    })();
  },[predictions,win1stDistMap,ownScore]);

  // ─── B2.4: V2 Mode B/A 자동채움 (bid_predictions.b_pred_* 6컬럼) ───
  // 근거: docs/v2/HANDOFF_V2_MASTER_PLAN §4 B2 + V2_DDL_SPEC §5
  // resolveMode RPC + recommendV2 → b_pred_mode/adj/bid_amount/floor_pass_prob/grain/src 적재
  // A안: 매칭 후 신규 컬럼 적재만 (기존 opt_adj/bid1st_v2_* 보호)
  //
  // ★ B2.4-fix (사용자 검출, 2026-05-19): win1stDistMap 로드 가드 필수
  // 가드 누락 시 useEffect 첫 트리거에서 빈 distMap으로 전체 row가 AT-fallback(n=0, μ=0, σ=0.642)
  // 일률 적재되어 발주사별 분포 학습이 무력화됨. 기존 bid1st_v2 자동채움(line 1082)과 동일 패턴 적용.
  // 라운드 11 권고: ref를 scoreSnap으로 변환 — ownScore 변경 시 stale row 재계산
  const v2BPredBackfillDone=useRef(null); // null | ownScore 값 저장
  useEffect(()=>{
    if(v2BPredBackfillDone.current===ownScore)return; // 같은 score로 이미 실행됨
    // 가드: win1stDistMap이 로드되어야 발주사별 분포 사용 가능
    if(!Object.keys(win1stDistMap?.agBa||{}).length&&!Object.keys(win1stDistMap?.ag||{}).length)return;
    if(!predictions||!predictions.length)return;
    // NULL≡20 동치 규칙: b_pred_mode NULL 또는 own_score≠current (단 matched row는 INSERT-only 보호 — pending만)
    const targets=predictions.filter(p=>
      p.at!=null
      &&p.ba!=null
      &&p.pred_floor_rate!=null
      &&(p.b_pred_mode==null||(p.match_status==='pending'&&(p.own_score??20)!==ownScore))
    );
    if(!targets.length){v2BPredBackfillDone.current=ownScore;return;}
    v2BPredBackfillDone.current=ownScore; // 동시 진입 방지
    (async()=>{
      const updates=[];
      for(const p of targets){
        try{
          const modeRes=await resolveMode({at:p.at,canonicalAg:p.ag,ba:Number(p.ba)});
          // Mode A(군시설)는 종형 fallback. floorErr 분포는 분포 요율(get_floor_rate_db)·pred_floor_rate 불일치와 자사 점수 미반영이 풀릴 때까지 넘기지 않는다.
          const v2=recommendV2(
            {at:p.at,agName:p.ag,ba:Number(p.ba),ep:Number(p.ep)||Number(p.ba),av:Number(p.av)||0,fr:Number(p.pred_floor_rate)},
            {distMap:win1stDistMap,modeResolution:modeRes,ownScore}
          );
          if(!v2||v2.adj==null)continue;
          const u={
            id:p.id,
            b_pred_mode:v2.mode,
            b_pred_adj:Number(Number(v2.adj).toFixed(4)),
            b_pred_bid_amount:v2.bid,
            b_pred_floor_pass_prob:v2.floor_pass_prob!=null?Number(Number(v2.floor_pass_prob).toFixed(4)):null,
            b_pred_grain:v2.grain,
            b_pred_src:v2.src
          };
          // 라운드 11 권고: 적재 시점 score 기록 — 대기 행만. 매칭 행은 빈 안착안만 채우고 own_score는 두지 않는다
          // (m22: matched row의 own_score는 UPDATE 안 함. 덮어쓰면 매칭 당시 점수로 계산된 bid1st_v2_*·opt_bid에 현재 점수 라벨이 붙음)
          if(p.match_status==='pending')u.own_score=ownScore;
          updates.push(u);
        }catch(e){/* row 단위 실패 무시, 다음 진행 */}
      }
      if(!updates.length)return;
      try{
        const ok=await sbUpdatePredictionsV2(updates);
        if(ok>0){
          const refreshed=await sbFetchPredictions();
          setPredictions(refreshed);
        }
      }catch(e){console.warn("b_pred 자동채움 실패:",e?.message);}
    })();
  },[predictions,win1stDistMap,ownScore]);

  // 스타일
  const btnS=(act,c)=>({padding:"4px 12px",fontSize:11,fontWeight:act?600:400,background:act?c+"22":"#1a1a30",color:act?c:"#888",border:"1px solid "+(act?c+"44":"#252540"),borderRadius:5,cursor:"pointer"});
  const Tb=({id,ch,badge})=>(<button onClick={()=>{setTab(id);setDataPage(0);if(id==="g2b_sheet")setG2bAgency("")}} style={{padding:"10px 20px",fontSize:12,fontWeight:tab===id?600:400,background:tab===id?C.bg3:"transparent",color:tab===id?C.gold:C.txm,border:"none",borderBottom:tab===id?`2px solid ${C.gold}`:"2px solid transparent",cursor:"pointer",position:"relative"}}>{ch}{badge>0&&<span style={{position:"absolute",top:4,right:4,background:"#e24b4a",color:"#fff",fontSize:8,padding:"1px 5px",borderRadius:8,minWidth:14,textAlign:"center"}}>{badge}</span>}</button>);
  // 정렬 가능 헤더
  const SortTh=({label,sortKey,current,setCurrent,align,style:sx})=>{
    const active=current.key===sortKey;
    const arrow=active?(current.dir==="asc"?" ▲":" ▼"):"";
    return<th style={{padding:"8px 4px",textAlign:align||"left",color:active?C.gold:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:11,cursor:"pointer",userSelect:"none",...sx}}
      onClick={()=>{setCurrent(prev=>prev.key===sortKey?{key:sortKey,dir:prev.dir==="asc"?"desc":"asc"}:{key:sortKey,dir:"desc"});setDataPage(0)}}>{label}{arrow}</th>};


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

    {/* 헤더 + 3탭 (sticky 고정) */}
    <div style={{padding:"10px 20px",borderBottom:"1px solid "+C.bdr,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8,position:"sticky",top:0,zIndex:50,background:C.bg}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <span style={{fontSize:16,fontWeight:700,color:C.gold}}>입찰 분석 시스템</span>
        <span style={{fontSize:10,color:C.txd}}>{recs.length.toLocaleString()}건 (신{nC}/구{oC})</span>
        <OwnScoreInput value={ownScore} onChange={setOwnScore} />
        {lastG2bAt&&<span title={"나라장터 공고 마지막 예측 갱신: "+new Date(lastG2bAt).toLocaleString("ko-KR")} style={{display:"inline-flex",alignItems:"center",gap:3,padding:"2px 7px",fontSize:9,color:"#5dca96",background:"rgba(93,202,150,0.08)",border:"1px solid rgba(93,202,150,0.2)",borderRadius:10,cursor:"default"}}>
          ● 공고 {fmtRelTime(lastG2bAt)} 갱신
        </span>}
        {(()=>{
          if(!lastSucviewAt)return null;
          const days=Math.floor((Date.now()-new Date(lastSucviewAt).getTime())/86400000);
          if(days<7)return null;
          const warn=days>=14;
          return<span title={"SUCVIEW(복수예가) 마지막 업로드: "+new Date(lastSucviewAt).toLocaleString("ko-KR")+"\n인포21C에서 SUCVIEW 파일을 다운로드해 업로드하세요."}
            style={{display:"inline-flex",alignItems:"center",gap:3,padding:"2px 7px",fontSize:9,color:warn?"#e24b4a":"#d4a834",background:warn?"rgba(226,75,74,0.08)":"rgba(212,168,52,0.08)",border:"1px solid "+(warn?"rgba(226,75,74,0.25)":"rgba(212,168,52,0.25)"),borderRadius:10,cursor:"help"}}>
            ⚠ SUCVIEW {days}일 없음
          </span>;
        })()}
        {(()=>{
          const now=Date.now();
          const H24=24*3600*1000, H2=2*3600*1000;
          const imm=notices.filter(n=>n.prediction_id&&n.od&&(new Date(n.od).getTime()-now)<=H24&&(new Date(n.od).getTime()-now)>0);
          if(imm.length===0)return null;
          const urgent=imm.some(n=>(new Date(n.od).getTime()-now)<=H2);
          return<span title={"24시간 내 개찰: "+imm.length+"건"+(urgent?" (2시간 내 긴급 포함)":"")+"\n클릭 시 공고 탭으로 이동"}
            onClick={()=>{setNoticeFilter("upcoming");setTab("notices");}}
            style={{display:"inline-flex",alignItems:"center",gap:3,padding:"2px 7px",fontSize:9,color:urgent?"#e24b4a":"#d4a834",background:urgent?"rgba(226,75,74,0.12)":"rgba(212,168,52,0.12)",border:"1px solid "+(urgent?"rgba(226,75,74,0.35)":"rgba(212,168,52,0.35)"),borderRadius:10,cursor:"pointer",fontWeight:600}}>
            ⏰ 임박 {imm.length}건
          </span>;
        })()}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:0,flexWrap:"wrap"}}>
        <div style={{display:"flex",gap:0,flexWrap:"wrap",alignItems:"center"}}>
          {TOP_TABS.map(t=><Tb key={t.id} id={t.id} ch={t.ch} badge={t.id==="predict"?compStats.pending:t.id==="notices"?todayBadge:undefined}/>)}
          {/* 보조 메뉴 접기 — 접힌 상태에서도 활성 탭은 노출 유지 */}
          {(()=>{
            const shown=moreTabs?SUB_TABS:SUB_TABS.filter(s=>s.id===tab);
            return<>
              {shown.map(s=><Tb key={s.id} id={s.id} ch={s.ch}/>)}
              <button onClick={()=>setMoreTabs(v=>!v)} title={moreTabs?"보조 메뉴 접기":SUB_TABS.map(s=>s.ch.replace(/^\S+\s/,"")).join("·")}
                style={{padding:"10px 12px",fontSize:12,background:"transparent",color:moreTabs?C.gold:C.txd,border:"none",borderBottom:"2px solid transparent",cursor:"pointer"}}>
                {moreTabs?"접기 ▴":"보조 ▾"}</button>
            </>;
          })()}
          {isAdmin&&<Tb id="admin" ch="👤 관리자"/>}
        </div>
        <UserBadge/>
      </div>
    </div>
    {msg.text&&<div style={{margin:"0 auto",maxWidth:1000,padding:"8px 16px"}}><div style={{padding:"8px 14px",background:msg.type==="ok"?"rgba(93,202,165,0.08)":"rgba(220,50,50,0.08)",border:`1px solid ${msg.type==="ok"?"rgba(93,202,165,0.3)":"rgba(220,50,50,0.3)"}`,borderRadius:6,fontSize:12,color:msg.type==="ok"?"#5ca":"#e55"}}>{msg.type==="ok"?"✓ ":"✕ "}{msg.text}</div></div>}

    <div style={{maxWidth:tab==="g2b_sheet"?1480:1300,margin:"0 auto",padding:"16px 16px"}}>

    {/* ═══ 대시보드 탭 ═══ */}
    {REF_ONLY_TABS.has(tab)&&<div style={{margin:"0 0 10px",padding:"6px 12px",fontSize:11,color:"#d4a834",background:"rgba(212,168,52,0.08)",border:"1px solid rgba(212,168,52,0.3)",borderRadius:6}}>{REF_ONLY_BANNER}</div>}
    {tab==="data"&&<DataTab busy={busy} drag={drag} setDrag={setDrag} loadFiles={loadFiles} loadPredFiles={loadPredFiles} uploadLog={uploadLog} dbLoading={dbLoading} compStats={compStats} dataStatus={dataStatus} bidDetails={bidDetails} onOpenExpired={()=>{setTab("predict");setCompFilter("expired")}}/>}

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
                <th style={{padding:"5px 6px",textAlign:"left",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:10}}>사정률 조정(Δ)</th>
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
      </div>
      <div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,overflow:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,tableLayout:"fixed"}}>
          <colgroup><col style={{width:"22%"}}/><col style={{width:"12%"}}/><col style={{width:"6%"}}/><col style={{width:"12%"}}/><col style={{width:"10%"}}/><col style={{width:"10%"}}/><col style={{width:"10%"}}/><col style={{width:"5%"}}/></colgroup>
          <thead><tr style={{background:C.bg3}}>
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
              <td style={{padding:"6px 4px",textAlign:"right",color:"#a8b4ff"}}>{r.br1!=null?Number(r.br1).toFixed(4):""}</td>
              <td style={{padding:"6px 4px",textAlign:"right"}}>{r.od||""}</td>
              <td style={{padding:"6px 4px",textAlign:"center",color:r.era==="new"?"#5dca96":"#e24b4a",fontSize:10}}>{r.era==="new"?"신":"구"}</td>
            </tr>})}</tbody>
        </table>
      </div>
      <div style={{display:"flex",justifyContent:"center",gap:8,marginTop:10,alignItems:"center"}}><button disabled={dataPage===0} onClick={()=>setDataPage(p=>p-1)} style={{padding:"5px 12px",fontSize:11,background:C.bg3,border:"1px solid "+C.bdr,borderRadius:5,color:C.txt,cursor:dataPage===0?"default":"pointer"}}>◀</button><span style={{fontSize:11,color:C.txd}}>{dataPage+1}/{totalPages}</span><button disabled={dataPage>=totalPages-1} onClick={()=>setDataPage(p=>p+1)} style={{padding:"5px 12px",fontSize:11,background:C.bg3,border:"1px solid "+C.bdr,borderRadius:5,color:C.txt,cursor:dataPage>=totalPages-1?"default":"pointer"}}>▶</button></div>
    </div>}

    {/* ═══ 예측 탭 (개편: 시뮬레이션 분리 + 통합 리스트 + 상세 모달) ═══ */}
    {tab==="predict"&&<div>
      {/* 상단: 입찰서류함 파일 업로드 */}
      <div style={{marginBottom:16}}>
        {/* 파일 업로드 (메인) */}
        <div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,overflow:"hidden"}}>
          <div style={{border:`2px dashed ${dragPred?C.gold:C.bdr}`,borderRadius:10,padding:"30px 16px",textAlign:"center",cursor:busy?"default":"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:dragPred?"rgba(212,168,52,0.04)":"transparent"}}
            onDrop={e=>{e.preventDefault();setDragPred(false);if(!busy&&e.dataTransfer.files?.length)loadPredFiles(e.dataTransfer.files)}}
            onDragOver={e=>{e.preventDefault();if(!busy)setDragPred(true)}} onDragLeave={()=>setDragPred(false)}
            onClick={()=>{if(!busy)document.getElementById("pfi").click()}}>
            <input id="pfi" type="file" accept=".xls,.xlsx" multiple style={{display:"none"}} onChange={e=>{if(e.target.files?.length){loadPredFiles(e.target.files);e.target.value=""}}}/>
            {busy?<div style={{color:C.gold,fontSize:14}}>예측 처리 중...</div>:<>
              <div style={{fontSize:28,opacity:0.3,marginBottom:6}}>↑</div>
              <div style={{fontSize:13,fontWeight:600,marginBottom:4}}>입찰서류함 업로드</div>
              <div style={{fontSize:11,color:C.txd}}>복수 XLS 파일 드래그 가능 · 각 건 예측 + DB 저장</div>
            </>}
          </div>
        </div>
      </div>
      {/* ★ 통합 예측 리스트 (file_upload 건 + 매칭 건) */}
      <div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,padding:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
          <div style={{fontSize:13,fontWeight:600,color:C.gold}}>예측 내역 ({compStats.total}건)</div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <button onClick={()=>{
              const wb=XLSX.utils.book_new();
              const data=compList.map(p=>{
                const finalRec=getFinalRecommendation(p);
                const finalAdj=finalRec.adj;const finalBid=finalRec.bid;const finalBid1st=finalRec.bid1st;
                const actBr1=p.matched_record_id!=null?(recBr1.get(p.matched_record_id)??null):null;
                const optVerdict=bidVerdict(finalBid1st||finalBid,recById.get(p.matched_record_id));
                return{
                  "공고명":p.pn||"",
                  "공고번호":p.pn_no||"",
                  "발주기관":p.ag||"",
                  "기관유형":p.at||"",
                  "개찰일":p.open_date||"",
                  // 기본 정보
                  "기초금액":p.ba||"",
                  "추정가격":p.ep||"",
                  "A값":p.av||"",
                  "낙찰하한율":p.pred_floor_rate||"",
                  "자사 유효 낙찰하한율":p.pred_floor_rate!=null?calcEffectiveFloorRate(p.at,Number(p.pred_floor_rate),ownScore):"",
                  "자사 비가격 점수":ownScore,
                  // ★ Phase 6-A: 추천은 opt_adj 단일 소스
                  "추천 사정률(100%)":finalAdj!=null?(100+Number(finalAdj)).toFixed(4):"",
                  "추천 투찰금액":finalBid1st||finalBid||"",
                  "추천근거":finalRec.source||"",
                  // 참고: 순수 통계 예측 (편향 보정 전)
                  "순수예측 사정률(100%)":p.pred_adj_rate!=null?(100+Number(p.pred_adj_rate)).toFixed(4):"",
                  "순수예측 투찰금액":p.pred_bid_amount||"",
                  "예측소스":p.pred_source||"",
                  // 입찰 후 결과
                  "실제 1위 사정률(100%)":actBr1!=null?actBr1.toFixed(4):"",
                  "오차(추천-실제)":finalAdj!=null&&actBr1!=null?((100+Number(finalAdj))-actBr1).toFixed(4):"",
                  "실제1위금액":p.actual_bid_amount||"",
                  "실제1위업체":p.actual_winner||"",
                  "참여업체수":p.actual_participant_count||"",
                  "매칭상태":p.match_status||"",
                  "낙찰가능":p.match_status==="matched"&&optVerdict?(optVerdict==="possible"?"✓":"✗"):""
                }});
              XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data),"예측내역");XLSX.writeFile(wb,"예측내역_"+new Date().toISOString().slice(0,10)+".xlsx")
            }} style={{padding:"4px 10px",fontSize:10,background:C.bg3,border:"1px solid "+C.bdr,borderRadius:5,color:C.txm,cursor:"pointer"}}>엑셀</button>
            <button onClick={async()=>{setBusy(true);const r=await refreshAll();setBusy(false);setMsg({type:"ok",text:r?`새로고침 완료${r.matched>0?" · "+r.matched+"건 매칭":""}`:""})}} disabled={busy}
              style={{padding:"4px 10px",fontSize:10,background:C.bg3,border:"1px solid "+C.bdr,borderRadius:5,color:C.txt,cursor:busy?"default":"pointer"}}>{busy?"갱신...":"새로고침"}</button>
          </div>
        </div>
        <div style={{display:"flex",gap:4,marginBottom:10,alignItems:"center",flexWrap:"wrap"}}>
          <button onClick={()=>{setCompFilter("all");setPredListShow(50)}} style={btnS(compFilter==="all",C.gold)}>전체 ({compStats.total - compStats.expired})</button>
          <button onClick={()=>{setCompFilter("matched");setPredListShow(50)}} style={btnS(compFilter==="matched","#5dca96")}>매칭 ({compStats.matched})</button>
          <button onClick={()=>{setCompFilter("pending");setPredListShow(50)}} style={btnS(compFilter==="pending","#e24b4a")}>대기 ({compStats.pending})</button>
          {compStats.cancelled>0&&<button onClick={()=>{setCompFilter("cancelled");setPredListShow(50)}} style={btnS(compFilter==="cancelled","#c08040")}>취소 ({compStats.cancelled})</button>}
          {compStats.expired>0&&<button onClick={()=>{setCompFilter("expired");setPredListShow(50)}} style={btnS(compFilter==="expired","#666680")}>만료 ({compStats.expired})</button>}
          {/* 발주기관 필터: 검색 또는 드랍으로 선택 (디폴트 빈값=전체) */}
          <span style={{marginLeft:8,display:"inline-flex",alignItems:"center",gap:4}}>
            <input list="agFilterOptions" value={agFilter} onChange={e=>{setAgFilter(e.target.value);setPredListShow(50)}} placeholder="발주기관 검색·선택 (전체)" title="발주기관을 입력해 검색하거나 목록에서 선택. 비우면 전체."
              style={{padding:"6px 12px",fontSize:12,background:C.bg3,border:"1px solid "+(agFilter?C.gold+"66":C.bdr),borderRadius:5,color:C.txt,minWidth:320,flex:"1 1 320px",maxWidth:480}}/>
            <datalist id="agFilterOptions">{agOptions.map(a=><option key={a} value={a}/>)}</datalist>
            {agFilter&&<button onClick={()=>{setAgFilter("");setPredListShow(50)}} title="전체 보기" style={{padding:"4px 8px",fontSize:10,background:C.bg3,border:"1px solid "+C.bdr,borderRadius:5,color:C.txd,cursor:"pointer"}}>✕</button>}
            {/* Phase ①: 예상 참가자수 버킷 필터 — 팩트 필터일 뿐, 낙찰 보장 아님 */}
            <select value={pcFilter} onChange={e=>{setPcFilter(e.target.value);setPredListShow(50)}} title="예상 참가자수 필터 — 같은 발주기관·금액대의 직전 1년 개찰 실측 중앙값 기준. 참가자가 적을수록 1순위 구간이 넓어집니다 (100명 미만 실측 1~3%, 그 외 약 0.6% — 낙찰 보장 아님)"
              style={{padding:"6px 10px",fontSize:12,background:C.bg3,border:"1px solid "+(pcFilter?"#5dca9666":C.bdr),borderRadius:5,color:pcFilter?"#5dca96":C.txt,cursor:"pointer"}}>
              <option value="">참가자수 전체</option>
              <option value="small">{"<100"}</option>
              <option value="mid">{"100~400"}</option>
              <option value="large">{"≥400"}</option>
            </select>
          </span>
          <label style={{display:"flex",alignItems:"center",gap:4,marginLeft:8,cursor:"pointer",fontSize:10,color:hideYuchal?C.txd:"#e24b4a"}}>
            <input type="checkbox" checked={hideYuchal} onChange={e=>{setHideYuchal(e.target.checked);setPredListShow(50)}} style={{accentColor:"#e24b4a",width:12,height:12}}/>
            <span>유찰 숨김 ({predictions.filter(p=>p.actual_winner&&(p.actual_winner==="유찰"||p.actual_winner==="유찰(무)")).length}건)</span>
          </label>
          <label style={{display:"flex",alignItems:"center",gap:4,cursor:"pointer",fontSize:10,color:hideSuui?C.txd:"#d4a834"}}>
            <input type="checkbox" checked={hideSuui} onChange={e=>{setHideSuui(e.target.checked);setPredListShow(50)}} style={{accentColor:"#d4a834",width:12,height:12}}/>
            <span>수의 숨김 ({predictions.filter(p=>p.is_negotiation===true&&p.actual_adj_rate==null).length}건)</span>
          </label>
        </div>
        {compList.length>0?<div style={{overflow:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,tableLayout:"fixed"}}>
            <colgroup><col style={{width:"14%"}}/><col style={{width:"8%"}}/><col style={{width:"7%"}}/><col style={{width:"8%"}}/><col style={{width:"5%"}}/><col style={{width:"5%"}}/><col style={{width:"7%"}}/><col style={{width:"8%"}}/><col style={{width:"6%"}}/><col style={{width:"7%"}}/><col style={{width:"5%"}}/><col style={{width:"5%"}}/><col style={{width:"4%"}}/></colgroup>
            <thead>
              <tr>
                <th colSpan={7} style={{padding:"4px 6px",fontSize:10,color:C.gold,fontWeight:500,borderBottom:"1px solid "+C.bdr+"44",textAlign:"left",letterSpacing:1}}>투찰 전 추천</th>
                <th colSpan={3} style={{padding:"4px 6px",fontSize:10,color:"#a8b4ff",fontWeight:500,borderBottom:"1px solid "+C.bdr+"44",textAlign:"left",letterSpacing:1}}>입찰 후 결과</th>
                <th colSpan={3} style={{padding:"4px 6px",fontSize:10,borderBottom:"1px solid "+C.bdr+"44"}}></th></tr>
              <tr style={{background:C.bg3}}>
              <SortTh label="공고명" sortKey="pn" current={predSort} setCurrent={setPredSort}/>
              <SortTh label="발주기관" sortKey="ag" current={predSort} setCurrent={setPredSort}/>
              <th style={{padding:"7px 4px",textAlign:"right",color:C.gold,fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:11}}>추천 사정률(100%)</th>
              <th style={{padding:"7px 4px",textAlign:"right",color:C.gold,fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:11}}>추천 투찰금</th>
              <th title="실격위험 — 추천 투찰금이 실제 낙찰하한가에 미달할 확률. 발주기관(기록 30건 미만이면 기관유형 전체)의 최근 3년 발주처 사정율 기록 기반 추정, 정보 제공용" style={{padding:"7px 4px",textAlign:"right",color:C.gold,fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:11}}>실격위험</th>
              <SortTh label="예상참가" sortKey="exp_pc" current={predSort} setCurrent={setPredSort} align="right"/>
              <SortTh label="개찰일" sortKey="open_date" current={predSort} setCurrent={setPredSort} align="right"/>
              <th title="1순위사정율(br1) 기준 — 1순위 투찰금에서 역산한 사정률. 예가/기초(ar1) 아님. 오차도 br1 기준." style={{padding:"7px 4px",textAlign:"right",color:"#a8b4ff",fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:11}}>실제 1위 사정률(100%)</th>
              <th style={{padding:"7px 4px",textAlign:"right",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:11}}>오차</th>
              <th style={{padding:"7px 4px",textAlign:"right",color:"#5dca96",fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:11}} title="발주처사정율(ar1 = 예가/기초, 100-base) — 개찰 후 매칭된 실제값">발주사 사정율(100%)</th>
              <SortTh label="상태" sortKey="match_status" current={predSort} setCurrent={setPredSort} align="center"/>
              <th style={{padding:"7px 4px",textAlign:"center",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:11}}>낙찰</th>
              <th style={{padding:"7px 4px",textAlign:"center",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:11}}></th>
            </tr></thead>
            <tbody>{compList.slice(0,predListShow).map(p=>{
              // Phase 5.6: 통합 최종 추천 (모달과 동일 로직: AI > Enhanced > opt_adj > pred)
              const finalRec=getFinalRecommendation(p);
              const finalAdj=finalRec.adj;const finalBid=finalRec.bid;const finalBid1st=finalRec.bid1st;
              // 실격위험 (표시 전용): 발주기관의 과거 발주처 사정율 vs 투찰금이 전제하는 사정률 — passProb.js (상세 화면과 같은 계산)
              const adjDist=finalRec.jongsim?null:resolveAdjHistory(adjHist,passKeyOf(p));
              const passL=(adjDist&&(finalBid1st||finalBid)&&p.ba)?passProbPct(adjDist,impliedAdjOfBid({bid:Number(finalBid1st||finalBid),ba:Number(p.ba),av:Number(p.av)||0,effFr:passEffFrOf(p,ownScore)})):null;
              const dRisk=passL==null?null:100-passL;
              // Phase ①: 예상 참가자수 (과거 동일 grain 개찰 실측 p50, 표시 전용 — 낙찰 보장 아님). 종심제는 "—" (spec §2-3)
              const pcD=(!finalRec.jongsim&&pcDistMap)?resolvePcDist(pcDistMap,{at:p.at,canonicalAg:p.canonical_ag||p.ag,ba:p.ba}):null;
              // 신뢰도: 모달과 동일한 공유 헬퍼(predConfidenceV2, 실측 정확도 기반) — badge·강조 정합
              const isHighConf=predConfidenceV2(p.pred_source, accuracyMap, {at:p.at, ag:p.ag, ba:p.ba}).level==='high';
              // 실측 1위 사정률 = br1(1순위사정율, 100-base). 표시·오차 산출에 사용 (actual_adj_rate/검증 인프라는 ar1 유지)
              const actBr1=p.matched_record_id!=null?(recBr1.get(p.matched_record_id)??null):null;
              // 발주사 사정율 = 발주처사정율(ar1 = 예가/기초, 100-base). 개찰 후 매칭된 실제값 (actual_adj_rate 기반)
              const agAr1=p.actual_adj_rate!=null?100+Number(p.actual_adj_rate):null;
              // Phase 23-5: 실측 방향 힌트 (리스트용, 셀 폭 고려해 글리프 축소)
              const biasArrow=getBiasArrow(predBiasMap,{at:p.at,ag:p.ag,ba:p.ba});
              const optErr=(finalAdj!=null&&actBr1!=null)?(100+Number(finalAdj))-actBr1:null;
              const isAnomaly=optErr!=null&&Math.abs(optErr)>5;
              const errColor=isAnomaly?"#e24b4a":optErr!=null?(Math.abs(optErr)<0.3?"#5dca96":Math.abs(optErr)<1?"#d4a834":"#e24b4a"):C.txd;
              const verdict=bidVerdict(finalBid1st||finalBid,recById.get(p.matched_record_id)); // null = 낙찰 기록 없음·하한가 없음 → 칸 비움
              const canWin=!isAnomaly&&verdict==="possible";
              const isYuchal=p.actual_winner&&(p.actual_winner==="유찰"||p.actual_winner==="유찰(무)");
              // 수의계약: is_negotiation 플래그 기준 (복수예가 메커니즘 미적용)
              const isSuui=!isYuchal&&p.is_negotiation===true&&p.actual_adj_rate==null;
              // 데이터대기: 경쟁입찰인데 bid_records에 사정률 미입력된 불완전 레코드
              const isDataWait=!isYuchal&&!isSuui&&p.match_status==="matched"&&actBr1==null;
              // 취소 공고: pn 텍스트 (취소)/[취소] 매치 + 매칭 전 (matched·expired 아님)
              const isCanc=p.match_status!=="matched"&&p.match_status!=="expired"&&isCancelledPred(p);
              return<tr key={p.id} id={"pred-row-"+p.id} style={{borderBottom:"1px solid "+C.bdr,opacity:(isAnomaly||isYuchal||isSuui||isDataWait?0.5:1),transition:"background 0.3s"}}>
                <td style={{padding:"6px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={p.pn}>{p.pn}</td>
                <td style={{padding:"6px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.ag}</td>
                <td style={{padding:"6px",textAlign:"right",fontFamily:"monospace",fontSize:11,color:finalRec.jongsim?"#e24b4a":(finalRec.floorSafe===false?"#e24b4a":(isHighConf?"#5dca96":C.gold)),fontWeight:500}} title={finalRec.jongsim?"LH 종심제·순심제 (예측 미지원)":(finalRec.floorSafe===false?"⚠ 자격 미달 — 그대로 투찰 시 자동 탈락 (av가 큰 입찰)":(finalRec.source?"근거: "+finalRec.source:""))}>
                  {finalRec.jongsim?<span style={{fontSize:10,padding:"2px 6px",borderRadius:4,background:"rgba(226,75,74,0.12)"}}>⚠ 종심제</span>:(finalAdj!=null?(
                    <span style={{display:"inline-flex",alignItems:"center",gap:4,justifyContent:"flex-end"}}>
                      <span>{(100+Number(finalAdj)).toFixed(4)+"%"}</span>
                      {finalRec.floorSafe===false&&<span style={{fontSize:10,color:"#e24b4a",fontWeight:700}} title="자격 미달">⚠</span>}
                      {biasArrow&&<span
                        style={{color:biasArrow.color,fontSize:biasArrow.size==='large'?13:biasArrow.size==='medium'?12:11,lineHeight:1,fontWeight:700}}
                        title={`실측 방향 힌트: ${biasArrow.label} (${biasArrow.sign>=0?'↑ 상향':'↓ 하향'} ${Math.abs(biasArrow.actualDir).toFixed(3)}%p · 근거 ${biasArrow.source})`}
                      >{biasArrow.glyph}</span>}
                    </span>
                  ):"")}
                </td>
                <td style={{padding:"6px",textAlign:"right",fontFamily:"monospace",fontSize:11,color:(isHighConf&&!finalRec.jongsim&&finalRec.floorSafe!==false)?"#5dca96":C.gold,fontWeight:700}}>
                  {finalRec.jongsim?<span style={{fontSize:10,color:C.txd}}>—</span>:((finalBid1st||finalBid)?tc(Number(finalBid1st||finalBid)):"")}</td>
                <td style={{padding:"6px",textAlign:"right",fontFamily:"monospace",fontSize:11,fontWeight:600,color:dRisk!=null?riskColor(dRisk):C.txd}} title={dRisk!=null?`실격위험 ${riskLabel(dRisk)} — 추천 투찰금이 실제 하한 미달일 확률\n${adjDist.grain==='AG'?'이 발주기관':'기관유형 전체'} 과거 ${adjDist.n}건 · 최근 3년`:(finalRec.jongsim?"종심제 — 미적용":"과거 기록 부족")}>{dRisk!=null?riskLabel(dRisk):<span style={{fontSize:10,color:C.txd}}>—</span>}</td>
                <td style={{padding:"6px",textAlign:"right",fontFamily:"monospace",fontSize:11,color:(pcD&&pcColor(pcD.p50))||C.txm}} title={pcD?`예상 참가자수 ~${tc(pcD.p50)}개 (p25~p75: ${tc(pcD.p25)}~${tc(pcD.p75)})\n표본 ${pcD.n}건 · 최근 365일 · ${PC_GRAIN_LABELS[pcD.grain]||pcD.grain} · 개찰 실측 분포\n참가자가 적을수록 추첨 모수가 작아집니다 (낙찰 보장 아님)`:(finalRec.jongsim?"종심제 — 미적용":"분포 표본 부족")}>{pcD?"~"+tc(pcD.p50):<span style={{fontSize:10,color:C.txd}}>—</span>}</td>
                <td style={{padding:"6px",textAlign:"right",fontSize:11,whiteSpace:"nowrap"}}>{p.open_date||""}</td>
                <td style={{padding:"6px",textAlign:"right",color:isYuchal?"#e24b4a":isSuui?"#d4a834":isDataWait?"#8a93a8":"#a8b4ff",fontFamily:"monospace",fontSize:11}}>{isYuchal?<span style={{fontSize:10}}>유찰</span>:isSuui?<span style={{fontSize:10}}>수의</span>:isDataWait?<span style={{fontSize:10}}>데이터대기</span>:actBr1!=null?actBr1.toFixed(4)+"%":""}</td>
                <td style={{padding:"6px",textAlign:"right",color:errColor,fontWeight:600,fontSize:11}}>{isYuchal||isSuui||isDataWait?"—":isAnomaly?"⚠":optErr!=null?optErr.toFixed(4):""}</td>
                <td style={{padding:"6px",textAlign:"right",fontFamily:"monospace",fontSize:11,color:"#5dca96"}} title="발주처사정율(ar1 = 예가/기초)">
                  {agAr1!=null?agAr1.toFixed(4)+"%":<span style={{color:C.txd,fontSize:10}}>—</span>}</td>
                <td style={{padding:"6px",textAlign:"center"}}>{isYuchal?<span style={{fontSize:10,padding:"2px 6px",borderRadius:4,background:"rgba(226,75,74,0.1)",color:"#e24b4a"}}>유찰</span>:isSuui?<span style={{fontSize:10,padding:"2px 6px",borderRadius:4,background:"rgba(212,168,52,0.15)",color:"#d4a834"}}>수의</span>:isDataWait?<span style={{fontSize:10,padding:"2px 6px",borderRadius:4,background:"rgba(138,147,168,0.15)",color:"#8a93a8"}}>데이터대기</span>:isCanc?<span style={{fontSize:10,padding:"2px 6px",borderRadius:4,background:"rgba(192,128,64,0.15)",color:"#c08040"}}>취소</span>:<span style={{fontSize:10,padding:"2px 6px",borderRadius:4,background:p.match_status==="matched"?"rgba(93,202,165,0.15)":"rgba(226,75,74,0.15)",color:p.match_status==="matched"?"#5dca96":"#e24b4a"}}>{p.match_status==="matched"?"매칭":"대기"}</span>}</td>
                <td style={{padding:"6px",textAlign:"center"}}>{p.match_status==="matched"&&!isYuchal&&!isSuui&&!isDataWait&&verdict?(canWin?<span style={{fontSize:9,padding:"1px 5px",borderRadius:3,background:"rgba(93,202,165,0.15)",color:"#5dca96"}}>✓</span>:<span style={{fontSize:9,color:C.txd}}>✗</span>):""}</td>
                <td style={{padding:"6px",textAlign:"center"}}><button onClick={()=>setCardPredId(p.id)} style={{padding:"2px 8px",fontSize:10,background:"rgba(168,180,255,0.1)",border:"1px solid rgba(168,180,255,0.25)",borderRadius:4,color:"#a8b4ff",cursor:"pointer"}}>상세</button></td>
              </tr>})}</tbody>
          </table>
          {/* 더보기 + 건수 표시 */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0"}}>
            <span style={{fontSize:11,color:C.txd}}>{Math.min(predListShow,compList.length)} / {compList.length}건 표시</span>
            {predListShow<compList.length?<button onClick={()=>setPredListShow(prev=>prev+50)} style={{padding:"6px 20px",fontSize:11,background:C.bg3,border:"1px solid "+C.bdr,borderRadius:6,color:C.gold,cursor:"pointer",fontWeight:500}}>
              더보기 (+50건)
            </button>:<span style={{fontSize:10,color:C.txd}}>전체 표시 완료</span>}
          </div>
        </div>:<div style={{textAlign:"center",padding:30,color:C.txd,fontSize:12}}>예측 내역이 없습니다. 입찰서류함을 업로드해주세요.</div>}
      </div>
    </div>}

    {/* ═══ 나라장터 공고 탭 ═══ */}
    {cardPred&&<BidCard pred={cardPred} rec={recOf(cardPred)} recs={g2bRecs} pcDistMap={pcDistMap} ownScore={ownScore} accuracyMap={accuracyMap} onClose={()=>setCardPredId(null)} onOpenG2B={(ag)=>{setG2bAgency(ag);setCardPredId(null);setTab("g2b_sheet")}}/>}
    {tab==="performance"&&<PerformanceTab recs={recs} bidDetails={bidDetails}/>}
    {tab==="notices"&&<NoticesTab
      notices={notices}
      setNotices={setNotices}
      noticeFilter={noticeFilter}
      setNoticeFilter={setNoticeFilter}
      onOpenCard={setCardPredId}
      todayRecMap={todayRecMap}
      predictions={predictions}
      loadPredFiles={loadPredFiles}
      noticeLoadingIds={noticeLoadingIds}
      setNoticeLoadingIds={setNoticeLoadingIds}
      refreshPredictions={refreshPredictions}
      pcDistMap={pcDistMap}
    />}

    {/* ═══ Phase 20: 작전 대시보드 탭 ═══ */}

    {/* ═══ U0 Phase 2: V2 미리보기 (mock 표시, B2/B3 엔진 미연결) ═══ */}

    {/* ═══ Phase 22 P2-2: 낙찰 결과 자동 피드백 탭 ═══ */}
    {tab==="feedback"&&<PredictionFeedback/>}

    {/* ═══ v7-ops-4B: 모델 검증 탭 ═══ */}
    {tab==="quality"&&(()=>{
      const latestWeek=weeklyQuality.find(w=>w.scope==="overall");
      const atWeekly=weeklyQuality.filter(w=>w.scope==="at").slice(0,12);
      const routeWeekly=weeklyQuality.filter(w=>w.scope==="route").slice(0,6);
      // P1(2026-09-24): 버전 필터 필수 — 조회(sbFetchQualityDaily)가 전 버전을 가져오므로, 필터가 없으면
      // v6.2·v6.2_g2b·v6.2_shown이 같은 날짜에 여러 줄로 섞여 표시된다(m43 이후 기존 결함).
      // 공식 추천안(메인 bid1st_v2) 채점 슬라이스만 표시.
      const dailyOverall=qualityDaily.filter(d=>d.model_version==='v6.2_shown'&&!d.at&&!d.route).slice(0,14);
      const biasColor=(b)=>{const a=Math.abs(Number(b));if(a<0.05)return C.txm;if(a<0.10)return "#d4a834";if(a<0.20)return "#e8954b";return "#e24b4a"};
      const maeColor=(m)=>{const v=Number(m);if(v<0.50)return "#5dca96";if(v<0.70)return "#d4a834";return "#e24b4a"};
      return<div style={{padding:"14px 16px",maxWidth:1100,margin:"0 auto"}}>
        <div style={{fontSize:18,fontWeight:700,color:C.txt,marginBottom:4}}>🔬 모델 검증 대시보드</div>
        <div style={{fontSize:11,color:C.txm,marginBottom:18}}>예측 엔진 품질 모니터링 — 일별 MAE · 주간 드리프트 · 기관별 편향</div>
        {qualityLoading&&<div style={{padding:20,textAlign:"center",color:C.txm,fontSize:12}}>…데이터 로드 중</div>}
        {!qualityLoading&&!weeklyQuality.length&&!qualityDaily.length&&<div style={{padding:20,textAlign:"center",color:C.txd,fontSize:12,background:C.bg3,borderRadius:8}}>검증 데이터 없음. 일일 cron이 아직 실행 안 됐을 수 있습니다.</div>}

        {/* 0. 요약 스트립 (4-카드: 주간MAE · 알림 · 관찰세그먼트 · 이력) */}
        {(latestWeek||watchlist.length>0)&&(()=>{
          let highN=0,medN=0;
          if(watchlist.length>0){
            const histMap={};
            for(const r of watchHistory){const k=r.at+"|"+r.tier;if(!histMap[k])histMap[k]=[];histMap[k].push(r)}
            for(const k in histMap)histMap[k].sort((a,b)=>String(b.snapshot_date).localeCompare(String(a.snapshot_date)));
            const bySeg={};
            const bump=(k,sev)=>{if(!bySeg[k])bySeg[k]=sev;else if(sev==="HIGH")bySeg[k]="HIGH"};
            for(const s of watchlist){
              const k=s.at+"|"+s.tier;const nRec=Number(s.n_recent||0);
              if(s.grade==="HOT")bump(k,"HIGH");
              else if(s.grade==="WARN"){const hist=histMap[k]||[];let streak=0;for(const r of hist){if(r.grade==="WARN"||r.grade==="HOT")streak++;else break}if(streak>=2)bump(k,"HIGH")}
              if(nRec>=15&&s.bias_drift!=null&&Math.abs(Number(s.bias_drift))>=0.5)bump(k,"MED");
              if(nRec>=15&&s.mae_drift!=null&&Number(s.mae_drift)>=0.2)bump(k,"MED");
            }
            for(const sev of Object.values(bySeg)){if(sev==="HIGH")highN++;else medN++}
          }
          const hotN=watchlist.filter(s=>s.grade==="HOT").length;
          const warnN=watchlist.filter(s=>s.grade==="WARN").length;
          const okN=watchlist.filter(s=>s.grade==="OK").length;
          const histDates=Array.from(new Set(watchHistory.map(r=>r.snapshot_date))).length;
          const cardS={padding:"10px 12px",background:C.bg3,borderRadius:6,minHeight:62,display:"flex",flexDirection:"column",justifyContent:"space-between"};
          const labS={fontSize:9,color:C.txd,marginBottom:4,textTransform:"uppercase",letterSpacing:0.3};
          return<div style={{display:"grid",gridTemplateColumns:"repeat(4, 1fr)",gap:8,marginBottom:14}}>
            <div style={cardS}>
              <div style={labS}>📊 주간 MAE (원시 엔진)</div>
              {latestWeek?<div>
                <div style={{fontSize:18,fontWeight:700,color:maeColor(latestWeek.mae_week),fontFamily:"monospace"}}>{Number(latestWeek.mae_week).toFixed(3)}%</div>
                {latestWeek.mae_delta!=null&&<div style={{fontSize:9,color:Number(latestWeek.mae_delta)<=0?"#5dca96":"#e24b4a",fontFamily:"monospace"}}>Δ {Number(latestWeek.mae_delta)>0?"+":""}{Number(latestWeek.mae_delta).toFixed(3)} · n={latestWeek.n_week}</div>}
              </div>:<div style={{fontSize:12,color:C.txd}}>—</div>}
            </div>
            <div style={cardS}>
              <div style={labS}>🚨 드리프트 알림</div>
              {highN+medN===0?
                <div style={{fontSize:14,fontWeight:600,color:"#5dca96"}}>✅ 이슈 없음</div>:
                <div style={{fontSize:14,fontWeight:700,fontFamily:"monospace"}}>
                  {highN>0&&<span style={{color:"#e24b4a"}}>HIGH {highN}</span>}
                  {highN>0&&medN>0&&<span style={{color:C.txd,margin:"0 4px"}}>·</span>}
                  {medN>0&&<span style={{color:"#d4a834"}}>MED {medN}</span>}
                </div>
              }
            </div>
            <div style={cardS}>
              <div style={labS}>🎯 관찰 세그먼트</div>
              <div>
                <div style={{fontSize:12,fontWeight:600,fontFamily:"monospace"}}>
                  {hotN>0&&<span style={{color:"#e24b4a"}}>HOT {hotN}</span>}
                  {hotN>0&&(warnN>0||okN>0)&&<span style={{color:C.txd,margin:"0 3px"}}>·</span>}
                  {warnN>0&&<span style={{color:"#d4a834"}}>WARN {warnN}</span>}
                  {warnN>0&&okN>0&&<span style={{color:C.txd,margin:"0 3px"}}>·</span>}
                  {okN>0&&<span style={{color:"#5dca96"}}>OK {okN}</span>}
                </div>
                <div style={{fontSize:9,color:C.txd,fontFamily:"monospace",marginTop:2}}>전체 {watchlist.length}개 추적</div>
              </div>
            </div>
            <div style={cardS}>
              <div style={labS}>🕑 스냅샷 이력</div>
              <div>
                <div style={{fontSize:18,fontWeight:700,color:C.gold,fontFamily:"monospace"}}>{histDates}일</div>
                <div style={{fontSize:9,color:C.txd,marginTop:2}}>{histDates<2?"2일차부터 추세 시각화":`누적 ${watchHistory.length}건`}</div>
              </div>
            </div>
          </div>;
        })()}

        {/* 1. Overall 주간 요약 */}
        {latestWeek&&<div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,padding:"14px 16px",marginBottom:14}}>
          <div style={{fontSize:12,color:C.txm,marginBottom:10,display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontWeight:600}}>📊 이번 주 전체 품질</span>
            <span style={{fontSize:10,color:C.txd}}>{latestWeek.report_week} 주차 · n={latestWeek.n_week}</span>
            {latestWeek.gate_status&&<span style={{fontSize:10,color:latestWeek.gate_status==="pass"?"#5dca96":"#e24b4a",background:(latestWeek.gate_status==="pass"?"rgba(93,202,165,":"rgba(226,75,74,")+"0.12)",padding:"2px 8px",borderRadius:3,fontWeight:600,textTransform:"uppercase"}}>{latestWeek.gate_status}</span>}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
            <div style={{padding:"10px 12px",background:C.bg3,borderRadius:6}}>
              <div style={{fontSize:9,color:C.txd,marginBottom:4}}>주간 MAE (원시 엔진)</div>
              <div style={{fontSize:20,fontWeight:700,color:maeColor(latestWeek.mae_week),fontFamily:"monospace"}}>{Number(latestWeek.mae_week).toFixed(3)}%</div>
              {latestWeek.mae_delta!=null&&<div style={{fontSize:10,color:Number(latestWeek.mae_delta)<=0?"#5dca96":"#e24b4a",marginTop:2,fontFamily:"monospace"}}>Δ {Number(latestWeek.mae_delta)>0?"+":""}{Number(latestWeek.mae_delta).toFixed(3)}</div>}
            </div>
            <div style={{padding:"10px 12px",background:C.bg3,borderRadius:6}}>
              <div style={{fontSize:9,color:C.txd,marginBottom:4}}>드리프트</div>
              <div style={{fontSize:14,fontWeight:700,color:latestWeek.drift_flag?"#e24b4a":"#5dca96",marginTop:4}}>{latestWeek.drift_flag?"⚠ 감지됨":"안정"}</div>
            </div>
            <div style={{padding:"10px 12px",background:C.bg3,borderRadius:6}}>
              <div style={{fontSize:9,color:C.txd,marginBottom:4}}>표본 수</div>
              <div style={{fontSize:20,fontWeight:700,color:C.gold,fontFamily:"monospace",marginTop:2}}>{latestWeek.n_week}</div>
            </div>
          </div>
        </div>}

        {/* 1-A2. 드리프트 알림 (임계값 기반 자동 감지 · 세그먼트 병합 + 표본 가드) */}
        {watchlist.length>0&&(()=>{
          const histMap={};
          for(const r of watchHistory){const k=r.at+"|"+r.tier;if(!histMap[k])histMap[k]=[];histMap[k].push(r)}
          for(const k in histMap)histMap[k].sort((a,b)=>String(b.snapshot_date).localeCompare(String(a.snapshot_date)));
          // 세그먼트별 신호 수집 → 병합
          const bySeg={};
          const put=(s,sev,tag,msg,reason)=>{
            const k=s.at+"|"+s.tier;
            if(!bySeg[k])bySeg[k]={at:s.at,tier:s.tier,n_recent:s.n_recent,sev,tags:[tag],msgs:[msg],reasons:[reason]};
            else{
              if(sev==="HIGH")bySeg[k].sev="HIGH";
              bySeg[k].tags.push(tag);bySeg[k].msgs.push(msg);bySeg[k].reasons.push(reason);
            }
          };
          for(const s of watchlist){
            const k=s.at+"|"+s.tier;
            const nRec=Number(s.n_recent||0);
            // HIGH: HOT 즉시
            if(s.grade==="HOT"){
              put(s,"HIGH","HOT",`MAE ${Number(s.mae_total).toFixed(3)} · bias ${Number(s.bias_total)>0?"+":""}${Number(s.bias_total).toFixed(3)}`,"hot");
            } else if(s.grade==="WARN"){
              const hist=histMap[k]||[];
              let streak=0;
              for(const r of hist){if(r.grade==="WARN"||r.grade==="HOT")streak++;else break}
              if(streak>=2)put(s,"HIGH","지속",`WARN ${streak}일 연속`,"streak");
            }
            // MED drift — 표본 가드: n_recent<15면 억제 (HOT 세그먼트는 이미 HIGH로 포함)
            const sampleOK=nRec>=15;
            if(sampleOK&&s.bias_drift!=null&&Math.abs(Number(s.bias_drift))>=0.5){
              put(s,"MED","편향역전",`bias drift ${Number(s.bias_drift)>0?"+":""}${Number(s.bias_drift).toFixed(2)}`,"bias");
            }
            if(sampleOK&&s.mae_drift!=null&&Number(s.mae_drift)>=0.2){
              put(s,"MED","MAE악화",`MAE drift +${Number(s.mae_drift).toFixed(2)}`,"mae");
            }
          }
          const merged=Object.values(bySeg);
          if(merged.length===0)return null;
          // HIGH 승격: MAE악화 + 편향역전 동시 = 구조적 시그널
          for(const m of merged)if(m.reasons.includes("mae")&&m.reasons.includes("bias"))m.sev="HIGH";
          merged.sort((a,b)=>(a.sev==="HIGH"?0:1)-(b.sev==="HIGH"?0:1));
          const tierLabel=(t)=>({S1_under3:"3억↓",S2_3to5:"3~5억",S3_5to10:"5~10억",S4_over10:"10억↑"}[t]||t);
          const sevColor=(sev)=>sev==="HIGH"?"#e24b4a":"#d4a834";
          const sevBg=(sev)=>sev==="HIGH"?"rgba(226,75,74,0.12)":"rgba(212,168,52,0.10)";
          const highN=merged.filter(a=>a.sev==="HIGH").length;
          const medN=merged.length-highN;
          // 기관별 분포
          const byAt={};for(const m of merged)byAt[m.at]=(byAt[m.at]||0)+1;
          const distro=Object.entries(byAt).sort((a,b)=>b[1]-a[1]).map(([at,n])=>`${at} ${n}`).join(" · ");
          return<div style={{background:C.bg2,border:"1px solid "+(highN>0?"#e24b4a":"#d4a834"),borderRadius:8,padding:"14px 16px",marginBottom:14}}>
            <div style={{fontSize:12,color:highN>0?"#e24b4a":"#d4a834",fontWeight:700,marginBottom:4}}>🚨 드리프트 알림 ({merged.length}건)</div>
            <div style={{fontSize:10,color:C.txd,marginBottom:10}}>HOT / WARN 2일 연속 / MAE+bias 동시 → HIGH · |bias|≥0.5, MAE≥0.2 → MED · n_recent&lt;15 억제 · 매일 18:00 UTC 갱신</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {merged.map((m,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 10px",background:sevBg(m.sev),borderRadius:6,borderLeft:"3px solid "+sevColor(m.sev)}}>
                  <span style={{fontSize:9,fontWeight:700,color:sevColor(m.sev),minWidth:30,fontFamily:"monospace"}}>{m.sev}</span>
                  <span style={{fontSize:10,color:C.txm,minWidth:90}}>{m.tags.join(" + ")}</span>
                  <span style={{fontSize:11,color:C.txt,fontWeight:600,minWidth:140}}>{m.at}<span style={{color:C.txd,marginLeft:4,fontSize:10}}>{tierLabel(m.tier)}</span></span>
                  <span style={{fontSize:10,color:C.txm,flex:1}}>{m.msgs.join(" · ")}</span>
                  <span style={{fontSize:9,color:C.txd,fontFamily:"monospace",minWidth:40,textAlign:"right"}}>n={m.n_recent}</span>
                </div>
              ))}
            </div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:C.txd,marginTop:8}}>
              <span>집중도: {distro}</span>
              <span>HIGH {highN} · MED {medN}</span>
            </div>
          </div>
        })()}

        {/* 1-B. 관찰 지점 (세그먼트 드리프트) */}
        {watchlist.length>0&&(()=>{
          const gradeColor=(g)=>g==="HOT"?"#e24b4a":g==="WARN"?"#d4a834":"#5dca96";
          const gradeBg=(g)=>g==="HOT"?"rgba(226,75,74,0.10)":g==="WARN"?"rgba(212,168,52,0.10)":"rgba(93,202,165,0.08)";
          const tierLabel=(t)=>({S1_under3:"3억 미만",S2_3to5:"3~5억",S3_5to10:"5~10억",S4_over10:"10억↑"}[t]||t);
          const driftColor=(d)=>{if(d==null)return C.txd;const v=Number(d);if(v>0.1)return "#e24b4a";if(v<-0.1)return "#5dca96";return C.txm};
          return<div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,padding:"14px 16px",marginBottom:14}}>
            <div style={{fontSize:12,color:C.txm,fontWeight:600,marginBottom:4}}>🎯 관찰 지점 (세그먼트 드리프트)</div>
            <div style={{fontSize:10,color:C.txd,marginBottom:10}}>기관×금액대 기준 최근 30일 vs 이전 30일 MAE/bias 변화 · 목표 n=50 진행률 · HOT/WARN은 주시</div>
            <table style={{width:"100%",fontSize:11,borderCollapse:"collapse"}}>
              <thead><tr style={{color:C.txd,fontSize:10}}>
                <th style={{textAlign:"left",padding:"4px 6px",borderBottom:"1px solid "+C.bdr}}>등급</th>
                <th style={{textAlign:"left",padding:"4px 6px",borderBottom:"1px solid "+C.bdr}}>세그먼트</th>
                <th style={{textAlign:"right",padding:"4px 6px",borderBottom:"1px solid "+C.bdr}}>n(전체)</th>
                <th style={{textAlign:"right",padding:"4px 6px",borderBottom:"1px solid "+C.bdr}}>MAE</th>
                <th style={{textAlign:"right",padding:"4px 6px",borderBottom:"1px solid "+C.bdr}}>bias</th>
                <th style={{textAlign:"right",padding:"4px 6px",borderBottom:"1px solid "+C.bdr}}>최근(n)</th>
                <th style={{textAlign:"right",padding:"4px 6px",borderBottom:"1px solid "+C.bdr}}>MAE드리프트</th>
                <th style={{textAlign:"right",padding:"4px 6px",borderBottom:"1px solid "+C.bdr}}>bias드리프트</th>
                <th style={{textAlign:"center",padding:"4px 6px",borderBottom:"1px solid "+C.bdr}}>진행률→n50</th>
              </tr></thead>
              <tbody>{watchlist.map((s,i)=>(
                <tr key={i} style={{borderBottom:"1px solid "+C.bdr,background:gradeBg(s.grade)}}>
                  <td style={{padding:"6px"}}><span style={{color:gradeColor(s.grade),fontWeight:700,fontSize:10}}>{s.grade}</span></td>
                  <td style={{padding:"6px",color:C.txt}}>{s.at}<span style={{color:C.txd,marginLeft:6,fontSize:10}}>{tierLabel(s.tier)}</span></td>
                  <td style={{padding:"6px",textAlign:"right",color:C.txm,fontFamily:"monospace"}}>{s.n_total}</td>
                  <td style={{padding:"6px",textAlign:"right",color:maeColor(s.mae_total),fontFamily:"monospace",fontWeight:600}}>{Number(s.mae_total).toFixed(3)}</td>
                  <td style={{padding:"6px",textAlign:"right",color:biasColor(s.bias_total),fontFamily:"monospace"}}>{Number(s.bias_total)>0?"+":""}{Number(s.bias_total).toFixed(3)}</td>
                  <td style={{padding:"6px",textAlign:"right",color:C.txd,fontFamily:"monospace"}}>{s.n_recent||0}<span style={{color:C.txd,marginLeft:3,fontSize:9}}>/{s.n_prev||0}</span></td>
                  <td style={{padding:"6px",textAlign:"right",color:driftColor(s.mae_drift),fontFamily:"monospace"}}>{s.mae_drift==null?"—":(Number(s.mae_drift)>0?"+":"")+Number(s.mae_drift).toFixed(3)}</td>
                  <td style={{padding:"6px",textAlign:"right",color:driftColor(s.bias_drift),fontFamily:"monospace"}}>{s.bias_drift==null?"—":(Number(s.bias_drift)>0?"+":"")+Number(s.bias_drift).toFixed(3)}</td>
                  <td style={{padding:"4px 6px",textAlign:"center"}}>
                    <div style={{display:"flex",alignItems:"center",gap:4}}>
                      <div style={{flex:1,height:6,background:C.bg3,borderRadius:3,overflow:"hidden"}}>
                        <div style={{width:Math.min(100,Number(s.progress_pct))+"%",height:"100%",background:Number(s.progress_pct)>=100?"#5dca96":C.gold}}/>
                      </div>
                      <span style={{fontSize:9,color:C.txd,fontFamily:"monospace",minWidth:32,textAlign:"right"}}>{Number(s.progress_pct).toFixed(0)}%</span>
                    </div>
                  </td>
                </tr>))}</tbody>
            </table>
          </div>
        })()}

        {/* 1-C. 드리프트 이력 (최근 14일 grade/drift 추이) */}
        {watchHistory.length>0&&(()=>{
          const gradeDot=(g)=>g==="HOT"?"#e24b4a":g==="WARN"?"#d4a834":g==="OK"?"#5dca96":C.txd;
          const tierLabel=(t)=>({S1_under3:"3억↓",S2_3to5:"3~5억",S3_5to10:"5~10억",S4_over10:"10억↑"}[t]||t);
          // 세그먼트 키별 그룹
          const byKey={};
          for(const r of watchHistory){const k=r.at+"|"+r.tier;if(!byKey[k])byKey[k]=[];byKey[k].push(r)}
          // 날짜 축 (최근→오래된)
          const allDates=Array.from(new Set(watchHistory.map(r=>r.snapshot_date))).sort().reverse();
          // 등급별 정렬: HOT > WARN > OK
          const rank=(g)=>g==="HOT"?1:g==="WARN"?2:3;
          const segKeys=Object.keys(byKey).sort((a,b)=>{
            const la=byKey[a][0],lb=byKey[b][0];
            return rank(la.grade)-rank(lb.grade)||(Number(lb.n_total)-Number(la.n_total));
          });
          return<div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,padding:"14px 16px",marginBottom:14,overflowX:"auto"}}>
            <div style={{fontSize:12,color:C.txm,fontWeight:600,marginBottom:4}}>🕑 드리프트 이력 (최근 {allDates.length}일)</div>
            <div style={{fontSize:10,color:C.txd,marginBottom:10}}>매일 18:00 UTC 자동 스냅샷 · 등급 색(●) 변화로 세그먼트 안정성 추적 · HOT→WARN→OK 순</div>
            <table style={{width:"100%",fontSize:11,borderCollapse:"collapse",minWidth:600}}>
              <thead><tr style={{color:C.txd,fontSize:10}}>
                <th style={{textAlign:"left",padding:"4px 6px",borderBottom:"1px solid "+C.bdr,position:"sticky",left:0,background:C.bg2}}>세그먼트</th>
                {allDates.map(d=>(<th key={d} style={{textAlign:"center",padding:"4px 2px",borderBottom:"1px solid "+C.bdr,fontFamily:"monospace",fontSize:9}}>{d.slice(5)}</th>))}
                <th style={{textAlign:"right",padding:"4px 6px",borderBottom:"1px solid "+C.bdr}}>MAE 추이</th>
                <th style={{textAlign:"right",padding:"4px 6px",borderBottom:"1px solid "+C.bdr}}>bias 드리프트</th>
              </tr></thead>
              <tbody>{segKeys.map(k=>{
                const rows=byKey[k];
                const byDate={};for(const r of rows)byDate[r.snapshot_date]=r;
                const latest=rows[0]; // 최근 (정렬 desc)
                const oldest=rows[rows.length-1];
                const maeTrend=(Number(latest.mae_total)-Number(oldest.mae_total)).toFixed(3);
                const driftVal=latest.bias_drift;
                return<tr key={k} style={{borderBottom:"1px solid "+C.bdr}}>
                  <td style={{padding:"5px 6px",color:C.txt,whiteSpace:"nowrap",position:"sticky",left:0,background:C.bg2}}>
                    {latest.at}<span style={{color:C.txd,marginLeft:4,fontSize:10}}>{tierLabel(latest.tier)}</span>
                  </td>
                  {allDates.map(d=>{
                    const r=byDate[d];
                    return <td key={d} style={{padding:"5px 2px",textAlign:"center"}}>
                      {r?<span title={r.grade+" · MAE "+Number(r.mae_total).toFixed(3)+(r.bias_drift!=null?" · Δbias "+(Number(r.bias_drift)>0?"+":"")+Number(r.bias_drift).toFixed(2):"")} style={{color:gradeDot(r.grade),fontSize:14,lineHeight:1}}>●</span>:<span style={{color:C.txd,fontSize:10}}>·</span>}
                    </td>;
                  })}
                  <td style={{padding:"5px 6px",textAlign:"right",fontFamily:"monospace"}}>
                    {rows.length<2?<span style={{color:C.txd}}>—</span>:(()=>{
                      const sorted=[...rows].sort((a,b)=>String(a.snapshot_date).localeCompare(String(b.snapshot_date)));
                      const maes=sorted.map(r=>Number(r.mae_total));
                      const mn=Math.min(...maes),mx=Math.max(...maes);
                      const w=68,h=18,pad=2;
                      const sx=(i)=>pad+(i/(maes.length-1))*(w-2*pad);
                      const sy=(m)=>mx===mn?h/2:pad+(1-(m-mn)/(mx-mn))*(h-2*pad);
                      const pts=maes.map((m,i)=>`${sx(i).toFixed(1)},${sy(m).toFixed(1)}`).join(" ");
                      const trendColor=Number(maeTrend)>0.05?"#e24b4a":Number(maeTrend)<-0.05?"#5dca96":C.txm;
                      return<span style={{display:"inline-flex",alignItems:"center",gap:6}}>
                        <svg width={w} height={h} style={{verticalAlign:"middle"}}>
                          <polyline points={pts} fill="none" stroke={trendColor} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
                          <circle cx={sx(maes.length-1)} cy={sy(maes[maes.length-1])} r="2" fill={trendColor}/>
                        </svg>
                        <span style={{color:trendColor,fontSize:10,minWidth:42,textAlign:"right"}}>{Number(maeTrend)>0?"+":""}{maeTrend}</span>
                      </span>;
                    })()}
                  </td>
                  <td style={{padding:"5px 6px",textAlign:"right",fontFamily:"monospace",color:driftVal==null?C.txd:Number(driftVal)>0.1?"#e24b4a":Number(driftVal)<-0.1?"#5dca96":C.txm}}>
                    {driftVal==null?"—":(Number(driftVal)>0?"+":"")+Number(driftVal).toFixed(3)}
                  </td>
                </tr>;
              })}</tbody>
            </table>
            <div style={{fontSize:10,color:C.txd,marginTop:8,textAlign:"right"}}>
              총 {watchHistory.length}건 스냅샷 · {Object.keys(byKey).length}개 세그먼트 추적 · {allDates.length===1?"내일부터 추이 누적 시작":`${allDates.length}일 누적`}
            </div>
          </div>
        })()}

        {/* 2. 기관별 주간 MAE */}
        {atWeekly.length>0&&<div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,padding:"14px 16px",marginBottom:14}}>
          <div style={{fontSize:12,color:C.txm,fontWeight:600,marginBottom:10}}>🏢 기관별 주간 MAE (원시 엔진)</div>
          <table style={{width:"100%",fontSize:11,borderCollapse:"collapse"}}>
            <thead><tr style={{color:C.txd,fontSize:10}}>
              <th style={{textAlign:"left",padding:"4px 6px",borderBottom:"1px solid "+C.bdr}}>주차</th>
              <th style={{textAlign:"left",padding:"4px 6px",borderBottom:"1px solid "+C.bdr}}>기관</th>
              <th style={{textAlign:"right",padding:"4px 6px",borderBottom:"1px solid "+C.bdr}}>n</th>
              <th style={{textAlign:"right",padding:"4px 6px",borderBottom:"1px solid "+C.bdr}}>MAE</th>
              <th style={{textAlign:"right",padding:"4px 6px",borderBottom:"1px solid "+C.bdr}}>Δ 전주</th>
              <th style={{textAlign:"center",padding:"4px 6px",borderBottom:"1px solid "+C.bdr}}>드리프트</th>
            </tr></thead>
            <tbody>{atWeekly.map((w,i)=>(
              <tr key={i} style={{borderBottom:"1px solid "+C.bdr}}>
                <td style={{padding:"6px",color:C.txd,fontFamily:"monospace"}}>{w.report_week}</td>
                <td style={{padding:"6px",color:C.txt}}>{w.dimension_value}</td>
                <td style={{padding:"6px",textAlign:"right",color:C.txm,fontFamily:"monospace"}}>{w.n_week}</td>
                <td style={{padding:"6px",textAlign:"right",color:maeColor(w.mae_week),fontFamily:"monospace",fontWeight:600}}>{Number(w.mae_week).toFixed(3)}</td>
                <td style={{padding:"6px",textAlign:"right",fontFamily:"monospace",color:w.mae_delta==null?C.txd:(Number(w.mae_delta)<=0?"#5dca96":"#e24b4a")}}>{w.mae_delta==null?"—":(Number(w.mae_delta)>0?"+":"")+Number(w.mae_delta).toFixed(3)}</td>
                <td style={{padding:"6px",textAlign:"center"}}>{w.drift_flag?<span style={{color:"#e24b4a"}}>⚠</span>:<span style={{color:C.txd}}>·</span>}</td>
              </tr>))}</tbody>
          </table>
        </div>}

        {/* 3. 기관별 편향 핫스팟 */}
        {biasHotspots.length>0&&<div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,padding:"14px 16px",marginBottom:14}}>
          <div style={{fontSize:12,color:C.txm,fontWeight:600,marginBottom:4}}>🎯 편향 핫스팟 (|bias|≥0.05)</div>
          <div style={{fontSize:10,color:C.txd,marginBottom:10}}>음수=과소예측(실제가 더 높음), 양수=과대예측(실제가 더 낮음) · 자동 보정은 bias_profile에 이미 반영됨</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
            {biasHotspots.filter(h=>Math.abs(Number(h.bias))>=0.05).slice(0,20).map((h,i)=>(
              <div key={i} style={{padding:"6px 10px",background:C.bg3,borderRadius:4,display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:11}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:9,color:C.txd}}>{h.grain}{h.key2?" · "+h.key2:""} · n={h.n}</div>
                  <div style={{color:C.txt,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h.key1}</div>
                </div>
                <div style={{color:biasColor(h.bias),fontFamily:"monospace",fontWeight:600,marginLeft:8}}>{Number(h.bias)>0?"+":""}{Number(h.bias).toFixed(3)}</div>
              </div>))}
          </div>
        </div>}

        {/* 4. 일별 전체 MAE (최근 14일) */}
        {dailyOverall.length>0&&<div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,padding:"14px 16px"}}>
          <div style={{fontSize:12,color:C.txm,fontWeight:600,marginBottom:10}}>📅 일별 전체 MAE — 메인 추천 기준 (최근 {dailyOverall.length}일)</div>
          <table style={{width:"100%",fontSize:11,borderCollapse:"collapse"}}>
            <thead><tr style={{color:C.txd,fontSize:10}}>
              <th style={{textAlign:"left",padding:"4px 6px",borderBottom:"1px solid "+C.bdr}}>측정일</th>
              <th style={{textAlign:"right",padding:"4px 6px",borderBottom:"1px solid "+C.bdr}}>n</th>
              <th style={{textAlign:"right",padding:"4px 6px",borderBottom:"1px solid "+C.bdr}}>MAE</th>
              <th style={{textAlign:"right",padding:"4px 6px",borderBottom:"1px solid "+C.bdr}}>hit±0.5%</th>
              <th style={{textAlign:"right",padding:"4px 6px",borderBottom:"1px solid "+C.bdr}}>floor safe</th>
            </tr></thead>
            <tbody>{dailyOverall.map((d,i)=>(
              <tr key={i} style={{borderBottom:"1px solid "+C.bdr}}>
                <td style={{padding:"6px",color:C.txd,fontFamily:"monospace"}}>{d.measured_on}</td>
                <td style={{padding:"6px",textAlign:"right",color:C.txm,fontFamily:"monospace"}}>{d.n}</td>
                <td style={{padding:"6px",textAlign:"right",color:maeColor(d.mae),fontFamily:"monospace",fontWeight:600}}>{Number(d.mae).toFixed(3)}</td>
                <td style={{padding:"6px",textAlign:"right",color:C.txm,fontFamily:"monospace"}}>{d.hit_0_5_pct!=null?Number(d.hit_0_5_pct).toFixed(1)+"%":"—"}</td>
                <td style={{padding:"6px",textAlign:"right",color:C.txm,fontFamily:"monospace"}}>{d.floor_safe_pct!=null?Number(d.floor_safe_pct).toFixed(1)+"%":"—"}</td>
              </tr>))}</tbody>
          </table>
        </div>}
      </div>
    })()}

    {/* ═══ 관리자 탭 (Phase 4-C) ═══ */}
    {tab==="admin"&&isAdmin&&<AdminTab C={C}/>}

    {/* ═══ 발주처 예측 V6 탭 ═══ */}
    {tab==="agency_predict_v6"&&<AgencyPredictorTab/>}

    {/* ═══ 발주사 하한 예측 탭 (V1, 2026-05-13) ═══ */}
    {tab==="agency_floor"&&<AgencyFloorTab/>}

    {/* ═══ G2B 양식 탭 ═══ */}
    {tab==="g2b_sheet"&&<G2BSheetTab key={g2bAgency} recs={g2bRecs} initialAgency={g2bAgency}/>}

    {/* ═══ AI 상담 탭 ═══ */}
    {tab==="chat"&&(()=>{
      const downloadChat=()=>{
        const now=new Date().toISOString().slice(0,16).replace("T"," ");
        let md=`# 입찰 분석 AI 상담 기록\n> ${now}\n\n---\n\n`;
        chatMsgs.forEach(m=>{if(m.role==="user")md+=`## 질문\n${m.content}\n\n`;else md+=`## AI 답변\n${m.content}\n\n---\n\n`});
        md+=`\n---\n*입찰 분석 시스템 (Claude Opus 4.6) · ${recs.length.toLocaleString()}건 데이터 기반*\n`;
        const blob=new Blob([md],{type:"text/markdown;charset=utf-8"});const url=URL.createObjectURL(blob);
        const a=document.createElement("a");a.href=url;a.download=`AI상담_${new Date().toISOString().slice(0,10)}.md`;a.click();URL.revokeObjectURL(url)};
      return<div ref={chatBoxRef} style={{display:"flex",height:chatH??"calc(100vh - 60px)"}}>
      {/* ★ 좌측 사이드바: 대화 목록 */}
      <div style={{width:chatSideOpen?200:0,overflow:"hidden",transition:"width 0.2s",borderRight:chatSideOpen?"1px solid "+C.bdr:"none",background:C.bg,flexShrink:0,display:"flex",flexDirection:"column"}}>
        <div style={{padding:"10px",borderBottom:"1px solid "+C.bdr}}>
          <button onClick={newChat} style={{width:"100%",padding:"8px",background:C.gold,border:"none",borderRadius:6,color:"#000",fontWeight:600,fontSize:12,cursor:"pointer"}}>+ 새 대화</button>
        </div>
        <div style={{flex:1,overflowY:"auto"}}>
          {chatSessions.map(s=><div key={s.id} onClick={()=>selectChat(s.id)}
            style={{padding:"10px 12px",cursor:"pointer",borderBottom:"1px solid "+C.bdr+"44",
              background:s.id===chatSid?"rgba(212,168,52,0.08)":"transparent",
              borderLeft:s.id===chatSid?"2px solid "+C.gold:"2px solid transparent"}}>
            <div style={{fontSize:12,color:s.id===chatSid?C.txt:C.txm,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:2}}>{s.title||"새 대화"}</div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:10,color:C.txd}}>{s.created?.slice(5,10)||""}</span>
              <button onClick={e=>{e.stopPropagation();if(confirm("이 대화를 삭제하시겠습니까?"))deleteChat(s.id)}}
                style={{fontSize:9,color:C.txd,background:"none",border:"none",cursor:"pointer",padding:"2px 4px"}}>삭제</button>
            </div>
          </div>)}
          {chatSessions.length===0&&<div style={{padding:20,textAlign:"center",fontSize:11,color:C.txd}}>대화 기록이 없습니다</div>}
        </div>
      </div>
      {/* ★ 우측 대화 영역 */}
      <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0}}>
        {/* 상단 바 */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 12px",borderBottom:"1px solid "+C.bdr,background:C.bg2}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <button onClick={()=>setChatSideOpen(!chatSideOpen)} style={{background:"none",border:"none",color:C.txm,cursor:"pointer",fontSize:16,padding:"2px 4px"}}>{chatSideOpen?"◁":"▷"}</button>
            <span style={{fontSize:12,color:C.txm}}>{chatSessions.find(s=>s.id===chatSid)?.title||"AI 상담"}</span>
          </div>
          <div style={{display:"flex",gap:6}}>
            {chatMsgs.length>0&&<button onClick={downloadChat} style={{fontSize:10,color:"#a8b4ff",background:"none",border:"none",cursor:"pointer"}}>다운로드</button>}
          </div>
        </div>
        {/* 대화 메시지 */}
        <div ref={chatRef} style={{flex:1,overflowY:"auto",padding:"16px 12px"}}>
          {chatMsgs.length===0&&<div style={{textAlign:"center",padding:"60px 20px"}}>
            <div style={{fontSize:28,opacity:0.2,marginBottom:12}}>AI</div>
            <div style={{fontSize:15,fontWeight:600,color:C.gold,marginBottom:8}}>입찰 분석 AI 어드바이저</div>
            <div style={{fontSize:12,color:C.txm,lineHeight:1.8,maxWidth:400,margin:"0 auto",marginBottom:20}}>
              한국 공공조달 입찰(전기/통신/소방)에 대해 무엇이든 물어보세요.<br/>
              {recs.length.toLocaleString()}건의 낙찰 데이터와 예측 모델 기반으로 답변합니다.
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,justifyContent:"center"}}>
              {["경기도 고양시 최근 낙찰 패턴과 투찰 전략은?",
                "교육청 vs 지자체 사정률 비교 분석해줘",
                "현재 예측 모델의 MAE와 기관별 정확도는?",
                "낙찰하한율 89.745%에서 최적 투찰 마진은?",
                "적격심사에서 입찰가격점수 85점 받으려면?",
                "최근 낙찰 동향과 사정률 추이를 알려줘"
              ].map((q,i)=><button key={i} onClick={()=>{setChatInput(q);setTimeout(()=>{const el=document.getElementById("chat-send");if(el)el.click()},50)}}
                style={{padding:"6px 12px",fontSize:11,background:C.bg3,border:"1px solid "+C.bdr,borderRadius:6,color:C.txm,cursor:"pointer",textAlign:"left",maxWidth:280}}>
                {q}
              </button>)}
            </div>
          </div>}
          {chatMsgs.map((m,i)=><div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start",marginBottom:14}}>
            {m.role==="assistant"&&<div style={{width:28,height:28,borderRadius:14,background:"rgba(168,180,255,0.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:"#a8b4ff",fontWeight:600,flexShrink:0,marginRight:8,marginTop:2}}>AI</div>}
            <div style={{maxWidth:"80%",padding:m.role==="user"?"10px 14px":"14px 16px",
              borderRadius:m.role==="user"?"12px 12px 2px 12px":"2px 12px 12px 12px",
              background:m.role==="user"?"rgba(212,168,52,0.12)":"rgba(168,180,255,0.06)",
              border:"1px solid "+(m.role==="user"?"rgba(212,168,52,0.2)":"rgba(168,180,255,0.12)")}}>
              {m.role==="user"?<div style={{fontSize:13,lineHeight:1.7,color:C.txt,whiteSpace:"pre-wrap"}}>{m.content}</div>
                :<div style={{fontSize:13,lineHeight:1.8,color:C.txt}} dangerouslySetInnerHTML={{__html:md2html(m.content)}}/>}
            </div>
            {m.role==="user"&&<div style={{width:28,height:28,borderRadius:14,background:"rgba(212,168,52,0.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:C.gold,fontWeight:600,flexShrink:0,marginLeft:8,marginTop:2}}>Q</div>}
          </div>)}
          {chatLoading&&<div style={{display:"flex",alignItems:"flex-start",marginBottom:14}}>
            <div style={{width:28,height:28,borderRadius:14,background:"rgba(168,180,255,0.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:"#a8b4ff",fontWeight:600,flexShrink:0,marginRight:8}}>AI</div>
            <div style={{padding:"14px 16px",borderRadius:"2px 12px 12px 12px",background:"rgba(168,180,255,0.06)",border:"1px solid rgba(168,180,255,0.12)",fontSize:13,color:C.txm}}>
              <span style={{display:"inline-block",animation:"blink 1.2s infinite"}}>분석 중...</span>
              <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
            </div>
          </div>}
        </div>
        {/* 입력 영역 */}
        <div style={{borderTop:"1px solid "+C.bdr,padding:"10px 12px",background:C.bg2}}>
          <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
            <textarea value={chatInput} onChange={e=>setChatInput(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendChat()}}}
              placeholder="입찰 전략, 사정률 분석, 적격심사 등 무엇이든 물어보세요..."
              rows={chatInput.split("\n").length>3?3:Math.max(1,chatInput.split("\n").length)}
              style={{flex:1,background:C.bg3,border:"1px solid "+C.bdr,borderRadius:8,padding:"10px 14px",color:C.txt,fontSize:13,resize:"none",outline:"none",fontFamily:"inherit",lineHeight:1.6}}/>
            <button id="chat-send" onClick={sendChat} disabled={chatLoading||!chatInput.trim()}
              style={{padding:"10px 18px",background:chatInput.trim()?C.gold:"#333",border:"none",borderRadius:8,color:chatInput.trim()?"#000":"#666",fontWeight:700,fontSize:13,cursor:chatInput.trim()?"pointer":"default",flexShrink:0}}>
              {chatLoading?"...":"전송"}
            </button>
          </div>
          <div style={{fontSize:10,color:C.txd,marginTop:4}}>Claude Opus 4.6 · Enter 전송 · Shift+Enter 줄바꿈</div>
        </div>
      </div>
    </div>})()}

    </div>
  </div>)}
