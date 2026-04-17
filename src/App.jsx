import React, { useState, useCallback, useMemo, useEffect } from "react";
import * as XLSX from "xlsx";
import { C, PAGE, inpS, SB_URL, hdrs, getHdrs } from "./lib/constants.js";
import { WinStrategyDashboard } from "./WinStrategyDashboard.jsx";
import { clsAg, clean, tc, tn, pDt, mSch, md5, parseFile, toRecord, toRecords, parseBidDoc, calcStats, predictV5, calcDataStatus, isSucviewFile, parseSucview, simDraws, pnv, sn, eraFR, isNewEra, sanitizeJson, recommendAssumedAdj, calcRoiV2, setWinProbMatrix, setBiasMap, setTrendMap, getEnhancedAdj, buildAiContext, callClaudeAi, WIN_OPT_GAP, calcWin1stBid } from "./lib/utils.js";
import { sbFetchAll, sbUpsert, sbDeleteIds, sbDeleteAll, sbSavePredictions, sbFetchPredictions, sbMatchPredictions, sbDeletePredictions, sbSaveDetail, sbFetchDetails, sbFetchDetailsByAg, sbFetchAgAssumedStats, sbFetchScoring, sbBatchUpsertScoring, sbFetchRoiMatrix, sbFetchBiasMap, sbFetchTrendMap, sbSaveAiAnalysis, sbFetchAiAnalysis, sbFetchAgencyWinStats, sbFetchAgencyPredictor, sbFetchSimulator, sbFetchNotices, sbPredictNotice } from "./lib/supabase.js";
import AuthGate from "./components/AuthGate.jsx";
import { useAuth, getSession } from "./auth.js";

// ─── 컴포넌트 ──────────────────────────────────────────────
function NI({value,onChange}){return<input value={value==="0"?"0":tc(value)} onChange={e=>{const r=e.target.value.replace(/,/g,"").replace(/[^0-9]/g,"");onChange(r===""?"0":r)}} style={{...inpS,textAlign:"right",fontFamily:"monospace"}}/>}

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
// 0-base 사정률을 100-base로 변환
function toP100(adj0){return adj0==null?null:(100+Number(adj0))}
// 100-base를 문자열로 포맷 (예: 99.78%)
function fmtP100(adj0,decimals=3){
  const v=toP100(adj0);
  if(v==null||isNaN(v))return"-";
  return v.toFixed(decimals)+"%"
}
// 티어별 배지 스타일
const TIER_STYLES={
  1:{emoji:"🏆",label:"P1",color:"#e24b4a",bg:"rgba(226,75,74,0.12)",border:"#e24b4a"},
  2:{emoji:"⭐",label:"P2",color:"#ff9933",bg:"rgba(255,153,51,0.10)",border:"#ff9933"},
  3:{emoji:"📊",label:"P3",color:"#5b9dd9",bg:"rgba(91,157,217,0.08)",border:"#5b9dd9"},
  4:{emoji:"⚠️",label:"P4",color:"#a8a8ff",bg:"rgba(168,168,255,0.06)",border:"#a8a8ff"},
  5:{emoji:"⛔",label:"P5",color:"#666680",bg:"rgba(102,102,128,0.06)",border:"#666680"}
};
// 예측 → 발주사 평가 (tier, win_rate, confidence, recommended_offset)
function assessPrediction(p,agencyStats,agencyPred){
  if(!p||!p.ag)return null;
  const s=agencyStats[p.ag];
  const pr=agencyPred[p.ag];
  if(!s)return{tier:null,win_rate:null,confidence:0,offset:0,label:"데이터 없음",n:0};
  return{
    tier:Number(s.priority_tier),
    win_rate:Number(s.theoretical_win_rate),
    actual_win_rate:Number(s.actual_win_rate),
    confidence:Number(s.confidence),
    n:Number(s.n_total),
    n_perfect:Number(s.n_perfect_win),
    n_actual:Number(s.n_actual_win),
    mae:Number(s.mae),
    median_adj:Number(s.median_adj_rate), // 0-base
    label:s.priority_label||"",
    recommendation:s.recommendation||"",
    offset:pr?Number(pr.effective_offset):0,
    strategy:pr?pr.strategy:"keep_current"
  }
}
// 배지 컴포넌트
function TierBadge({tier,label,compact=false}){
  if(!tier)return<span style={{fontSize:10,color:"#666680"}}>미분류</span>;
  const s=TIER_STYLES[tier]||TIER_STYLES[5];
  return<span style={{display:"inline-flex",alignItems:"center",gap:3,padding:compact?"1px 5px":"2px 7px",fontSize:compact?9:10,fontWeight:600,color:s.color,background:s.bg,border:"1px solid "+s.border+"55",borderRadius:4}}>
    {s.emoji} {s.label}{label&&!compact?" "+label.replace(/^🏆 |^⭐ |^📊 |^⚠️ |^⛔ /,""):""}
  </span>
}
// 신뢰도 바 (0~1)
function ConfBar({confidence}){
  const v=Math.max(0,Math.min(1,Number(confidence)||0));
  const pct=Math.round(v*100);
  const color=v>=0.8?"#5dca96":v>=0.5?"#d4a834":"#a8a8ff";
  return<div style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:9,color:"#a0a0b8"}}>
    <div style={{width:40,height:4,background:"#252540",borderRadius:2,overflow:"hidden"}}>
      <div style={{width:pct+"%",height:"100%",background:color}}/>
    </div>
    <span style={{color,fontWeight:600}}>{pct}%</span>
  </div>
}
// Phase 14-3: 분산 투찰 추천 뱃지
function SplitBadge({sim,compact=false}){
  if(!sim)return null;
  const lbl=sim.strategy_label;
  if(lbl==="single_only"||lbl==="no_data")return null;
  const styles={
    split_strong:{emoji:"🔥",text:"분산강력",color:"#e24b4a",bg:"rgba(226,75,74,0.12)",border:"#e24b4a"},
    split_consider:{emoji:"📊",text:"분산검토",color:"#5b9dd9",bg:"rgba(91,157,217,0.10)",border:"#5b9dd9"},
    low_sample:{emoji:"⚠",text:"샘플부족",color:"#a8a8ff",bg:"rgba(168,168,255,0.06)",border:"#a8a8ff"}
  };
  const s=styles[lbl];if(!s)return null;
  const gain=Number(sim.ev_gain_eok)||0;
  const gainStr=gain>=0.01?(gain>=1?gain.toFixed(2)+"억":(gain*10000).toFixed(0)+"만"):"";
  const tooltip=`12-F 단독: ${(Number(sim.p_calibrated_12f)*100).toFixed(1)}%\n분산 투찰: ${(Number(sim.p_calibrated_split)*100).toFixed(1)}%\nEV 증가: +${gainStr||"미미"}\n샘플: ${sim.cat_n}건`;
  return<span title={tooltip} style={{display:"inline-flex",alignItems:"center",gap:3,padding:compact?"1px 5px":"2px 7px",fontSize:compact?9:10,fontWeight:600,color:s.color,background:s.bg,border:"1px solid "+s.border+"55",borderRadius:4,cursor:"help"}}>
    {s.emoji} {compact?gainStr||s.text:s.text+(gainStr?" +"+gainStr:"")}
  </span>
}

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
  const[lastG2bAt,setLastG2bAt]=useState(null); // 나라장터 자동 예측 마지막 갱신 시각
  const[lastSucviewAt,setLastSucviewAt]=useState(null); // SUCVIEW 마지막 업로드 시각
  const[notices,setNotices]=useState([]); // 나라장터 공고 목록
  const[noticeLoadingIds,setNoticeLoadingIds]=useState(new Set()); // 예측 등록 중인 notice id
  const[noticeFilter,setNoticeFilter]=useState("upcoming"); // upcoming/all/registered
  const[scoringMap,setScoringMap]=useState({}); // Phase 5: ROI scoring (prediction_id → grade/win_prob/...)
  const[biasMap,setBiasMapState]=useState({agency:{},at:{}}); // Phase 5.4: 편차 보정 맵
  const[trendMap,setTrendMapState]=useState({}); // Phase 5.4: 추세 맵
  const[claudeApiKey,setClaudeApiKey]=useState(""); // Phase 5.4-B: Edge Function 프록시 사용, 레거시 호환 유지
  const[aiAnalysisMap,setAiAnalysisMap]=useState({}); // 예측ID → AI 분석 결과
  const[aiLoadingPredId,setAiLoadingPredId]=useState(null);
  const[gradeFilter,setGradeFilter]=useState("all"); // Phase 5: 등급 필터
  const[compFilter,setCompFilter]=useState("all");
  const[predListShow,setPredListShow]=useState(50); // 리스트 표시 건수 (더보기)
  const[hideYuchal,setHideYuchal]=useState(true); // 유찰 건 숨김 (기본 ON)
  const[hideSuui,setHideSuui]=useState(true); // 수의계약 건 숨김 (기본 ON)
  const[bidDetails,setBidDetails]=useState([]);
  const[agAss,setAgAss]=useState({});
  const[simResult,setSimResult]=useState(null);
  const[expandedDetail,setExpandedDetail]=useState(null);
  const[simSlider,setSimSlider]=useState(0); // Phase 3: 투찰 시뮬레이터 사정률 슬라이더
  const[adjPatDec,setAdjPatDec]=useState(2); // 사정률 패턴 소수점 자릿수 (2~4)
  const[aiAdvice,setAiAdvice]=useState("");const[aiLoading,setAiLoading]=useState(false); // Phase 4-A: AI 어드바이저
  const[batchAi,setBatchAi]=useState({});const[batchAiLoading,setBatchAiLoading]=useState(null);const[expandedBatch,setExpandedBatch]=useState(null); // 일괄 AI
  const[predSel,setPredSel]=useState({}); // 예측 내역 선택 삭제
  const[detailModal,setDetailModal]=useState(null); // 상세 모달 (prediction 객체)
  const[detailTab,setDetailTab]=useState("detail"); // Phase 5.6: 상세 모달 탭 (detail|strategy|ai|pattern|info)
  const[detailAi,setDetailAi]=useState("");const[detailAiLoading,setDetailAiLoading]=useState(false); // 모달 AI
  const[showSim,setShowSim]=useState(false); // 수동 시뮬레이션 토글
  // Phase 12-C: 발주사별 낙찰 예측
  const[agencyStats,setAgencyStats]=useState({}); // ag → {tier, win_rate, confidence, ...}
  const[agencyPred,setAgencyPred]=useState({}); // ag → {offset, strategy}
  const[hideP5,setHideP5]=useState(true); // P5 (회피) 자동 숨김 기본 ON
  const[onlyPrimary,setOnlyPrimary]=useState(false); // 주력 발주사만 보기
  // Phase 14-3: 분산 투찰 시뮬레이터 (prediction_id → {strategy_label, ev_gain_eok, ...})
  const[simulatorMap,setSimulatorMap]=useState({});
  // ★ AI 챗봇 (localStorage 세션 관리)
  const[chatSessions,setChatSessions]=useState(()=>{try{return JSON.parse(localStorage.getItem("bid_chat_sessions")||"[]")}catch(e){return[]}});
  const[chatSid,setChatSid]=useState(()=>localStorage.getItem("bid_chat_active")||"");
  const[chatMsgs,setChatMsgs]=useState(()=>{if(!chatSid)return[];try{return JSON.parse(localStorage.getItem("bid_chat_msg_"+chatSid)||"[]")}catch(e){return[]}});
  const[chatInput,setChatInput]=useState("");const[chatLoading,setChatLoading]=useState(false);
  const[chatSideOpen,setChatSideOpen]=useState(true);
  const chatRef=useCallback(node=>{if(node)setTimeout(()=>{node.scrollTop=node.scrollHeight},50)},[chatMsgs]);
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
    const ba=p.ba?Number(p.ba):0;
    const av=p.av?Number(p.av):0;
    const fr=Number(p.pred_floor_rate||0);
    const calcBid=(adj)=>{
      if(!ba||!fr)return null;
      const xp=ba*(1+adj/100);
      return av>0?Math.ceil(av+(xp-av)*(fr/100)):Math.ceil(xp*(fr/100));
    };
    // 1순위: opt_adj (편향 보정 + OPT_OFFSET 적용된 최종값)
    if(p.opt_adj!=null){
      const adjNum=Number(p.opt_adj);
      const bid=p.opt_bid?Number(p.opt_bid):calcBid(adjNum);
      const bid1st=calcWin1stBid(bid,fr,p.at);
      return{adj:adjNum,bid,bid1st,source:"추천"};
    }
    // 2순위 fallback: pred_adj_rate (편향 보정 전 순수 예측)
    if(p.pred_adj_rate!=null){
      const adjNum=Number(p.pred_adj_rate);
      const bid=p.pred_bid_amount?Number(p.pred_bid_amount):calcBid(adjNum);
      const bid1st=calcWin1stBid(bid,fr,p.at);
      return{adj:adjNum,bid,bid1st,source:"순수예측"};
    }
    return{adj:null,bid:null,bid1st:null,source:null};
  },[]);

  // AI 프롬프트 생성 (공통)
  const buildAiPrompt=(r,mode="initial")=>{
    const p=r.pred;if(!p)return null;
    const agType=r.at||clsAg(r.ag);const agName=r.ag||"";
    const curStat=allS.as?.[agName];const typeStat=allS.ts?.[agType];
    const agDets=bidDetails.filter(d=>d.ag===agName);
    const rec=recommendAssumedAdj({at:agType,agName,ba:r.ba,ep:r.ep,av:r.av},allS.ts,allS.as,agAss);
    const baseInfo=`■ 입찰 정보
- 공고명: ${(r.pn||"").slice(0,50)}
- 발주기관: ${agName} (${agType})
- 기초금액: ${r.ba?Number(r.ba).toLocaleString():"미입력"}원
- 추정가격: ${r.ep?Number(r.ep).toLocaleString():"미입력"}원
- A값: ${r.av?Number(r.av).toLocaleString()+"원":"없음"}
- 적용 낙찰하한율: ${p.fr}%

■ 예측 결과 (분석용: 사정률 예측)
- 예측 사정률(100%): ${(100+Number(p.adj)).toFixed(4)}% (중앙값)
- 신뢰구간 70%: ${p.ci70?(100+Number(p.ci70.low)).toFixed(4)+"% ~ "+(100+Number(p.ci70.high)).toFixed(4)+"%":"N/A"}
- 예측 투찰금액: ${p.bid?p.bid.toLocaleString()+"원":"N/A"}
- 근거: ${p.src}

■ 추천 투찰 전략 (실전용: 가정 사정률 기반)
- 보수적: 가정 사정률 ${(100+rec.conservative.adj).toFixed(4)}%, 투찰금액 ${rec.conservative.bid.toLocaleString()}원
- 균형:   가정 사정률 ${(100+rec.balanced.adj).toFixed(4)}%, 투찰금액 ${rec.balanced.bid.toLocaleString()}원
- 공격적: 가정 사정률 ${(100+rec.aggressive.adj).toFixed(4)}%, 투찰금액 ${rec.aggressive.bid.toLocaleString()}원
- 근거: ${rec.source}
- 탈락률 참고: ${rec.risk.note} (${rec.risk.failRate}%)

■ 기관 통계 (${agType})
- 평균 사정률(100%): ${typeStat?(100+Number(typeStat.avg)).toFixed(4)+"%":"N/A"} (${typeStat?typeStat.n+"건":"N/A"})
- 표준편차: ${typeStat?typeStat.std.toFixed(4)+"%":"N/A"}
${curStat?`- 발주기관 개별: 평균(100%) ${(100+Number(curStat.avg)).toFixed(4)}%, ${curStat.n}건`:"- 발주기관 개별 데이터: 없음"}
${agDets.length>0?`- 복수예가 상세: ${agDets.length}건 보유`:""}

■ 핵심 제약
- 복수예비가격 C(15,4) 추첨의 노이즈 바닥 = 0.642%
- 1순위 업체의 낙찰하한율 대비 마진: 중앙값 0.5%`;

    if(mode==="post"&&r.actual!=null){
      const err=r.actual-p.adj;const errDir=err>0?"높게":"낮게";
      const matchedRec=r.matchedRecord||{};
      const optAdj=p.optAdj!=null?p.optAdj:p.adj;
      const optBid=p.optBid||p.bid;
      const marginWon=matchedRec.bp?Number(matchedRec.bp)-optBid:null;
      const marginPct=marginWon&&matchedRec.bp?marginWon/Number(matchedRec.bp)*100:null;
      const epN=r.ep||r.ba||0;
      const tierPct=epN<1e8?"1.8%":epN<3e8?"4.5%":epN<1e9?"8.8%":"12.0%";
      return`당신은 한국 공공조달 입찰 전문가 AI입니다. 이 입찰건은 이미 개찰이 완료되어 실제 결과가 확인되었습니다. 예측과 실제의 차이를 분석하고, 향후 유사건에 대한 교훈을 300자 이내로 정리해주세요.

${baseInfo}

■ 실제 결과 (개찰 완료)
- 실제 사정률(100%): ${(100+Number(r.actual)).toFixed(4)}%
- 예측 오차: ${err>=0?"+":""}${err.toFixed(4)}% (예측이 실제보다 ${Math.abs(err).toFixed(4)}% ${errDir} 예측)
- 추천 사정률(100%): ${(100+optAdj).toFixed(4)}% / 추천 투찰금액: ${optBid.toLocaleString()}원
${matchedRec.co?`- 1순위 업체: ${matchedRec.co}`:""}
${matchedRec.pc?`- 참여업체 수: ${matchedRec.pc}개사`:""}
${matchedRec.bp?`- 1순위 투찰금액: ${Number(matchedRec.bp).toLocaleString()}원`:""}
${marginWon!=null?`- 1순위 대비 마진: ${marginWon>=0?"+":""}${Math.round(marginWon).toLocaleString()}원 (${marginPct>=0?"+":""}${marginPct.toFixed(3)}%) → ${marginWon>=0?"낙찰 가능":"낙찰 불가"}`:""}
- 금액대 기대 낙찰률: ${tierPct} (722건 백테스트)

위 정보를 바탕으로:
1. 예측 오차의 원인 분석 (기관 특성, 복수예가 추첨 변동성, 데이터 부족 등)
2. ${marginWon!=null&&marginWon<0&&Math.abs(marginPct)<0.5?"이 건은 0.5% 이내로 아깝게 놓친 건입니다. 다음 투찰 시 더 적극적 접근이 유리했을지 분석해주세요.":"이 기관의 향후 입찰에 적용할 수 있는 교훈 한 가지"}
3. 전략 보정 제안: 이 기관에서는 추천 사정률을 더 낮출지/유지할지/높일지`}

    return`당신은 한국 공공조달 입찰 전문가 AI입니다. 다음 입찰건에 대해 맞춤형 투찰 전략을 200자 이내로 간결하게 조언해주세요.

${baseInfo}

위 정보를 바탕으로:
1. 이 입찰건의 특성과 리스크를 한 줄로 요약
2. 추천 투찰 전략 (보수/균형/공격 중)과 그 이유 — 예측 투찰금액과 추천 투찰금액 차이도 언급
3. 투찰 시 유의사항 한 가지`};
  const callAi=async(prompt)=>{
    const _sess=getSession();
    const res=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json","Authorization":_sess?.access_token?`Bearer ${_sess.access_token}`:""},
      body:JSON.stringify({systemBase:buildChatSystem(),messages:[{role:"user",content:prompt}]})});
    if(!res.ok){const err=await res.json().catch(()=>({}));throw new Error(err.error?.message||err.error||`API ${res.status}`)}
    const data=await res.json();return data.content?.map(c=>c.text||"").join("")||"응답 없음"};

  // ★ AI 챗봇 시스템 프롬프트 (현재 데이터 통계 동적 포함)
  const buildChatSystem=()=>{
    const ts=allS.ts||{};const typeStats=Object.entries(ts).map(([k,v])=>`${k}: 평균(100%)${(100+Number(v.avg||0)).toFixed(3)}%, std${v.std?.toFixed(3)||0}%, ${v.n||0}건`).join(" / ");
    const matched=predictions.filter(p=>p.match_status==="matched");
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
    try{const[rows,preds,dets,agStats,scoring]=await Promise.all([sbFetchAll(),sbFetchPredictions(),sbFetchDetails(),sbFetchAgAssumedStats(),sbFetchScoring()]);
      setRecs(rows);refreshStats(rows);setDataStatus(calcDataStatus(rows));
      setPredictions(preds||[]);setBidDetails(dets||[]);setAgAss(agStats||{});
      // scoring map 구성
      const sm={};(scoring||[]).forEach(s=>{sm[s.prediction_id]=s});setScoringMap(sm);
      // 자동 매칭 시도
      const matched=await sbMatchPredictions(preds,rows);
      if(matched>0){const updPreds=await sbFetchPredictions();setPredictions(updPreds)}
      return{records:rows.length,predictions:(preds||[]).length,details:(dets||[]).length,matched}
    }catch(e){return null}},[refreshStats]);;

  // DB 로드
  useEffect(()=>{(async()=>{
    try{const rows=await sbFetchAll();setRecs(rows);refreshStats(rows);setDataStatus(calcDataStatus(rows));if(rows.length>0)setTab("dash")}catch(e){setMsg({type:"err",text:"DB 로드 실패: "+e.message})}
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
    try{const scoring=await sbFetchScoring();const sm={};(scoring||[]).forEach(s=>{sm[s.prediction_id]=s});setScoringMap(sm)}catch(e){setScoringMap({})}
    try{const mtx=await sbFetchRoiMatrix();if(mtx?.matrix)setWinProbMatrix(mtx.matrix)}catch(e){}
    try{const bm=await sbFetchBiasMap();if(bm){setBiasMap(bm);setBiasMapState(bm)}}catch(e){}
    try{const tm=await sbFetchTrendMap();if(tm){setTrendMap(tm);setTrendMapState(tm)}}catch(e){}
    // Phase 12-C: 발주사별 낙찰 예측 데이터 로드
    try{
      const [aws,apr]=await Promise.all([sbFetchAgencyWinStats(),sbFetchAgencyPredictor()]);
      const awsMap={};(aws||[]).forEach(r=>{awsMap[r.ag]=r});setAgencyStats(awsMap);
      const aprMap={};(apr||[]).forEach(r=>{aprMap[r.ag]=r});setAgencyPred(aprMap);
    }catch(e){setAgencyStats({});setAgencyPred({})}
    // Phase 14-3: 분산 투찰 시뮬레이터 데이터 로드
    try{
      const sim=await sbFetchSimulator();
      const simMap={};(sim||[]).forEach(r=>{simMap[r.prediction_id]=r});setSimulatorMap(simMap);
    }catch(e){setSimulatorMap({})}
    // 나라장터 공고 로드
    try{const nots=await sbFetchNotices();setNotices(nots||[])}catch(e){setNotices([])}
    setDbLoading(false)
  })()},[refreshStats]);

  // 예측 탭 진입 시 자동 새로고침
  useEffect(()=>{if(tab==="predict"&&!dbLoading){refreshPredictions()}},[tab,dbLoading]);

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
          const results=items.map(item=>{const p=predictV5({at:item.at,agName:item.ag,ba:item.ba,ep:item.ep,av:item.av},allS.ts,allS.as,bidDetails,agencyPred);const rec=recommendAssumedAdj({at:item.at,agName:item.ag,ba:item.ba,ep:item.ep,av:item.av},allS.ts,allS.as,curAgAss);return{...item,pred:p,rec}}).filter(r=>r.pred);
          if(!results.length)throw new Error("예측 결과 0건");
          accPredResults=accPredResults.concat(results);setPredResults([...accPredResults]); // ★ 누적 표시
          const dbRows=results.map(r=>({dedup_key:r.dedup_key,pn:r.pn,pn_no:r.pn_no,ag:r.ag,at:r.at,ep:r.ep,ba:r.ba,av:r.av,raw_cost:r.raw_cost,cat:r.cat,open_date:r.open_date,pred_adj_rate:r.pred.adj,pred_expected_price:r.pred.xp,pred_floor_rate:r.pred.fr,pred_bid_amount:r.pred.bid,pred_source:r.pred.src,pred_base_adj:r.pred.baseAdj,opt_adj:r.pred.optAdj,opt_bid:r.pred.optBid,rec_adj_p25:r.rec?.aggressive?.adj,rec_adj_p50:r.rec?.balanced?.adj,rec_adj_p75:r.rec?.conservative?.adj,rec_bid_p25:r.rec?.aggressive?.bid,rec_bid_p50:r.rec?.balanced?.bid,rec_bid_p75:r.rec?.conservative?.bid,rec_strategy:r.rec?.strategy,source:"file_upload",match_status:"pending"}));
          await sbSavePredictions(dbRows);
          logs.push({name:file.name,type:"ok",text:`[예측] ${results.length}건 예측 완료`});
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
    try{const[rows,preds,dets]=await Promise.all([sbFetchAll(),sbFetchPredictions(),sbFetchDetails()]);
      setRecs(rows);refreshStats(rows);setDataStatus(calcDataStatus(rows));setBidDetails(dets||[]);
      const matched=await sbMatchPredictions(preds,rows);
      // Phase 5.2: 신규 예측에 대해 자동 scoring
      const existingIds=new Set(Object.keys(scoringMap).map(Number));
      const newPreds=(matched>0?await sbFetchPredictions():preds).filter(p=>!existingIds.has(p.id));
      if(newPreds.length>0){
        const scoringRows=newPreds.map(p=>{const sc=calcRoiV2(p);return{prediction_id:p.id,...sc}});
        await sbBatchUpsertScoring(scoringRows);
        const scoring=await sbFetchScoring();const sm={};(scoring||[]).forEach(s=>{sm[s.prediction_id]=s});setScoringMap(sm);
      }
      if(matched>0){const updPreds=await sbFetchPredictions();setPredictions(updPreds);setMsg({type:"ok",text:`업로드 완료 · ${matched}건 예측 자동 매칭 · 신규 ${newPreds.length}건 scoring`})}
      else{setPredictions(preds);if(!logs.some(l=>l.type==="err"))setMsg({type:"ok",text:`업로드 완료 · 신규 ${newPreds.length}건 scoring`})}
    }catch(e){setMsg({type:"err",text:"DB 재로드 실패"})}
    setSel({});setBusy(false)},[refreshStats,allS,bidDetails,agAss]);

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
      try{const{rows}=await parseFile(file);const items=parseBidDoc(rows);if(!items.length){logs.push({name:file.name,ok:false,msg:"예측 대상 0건"});failCount++;continue}
        const results=items.map(item=>{const p=predictV5({at:item.at,agName:item.ag,ba:item.ba,ep:item.ep,av:item.av},allS.ts,allS.as,bidDetails,agencyPred);const rec=recommendAssumedAdj({at:item.at,agName:item.ag,ba:item.ba,ep:item.ep,av:item.av},allS.ts,allS.as,curAgAss);return{...item,pred:p,rec}}).filter(r=>r.pred);
        if(!results.length){logs.push({name:file.name,ok:false,msg:"예측 결과 0건"});failCount++;continue}
        totalResults=totalResults.concat(results);
        logs.push({name:file.name,ok:true,msg:`${results.length}건 예측`});successCount++;
      }catch(e){logs.push({name:file.name,ok:false,msg:e.message});failCount++}}
    if(totalResults.length>0){
      setPredResults(prev=>{const dkSet=new Set(totalResults.map(r=>r.dedup_key));const kept=prev.filter(p=>!dkSet.has(p.dedup_key));return[...kept,...totalResults]});
      const dbRows=totalResults.map(r=>({dedup_key:r.dedup_key,pn:r.pn,pn_no:r.pn_no,ag:r.ag,at:r.at,ep:r.ep,ba:r.ba,av:r.av,raw_cost:r.raw_cost,cat:r.cat,open_date:r.open_date,pred_adj_rate:r.pred.adj,pred_expected_price:r.pred.xp,pred_floor_rate:r.pred.fr,pred_bid_amount:r.pred.bid,pred_source:r.pred.src,pred_base_adj:r.pred.baseAdj,opt_adj:r.pred.optAdj,opt_bid:r.pred.optBid,rec_adj_p25:r.rec?.aggressive?.adj,rec_adj_p50:r.rec?.balanced?.adj,rec_adj_p75:r.rec?.conservative?.adj,rec_bid_p25:r.rec?.aggressive?.bid,rec_bid_p50:r.rec?.balanced?.bid,rec_bid_p75:r.rec?.conservative?.bid,rec_strategy:r.rec?.strategy,source:"file_upload",match_status:"pending"}));
      await sbSavePredictions(dbRows);const preds=await sbFetchPredictions();setPredictions(preds);
      // Phase 5.2: 신규 예측 자동 scoring
      const existingIds=new Set(Object.keys(scoringMap).map(Number));
      const newPreds=preds.filter(p=>!existingIds.has(p.id));
      if(newPreds.length>0){
        const scoringRows=newPreds.map(p=>{const sc=calcRoiV2(p);return{prediction_id:p.id,...sc}});
        await sbBatchUpsertScoring(scoringRows);
        const scoring=await sbFetchScoring();const sm={};(scoring||[]).forEach(s=>{sm[s.prediction_id]=s});setScoringMap(sm);
      }
    }
    const summary=fileList.length===1?logs[0]?.ok?`${totalResults.length}건 예측 완료 · DB 저장`:logs[0]?.msg
      :`${fileList.length}개 파일 처리: 성공 ${successCount} · 실패 ${failCount} · 총 ${totalResults.length}건 예측`;
    setMsg({type:failCount>0&&successCount===0?"err":"ok",text:summary});setBusy(false)},[allS,bidDetails,agAss]);

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
  const[manualRec,setManualRec]=useState(null);
  const doManualPred=useCallback(()=>{
    if(!Object.keys(allS.ts||{}).length){setMsg({type:"err",text:"낙찰 데이터가 없습니다. 먼저 데이터를 업로드해주세요."});return}
    const p=predictV5({at:clsAg(inp.agency),agName:inp.agency.trim(),ba:tn(inp.baseAmount),ep:tn(inp.estimatedPrice),av:tn(inp.aValue)},allS.ts,allS.as,bidDetails,agencyPred);
    if(!p){setMsg({type:"err",text:"예측 실패: 기관 또는 금액 정보를 확인해주세요."});return}
    setPred(p);if(p)setSimSlider(Math.round(p.adj*100));
    const rec=recommendAssumedAdj({at:clsAg(inp.agency),agName:inp.agency.trim(),ba:tn(inp.baseAmount),ep:tn(inp.estimatedPrice),av:tn(inp.aValue)},allS.ts,allS.as,agAss);
    setManualRec(rec)},[inp,allS,bidDetails,agencyPred,agAss]);

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
  const fmtRelTime=(iso)=>{if(!iso)return null;const d=Date.now()-new Date(iso).getTime();const m=Math.floor(d/60000);if(m<1)return"방금";if(m<60)return m+"분 전";const h=Math.floor(m/60);if(h<24)return h+"시간 전";return new Date(iso).toLocaleDateString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})};
  const allSel=pagedRecs.length>0&&pagedRecs.every(r=>sel[r.id]);

  const compStats=useMemo(()=>{
    const preds=predictions||[];const matched=preds.filter(p=>p.match_status==="matched");const pending=preds.filter(p=>p.match_status==="pending");
    const expired=preds.filter(p=>p.match_status==="expired");
    const errors=matched.filter(p=>p.adj_rate_error!=null).map(p=>Number(p.adj_rate_error));
    const absErrors=errors.map(e=>Math.abs(e));
    const avgErr=absErrors.length?Math.round(absErrors.reduce((a,b)=>a+b,0)/absErrors.length*10000)/10000:0;
    const bias=errors.length?Math.round(errors.reduce((a,b)=>a+b,0)/errors.length*10000)/10000:0;
    const within05=absErrors.filter(e=>e<=0.5).length;
    const byType={};matched.forEach(p=>{const t=p.at||"기타";if(!byType[t])byType[t]={n:0,errSum:0};byType[t].n++;if(p.adj_rate_error!=null)byType[t].errSum+=Math.abs(p.adj_rate_error)});
    Object.values(byType).forEach(v=>{v.avgErr=v.n?Math.round(v.errSum/v.n*10000)/10000:0});
    return{total:preds.length,matched:matched.length,pending:pending.length,expired:expired.length,avgErr,bias,within05,byType}},[predictions]);
  const compList=useMemo(()=>{const p=predictions||[];let list;
    // 기본: expired 자동 제외 (명시적 expired 필터 선택 시에만 표시)
    if(compFilter==="matched")list=p.filter(x=>x.match_status==="matched");
    else if(compFilter==="pending")list=p.filter(x=>x.match_status==="pending");
    else if(compFilter==="expired")list=p.filter(x=>x.match_status==="expired");
    else list=p.filter(x=>x.match_status!=="expired"); // 전체에서 expired 제외
    if(hideYuchal)list=list.filter(x=>!(x.actual_winner&&(x.actual_winner==="유찰"||x.actual_winner==="유찰(무)")));
    if(hideSuui)list=list.filter(x=>{const y=x.actual_winner&&(x.actual_winner==="유찰"||x.actual_winner==="유찰(무)");return y||!(x.match_status==="matched"&&x.actual_adj_rate==null&&x.actual_winner!=null&&x.actual_winner!=="")});
    // Phase 5: 등급 필터
    if(gradeFilter!=="all"){list=list.filter(x=>{const g=scoringMap[x.id]?.roi_grade||"D";if(gradeFilter==="SA")return g==="S"||g==="A";if(gradeFilter==="SAB")return g==="S"||g==="A"||g==="B";if(gradeFilter==="notD")return g!=="D";return true})}
    // Phase 12-C: 발주사별 P5 숨김, 주력만 보기 (pending 건에만 적용)
    if(hideP5){list=list.filter(x=>{
      if(x.match_status!=="pending")return true; // 매칭건은 유지 (과거 데이터)
      const a=assessPrediction(x,agencyStats,agencyPred);
      return !a||a.tier==null||a.tier<5;
    })}
    if(onlyPrimary){list=list.filter(x=>{
      if(x.match_status!=="pending")return true;
      const a=assessPrediction(x,agencyStats,agencyPred);
      return a&&a.tier!=null&&a.tier<=2;
    })}
    return[...list].sort((a,b)=>sortFn(a,b,predSort.key,predSort.dir))},[predictions,compFilter,predSort,hideYuchal,hideSuui,gradeFilter,scoringMap,hideP5,onlyPrimary,agencyStats,agencyPred]);

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

  return(<AuthGate><div style={{fontFamily:"system-ui,sans-serif",background:C.bg,color:C.txt,minHeight:"100vh",fontSize:13}}>
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
      </div>
      <div style={{display:"flex",alignItems:"center",gap:0,flexWrap:"wrap"}}>
        <div style={{display:"flex",gap:0}}><Tb id="dash" ch="대시보드"/><Tb id="analysis" ch="분석"/><Tb id="predict" ch="예측" badge={compStats.pending}/><Tb id="notices" ch="공고" badge={notices.filter(n=>n.is_target&&!n.prediction_id).length||0}/><Tb id="winstrat" ch="🎯 작전"/><Tb id="chat" ch="AI 상담"/></div>
        <UserBadge/>
      </div>
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
      {uploadLog.length>0&&<div style={{marginBottom:12}}>{uploadLog.map((l,i)=><div key={i} style={{padding:"6px 12px",fontSize:12,color:l.type==="ok"?"#5ca":l.type==="warn"?"#d4a834":"#e55",borderBottom:"1px solid "+C.bdr}}>{l.type==="ok"?"✓":l.type==="warn"?"⚠":"✕"} {l.name} — {l.text}</div>)}</div>}

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

      {/* Phase 5.4-B: Claude AI는 Supabase Edge Function 프록시 경유 — 키 입력 불필요 */}

      {/* Phase 5.2: 만료 경고 카드 (낙찰결과 미업로드 유도) */}
      {compStats.expired>0&&<div style={{background:"linear-gradient(135deg, rgba(226,75,74,0.08), rgba(212,168,52,0.04))",border:"1px solid rgba(226,75,74,0.3)",borderRadius:8,padding:"10px 14px",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}} onClick={()=>{setTab("predict");setCompFilter("expired")}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:16}}>⚠️</span>
          <div>
            <div style={{fontSize:12,fontWeight:600,color:"#e24b4a"}}>검증 만료 {compStats.expired}건</div>
            <div style={{fontSize:10,color:C.txm,marginTop:2}}>60일 이상 경과 + 낙찰결과 미업로드 — 낙찰정보리스트를 업로드하면 매트릭스가 자동 재학습됩니다</div>
          </div>
        </div>
        <span style={{fontSize:11,color:"#e24b4a",fontWeight:600}}>확인 →</span>
      </div>}

      {/* Phase 5: ROI 추천 카드 */}
      {(()=>{const counts={S:0,A:0,B:0,C:0,D:0};let evSum=0;let pendingSA=0;
        predictions.forEach(p=>{const sc=scoringMap[p.id];if(!sc)return;const g=sc.roi_grade||"D";counts[g]=(counts[g]||0)+1;evSum+=Number(sc.expected_value)||0;if(p.match_status==="pending"&&(g==="S"||g==="A"))pendingSA++});
        const totalScored=Object.values(counts).reduce((a,b)=>a+b,0);if(totalScored===0)return null;
        return<div style={{background:"linear-gradient(135deg, rgba(168,85,247,0.1), rgba(93,202,165,0.05))",border:"1px solid rgba(168,85,247,0.3)",borderRadius:10,padding:"14px 16px",marginBottom:16,cursor:"pointer"}} onClick={()=>{setTab("predict");setGradeFilter("SA")}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:13,fontWeight:600,color:"#a855f7",letterSpacing:1}}>🎯 ROI 추천 — 투찰 우선순위</span>
              {pendingSA>0&&<span style={{fontSize:10,padding:"2px 7px",borderRadius:10,background:"#a855f7",color:"#fff",fontWeight:600}}>대기 S/A {pendingSA}건 →</span>}
            </div>
            <span style={{fontSize:9,color:C.txd}}>전체 {totalScored}건 점수화 완료 · 검증 낙찰률 S 30% / A 17%</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(6, 1fr)",gap:8}}>
            {[{g:"S",label:"반드시",c:"#a855f7"},{g:"A",label:"우선",c:"#5dca96"},{g:"B",label:"선택",c:"#d4a834"},{g:"C",label:"여력",c:"#a8b4ff"},{g:"D",label:"제외",c:"#666680"}].map(x=>
              <div key={x.g} style={{padding:"8px 6px",background:C.bg3,borderRadius:5,textAlign:"center",border:"1px solid "+x.c+"33"}}>
                <div style={{fontSize:9,color:C.txd,marginBottom:2}}>{x.label}</div>
                <div style={{fontSize:16,fontWeight:700,color:x.c,fontFamily:"monospace"}}>{x.g} {counts[x.g]}</div>
              </div>
            )}
            <div style={{padding:"8px 6px",background:C.bg3,borderRadius:5,textAlign:"center",border:"1px solid #5dca9633"}}>
              <div style={{fontSize:9,color:C.txd,marginBottom:2}}>총 기대값</div>
              <div style={{fontSize:13,fontWeight:600,color:"#5dca96",fontFamily:"monospace"}}>{tc(Math.round(evSum))}원</div>
            </div>
          </div>
        </div>
      })()}

      {/* Phase 5.3: 같은 기관 묶음 알림 */}
      {(()=>{
        // pending S/A 건을 발주기관별로 그룹핑
        const sa=predictions.filter(p=>{const g=scoringMap[p.id]?.roi_grade;return p.match_status==="pending"&&(g==="S"||g==="A")});
        const groups={};sa.forEach(p=>{if(!p.ag)return;if(!groups[p.ag])groups[p.ag]=[];groups[p.ag].push(p)});
        const big=Object.entries(groups).filter(([_,items])=>items.length>=3).sort((a,b)=>b[1].length-a[1].length);
        if(big.length===0)return null;
        return<div style={{background:"linear-gradient(135deg, rgba(168,85,247,0.12), rgba(212,168,52,0.06))",border:"1px solid rgba(168,85,247,0.4)",borderRadius:10,padding:"14px 16px",marginBottom:16}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
            <span style={{fontSize:13,fontWeight:600,color:"#a855f7",letterSpacing:1}}>🔥 발주기관 묶음 발견 — 우선 검토</span>
            <span style={{fontSize:9,color:C.txd}}>같은 기관에 S/A등급 3건 이상 집중</span>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {big.slice(0,5).map(([ag,items])=>{
              const totalAmt=items.reduce((s,p)=>s+(Number(p.ep||p.ba)||0),0);
              const avgProb=items.reduce((s,p)=>s+(Number(scoringMap[p.id]?.win_prob)||0),0)/items.length;
              const expWins=Math.round(avgProb*items.length*10)/10;
              return<div key={ag} style={{padding:"8px 12px",background:C.bg3,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}} onClick={()=>{setTab("predict");setGradeFilter("SA")}}>
                <div style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0}}>
                  <span style={{fontSize:18,fontWeight:700,color:"#a855f7",fontFamily:"monospace",minWidth:32}}>{items.length}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,color:C.txt,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ag}</div>
                    <div style={{fontSize:10,color:C.txm,marginTop:2}}>총 {tc(totalAmt)}원 · 평균 확률 {(avgProb*100).toFixed(1)}% · 기대 낙찰 {expWins}건</div>
                  </div>
                </div>
                <span style={{fontSize:11,color:"#a855f7",marginLeft:8}}>→</span>
              </div>
            })}
          </div>
        </div>
      })()}
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

      {/* ★ 상세 모달 — Phase 5.6 탭 기반 재설계 */}
      {detailModal&&(()=>{
        const d=detailModal;
        const pa=d.pred_adj_rate!=null?Number(d.pred_adj_rate):null;
        const aa=d.actual_adj_rate!=null?Number(d.actual_adj_rate):null;
        const pb=d.pred_bid_amount?Number(d.pred_bid_amount):null;
        const ab=d.actual_bid_amount?Number(d.actual_bid_amount):null;
        const pxp=d.pred_expected_price?Number(d.pred_expected_price):null;
        const axp=d.actual_expected_price?Number(d.actual_expected_price):null;
        const pBR=pb&&pxp&&pxp>0?pb/pxp*100:null;
        const aBR=ab&&axp&&axp>0?ab/axp*100:null;
        const err=d.adj_rate_error!=null?Number(d.adj_rate_error):null;
        const errAbs=err!=null?Math.abs(err):null;
        const ba=d.ba?Number(d.ba):null;
        const ep=d.ep?Number(d.ep):null;
        const av=d.av?Number(d.av):0;
        // ★ Phase 5.6: 통합 최종 추천 (예측 리스트와 동일 로직 사용)
        const finalRec=getFinalRecommendation(d);
        const finalAdj=finalRec.adj;
        const finalBid=finalRec.bid;
        const finalBid1st=finalRec.bid1st;
        const finalSource=finalRec.source==="추천"?"통계 예측 + 편향 보정":
                          finalRec.source==="순수예측"?"순수 통계 예측":"—";
        const fr2=Number(d.pred_floor_rate||0);
        const calcBid=(adj)=>{const xp=ba*(1+adj/100);return av>0?Math.ceil(av+(xp-av)*(fr2/100)):Math.ceil(xp*(fr2/100))};
        const fmtAdj=(adj)=>adj==null?"—":(100+Number(adj)).toFixed(4)+"%";
        const ai=aiAnalysisMap[d.id];
        const aiLoading=aiLoadingPredId===d.id;
        // Enhanced (전략 탭용)
        const enhanced=getEnhancedAdj(d);
        // 등급
        const sc=scoringMap[d.id];
        const grade=sc?sc.roi_grade:null;
        const gc=grade?{S:"#a855f7",A:"#5dca96",B:"#d4a834",C:"#a8b4ff",D:"#666680"}[grade]:C.txm;
        const gradeDesc=grade?{S:"반드시 투찰",A:"우선 투찰",B:"선택 투찰",C:"여력시 투찰",D:"제외 권장"}[grade]:"";
        const winProb=sc?Number(sc.win_prob):null;
        // 매칭 결과 판정
        const floorLine=axp?(av>0?av+(axp-av)*(fr2/100):axp*(fr2/100)):null;
        const matchResult=d.match_status==="matched"&&ab&&finalBid?
          (finalBid>ab?"higher":(floorLine&&finalBid<floorLine?"invalid":"win")):null;

        return<div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,.7)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>{setDetailModal(null);setDetailAi("");setDetailAiLoading(false);setDetailTab("detail")}}>
        <div onClick={e=>e.stopPropagation()} style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:12,padding:"20px 24px",maxWidth:680,width:"100%",maxHeight:"90vh",overflowY:"auto"}}>
          {/* 헤더 */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:15,fontWeight:600,color:C.txt,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={d.pn}>{d.pn}</div>
              <div style={{fontSize:12,color:C.txm,marginTop:3}}>{d.ag} ({d.at}) · {d.open_date||"개찰일 미정"} · <span style={{padding:"2px 6px",borderRadius:4,fontSize:10,background:d.match_status==="matched"?"rgba(93,202,165,0.15)":"rgba(226,75,74,0.15)",color:d.match_status==="matched"?"#5dca96":"#e24b4a"}}>{d.match_status==="matched"?"매칭":"대기"}</span></div>
            </div>
            <div style={{fontSize:20,color:C.txd,cursor:"pointer",lineHeight:1,padding:"0 4px",flexShrink:0}} onClick={()=>{setDetailModal(null);setDetailAi("");setDetailTab("detail")}}>×</div>
          </div>

          {/* ★★★ 투찰 결정 가이드 ★★★ */}
          {(()=>{
            // pred_source 파싱: "d:0.50|s:0.25|c:0.20|bc*0.0"
            const src=d.pred_source||"";
            const dm=src.match(/d:([\d.]+)/),sm=src.match(/s:([\d.]+)/),cm=src.match(/c:([\d.]+)/),bcm=src.match(/bc\*([\d.]+)/);
            const dw=dm?Math.round(Number(dm[1])*100):0,sw=sm?Math.round(Number(sm[1])*100):0,cw=cm?Math.round(Number(cm[1])*100):0,bc=bcm?Number(bcm[1]):0;
            const srcLabel=(dw||sw||cw)?[dw>0&&`발주사통계 ${dw}%`,sw>0&&`유사사례 ${sw}%`,cw>0&&`업체패턴 ${cw}%`].filter(Boolean).join(" + "):"";
            const dataConf=dw>=50?"high":dw>=30?"med":sw>=40?"med":"low";
            const confColor=dataConf==="high"?"#5dca96":dataConf==="med"?"#d4a834":"#a8b4ff";
            const confLabel=dataConf==="high"?"신뢰 높음":dataConf==="med"?"신뢰 보통":"데이터 부족";
            const winBid=finalBid1st||finalBid;
            const agEnv=assessPrediction(d,agencyStats,agencyPred);
            const isHard=agEnv&&agEnv.confidence>0.5&&(agEnv.n||0)>5;
            return<div style={{marginBottom:14,borderRadius:10,overflow:"hidden",border:"2px solid rgba(212,168,52,0.5)"}}>
              {/* 헤더 */}
              <div style={{background:"rgba(212,168,52,0.12)",padding:"9px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:12,fontWeight:700,color:C.gold}}>📋 투찰 결정 가이드</span>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  {grade&&<span style={{fontSize:12,fontWeight:700,padding:"2px 9px",borderRadius:4,background:gc+"33",color:gc,border:"1px solid "+gc+"77"}}>{grade} {gradeDesc}</span>}
                  {winProb!=null&&<span style={{fontSize:11,color:gc,fontWeight:600}}>낙찰확률 {(winProb*100).toFixed(1)}%</span>}
                </div>
              </div>
              {/* 핵심 2값: 사정률 + 투찰금 */}
              <div style={{padding:"14px 16px",background:"rgba(0,0,0,0.2)",display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                <div>
                  <div style={{fontSize:10,color:C.txm,marginBottom:3}}>📌 입찰 시 사용할 사정률(100%)</div>
                  <div style={{fontSize:28,fontWeight:700,color:"#5dca96",fontFamily:"monospace",lineHeight:1}}>{fmtAdj(finalAdj)}</div>
                  <div style={{fontSize:10,color:C.txd,marginTop:3}}>이 예정가격을 기초금액으로 계산한 값</div>
                </div>
                <div>
                  <div style={{fontSize:10,color:C.txm,marginBottom:3}}>💰 입찰 시 사용할 투찰금액</div>
                  <div style={{fontSize:28,fontWeight:700,color:C.gold,fontFamily:"monospace",lineHeight:1}}>{winBid?tc(winBid)+"원":"—"}</div>
                  <div style={{fontSize:10,color:C.txd,marginTop:3}}>낙찰하한율 {d.pred_floor_rate||"—"}% 적용{d.av&&Number(d.av)>0?" (A값 "+tc(Number(d.av))+"원)":""}</div>
                </div>
              </div>
              {/* 신뢰도 + 근거 */}
              <div style={{padding:"10px 16px",background:"rgba(0,0,0,0.1)",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
                <div style={{fontSize:11,color:C.txm}}>
                  {srcLabel&&<span>예측 근거: <span style={{color:C.txt}}>{srcLabel}</span></span>}
                  {bc>0&&<span style={{color:confColor,marginLeft:6}}>| 편향보정 적용</span>}
                </div>
                <span style={{fontSize:10,padding:"2px 8px",borderRadius:10,background:confColor+"22",color:confColor,border:"1px solid "+confColor+"44",fontWeight:600,whiteSpace:"nowrap"}}>{confLabel}</span>
              </div>
              {/* 경고 (격전지, 단골) */}
              {agEnv&&<div style={{padding:"8px 16px",background:agEnv.tier<=2?"rgba(226,75,74,0.08)":agEnv.tier===5?"rgba(100,100,128,0.08)":"rgba(91,157,217,0.08)",borderTop:"1px solid "+C.bdr+"55",display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:11,color:agEnv.tier<=2?"#e24b4a":agEnv.tier===5?"#666680":"#5b9dd9"}}>
                  {agEnv.tier<=2?"🏆 주력 발주사 — 적극 투찰 권장":agEnv.tier===5?"⛔ 회피 발주사 — 참여 비추천":"📊 일반 발주사"}
                </span>
                <span style={{fontSize:10,color:C.txd}}>이론 낙찰률 {agEnv.win_rate||"—"}% | 데이터 {agEnv.n||"—"}건</span>
              </div>}
              {/* 매칭 결과 (개찰 후) */}
              {matchResult&&<div style={{padding:"10px 16px",borderTop:"1px solid "+C.bdr+"55",
                background:matchResult==="win"?"rgba(93,202,165,0.08)":matchResult==="invalid"?"rgba(226,75,74,0.08)":"rgba(212,168,52,0.08)"}}>
                <div style={{fontSize:11,fontWeight:600,color:matchResult==="win"?"#5dca96":matchResult==="invalid"?"#e24b4a":"#d4a834",marginBottom:4}}>
                  {matchResult==="win"&&"✓ 이 금액으로 낙찰 가능했습니다"}
                  {matchResult==="higher"&&"✗ 실제 1위보다 높아 낙찰 불가 — 다음 투찰 시 낮추기"}
                  {matchResult==="invalid"&&"⚠ 하한율 미달 — 투찰 무효 위험"}
                </div>
                <div style={{fontSize:11,color:C.txm,display:"flex",gap:16}}>
                  {ab&&<span>실제 1위: <span style={{color:C.txt,fontFamily:"monospace"}}>{tc(ab)}원</span></span>}
                  {finalAdj!=null&&d.actual_adj_rate!=null&&<span>예측 오차: <span style={{color:Math.abs(Number(finalAdj)-Number(d.actual_adj_rate))<0.3?"#5dca96":"#d4a834",fontFamily:"monospace"}}>{(Number(finalAdj)-Number(d.actual_adj_rate))>=0?"+":""}{(Number(finalAdj)-Number(d.actual_adj_rate)).toFixed(4)}%</span></span>}
                  {winBid&&ab&&matchResult==="higher"&&<span>초과: <span style={{color:"#d4a834",fontFamily:"monospace"}}>+{tc(winBid-ab)}원</span></span>}
                </div>
              </div>}
            </div>
          })()}

          {/* 탭 네비게이션 */}
          <div style={{display:"flex",gap:2,borderBottom:"1px solid "+C.bdr,marginBottom:14}}>
            {[
              {k:"detail",label:"📊 상세"},
              {k:"strategy",label:"🎯 전략옵션"},
              {k:"ai",label:"🤖 AI 분석"},
              {k:"pattern",label:"📈 기관패턴"},
              {k:"info",label:"ℹ️ 기본정보"}
            ].map(t=><button key={t.k} onClick={()=>setDetailTab(t.k)} style={{
              padding:"8px 12px",fontSize:11,background:"none",border:"none",cursor:"pointer",
              color:detailTab===t.k?C.gold:C.txm,fontWeight:detailTab===t.k?600:400,
              borderBottom:detailTab===t.k?"2px solid "+C.gold:"2px solid transparent",
              marginBottom:-1}}>{t.label}</button>)}
          </div>

          {/* 탭 컨텐츠 */}
          {/* ───────── 상세 탭 ───────── */}
          {detailTab==="detail"&&<div>
            {/* 예측 vs 실제 비교 테이블 (pa는 편향 보정 전 순수 통계 예측값) */}
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,marginBottom:14}}>
              <thead><tr style={{background:C.bg3}}>
                {["항목","순수예측","실제","차이"].map((h,i)=><th key={i} style={{padding:"7px 8px",textAlign:i>=1?"right":"left",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:11}}>{h}</th>)}
              </tr></thead>
              <tbody>
                <tr style={{borderBottom:"1px solid "+C.bdr}}>
                  <td style={{padding:"6px 8px",color:C.txm}}>사정률(100%)</td>
                  <td style={{padding:"6px 8px",textAlign:"right",color:"#5dca96",fontWeight:500,fontFamily:"monospace"}}>{pa!=null?(100+pa).toFixed(4)+"%":"—"}</td>
                  <td style={{padding:"6px 8px",textAlign:"right",color:C.gold,fontWeight:500,fontFamily:"monospace"}}>{aa!=null?(100+aa).toFixed(4)+"%":"—"}</td>
                  <td style={{padding:"6px 8px",textAlign:"right",color:errAbs!=null?(errAbs<0.3?"#5dca96":errAbs<1?"#d4a834":"#e24b4a"):C.txd,fontWeight:600,fontFamily:"monospace"}}>{err!=null?err.toFixed(4)+"%":"—"}</td>
                </tr>
                <tr style={{borderBottom:"1px solid "+C.bdr}}>
                  <td style={{padding:"6px 8px",color:C.txm}}>예정가격</td>
                  <td style={{padding:"6px 8px",textAlign:"right",fontFamily:"monospace"}}>{pxp?tc(pxp):"—"}</td>
                  <td style={{padding:"6px 8px",textAlign:"right",fontFamily:"monospace"}}>{axp?tc(axp):"—"}</td>
                  <td style={{padding:"6px 8px",textAlign:"right",fontFamily:"monospace",fontSize:11}}>{pxp&&axp?tc(Math.round(pxp-axp)):""}</td>
                </tr>
                <tr style={{borderBottom:"1px solid "+C.bdr}}>
                  <td style={{padding:"6px 8px",color:C.txm}}>투찰금액 (1순위)</td>
                  <td style={{padding:"6px 8px",textAlign:"right",fontFamily:"monospace",color:C.gold,fontWeight:600}}>{pb?tc(pb):"—"}</td>
                  <td style={{padding:"6px 8px",textAlign:"right",fontFamily:"monospace"}}>{ab?tc(ab):"—"}</td>
                  <td style={{padding:"6px 8px",textAlign:"right",fontFamily:"monospace",fontSize:11}}>{pb&&ab?tc(Math.round(pb-ab)):""}</td>
                </tr>
                <tr style={{borderBottom:"1px solid "+C.bdr}}>
                  <td style={{padding:"6px 8px",color:C.txm}}>투찰율</td>
                  <td style={{padding:"6px 8px",textAlign:"right",color:"#85b7eb",fontFamily:"monospace"}}>{pBR!=null?pBR.toFixed(4)+"%":"—"}</td>
                  <td style={{padding:"6px 8px",textAlign:"right",color:"#85b7eb",fontFamily:"monospace"}}>{aBR!=null?aBR.toFixed(4)+"%":"—"}</td>
                  <td style={{padding:"6px 8px",textAlign:"right",fontSize:11,fontFamily:"monospace"}}>{pBR!=null&&aBR!=null?(pBR-aBR).toFixed(4)+"%":""}</td>
                </tr>
              </tbody>
            </table>

            {/* ROI 등급 산정 이유 */}
            {sc&&(()=>{
              const em=Number(sc.expected_margin);const ev=Number(sc.expected_value);
              const at=d.at||"기타";const amt=Number(d.ep||d.ba||0);
              const tier=amt<3e8?"S":amt<1e9?"M":"L";
              const tierLabel={S:"3억 미만",M:"3~10억",L:"10억 이상"}[tier];
              const od=d.open_date;
              const dow=od?["일","월","화","수","목","금","토"][new Date(od).getDay()]:null;
              const isPeakDay=dow&&["화","수","목"].includes(dow);
              const isInvalid=(d.pn||"").match(/\[(취소|중지|재공고|정정|연기)\]/);
              const isAvoid=at==="수자원공사"||(at==="교육청"&&tier==="L")||(at==="조달청"&&tier==="S");
              let reasons=[];
              if(isInvalid){reasons.push(`⚠️ 공고에 "${isInvalid[1]}" 표시 → D등급 강제`)}
              else if(isAvoid){reasons.push(`⚠️ ${at}-${tier} 회피존 → 강제 차단`)}
              else{
                reasons.push(`📊 ${at}-${tierLabel} 매트릭스 베이스 확률 적용`);
                if(isPeakDay)reasons.push(`📅 ${dow}요일 개찰 → +10% 보정`);
              }
              return<div style={{padding:"12px 14px",background:C.bg3,borderRadius:8}}>
                <div style={{fontSize:11,color:C.txm,fontWeight:600,marginBottom:8}}>🎯 ROI 등급 산정 이유</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                  <div style={{fontSize:11,color:C.txm}}>기대 마진: <span style={{color:C.gold,fontFamily:"monospace",fontWeight:600}}>{tc(em)}원</span></div>
                  <div style={{fontSize:11,color:C.txm}}>기대값: <span style={{color:"#5dca96",fontFamily:"monospace",fontWeight:600}}>{tc(ev)}원</span></div>
                </div>
                {reasons.map((r,i)=><div key={i} style={{fontSize:10,color:C.txt,marginBottom:3,lineHeight:1.5}}>{r}</div>)}
                <div style={{fontSize:10,color:C.txd,marginTop:8,paddingTop:8,borderTop:"1px solid "+C.bdr}}>💡 <strong style={{color:C.txm}}>{sc.strategy_label}</strong> · 6개 신호 결합 (매트릭스+경쟁강도+시점+골드존+회피존)</div>
              </div>
            })()}
          </div>}

          {/* ───────── 전략옵션 탭 ───────── */}
          {detailTab==="strategy"&&<div>
            {/* ★ Phase 6-A: 전략옵션은 오직 opt_adj 기준 ±0.1%p (AI 혼재 제거) */}
            {/* AI 분석의 3전략 값은 "🤖 AI 분석" 탭에서만 표시 (참고용) */}
            {(()=>{
              let safeAdj,balAdj,aggrAdj,safeBid,balBid,aggrBid;
              // opt_adj 기준 고정:
              // 공격 = opt_adj - 0.10 (낙찰 가능성↑, 하한선 밑 위험↑)
              // 균형 = opt_adj 그대로 (= 리스트/메인의 "추천 사정률(100%)")
              // 안전 = opt_adj + 0.10 (하한선 여유↑)
              const base=d.opt_adj!=null?Number(d.opt_adj):(d.pred_adj_rate!=null?Number(d.pred_adj_rate):null);
              if(base!=null){
                aggrAdj=Math.round((base-0.10)*10000)/10000;
                balAdj=Math.round(base*10000)/10000;
                safeAdj=Math.round((base+0.10)*10000)/10000;
              }
              safeBid=safeAdj!=null?calcBid(safeAdj):null;
              balBid=balAdj!=null?calcBid(balAdj):null;
              aggrBid=aggrAdj!=null?calcBid(aggrAdj):null;
              const strategies=[
                {k:"aggressive",label:"공격",icon:"🔴",adj:aggrAdj,bid:aggrBid,color:"#e24b4a",desc:"낙찰가 최저 노림"},
                {k:"balanced",label:"균형 (추천)",icon:"🟡",adj:balAdj,bid:balBid,color:"#d4a834",desc:"시스템 기본 추천 = 리스트 값"},
                {k:"safe",label:"안전",icon:"🟢",adj:safeAdj,bid:safeBid,color:"#5dca96",desc:"하한선 여유 확보"}
              ];
              return<div>
                <div style={{fontSize:12,color:C.txm,marginBottom:10}}>
                  📊 추천 사정률(100%) 기준 ±0.1%p 시나리오
                  <span style={{color:C.txd,fontSize:10,marginLeft:6}}>(사정률은 100% 기준 표기)</span>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:14}}>
                  {strategies.map(s=>{
                    const isRec=s.k==="balanced";
                    return<div key={s.k} style={{padding:"12px 10px",background:isRec?s.color+"20":C.bg3,borderRadius:8,border:isRec?"2px solid "+s.color:"1px solid "+C.bdr,textAlign:"center",position:"relative"}}>
                      {isRec&&<div style={{position:"absolute",top:-9,left:"50%",transform:"translateX(-50%)",background:s.color,color:"#000",fontSize:9,fontWeight:700,padding:"2px 8px",borderRadius:3,letterSpacing:0.5}}>권장</div>}
                      <div style={{fontSize:11,color:s.color,fontWeight:700,marginBottom:8}}>{s.icon} {s.label}</div>
                      <div style={{fontSize:9,color:C.txd,marginBottom:6}}>{s.desc}</div>
                      <div style={{fontSize:15,fontWeight:700,color:C.txt,fontFamily:"monospace",marginBottom:4}}>{fmtAdj(s.adj)}</div>
                      {s.bid&&<div style={{fontSize:10,color:C.txm,fontFamily:"monospace",marginBottom:6}}>{tc(s.bid)}원</div>}
                    </div>
                  })}
                </div>
                {/* AI 분석 안내 */}
                <div style={{padding:"10px 12px",background:"rgba(168,85,247,0.06)",border:"1px solid rgba(168,85,247,0.25)",borderRadius:6,fontSize:11,color:"#c89dff",marginBottom:12,textAlign:"center"}}>
                  💡 AI의 의견이 궁금하면 <strong>🤖 AI 분석 탭</strong>을 참고하세요 (최종 추천에 영향 없음)
                </div>
                {/* 경쟁 참고 (의미 명확화) */}
                {d.rec_adj_p50!=null&&<div style={{padding:"10px 12px",background:C.bg3,borderRadius:6,fontSize:11}}>
                  <div style={{fontSize:10,color:C.txm,fontWeight:600,marginBottom:6}}>📋 경쟁자 예상 투찰 분포 (과거 낙찰자 통계)</div>
                  <div style={{display:"grid",gridTemplateColumns:"auto 1fr 1fr",gap:"4px 10px"}}>
                    <span style={{color:C.txd}}>하위 25% (P25)</span><span style={{fontFamily:"monospace"}}>{d.rec_adj_p25!=null?(100+Number(d.rec_adj_p25)).toFixed(4)+"%":"—"}</span><span style={{fontFamily:"monospace",textAlign:"right",color:C.txm}}>{d.rec_bid_p25?tc(Number(d.rec_bid_p25))+"원":"—"}</span>
                    <span style={{color:C.txd}}>중앙값 (P50)</span><span style={{fontFamily:"monospace"}}>{(100+Number(d.rec_adj_p50)).toFixed(4)+"%"}</span><span style={{fontFamily:"monospace",textAlign:"right",color:C.txm}}>{d.rec_bid_p50?tc(Number(d.rec_bid_p50))+"원":"—"}</span>
                    <span style={{color:C.txd}}>상위 25% (P75)</span><span style={{fontFamily:"monospace"}}>{d.rec_adj_p75!=null?(100+Number(d.rec_adj_p75)).toFixed(4)+"%":"—"}</span><span style={{fontFamily:"monospace",textAlign:"right",color:C.txm}}>{d.rec_bid_p75?tc(Number(d.rec_bid_p75))+"원":"—"}</span>
                  </div>
                  <div style={{fontSize:9,color:C.txd,marginTop:6}}>※ 과거 낙찰자들의 실제 투찰 분포 (투찰 전략 아님, 참고만)</div>
                </div>}
              </div>
            })()}
          </div>}

          {/* ───────── AI 분석 탭 ───────── */}
          {detailTab==="ai"&&<div>
            {/* Claude AI 분석 실행/재실행 버튼 */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={{fontSize:12,color:"#a855f7",fontWeight:700}}>🧠 Claude AI 강화 예측</div>
              <button disabled={aiLoading} onClick={async()=>{
                try{setAiLoadingPredId(d.id);
                  const ctx=buildAiContext(d,scoringMap,biasMap,trendMap,recs);
                  const result=await callClaudeAi(ctx,null);
                  await sbSaveAiAnalysis(d.id,d.pn_no,result);
                  setAiAnalysisMap(prev=>({...prev,[d.id]:result}))
                }catch(e){alert("AI 분석 실패: "+e.message)}
                finally{setAiLoadingPredId(null)}
              }} style={{padding:"6px 14px",fontSize:11,background:"rgba(168,85,247,0.18)",border:"1px solid rgba(168,85,247,0.5)",borderRadius:6,color:"#c89dff",cursor:aiLoading?"default":"pointer",fontWeight:600}}>
                {aiLoading?"분석 중...":ai?"🔄 재분석":"🤖 Claude AI 분석"}
              </button>
            </div>
            {/* AI 분석 결과 */}
            {ai?<div>
              <div style={{fontSize:11,color:C.txt,lineHeight:1.7,marginBottom:12,padding:"12px 14px",background:"rgba(168,85,247,0.06)",borderRadius:6,borderLeft:"3px solid #a855f7"}}>{ai.ai_analysis}</div>
              {/* 결정 이유 + 주의사항 */}
              {((ai.reasons&&ai.reasons.length>0)||(ai.warnings&&ai.warnings.length>0))&&<div style={{display:"grid",gridTemplateColumns:ai.warnings&&ai.warnings.length>0?"1fr 1fr":"1fr",gap:10,marginBottom:12}}>
                {ai.reasons&&ai.reasons.length>0&&<div style={{padding:"10px 12px",background:"rgba(93,202,165,0.05)",borderRadius:6,border:"1px solid rgba(93,202,165,0.2)"}}>
                  <div style={{fontSize:10,color:"#5dca96",fontWeight:600,marginBottom:6}}>📌 결정 이유</div>
                  {ai.reasons.map((r,i)=><div key={i} style={{fontSize:11,color:C.txt,marginBottom:4,lineHeight:1.5}}>• {r}</div>)}
                </div>}
                {ai.warnings&&ai.warnings.length>0&&<div style={{padding:"10px 12px",background:"rgba(226,75,74,0.05)",borderRadius:6,border:"1px solid rgba(226,75,74,0.2)"}}>
                  <div style={{fontSize:10,color:"#e24b4a",fontWeight:600,marginBottom:6}}>⚠️ 주의사항</div>
                  {ai.warnings.map((w,i)=><div key={i} style={{fontSize:11,color:C.txt,marginBottom:4,lineHeight:1.5}}>• {w}</div>)}
                </div>}
              </div>}
            </div>:!aiLoading&&<div style={{fontSize:11,color:C.txd,padding:"20px",textAlign:"center",background:C.bg3,borderRadius:6}}>Claude AI 분석 버튼을 클릭하면 이 공고에 대한 맞춤 전략을 분석합니다</div>}
            
            {/* AI 전략 어드바이저 (레거시) */}
            <div style={{marginTop:14,paddingTop:14,borderTop:"1px solid "+C.bdr}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{fontSize:12,fontWeight:500,color:"#a8b4ff"}}>📝 AI 전략 어드바이저{d.match_status==="matched"&&detailAi?" (사후분석)":""}</div>
                {!detailAi&&<button disabled={detailAiLoading} onClick={async()=>{
                  setDetailAiLoading(true);setDetailAi("");
                  try{const isMatched=d.match_status==="matched"&&d.actual_adj_rate!=null;
                    const matchedRec=isMatched?recs.find(rc=>rc.id===Number(d.matched_record_id))||{}:{};
                    const prompt=buildAiPrompt({pn:d.pn,ag:d.ag,at:d.at,ba:ba,ep:ep,av:av,
                      pred:{adj:pa,xp:pxp,fr:Number(d.pred_floor_rate),bid:pb,src:d.pred_source||"",ci70:null,ci90:null},
                      actual:isMatched?Number(d.actual_adj_rate):null,matchedRecord:matchedRec},isMatched?"post":"initial");
                    if(!prompt)throw new Error("데이터 없음");
                    const text=await callAi(prompt);setDetailAi(text);
                    if(d.id){try{await fetch(`${SB_URL}/rest/v1/bid_predictions?id=eq.${d.id}`,{method:"PATCH",headers:{...getHdrs(),"Prefer":"return=minimal"},body:JSON.stringify({ai_advice:text})});
                      setPredictions(prev=>prev.map(p=>p.id===d.id?{...p,ai_advice:text}:p))}catch(e){}}}
                  catch(e){setDetailAi("⚠ "+e.message)}finally{setDetailAiLoading(false)}
                }} style={{padding:"4px 12px",fontSize:11,background:"rgba(168,180,255,0.1)",border:"1px solid rgba(168,180,255,0.3)",borderRadius:5,color:"#a8b4ff",cursor:detailAiLoading?"default":"pointer"}}>
                  {detailAiLoading?"분석 중...":(d.match_status==="matched"&&d.actual_adj_rate!=null?"사후 분석":"전략 분석")}
                </button>}
              </div>
              {detailAiLoading?<div style={{padding:"16px",textAlign:"center",color:"#a8b4ff",fontSize:12}}>AI 분석 중...</div>
                :detailAi?<div style={{padding:"10px 12px",background:C.bg3,borderRadius:6,fontSize:12,lineHeight:1.7,color:C.txt}} dangerouslySetInnerHTML={{__html:md2html(detailAi)}}/>
                :null}
            </div>
          </div>}

          {/* ───────── 기관 패턴 탭 ───────── */}
          {detailTab==="pattern"&&<div>
            {(()=>{
              const agRecs=recs.filter(r=>r.ag===d.ag&&r.br1&&Number(r.br1)>=95&&Number(r.br1)<=105&&r.co&&r.co!=="유찰"&&r.co!=="유찰(무)");
              if(agRecs.length<3)return<div style={{padding:"20px",textAlign:"center",color:C.txd,fontSize:11}}>이 발주기관의 낙찰 데이터가 부족합니다 (최소 3건 필요, 현재 {agRecs.length}건)</div>;
              const dec=adjPatDec;
              const mul=Math.pow(10,dec);
              const freqMap={};
              for(const r of agRecs){
                const adj=Math.round((Number(r.br1)-100)*mul)/mul;
                freqMap[adj]=(freqMap[adj]||0)+1;
              }
              const allSorted=Object.entries(freqMap).map(([k,v])=>({adj:Number(k),cnt:v})).sort((a,b)=>b.cnt-a.cnt);
              const multi=allSorted.filter(s=>s.cnt>=2);
              const showList=multi.length>=10?multi.slice(0,30):allSorted.slice(0,Math.max(10,multi.length));
              if(showList.length===0)return<div style={{padding:"20px",textAlign:"center",color:C.txd,fontSize:11}}>패턴 데이터 없음</div>;
              const maxCnt=showList[0].cnt;
              const total=agRecs.length;
              const top3Pct=Math.round((showList.slice(0,3).reduce((s,x)=>s+x.cnt,0))/total*100);
              const topAdj=showList[0].adj;
              return<div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <div style={{fontSize:12,fontWeight:500,color:"#85b7eb"}}>{d.ag} — 1위 사정률 패턴 ({total}건)</div>
                  <div style={{display:"flex",gap:3}}>
                    {[2,3,4].map(v=><button key={v} onClick={()=>setAdjPatDec(v)}
                      style={{padding:"3px 8px",fontSize:10,borderRadius:3,cursor:"pointer",
                        background:dec===v?"rgba(133,183,235,0.25)":"transparent",
                        border:dec===v?"1px solid #85b7eb":"1px solid "+C.bdr,
                        color:dec===v?"#85b7eb":C.txm}}>{v}자리</button>)}
                  </div>
                </div>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                  <thead><tr style={{background:C.bg3}}>
                    <th style={{padding:"5px 6px",textAlign:"center",color:C.txm,borderBottom:"1px solid "+C.bdr,width:"8%"}}>순위</th>
                    <th style={{padding:"5px 6px",textAlign:"right",color:C.txm,borderBottom:"1px solid "+C.bdr,width:"30%"}}>사정률</th>
                    <th style={{padding:"5px 6px",textAlign:"right",color:C.txm,borderBottom:"1px solid "+C.bdr,width:"12%"}}>횟수</th>
                    <th style={{padding:"5px 6px",textAlign:"right",color:C.txm,borderBottom:"1px solid "+C.bdr,width:"12%"}}>비율</th>
                    <th style={{padding:"5px 6px",textAlign:"left",color:C.txm,borderBottom:"1px solid "+C.bdr,width:"38%"}}></th>
                  </tr></thead>
                  <tbody>{showList.map((s,i)=>{
                    const pct=Math.round(s.cnt/total*1000)/10;
                    const barW=Math.max(Math.round(s.cnt/maxCnt*100),2);
                    const isTop=i===0;
                    return<tr key={i} style={{borderBottom:"1px solid "+C.bdr+"44"}}>
                      <td style={{padding:"4px 6px",textAlign:"center",color:isTop?"#85b7eb":C.txm,fontWeight:isTop?600:400}}>{i+1}</td>
                      <td style={{padding:"4px 6px",textAlign:"right",fontFamily:"monospace",fontSize:11,color:isTop?"#85b7eb":C.txt,fontWeight:isTop?600:400}}>{(100+s.adj).toFixed(dec)}% <span style={{color:C.txd,fontSize:9}}>({s.adj>=0?"+":""}{s.adj.toFixed(dec)})</span></td>
                      <td style={{padding:"4px 6px",textAlign:"right",color:C.txt,fontWeight:s.cnt>=3?600:400}}>{s.cnt}회</td>
                      <td style={{padding:"4px 6px",textAlign:"right",color:C.txm}}>{pct}%</td>
                      <td style={{padding:"4px 6px"}}><div style={{height:10,borderRadius:3,background:"rgba(133,183,235,"+((0.15+0.85*s.cnt/maxCnt).toFixed(2))+")",width:barW+"%"}}/></td>
                    </tr>})}</tbody>
                </table>
                <div style={{marginTop:8,fontSize:10,color:C.txm}}>💡 사정률 <span style={{color:"#85b7eb",fontWeight:500}}>{(100+topAdj).toFixed(dec)}%</span>이 {showList[0].cnt}회로 가장 많으며, 상위 3개에 <span style={{color:"#85b7eb",fontWeight:500}}>{top3Pct}%</span> 집중</div>
              </div>
            })()}
          </div>}

          {/* ───────── 기본정보 탭 ───────── */}
          {detailTab==="info"&&<div>
            <div style={{padding:"14px 16px",background:C.bg3,borderRadius:8}}>
              <div style={{fontSize:11,color:C.txm,fontWeight:600,marginBottom:10}}>📋 입찰 기본 정보</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px 20px",fontSize:12}}>
                <div style={{color:C.txm}}>공고번호: <span style={{color:C.txt,fontFamily:"monospace",fontSize:11}}>{d.pn_no||"—"}</span></div>
                <div style={{color:C.txm}}>발주기관: <span style={{color:C.txt}}>{d.ag||"—"}</span></div>
                <div style={{color:C.txm}}>기관유형: <span style={{color:C.txt}}>{d.at||"—"}</span></div>
                <div style={{color:C.txm}}>개찰일: <span style={{color:C.txt}}>{d.open_date||"—"}</span></div>
                <div style={{color:C.txm}}>기초금액: <span style={{color:C.txt,fontFamily:"monospace"}}>{ba?tc(ba)+"원":"—"}</span></div>
                <div style={{color:C.txm}}>추정가격: <span style={{color:C.txt,fontFamily:"monospace"}}>{ep?tc(ep)+"원":"—"}</span></div>
                <div style={{color:C.txm}}>A값: <span style={{color:C.txt,fontFamily:"monospace"}}>{av?tc(av)+"원":"없음"}</span></div>
                <div style={{color:C.txm}}>낙찰하한율: <span style={{color:C.txt,fontFamily:"monospace"}}>{d.pred_floor_rate||"—"}%</span></div>
              </div>
              {d.pred_source&&<div style={{marginTop:12,paddingTop:10,borderTop:"1px solid "+C.bdr,fontSize:11,color:C.txm}}>
                예측 근거: <span style={{color:C.txt}}>{d.pred_source}</span>
              </div>}
              {d.actual_winner&&<div style={{marginTop:6,fontSize:11,color:C.txm}}>
                1순위 업체: <span style={{color:"#5dca96",fontWeight:500}}>{d.actual_winner}</span>
                {d.actual_participant_count&&<span style={{color:C.txd,marginLeft:8}}>(참여 {d.actual_participant_count}개사)</span>}
              </div>}
            </div>
          </div>}
        </div>
      </div>})()}


      {/* 상단: 파일 업로드 + 수동 시뮬레이션 토글 */}
      <div style={{display:"grid",gridTemplateColumns:showSim?"1fr 1fr":"1fr",gap:12,marginBottom:16}}>
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
        {/* 수동 시뮬레이션 (토글) */}
        {showSim&&<div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,padding:16}}>
          <div style={{fontSize:12,fontWeight:600,color:C.gold,marginBottom:10}}>빠른 시뮬레이션</div>
          <div style={{fontSize:10,color:C.txd,marginBottom:8}}>DB에 저장되지 않습니다. 일회성 조회용.</div>
          <div style={{marginBottom:6}}><div style={{fontSize:11,color:C.txm,marginBottom:3}}>발주기관</div><AgencyInput value={inp.agency} onChange={v=>setInp(p=>({...p,agency:v}))} agencies={agencyList} stats={allS.as}/></div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:6}}>
            <div><div style={{fontSize:11,color:C.txm,marginBottom:3}}>기초금액</div><NI value={inp.baseAmount} onChange={v=>setInp(p=>({...p,baseAmount:v}))}/></div>
            <div><div style={{fontSize:11,color:C.txm,marginBottom:3}}>A값</div><NI value={inp.aValue} onChange={v=>setInp(p=>({...p,aValue:v}))}/></div>
          </div>
          <button onClick={doManualPred} style={{width:"100%",padding:"8px",background:C.gold,border:"none",borderRadius:6,color:"#000",fontWeight:700,fontSize:12,cursor:"pointer"}}>시뮬레이션</button>
          {/* 시뮬레이션 결과 (통합) */}
          {pred&&<div style={{marginTop:10,padding:"10px",background:C.bg3,borderRadius:6}}>
            {/* 예측 분석 */}
            <div style={{fontSize:11,color:C.txm,marginBottom:6}}>📊 예측: 사정률 <span style={{color:"#5dca96",fontFamily:"monospace"}}>{(100+pred.adj).toFixed(4)}%</span> · 하한율 {pred.fr}% · <span style={{fontSize:10}}>{pred.src}</span></div>
            {/* Phase 12-D: 발주사 보정 표시 */}
            {pred.agencyOffset!=null&&pred.agencyN>0&&<div style={{fontSize:10,color:"#e24b4a",marginBottom:6,padding:"3px 6px",background:"rgba(226,75,74,0.06)",borderRadius:4,border:"1px solid rgba(226,75,74,0.2)"}}>
              🎯 발주사 보정: 기관유형 {pred.typeOffset>=0?"+":""}{pred.typeOffset.toFixed(3)}% <span style={{color:C.txd}}>+</span> <span style={{color:"#e24b4a",fontWeight:600}}>발주사 {pred.agencyOffset>=0?"+":""}{pred.agencyOffset.toFixed(3)}%</span> <span style={{color:C.txd}}>(샘플 {pred.agencyN}건)</span> = 최종 {pred.optOffset>=0?"+":""}{pred.optOffset.toFixed(3)}%
            </div>}
            {/* ★ 추천 투찰 (메인) */}
            <div style={{padding:"10px 12px",background:"rgba(212,168,52,0.08)",border:"1px solid rgba(212,168,52,0.25)",borderRadius:6,marginBottom:8}}>
              <div style={{fontSize:12,fontWeight:600,color:C.gold,marginBottom:6}}>★ 추천 투찰</div>
              <div style={{textAlign:"center",marginBottom:6}}>
                <div style={{fontSize:18,fontWeight:700,color:C.gold,fontFamily:"monospace"}}>{pred.optAdj!=null?(100+pred.optAdj).toFixed(4)+"%":"—"}</div>
                <div style={{fontSize:16,fontWeight:700,color:C.gold,fontFamily:"monospace"}}>{pred.optBid?tc(pred.optBid)+"원":tc(pred.bid)+"원"}</div>
                {pred.optXp>0&&pred.optBid&&<div style={{fontSize:10,color:"#85b7eb"}}>투찰율 {(pred.optBid/pred.optXp*100).toFixed(4)}%</div>}
              </div>
              {/* 조정 범위 */}
              <div style={{background:C.bg,borderRadius:6,padding:"6px 8px",fontSize:11}}>
                <div style={{display:"grid",gridTemplateColumns:"auto 1fr 1fr",gap:"3px 8px",alignItems:"center"}}>
                  <span style={{color:"#e24b4a",fontSize:10}}>적극적</span>
                  <span style={{fontFamily:"monospace",color:C.txt}}>{pred.optAdj!=null?(100+pred.optAdj-0.05).toFixed(4)+"%":"—"}</span>
                  <span style={{fontFamily:"monospace",color:C.txm,textAlign:"right"}}>{pred.optBid?tc(Math.round(pred.optBid-tn(inp.baseAmount)*0.0005))+"원":"—"}</span>
                  <span style={{color:C.gold,fontSize:10,fontWeight:600}}>● 기본</span>
                  <span style={{fontFamily:"monospace",color:C.gold,fontWeight:600}}>{pred.optAdj!=null?(100+pred.optAdj).toFixed(4)+"%":"—"}</span>
                  <span style={{fontFamily:"monospace",color:C.gold,fontWeight:600,textAlign:"right"}}>{pred.optBid?tc(pred.optBid)+"원":tc(pred.bid)+"원"}</span>
                  <span style={{color:"#5dca96",fontSize:10}}>안전</span>
                  <span style={{fontFamily:"monospace",color:C.txt}}>{(100+pred.adj).toFixed(4)+"%"}</span>
                  <span style={{fontFamily:"monospace",color:C.txm,textAlign:"right"}}>{tc(pred.bid)}원</span>
                </div>
              </div>
            </div>
            {/* AI 시뮬레이션 */}
            <div style={{borderTop:"1px solid "+C.bdr,paddingTop:8}}>
              <button disabled={aiLoading} onClick={async()=>{
                setAiLoading(true);setAiAdvice("");
                try{const prompt=buildAiPrompt({pn:"시뮬레이션: "+inp.agency,ag:inp.agency.trim(),at:clsAg(inp.agency),ba:tn(inp.baseAmount),ep:tn(inp.estimatedPrice),av:tn(inp.aValue),pred});
                  if(!prompt)throw new Error("데이터 없음");const text=await callAi(prompt);setAiAdvice(text)}
                catch(e){setAiAdvice("⚠ "+e.message)}finally{setAiLoading(false)}
              }} style={{padding:"3px 10px",fontSize:10,background:"rgba(168,180,255,0.1)",border:"1px solid rgba(168,180,255,0.3)",borderRadius:4,color:"#a8b4ff",cursor:aiLoading?"default":"pointer",marginBottom:6}}>
                {aiLoading?"분석 중...":"AI 전략 분석"}
              </button>
              {aiAdvice&&<div style={{fontSize:12,lineHeight:1.7,color:C.txt}} dangerouslySetInnerHTML={{__html:md2html(aiAdvice)}}/>}
            </div>
            {/* 경쟁 참고 (접기) — 사정률은 100% 기준 */}
            {manualRec&&<details style={{marginTop:6}}>
              <summary style={{fontSize:10,color:C.txd,cursor:"pointer"}}>📋 경쟁 참고 — 사정률(100%) 시나리오</summary>
              <div style={{padding:"6px 8px",background:C.bg,borderRadius:6,marginTop:4,fontSize:11,display:"grid",gridTemplateColumns:"auto 1fr 1fr",gap:"3px 8px"}}>
                <span style={{color:C.txd}}>공격</span><span style={{fontFamily:"monospace"}}>{(100+manualRec.aggressive.adj).toFixed(4)}%</span><span style={{fontFamily:"monospace",textAlign:"right"}}>{tc(manualRec.aggressive.bid)}원</span>
                <span style={{color:C.txd}}>균형</span><span style={{fontFamily:"monospace"}}>{(100+manualRec.balanced.adj).toFixed(4)}%</span><span style={{fontFamily:"monospace",textAlign:"right"}}>{tc(manualRec.balanced.bid)}원</span>
                <span style={{color:C.txd}}>보수</span><span style={{fontFamily:"monospace"}}>{(100+manualRec.conservative.adj).toFixed(4)}%</span><span style={{fontFamily:"monospace",textAlign:"right"}}>{tc(manualRec.conservative.bid)}원</span>
              </div>
            </details>}
          </div>}
        </div>}
      </div>
      {/* 시뮬레이션 토글 */}
      <div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",marginTop:-10,marginBottom:10}}>
        <button onClick={()=>{setShowSim(!showSim);if(showSim){setPred(null);setAiAdvice("")}}} style={{padding:"3px 10px",fontSize:10,background:showSim?"rgba(212,168,52,0.1)":"transparent",border:"1px solid "+(showSim?C.gold+"44":C.bdr),borderRadius:5,color:showSim?C.gold:C.txd,cursor:"pointer"}}>
          {showSim?"시뮬레이션 닫기":"빠른 시뮬레이션"}
        </button>
      </div>

      {/* 모델 성능 카드 (간략) */}
      {compStats.matched>=3&&<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
        {[{l:"MAE",v:compStats.avgErr.toFixed(4)+"%",c:"#d4a834"},{l:"Bias",v:(compStats.bias>=0?"+":"")+compStats.bias.toFixed(4)+"%",c:Math.abs(compStats.bias)<0.1?"#5dca96":"#e24b4a"},{l:"±0.5% 적중",v:Math.round(compStats.within05/compStats.matched*100)+"%",c:"#5dca96"},{l:"매칭",v:compStats.matched+"건",c:C.txm}].map((c,i)=>
          <div key={i} style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,padding:"8px",textAlign:"center"}}>
            <div style={{fontSize:10,color:C.txd}}>{c.l}</div>
            <div style={{fontSize:15,fontWeight:600,color:c.c}}>{c.v}</div>
          </div>)}
      </div>}
      {/* ★ 전략별 성과 모니터링 */}
      {(()=>{const matchedWithRec=predictions.filter(p=>p.match_status==="matched"&&p.rec_1st_possible);
        if(matchedWithRec.length<1)return null;
        const counts={existing:0,aggressive:0,balanced:0,conservative:0,any:0};
        matchedWithRec.forEach(p=>{try{const j=JSON.parse(p.rec_1st_possible);
          if(j.existing)counts.existing++;if(j.aggressive)counts.aggressive++;if(j.balanced)counts.balanced++;if(j.conservative)counts.conservative++;
          if(j.existing||j.aggressive||j.balanced||j.conservative)counts.any++}catch(e){}});
        const n=matchedWithRec.length;const pct=v=>Math.round(v/n*100);
        return<div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6,marginBottom:12}}>
          {[{l:"기존 예측",v:pct(counts.existing)+"%",s:counts.existing+"건",c:C.txm},
            {l:"공격 전략",v:pct(counts.aggressive)+"%",s:counts.aggressive+"건",c:"#e24b4a"},
            {l:"균형 전략",v:pct(counts.balanced)+"%",s:counts.balanced+"건",c:C.gold},
            {l:"보수 전략",v:pct(counts.conservative)+"%",s:counts.conservative+"건",c:"#5dca96"},
            {l:"병행 최선",v:pct(counts.any)+"%",s:counts.any+"/"+n+"건",c:"#a8b4ff"}
          ].map((c,i)=><div key={i} style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,padding:"6px",textAlign:"center"}}>
            <div style={{fontSize:9,color:C.txd}}>{c.l}</div>
            <div style={{fontSize:14,fontWeight:600,color:c.c}}>{c.v}</div>
            <div style={{fontSize:9,color:C.txd}}>{c.s}</div>
          </div>)}
        </div>})()}

      {/* ★ 통합 예측 리스트 (file_upload 건 + 매칭 건) */}
      <div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,padding:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
          <div style={{fontSize:13,fontWeight:600,color:C.gold}}>예측 내역 ({compStats.total}건)</div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <button onClick={()=>{
              const wb=XLSX.utils.book_new();
              const data=compList.map(p=>{
                const finalRec=getFinalRecommendation(p);
                const finalAdj=finalRec.adj;const finalBid=finalRec.bid;
                const optWin=finalBid!=null&&p.actual_bid_amount!=null&&p.actual_expected_price!=null&&p.pred_floor_rate!=null&&Number(finalBid)<=Number(p.actual_bid_amount)&&Number(finalBid)>=Number(p.actual_expected_price)*Number(p.pred_floor_rate)/100;
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
                  // ★ Phase 6-A: 추천은 opt_adj 단일 소스
                  "추천 사정률(100%)":finalAdj!=null?(100+Number(finalAdj)).toFixed(4):"",
                  "추천 투찰금액":finalBid||"",
                  "추천근거":finalRec.source||"",
                  // 참고: 순수 통계 예측 (편향 보정 전)
                  "순수예측 사정률(100%)":p.pred_adj_rate!=null?(100+Number(p.pred_adj_rate)).toFixed(4):"",
                  "순수예측 투찰금액":p.pred_bid_amount||"",
                  "예측소스":p.pred_source||"",
                  // 입찰 후 결과
                  "실제 1위 사정률(100%)":p.actual_adj_rate!=null?(100+Number(p.actual_adj_rate)).toFixed(4):"",
                  "오차(추천-실제)":finalAdj!=null&&p.actual_adj_rate!=null?(Number(finalAdj)-Number(p.actual_adj_rate)).toFixed(4):"",
                  "실제1위금액":p.actual_bid_amount||"",
                  "실제1위업체":p.actual_winner||"",
                  "참여업체수":p.actual_participant_count||"",
                  "매칭상태":p.match_status||"",
                  "낙찰가능":p.match_status==="matched"?(optWin?"✓":"✗"):""
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
          {compStats.expired>0&&<button onClick={()=>{setCompFilter("expired");setPredListShow(50)}} style={btnS(compFilter==="expired","#666680")}>만료 ({compStats.expired})</button>}
          <label style={{display:"flex",alignItems:"center",gap:4,marginLeft:8,cursor:"pointer",fontSize:10,color:hideYuchal?C.txd:"#e24b4a"}}>
            <input type="checkbox" checked={hideYuchal} onChange={e=>{setHideYuchal(e.target.checked);setPredListShow(50)}} style={{accentColor:"#e24b4a",width:12,height:12}}/>
            <span>유찰 숨김 ({predictions.filter(p=>p.actual_winner&&(p.actual_winner==="유찰"||p.actual_winner==="유찰(무)")).length}건)</span>
          </label>
          <label style={{display:"flex",alignItems:"center",gap:4,cursor:"pointer",fontSize:10,color:hideSuui?C.txd:"#d4a834"}}>
            <input type="checkbox" checked={hideSuui} onChange={e=>{setHideSuui(e.target.checked);setPredListShow(50)}} style={{accentColor:"#d4a834",width:12,height:12}}/>
            <span>수의 숨김 ({predictions.filter(p=>{const y=p.actual_winner&&(p.actual_winner==="유찰"||p.actual_winner==="유찰(무)");return !y&&p.match_status==="matched"&&p.actual_adj_rate==null&&p.actual_winner!=null&&p.actual_winner!==""}).length}건)</span>
          </label>
        </div>
        {/* Phase 12-C: 발주사별 낙찰 예측 대시보드 */}
        {(()=>{
          const pending=predictions.filter(p=>p.match_status==="pending"&&p.match_status!=="expired");
          const assessed=pending.map(p=>assessPrediction(p,agencyStats,agencyPred)).filter(a=>a);
          const tierCounts={1:0,2:0,3:0,4:0,5:0,null:0};
          let expectedWins=0;let primaryCount=0;
          assessed.forEach(a=>{
            if(a.tier==null)tierCounts.null++;
            else tierCounts[a.tier]++;
            if(a.win_rate)expectedWins+=Number(a.win_rate)/100;
            if(a.tier&&a.tier<=2)primaryCount++;
          });
          return<div style={{marginBottom:10,padding:"10px 12px",background:"linear-gradient(90deg, rgba(226,75,74,0.06), rgba(93,202,150,0.06))",borderRadius:8,border:"1px solid "+C.bdr}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8,flexWrap:"wrap",gap:8}}>
              <div style={{fontSize:11,fontWeight:600,color:C.gold,letterSpacing:0.5}}>🎯 발주사별 낙찰 예측 · pending {pending.length}건 기준</div>
              <div style={{display:"flex",gap:10,alignItems:"center"}}>
                <label style={{display:"flex",alignItems:"center",gap:4,cursor:"pointer",fontSize:10,color:hideP5?"#5dca96":C.txd}}>
                  <input type="checkbox" checked={hideP5} onChange={e=>{setHideP5(e.target.checked);setPredListShow(50)}} style={{accentColor:"#5dca96",width:12,height:12}}/>
                  <span>P5 숨김 ({tierCounts[5]}건)</span>
                </label>
                <label style={{display:"flex",alignItems:"center",gap:4,cursor:"pointer",fontSize:10,color:onlyPrimary?"#e24b4a":C.txd}}>
                  <input type="checkbox" checked={onlyPrimary} onChange={e=>{setOnlyPrimary(e.target.checked);setPredListShow(50)}} style={{accentColor:"#e24b4a",width:12,height:12}}/>
                  <span>P1~P2만 ({primaryCount}건)</span>
                </label>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:6}}>
              {[
                {l:"🏆 P1",v:tierCounts[1],c:"#e24b4a",sub:"20%+"},
                {l:"⭐ P2",v:tierCounts[2],c:"#ff9933",sub:"13~20%"},
                {l:"📊 P3",v:tierCounts[3],c:"#5b9dd9",sub:"7~13%"},
                {l:"⚠️ P4",v:tierCounts[4],c:"#a8a8ff",sub:"3~7%"},
                {l:"⛔ P5",v:tierCounts[5],c:"#666680",sub:"~2%"},
                {l:"❓ 미분류",v:tierCounts.null,c:C.txd,sub:"샘플 부족"},
                {l:"📈 기대 낙찰",v:expectedWins.toFixed(1),c:"#5dca96",sub:"이론 합계",unit:"건"}
              ].map((c,i)=>
                <div key={i} style={{background:C.bg3,border:"1px solid "+c.c+"33",borderRadius:6,padding:"6px 4px",textAlign:"center"}}>
                  <div style={{fontSize:9,color:C.txd,marginBottom:2}}>{c.l}</div>
                  <div style={{fontSize:16,fontWeight:700,color:c.c,fontFamily:"monospace"}}>{c.v}{c.unit||""}</div>
                  <div style={{fontSize:8,color:C.txd}}>{c.sub}</div>
                </div>
              )}
            </div>
            {Object.keys(agencyStats).length===0&&<div style={{fontSize:10,color:"#e24b4a",marginTop:6,textAlign:"center"}}>⚠️ agency_win_stats 로드 실패 — 다시 시도 중</div>}
          </div>
        })()}
        {/* Phase 14-3: 분산 투찰 시뮬레이터 요약 */}
        {(()=>{
          const pending=predictions.filter(p=>p.match_status==="pending");
          const sims=pending.map(p=>simulatorMap[p.id]).filter(s=>s);
          if(sims.length===0)return null;
          const strong=sims.filter(s=>s.strategy_label==="split_strong");
          const consider=sims.filter(s=>s.strategy_label==="split_consider");
          const lowSample=sims.filter(s=>s.strategy_label==="low_sample");
          const totalGain=strong.reduce((a,s)=>a+(Number(s.ev_gain_eok)||0),0)
                        + consider.reduce((a,s)=>a+(Number(s.ev_gain_eok)||0),0);
          // Top 5 strong
          const top5=[...strong].sort((a,b)=>(Number(b.ev_gain_eok)||0)-(Number(a.ev_gain_eok)||0)).slice(0,5);
          const top5Pids=new Set(top5.map(s=>s.prediction_id));
          const top5Preds=pending.filter(p=>top5Pids.has(p.id));
          return<div style={{marginBottom:10,padding:"10px 12px",background:"linear-gradient(90deg, rgba(226,75,74,0.06), rgba(91,157,217,0.06))",borderRadius:8,border:"1px solid "+C.bdr}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8,flexWrap:"wrap",gap:8}}>
              <div style={{fontSize:11,fontWeight:600,color:"#e24b4a",letterSpacing:0.5}}>
                🔥 분산 투찰 시뮬레이터 · pending {sims.length}건 분석
              </div>
              <div style={{fontSize:10,color:C.txd}}>
                EV 증가 잠재력: <span style={{color:"#5dca96",fontWeight:600,fontSize:12}}>+{totalGain.toFixed(2)}억</span>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:top5.length>0?10:0}}>
              {[
                {l:"🔥 강력 추천",v:strong.length,c:"#e24b4a",sub:"EV +300만↑"},
                {l:"📊 검토 권장",v:consider.length,c:"#5b9dd9",sub:"50%+ 개선"},
                {l:"⚠ 샘플 부족",v:lowSample.length,c:"#a8a8ff",sub:"참고용"},
                {l:"💰 합산 EV",v:"+"+totalGain.toFixed(2),c:"#5dca96",sub:"억",unit:""}
              ].map((c,i)=>
                <div key={i} style={{background:C.bg3,border:"1px solid "+c.c+"33",borderRadius:6,padding:"6px 4px",textAlign:"center"}}>
                  <div style={{fontSize:9,color:C.txd,marginBottom:2}}>{c.l}</div>
                  <div style={{fontSize:16,fontWeight:700,color:c.c,fontFamily:"monospace"}}>{c.v}{c.unit||""}</div>
                  <div style={{fontSize:8,color:C.txd}}>{c.sub}</div>
                </div>
              )}
            </div>
            {top5.length>0&&<div style={{fontSize:10,color:C.txm,marginBottom:4,fontWeight:600}}>Top {top5.length} 분산 투찰 강력 추천:</div>}
            {top5.length>0&&<div style={{display:"flex",flexDirection:"column",gap:3}}>
              {top5.map(s=>{
                const p=top5Preds.find(x=>x.id===s.prediction_id);if(!p)return null;
                const gain=Number(s.ev_gain_eok)||0;
                const gainStr=gain>=1?gain.toFixed(2)+"억":(gain*10000).toFixed(0)+"만";
                const baEok=p.ba?(Number(p.ba)/100000000).toFixed(2):"-";
                return<div key={s.prediction_id} style={{display:"flex",alignItems:"center",gap:8,fontSize:10,padding:"4px 8px",background:C.bg2,borderRadius:4,border:"1px solid "+C.bdr+"55"}}>
                  <span style={{color:C.txd,minWidth:54,fontFamily:"monospace"}}>{p.open_date||"-"}</span>
                  <span style={{color:C.txt,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={p.pn}>{p.ag} · {p.pn}</span>
                  <span style={{color:C.gold,fontFamily:"monospace",minWidth:48,textAlign:"right"}}>{baEok}억</span>
                  <span style={{color:"#5b9dd9",fontFamily:"monospace",minWidth:42,textAlign:"right"}}>{(Number(s.p_calibrated_12f)*100).toFixed(0)}%→{(Number(s.p_calibrated_split)*100).toFixed(0)}%</span>
                  <span style={{color:"#5dca96",fontWeight:600,fontFamily:"monospace",minWidth:48,textAlign:"right"}}>+{gainStr}</span>
                </div>
              })}
            </div>}
          </div>
        })()}
        {/* Phase 5: ROI 등급 필터 + 등급별 통계 */}
        <div style={{display:"flex",gap:6,marginBottom:8,alignItems:"center",flexWrap:"wrap",padding:"6px 8px",background:"linear-gradient(90deg, rgba(168,85,247,0.05), rgba(93,202,165,0.05))",borderRadius:6,border:"1px solid "+C.bdr}}>
          <span style={{fontSize:10,color:C.txm,fontWeight:600,marginRight:4}}>🎯 ROI 등급:</span>
          {(()=>{const counts={S:0,A:0,B:0,C:0,D:0};predictions.forEach(p=>{const g=scoringMap[p.id]?.roi_grade||"D";counts[g]=(counts[g]||0)+1});return null})()}
          <button onClick={()=>{setGradeFilter("all");setPredListShow(50)}} style={btnS(gradeFilter==="all","#a8b4ff")}>전체</button>
          <button onClick={()=>{setGradeFilter("SA");setPredListShow(50)}} style={btnS(gradeFilter==="SA","#a855f7")}>S+A만 ({predictions.filter(p=>{const g=scoringMap[p.id]?.roi_grade;return g==="S"||g==="A"}).length})</button>
          <button onClick={()=>{setGradeFilter("SAB");setPredListShow(50)}} style={btnS(gradeFilter==="SAB","#5dca96")}>S+A+B ({predictions.filter(p=>{const g=scoringMap[p.id]?.roi_grade;return g==="S"||g==="A"||g==="B"}).length})</button>
          <button onClick={()=>{setGradeFilter("notD");setPredListShow(50)}} style={btnS(gradeFilter==="notD","#d4a834")}>D 제외 ({predictions.filter(p=>(scoringMap[p.id]?.roi_grade||"D")!=="D").length})</button>
          <span style={{fontSize:9,color:C.txd,marginLeft:8}}>S(반드시) · A(우선) · B(선택) · C(여력) · D(제외)</span>
        </div>
        {/* 오차 색상 범례 */}
        <div style={{display:"flex",gap:12,marginBottom:8,padding:"4px 8px",background:C.bg3,borderRadius:6,alignItems:"center",flexWrap:"wrap"}}>
          <span style={{fontSize:10,color:C.txd}}>오차 범례:</span>
          <span style={{fontSize:10,color:"#5dca96"}}>● &lt;0.3% 우수</span>
          <span style={{fontSize:10,color:"#d4a834"}}>● 0.3~1.0% 보통</span>
          <span style={{fontSize:10,color:"#e24b4a"}}>● ≥1.0% 큰차이</span>
          <span style={{fontSize:10,color:"#e24b4a"}}>⚠ &gt;5% 이상치</span>
          <span style={{fontSize:10,color:C.txd}}>— 유찰/수의</span>
        </div>
        {compList.length>0?<div style={{overflow:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,tableLayout:"fixed"}}>
            <colgroup><col style={{width:"4%"}}/><col style={{width:"6%"}}/><col style={{width:"14%"}}/><col style={{width:"10%"}}/><col style={{width:"9%"}}/><col style={{width:"11%"}}/><col style={{width:"7%"}}/><col style={{width:"9%"}}/><col style={{width:"7%"}}/><col style={{width:"6%"}}/><col style={{width:"5%"}}/><col style={{width:"4%"}}/></colgroup>
            <thead>
              <tr><th colSpan={1} style={{padding:"4px 6px",fontSize:10,color:"#a855f7",fontWeight:500,borderBottom:"1px solid "+C.bdr+"44",textAlign:"center",letterSpacing:1}}>ROI</th>
                <th colSpan={1} style={{padding:"4px 6px",fontSize:10,color:"#e24b4a",fontWeight:500,borderBottom:"1px solid "+C.bdr+"44",textAlign:"center",letterSpacing:1}}>P12</th>
                <th colSpan={5} style={{padding:"4px 6px",fontSize:10,color:C.gold,fontWeight:500,borderBottom:"1px solid "+C.bdr+"44",textAlign:"left",letterSpacing:1}}>투찰 전 추천</th>
                <th colSpan={3} style={{padding:"4px 6px",fontSize:10,color:"#a8b4ff",fontWeight:500,borderBottom:"1px solid "+C.bdr+"44",textAlign:"left",letterSpacing:1}}>입찰 후 결과</th>
                <th colSpan={2} style={{padding:"4px 6px",fontSize:10,borderBottom:"1px solid "+C.bdr+"44"}}></th></tr>
              <tr style={{background:C.bg3}}>
              <th style={{padding:"7px 4px",textAlign:"center",color:"#a855f7",fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:11}}>등급</th>
              <th style={{padding:"7px 4px",textAlign:"center",color:"#e24b4a",fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:11}} title="발주사별 낙찰 예측 (P1~P5)">타깃</th>
              <SortTh label="공고명" sortKey="pn" current={predSort} setCurrent={setPredSort}/>
              <SortTh label="발주기관" sortKey="ag" current={predSort} setCurrent={setPredSort}/>
              <th style={{padding:"7px 4px",textAlign:"right",color:C.gold,fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:11}}>추천 사정률(100%)</th>
              <th style={{padding:"7px 4px",textAlign:"right",color:C.gold,fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:11}}>추천 투찰금</th>
              <SortTh label="개찰일" sortKey="open_date" current={predSort} setCurrent={setPredSort} align="right"/>
              <th style={{padding:"7px 4px",textAlign:"right",color:"#a8b4ff",fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:11}}>실제 1위 사정률(100%)</th>
              <th style={{padding:"7px 4px",textAlign:"right",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:11}}>오차</th>
              <SortTh label="상태" sortKey="match_status" current={predSort} setCurrent={setPredSort} align="center"/>
              <th style={{padding:"7px 4px",textAlign:"center",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:11}}>낙찰</th>
              <th style={{padding:"7px 4px",textAlign:"center",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:11}}></th>
            </tr></thead>
            <tbody>{compList.slice(0,predListShow).map(p=>{
              // Phase 5.6: 통합 최종 추천 (모달과 동일 로직: AI > Enhanced > opt_adj > pred)
              const finalRec=getFinalRecommendation(p);
              const finalAdj=finalRec.adj;const finalBid=finalRec.bid;const finalBid1st=finalRec.bid1st;
              const optErr=(finalAdj!=null&&p.actual_adj_rate!=null)?Number(finalAdj)-Number(p.actual_adj_rate):null;
              const isAnomaly=optErr!=null&&Math.abs(optErr)>5;
              const errColor=isAnomaly?"#e24b4a":optErr!=null?(Math.abs(optErr)<0.3?"#5dca96":Math.abs(optErr)<1?"#d4a834":"#e24b4a"):C.txd;
              const canWin=!isAnomaly&&finalBid!=null&&p.actual_bid_amount!=null&&p.actual_expected_price!=null&&p.pred_floor_rate!=null&&Number(finalBid)<=Number(p.actual_bid_amount)&&Number(finalBid)>=Number(p.actual_expected_price)*Number(p.pred_floor_rate)/100;
              const isYuchal=p.actual_winner&&(p.actual_winner==="유찰"||p.actual_winner==="유찰(무)");
              // 수의계약: 매칭됐지만 actual_adj_rate NULL이고 유찰 아님 (복수예가 메커니즘 미적용)
              const isSuui=!isYuchal&&p.match_status==="matched"&&p.actual_adj_rate==null&&p.actual_winner!=null&&p.actual_winner!=="";
              const sc=scoringMap[p.id];const grade=sc?.roi_grade||"D";const winProb=sc?.win_prob;
              const gradeColor={S:"#a855f7",A:"#5dca96",B:"#d4a834",C:"#a8b4ff",D:"#666680"}[grade];
              // AI 권장은 이제 최종 추천에 영향 없음 (참고용 탭에서만 확인)
              // Phase 12-C: 발주사별 낙찰 예측
              const agAsmt=assessPrediction(p,agencyStats,agencyPred);
              const sim=simulatorMap[p.id]; // Phase 14-3: 분산 투찰 시뮬레이터
              const tierStyle=agAsmt&&agAsmt.tier?TIER_STYLES[agAsmt.tier]:null;
              // P1~P2는 좌측 강조 보더, P5는 opacity 추가 감소
              const rowBorder=tierStyle&&agAsmt.tier<=2?{borderLeft:"3px solid "+tierStyle.border}:{};
              const p5Fade=agAsmt&&agAsmt.tier===5?0.55:1;
              return<tr key={p.id} style={{borderBottom:"1px solid "+C.bdr,opacity:(isAnomaly||isYuchal||isSuui?0.5:1)*p5Fade,...rowBorder}}>
                <td style={{padding:"6px",textAlign:"center"}}><span title={sc?`${sc.strategy_label} · 낙찰확률 ${(winProb*100).toFixed(1)}%`:""} style={{display:"inline-block",fontSize:10,fontWeight:700,padding:"2px 6px",borderRadius:4,background:gradeColor+"22",color:gradeColor,border:"1px solid "+gradeColor+"55",minWidth:18}}>{grade}</span></td>
                <td style={{padding:"6px 2px",textAlign:"center"}}>
                  {agAsmt&&agAsmt.tier?<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}} title={`${agAsmt.label}\n샘플 ${agAsmt.n}건\n이론 ${agAsmt.win_rate}%\n오차 ${agAsmt.mae}%`}>
                    <TierBadge tier={agAsmt.tier} compact={true}/>
                    <span style={{fontSize:9,fontFamily:"monospace",color:tierStyle?.color||C.txd,fontWeight:600}}>{agAsmt.win_rate}%</span>
                    {sim&&<SplitBadge sim={sim} compact={true}/>}
                  </div>:(sim?<div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}><span style={{fontSize:9,color:C.txd}}>-</span><SplitBadge sim={sim} compact={true}/></div>:<span style={{fontSize:9,color:C.txd}}>-</span>)}
                </td>
                <td style={{padding:"6px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={p.pn}>{p.pn}</td>
                <td style={{padding:"6px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.ag}</td>
                <td style={{padding:"6px",textAlign:"right",fontFamily:"monospace",fontSize:11,color:C.gold,fontWeight:500}} title={finalRec.source?"근거: "+finalRec.source:""}>
                  {finalAdj!=null?(100+Number(finalAdj)).toFixed(4)+"%":""}
                </td>
                <td style={{padding:"6px",textAlign:"right",fontFamily:"monospace",fontSize:11,color:C.gold,fontWeight:700}}>
                  {(finalBid1st||finalBid)?tc(Number(finalBid1st||finalBid)):""}</td>
                <td style={{padding:"6px",textAlign:"right",fontSize:11}}>{p.open_date||""}</td>
                <td style={{padding:"6px",textAlign:"right",color:isYuchal?"#e24b4a":isSuui?"#d4a834":"#a8b4ff",fontFamily:"monospace",fontSize:11}}>{isYuchal?<span style={{fontSize:10}}>유찰</span>:isSuui?<span style={{fontSize:10}}>수의</span>:p.actual_adj_rate!=null?(100+Number(p.actual_adj_rate)).toFixed(4)+"%":""}</td>
                <td style={{padding:"6px",textAlign:"right",color:errColor,fontWeight:600,fontSize:11}}>{isYuchal||isSuui?"—":isAnomaly?"⚠":optErr!=null?optErr.toFixed(4):""}</td>
                <td style={{padding:"6px",textAlign:"center"}}>{isYuchal?<span style={{fontSize:10,padding:"2px 6px",borderRadius:4,background:"rgba(226,75,74,0.1)",color:"#e24b4a"}}>유찰</span>:isSuui?<span style={{fontSize:10,padding:"2px 6px",borderRadius:4,background:"rgba(212,168,52,0.15)",color:"#d4a834"}}>수의</span>:<span style={{fontSize:10,padding:"2px 6px",borderRadius:4,background:p.match_status==="matched"?"rgba(93,202,165,0.15)":"rgba(226,75,74,0.15)",color:p.match_status==="matched"?"#5dca96":"#e24b4a"}}>{p.match_status==="matched"?"매칭":"대기"}</span>}</td>
                <td style={{padding:"6px",textAlign:"center"}}>{p.match_status==="matched"&&!isYuchal&&!isSuui?(canWin?<span style={{fontSize:9,padding:"1px 5px",borderRadius:3,background:"rgba(93,202,165,0.15)",color:"#5dca96"}}>✓</span>:<span style={{fontSize:9,color:C.txd}}>✗</span>):""}</td>
                <td style={{padding:"6px",textAlign:"center"}}><button onClick={async()=>{setDetailModal(p);setDetailTab("detail");setDetailAi(p.ai_advice||"");setDetailAiLoading(false);
                  // Phase 5.4: 저장된 AI 분석 자동 로드
                  if(!aiAnalysisMap[p.id]){
                    try{const ai=await sbFetchAiAnalysis(p.id);if(ai)setAiAnalysisMap(prev=>({...prev,[p.id]:ai}))}catch(e){}
                  }
                }} style={{padding:"2px 8px",fontSize:10,background:"rgba(168,180,255,0.1)",border:"1px solid rgba(168,180,255,0.25)",borderRadius:4,color:"#a8b4ff",cursor:"pointer"}}>상세</button></td>
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
    {tab==="notices"&&(()=>{
      const today=new Date().toISOString().slice(0,10);
      const AT_COLOR={"지자체":"#a8b4ff","교육청":"#ffb86c","군시설":"#ff79c6","한전":"#f1fa8c","조달청":"#8be9fd","LH":"#50fa7b","수자원공사":"#bd93f9"};
      const fmtOd=(iso)=>{if(!iso)return"-";const d=new Date(iso);return(d.getMonth()+1)+"/"+(d.getDate())+" "+d.getHours().toString().padStart(2,"0")+":"+d.getMinutes().toString().padStart(2,"0")};
      // 필터 적용
      const allSorted=[...notices].sort((a,b)=>a.od>b.od?1:-1);
      const filtered=noticeFilter==="upcoming"?allSorted.filter(n=>n.od&&n.od.slice(0,10)>=today):
                     noticeFilter==="registered"?allSorted.filter(n=>n.prediction_id):
                     allSorted;
      const regCnt=notices.filter(n=>n.prediction_id).length;
      const predDoneCnt=notices.filter(n=>n.prediction_id&&predMap[n.prediction_id]?.pred_adj_rate!=null).length;
      // 예측 등록 핸들러
      const handlePredictNotice=async(notice)=>{
        if(noticeLoadingIds.has(notice.id))return;
        setNoticeLoadingIds(prev=>{const s=new Set(prev);s.add(notice.id);return s});
        try{
          const result=await sbPredictNotice(notice.id);
          // notices 상태 업데이트
          setNotices(prev=>prev.map(n=>n.id===notice.id?{...n,prediction_id:result?.pred_id||n.prediction_id,is_target:true}:n));
          // predictions 새로고침
          await refreshPredictions();
        }catch(e){}
        finally{setNoticeLoadingIds(prev=>{const s=new Set(prev);s.delete(notice.id);return s})}
      };
      return<div style={{maxWidth:1200,margin:"0 auto",padding:"16px 20px"}}>
        {/* 요약 카드 */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
          {[{l:"전체 수집",v:notices.length+"건",c:C.txm},{l:"예측 등록",v:regCnt+"건",c:C.gold},{l:"예측 완료",v:predDoneCnt+"건",c:"#5dca96"},{l:"최근 수집",v:notices.length>0?fmtRelTime(notices.reduce((a,b)=>a.api_fetched_at>b.api_fetched_at?a:b).api_fetched_at):"—",c:C.txd}]
          .map((c,i)=><div key={i} style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,padding:"10px 12px",textAlign:"center"}}>
            <div style={{fontSize:10,color:C.txd,marginBottom:3}}>{c.l}</div>
            <div style={{fontSize:i===3?12:18,fontWeight:600,color:c.c}}>{c.v}</div>
          </div>)}
        </div>
        {/* 안내 메시지 */}
        <div style={{marginBottom:12,padding:"10px 14px",background:"rgba(91,157,217,0.06)",border:"1px solid rgba(91,157,217,0.2)",borderRadius:8,fontSize:11,color:"#5b9dd9"}}>
          💡 나라장터에서 자동 수집된 공고입니다. 입찰 참여할 공고의 <strong>[예측 등록]</strong> 버튼을 클릭하면 예측탭에 즉시 반영됩니다.
          군부대(UMM)·민간 발주처 공고는 기존처럼 엑셀 업로드를 이용하세요.<br/>
          <span style={{fontSize:10,color:C.txd}}>※ 과거 샘플 3건 미만 발주사는 "⚠ 데이터 부족"으로 표시 (배지 Hover 시 상세 안내)</span>
        </div>
        {/* 필터 */}
        <div style={{display:"flex",gap:6,marginBottom:10,alignItems:"center"}}>
          {[{k:"upcoming",l:"개찰 예정"},{ k:"all",l:"전체 공고"},{ k:"registered",l:"예측 등록됨"}].map(f=>
            <button key={f.k} onClick={()=>setNoticeFilter(f.k)}
              style={{padding:"5px 12px",fontSize:11,borderRadius:6,border:"1px solid "+(noticeFilter===f.k?C.gold:C.bdr),background:noticeFilter===f.k?"rgba(212,168,52,0.12)":C.bg3,color:noticeFilter===f.k?C.gold:C.txm,cursor:"pointer",fontWeight:noticeFilter===f.k?600:400}}>
              {f.l}{f.k==="upcoming"?` (${allSorted.filter(n=>n.od&&n.od.slice(0,10)>=today).length})`:f.k==="registered"?` (${regCnt})`:`(${notices.length})`}
            </button>)}
          <span style={{fontSize:10,color:C.txd,marginLeft:4}}>30분마다 자동 업데이트</span>
        </div>
        {/* 공고 테이블 */}
        <div style={{border:"1px solid "+C.bdr,borderRadius:8,overflow:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:900}}>
            <thead><tr style={{background:C.bg3}}>
              {["개찰일시","공고명","발주기관","유형","추정가격","예측 사정률","추천 투찰금","액션"].map((h,i)=>
                <th key={i} style={{padding:"8px 10px",textAlign:i>=4&&i<=6?"right":"left",color:C.txd,fontWeight:600,borderBottom:"1px solid "+C.bdr,whiteSpace:"nowrap",fontSize:10}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {filtered.length===0&&<tr><td colSpan={8} style={{padding:"24px",textAlign:"center",color:C.txd,fontSize:12}}>공고 없음</td></tr>}
              {filtered.map(n=>{
                const p=n.prediction_id?predMap[n.prediction_id]:null;
                const hasPred=p?.pred_adj_rate!=null;
                const noPred=n.prediction_id&&!hasPred; // 등록됐지만 데이터 부족
                const isLoading=noticeLoadingIds.has(n.id);
                const isUmm=n.pn_no&&(n.pn_no.startsWith("UMM")||n.pn_no.startsWith("E0"));
                const atClr=AT_COLOR[n.at]||"#a8a8ff";
                const bid1st=hasPred&&p.pred_bid_amount&&p.pred_floor_rate?
                  Math.round(Number(p.pred_bid_amount)*Number(p.pred_floor_rate)/(Number(p.pred_floor_rate)+(WIN_OPT_GAP[n.at]||0.3))):null;
                return<tr key={n.id} style={{borderBottom:"1px solid "+C.bdr+"33",opacity:n.od&&n.od.slice(0,10)<today?0.55:1,transition:"background .1s"}}
                  onMouseEnter={e=>e.currentTarget.style.background=C.bg3}
                  onMouseLeave={e=>e.currentTarget.style.background=""}>
                  <td style={{padding:"8px 10px",color:C.txt,whiteSpace:"nowrap",fontFamily:"monospace",fontSize:10}}>{fmtOd(n.od)}</td>
                  <td style={{padding:"8px 10px",color:C.txt,maxWidth:240,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={n.pn}>{n.pn}</td>
                  <td style={{padding:"8px 10px",color:C.txm,maxWidth:150,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={n.ag}>{n.ag}</td>
                  <td style={{padding:"8px 10px"}}><span style={{fontSize:9,padding:"1px 5px",background:atClr+"18",border:"1px solid "+atClr+"44",borderRadius:4,color:atClr}}>{n.at}</span></td>
                  <td style={{padding:"8px 10px",color:C.txt,textAlign:"right",fontFamily:"monospace",fontSize:10}}>{n.ep?Number(n.ep).toLocaleString():"-"}</td>
                  <td style={{padding:"8px 10px",textAlign:"right",color:hasPred?"#5dca96":C.txd,fontFamily:"monospace",fontWeight:hasPred?700:400,fontSize:10}}>
                    {hasPred?(100+Number(p.pred_adj_rate)).toFixed(4)+"%":"—"}
                  </td>
                  <td style={{padding:"8px 10px",textAlign:"right",color:hasPred?C.gold:C.txd,fontFamily:"monospace",fontWeight:hasPred?700:400,fontSize:10}}>
                    {hasPred&&bid1st?tc(bid1st):(hasPred&&p.pred_bid_amount?tc(Number(p.pred_bid_amount)):"—")}
                  </td>
                  <td style={{padding:"8px 10px",textAlign:"center",whiteSpace:"nowrap"}}>
                    {isUmm?<span style={{fontSize:9,color:C.txd}}>엑셀 업로드</span>:
                     hasPred?<button onClick={()=>{setTab("predict");}} style={{fontSize:9,padding:"3px 8px",background:"rgba(93,202,150,.1)",border:"1px solid rgba(93,202,150,.3)",borderRadius:4,color:"#5dca96",cursor:"pointer"}}>✅ 예측완료 →</button>:
                     noPred?<span title={"⚠ 데이터 부족\n이 발주사의 과거 낙찰 샘플이 3건 미만입니다.\n신규/민간/소형 기관이거나 학습 데이터가 누적되지 않았습니다.\nSUCVIEW 파일(인포21c)을 업로드해 수동 예측을 보강하세요."} style={{fontSize:9,padding:"2px 6px",background:"rgba(168,168,255,.08)",border:"1px solid rgba(168,168,255,.2)",borderRadius:4,color:"#a8a8ff",cursor:"help"}}>⚠ 데이터부족</span>:
                     isLoading?<span style={{fontSize:9,color:C.txd}}>처리중...</span>:
                     <button onClick={()=>handlePredictNotice(n)}
                       style={{fontSize:10,padding:"4px 10px",background:"rgba(91,157,217,0.1)",border:"1px solid rgba(91,157,217,0.4)",borderRadius:5,color:"#5b9dd9",cursor:"pointer",fontWeight:600}}>
                       📋 예측 등록
                     </button>}
                  </td>
                </tr>})}
            </tbody>
          </table>
        </div>
        <div style={{marginTop:8,fontSize:10,color:C.txd}}>
          UMM(군부대)·민간 공고는 나라장터 API 미제공 — 기존 엑셀 업로드 사용 |
          나라장터 공고는 예측 등록 버튼으로 즉시 처리
        </div>
      </div>})()}

    {/* ═══ Phase 20: 작전 대시보드 탭 ═══ */}
    {tab==="winstrat"&&<WinStrategyDashboard/>}

    {/* ═══ AI 상담 탭 ═══ */}
    {tab==="chat"&&(()=>{
      const downloadChat=()=>{
        const now=new Date().toISOString().slice(0,16).replace("T"," ");
        let md=`# 입찰 분석 AI 상담 기록\n> ${now}\n\n---\n\n`;
        chatMsgs.forEach(m=>{if(m.role==="user")md+=`## 질문\n${m.content}\n\n`;else md+=`## AI 답변\n${m.content}\n\n---\n\n`});
        md+=`\n---\n*입찰 분석 시스템 (Claude Opus 4.6) · ${recs.length.toLocaleString()}건 데이터 기반*\n`;
        const blob=new Blob([md],{type:"text/markdown;charset=utf-8"});const url=URL.createObjectURL(blob);
        const a=document.createElement("a");a.href=url;a.download=`AI상담_${new Date().toISOString().slice(0,10)}.md`;a.click();URL.revokeObjectURL(url)};
      return<div style={{display:"flex",height:"calc(100vh - 60px)"}}>
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
  </div></AuthGate>)}
