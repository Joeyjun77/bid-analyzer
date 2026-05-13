import { useState, useEffect } from "react";
import { C } from "../lib/constants.js";
import { sbFetchAgencyPredictionsV3, sbBatchInsertBidHistoryUpload, sbCallPredictWithHistory, sbBatchInsertBidPredictionsV3 } from "../lib/supabase.js";
import { parseFile, parseSucview, parseBidDoc, isSucviewFile, normalizeAgencyName, clsAg, eraFR, clean, pDt, sn, pnv, amountTierOf } from "../lib/utils.js";

// ─── V6-B1: 발주처 예측 탭 ────────────────────────────────────
// spec: docs/superpowers/specs/2026-05-13-agency-predictor-v6b1-mvp-design.md

function fmtP100(v,decimals=4){
  const n=Number(v);
  if(!isFinite(n))return"-";
  return n.toFixed(decimals)+"%";
}
function fmtBillion(amt,decimals=3){
  const n=Number(amt);
  if(!isFinite(n))return"-";
  return(n/1e8).toFixed(decimals)+"억";
}
function riskColor(r){
  const n=Number(r);
  if(!isFinite(n))return C.txd;
  if(n>=0.40)return"#e24b4a";
  if(n>=0.20)return"#d4a834";
  return C.txd;
}
function tierBadgeStyle(tier){
  const base={fontSize:9,padding:"1px 6px",borderRadius:4,fontWeight:600,display:"inline-block"};
  if(tier==="high")return{...base,background:"#1d3a2a",color:"#5dca96"};
  if(tier==="medium")return{...base,background:"#1d2a3a",color:"#7aa8e8"};
  if(tier==="low")return{...base,background:"#2a2a2a",color:C.txm};
  return{...base,background:"#3a2a1d",color:"#d4a834"}; // insufficient
}

// V6-B1: SUCVIEW/입찰서류함 파싱 결과 → predict_with_history 입력 행으로 변환
// 반환: {validInputs:[{bid_no,ag,canonical_ag,industry,base_amount,a_value,floor_rate,opened_at,notice_title,contract_method}], skipReasons:[{bid_no,reason}]}
function toPredictInputs(parsedRows,sourceType){
  const validInputs=[],skipReasons=[];
  for(const r of parsedRows){
    if(!r||typeof r!=="object")continue;
    const bid_no=clean(r.pn_no||r.bid_no||"");
    if(!bid_no){skipReasons.push({bid_no:"(empty)",reason:"공고번호 없음"});continue;}
    const ag=clean(r.ag||"");
    if(!ag){skipReasons.push({bid_no,reason:"발주사명 없음"});continue;}
    const ba=Number(r.ba||0);
    if(!isFinite(ba)||ba<=0){skipReasons.push({bid_no,reason:"기초금액 없음/0"});continue;}
    const av=Number(r.av||0);
    const ep=Number(r.ep||0);
    // parseBidDoc은 open_date, parseSucview는 od 필드 사용
    const od=pDt(r.od||r.open_date||"");
    const cat=clean(r.cat||r.work_cat||"");
    const at=clsAg(ag);
    const floor_rate=eraFR(at,ep>0?ep:ba,od);
    const canonical_ag=normalizeAgencyName(ag);
    validInputs.push({
      bid_no,
      ag,
      canonical_ag,
      industry:cat||null,
      base_amount:ba,
      a_value:av>0?av:null,
      floor_rate,
      opened_at:od,
      notice_title:clean(r.pn||""),
      contract_method:clean(r.contract_method||"")||null
    });
  }
  return{validInputs,skipReasons};
}

// V6-B1: 파일 1개 처리 — parseFile → format 판별 → parseSucview/parseBidDoc
// parseSucview: 단일 객체 반환 → [obj] 로 래핑
// parseBidDoc: 배열 직접 반환 (records 래퍼 없음)
async function processFile(file){
  const {rows}=await parseFile(file);
  if(isSucviewFile(rows)){
    const parsed=parseSucview(rows,file.name);
    // parseSucview는 단일 객체 반환이므로 배열로 래핑
    return{type:"SUCVIEW",rows:Array.isArray(parsed)?parsed:[parsed]};
  }
  // 입찰서류함 가정 (헤더 동적 매핑) — parseBidDoc은 배열 직접 반환
  const parsed=parseBidDoc(rows);
  if(Array.isArray(parsed)&&parsed.length){
    return{type:"BIDDOC",rows:parsed};
  }
  // 낙찰정보리스트 가능성 → 차단
  if(rows[0]&&String(rows[0][1]||"").includes("공고명")){
    throw new Error("낙찰정보리스트는 데이터탭에 업로드해주세요");
  }
  throw new Error("인식 불가 파일 형식");
}

function AgencyPredictorRow({pred}){
  return<tr style={{borderTop:"1px solid "+C.bdr}}>
    <td style={{padding:"6px 8px",fontSize:11}}>{(pred.created_at||"").slice(0,10)||"-"}</td>
    <td style={{padding:"6px 8px",fontSize:11}}>
      <div style={{fontWeight:600}}>{pred.canonical_ag||"-"}</div>
      <div style={{fontSize:9,color:C.txd}}>{pred.industry||"-"}{pred.amount_tier?" · "+pred.amount_tier:""}</div>
    </td>
    <td style={{padding:"6px 8px",fontSize:11,textAlign:"right",fontFamily:"monospace"}}>{fmtBillion(pred.base_amount,2)}</td>
    <td style={{padding:"6px 8px",fontSize:11,textAlign:"right",fontFamily:"monospace"}}>
      <div style={{fontWeight:600}}>{fmtP100(pred.predicted_ratio,4)}</div>
      <div style={{fontSize:9,color:C.txd}}>[stage {pred.signal_stage}·n={pred.sample_size_used||0}]</div>
    </td>
    <td style={{padding:"6px 8px",fontSize:11,textAlign:"right",fontFamily:"monospace"}}>
      <div>{fmtBillion(pred.strategy_aggressive_bid,3)}</div>
      <div style={{fontSize:9,color:C.txd}}>({Number(pred.aggressive_margin||0).toFixed(3)})</div>
    </td>
    <td style={{padding:"6px 8px",fontSize:11,textAlign:"right",fontFamily:"monospace"}}>
      <div>{fmtBillion(pred.strategy_balanced_bid,3)}</div>
      <div style={{fontSize:9,color:C.txd}}>({Number(pred.balanced_margin||0).toFixed(3)})</div>
    </td>
    <td style={{padding:"6px 8px",fontSize:11,textAlign:"right",fontFamily:"monospace"}}>
      <div>{fmtBillion(pred.strategy_safe_bid,3)}</div>
      <div style={{fontSize:9,color:C.txd}}>({Number(pred.safe_margin||0).toFixed(3)})</div>
    </td>
    <td style={{padding:"6px 8px",fontSize:11,textAlign:"right",fontFamily:"monospace",color:riskColor(pred.disq_risk_balanced),fontWeight:Number(pred.disq_risk_balanced||0)>=0.40?700:400}}>
      {pred.disq_risk_balanced!=null?(Number(pred.disq_risk_balanced)*100).toFixed(1)+"%":"-"}
    </td>
    <td style={{padding:"6px 8px",fontSize:11,textAlign:"center"}}>
      <span style={tierBadgeStyle(pred.confidence_tier)}>{pred.confidence_tier||"-"}</span>
    </td>
  </tr>;
}

export default function AgencyPredictorTab(){
  const [preds,setPreds]=useState(null);
  const [loading,setLoading]=useState("idle"); // idle/fetching/parsing/predicting/saving
  const [pendingInputs,setPendingInputs]=useState([]); // 업로드 후 일괄 예측 대기 행
  const [progress,setProgress]=useState({done:0,total:0});
  const [parseLogs,setParseLogs]=useState([]); // [{name, ok, success, skipped, msg}]

  async function handleFileUpload(files){
    if(!files||!files.length)return;
    setLoading("parsing");
    const logs=[],allInputs=[];
    for(const file of files){
      try{
        const {type,rows}=await processFile(file);
        const {validInputs,skipReasons}=toPredictInputs(rows,type);
        logs.push({name:file.name,ok:true,success:validInputs.length,skipped:skipReasons.length,type});
        allInputs.push(...validInputs);
      }catch(e){
        logs.push({name:file.name,ok:false,msg:e.message||"파싱 실패"});
      }
    }
    setParseLogs(logs);
    setPendingInputs(allInputs);
    setLoading("idle");
  }

  useEffect(()=>{
    let cancel=false;
    setLoading("fetching");
    sbFetchAgencyPredictionsV3(200).then(rows=>{
      if(cancel)return;
      setPreds(rows||[]);
      setLoading("idle");
    });
    return()=>{cancel=true};
  },[]);

  if(preds==null){
    return<div style={{padding:24,color:C.txd,fontSize:12}}>발주처 예측 데이터 로딩 중...</div>;
  }

  return<div>
    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12,padding:"10px 12px",background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,fontSize:12,flexWrap:"wrap"}}>
      <span style={{fontWeight:700,color:C.gold}}>💎 발주처 예측 V6</span>
      <span style={{color:C.bdr}}>|</span>
      <span>예측 대상 <strong>{preds.length}건</strong></span>
      <span style={{color:C.bdr}}>·</span>
      <span style={{color:C.txd}}>파일 업로드 + 일괄 예측은 후속 Task에서 추가됩니다</span>
    </div>
    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12,padding:"10px 12px",background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,fontSize:12,flexWrap:"wrap"}}>
      <input id="v6b1_fi" type="file" accept=".xls,.xlsx" multiple style={{display:"none"}}
        onChange={e=>{if(e.target.files?.length){handleFileUpload(e.target.files);e.target.value=""}}}/>
      <label htmlFor="v6b1_fi" style={{cursor:"pointer",padding:"6px 12px",background:C.bg3,border:"1px solid "+C.bdr,borderRadius:6,fontWeight:600}}>📁 파일 선택</label>
      <span style={{fontSize:11,color:C.txd}}>SUCVIEW / 입찰서류함 형식 (xls·xlsx, 다중 가능)</span>
      {pendingInputs.length>0&&<>
        <span style={{color:C.bdr}}>|</span>
        <span><strong>{pendingInputs.length}건</strong> 대기</span>
      </>}
      {loading==="parsing"&&<span style={{color:C.gold}}>파싱 중...</span>}
    </div>
    {parseLogs.length>0&&<div style={{padding:"8px 12px",marginBottom:12,background:C.bg2,border:"1px solid "+C.bdr,borderRadius:6,fontSize:11}}>
      <div style={{color:C.txm,marginBottom:4,fontWeight:600}}>업로드 로그</div>
      {parseLogs.map((log,i)=><div key={i} style={{color:log.ok?C.txm:"#e24b4a"}}>
        · {log.name}: {log.ok?`${log.type} · 성공 ${log.success}건${log.skipped?` · 스킵 ${log.skipped}건`:""}`:`실패 — ${log.msg}`}
      </div>)}
    </div>}
    {preds.length===0?
      <div style={{padding:24,color:C.txd,textAlign:"center",fontSize:12,background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8}}>예측 결과가 없습니다. 파일을 업로드해 첫 예측을 만들어보세요.</div>
      :
      <table style={{width:"100%",fontSize:11,borderCollapse:"collapse",background:C.bg2,border:"1px solid "+C.bdr,borderRadius:6,overflow:"hidden"}}>
        <thead><tr style={{color:C.txd,background:C.bg3}}>
          <th style={{textAlign:"left",padding:"6px 8px",fontWeight:600}}>개찰일</th>
          <th style={{textAlign:"left",padding:"6px 8px",fontWeight:600}}>발주사 / 업종</th>
          <th style={{textAlign:"right",padding:"6px 8px",fontWeight:600}}>기초</th>
          <th style={{textAlign:"right",padding:"6px 8px",fontWeight:600}}>예측 사정률</th>
          <th style={{textAlign:"right",padding:"6px 8px",fontWeight:600}}>공격 (마진)</th>
          <th style={{textAlign:"right",padding:"6px 8px",fontWeight:600}}>균형 (마진)</th>
          <th style={{textAlign:"right",padding:"6px 8px",fontWeight:600}}>안전 (마진)</th>
          <th style={{textAlign:"right",padding:"6px 8px",fontWeight:600}}>부적격 (균형)</th>
          <th style={{textAlign:"center",padding:"6px 8px",fontWeight:600}}>신뢰</th>
        </tr></thead>
        <tbody>{preds.map(p=><AgencyPredictorRow key={p.id} pred={p}/>)}</tbody>
      </table>
    }
  </div>;
}
