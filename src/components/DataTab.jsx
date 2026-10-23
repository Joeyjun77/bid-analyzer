// 데이터 탭 — 업로드 2종(낙찰 데이터 loadFiles, 입찰서류함 loadPredFiles) + 검증 만료 경고 + 최근 활동.
// 대시보드(2026-10-23 P4 삭제)에서 옮겼다. 업로드 핸들러는 App 그대로, 여기서는 호출만 한다.
import React, { useRef } from "react";
import { C } from "../lib/constants.js";

export default function DataTab({ busy, drag, setDrag, loadFiles, loadPredFiles, uploadLog, dbLoading, compStats, dataStatus, bidDetails, onOpenExpired }) {
  const predRef = useRef(null);
  return <div>
    {/* 낙찰 데이터 드롭존 */}
    <div style={{border:`2px dashed ${drag?C.gold:C.bdr}`,borderRadius:10,padding:"20px",textAlign:"center",cursor:busy?"default":"pointer",background:drag?"rgba(212,168,52,0.04)":"transparent",marginBottom:10}}
      onDrop={e=>{e.preventDefault();setDrag(false);if(!busy)loadFiles(e.dataTransfer.files)}} onDragOver={e=>{e.preventDefault();if(!busy)setDrag(true)}} onDragLeave={()=>setDrag(false)}
      onClick={()=>{if(!busy)document.getElementById("fi").click()}}>
      <input id="fi" type="file" accept=".xls,.xlsx" multiple style={{display:"none"}} onChange={e=>{if(e.target.files?.length){loadFiles(e.target.files);e.target.value=""}}}/>
      {busy?<div style={{color:C.gold,fontSize:14}}>처리 중...</div>:<>
        <div style={{fontSize:13,fontWeight:600,marginBottom:4}}>파일을 드래그하거나 클릭하세요</div>
        <div style={{fontSize:11,color:C.txd}}>낙찰정보리스트 / SUCVIEW 상세 / 입찰서류함 — 자동 판별</div>
        {dbLoading&&<div style={{marginTop:8,fontSize:11,color:C.txd}}>DB 연결 중...</div>}
      </>}
    </div>
    {/* 입찰서류함 엑셀(예측 등록) — 오늘의 공고의 같은 버튼과 같은 핸들러 */}
    <div style={{marginBottom:16}}>
      <input ref={predRef} type="file" accept=".xls,.xlsx" multiple style={{display:"none"}} onChange={e=>{if(e.target.files?.length)loadPredFiles(e.target.files);e.target.value=""}}/>
      <button disabled={busy} onClick={()=>predRef.current?.click()} style={{padding:"6px 14px",fontSize:12,borderRadius:6,border:"1px solid "+C.bdr,background:C.bg2,color:"#5dca96",cursor:busy?"default":"pointer"}}>입찰서류함 엑셀 업로드</button>
    </div>
    {uploadLog.length>0&&<div style={{marginBottom:12}}>{uploadLog.map((l,i)=><div key={i} style={{padding:"6px 12px",fontSize:12,color:l.type==="ok"?"#5ca":l.type==="warn"?"#d4a834":"#e55",borderBottom:"1px solid "+C.bdr}}>{l.type==="ok"?"✓":l.type==="warn"?"⚠":"✕"} {l.name} — {l.text}</div>)}</div>}

    {/* 검증 만료 경고 (낙찰결과 미업로드 유도) */}
    {compStats.expired>0&&<div style={{background:"linear-gradient(135deg, rgba(226,75,74,0.08), rgba(212,168,52,0.04))",border:"1px solid rgba(226,75,74,0.3)",borderRadius:8,padding:"10px 14px",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}} onClick={onOpenExpired}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <span style={{fontSize:16}}>⚠️</span>
        <div>
          <div style={{fontSize:12,fontWeight:600,color:"#e24b4a"}}>검증 만료 {compStats.expired}건</div>
          <div style={{fontSize:10,color:C.txm,marginTop:2}}>60일 이상 경과 + 낙찰결과 미업로드 — 낙찰정보리스트를 업로드하면 매트릭스가 자동 재학습됩니다</div>
        </div>
      </div>
      <span style={{fontSize:11,color:"#e24b4a",fontWeight:600}}>확인 →</span>
    </div>}

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
  </div>;
}
