import { useState, useEffect } from "react";
import { C } from "../lib/constants.js";
import { sbFetchAgencyPredictionsV3 } from "../lib/supabase.js";

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
