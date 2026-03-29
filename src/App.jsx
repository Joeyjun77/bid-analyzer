import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import * as XLSX from "xlsx";

// ─── Supabase ──────────────────────────────────────────────
const SB_URL="https://sadunejfkstxbxogzutl.supabase.co";
const SB_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhZHVuZWpma3N0eGJ4b2d6dXRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2ODYxOTksImV4cCI6MjA5MDI2MjE5OX0.C5kNr-4urLImKfqOi_yl2-SUbrpcSgz2N3IiWGbObgc";
const hdrs={"Content-Type":"application/json","apikey":SB_KEY,"Authorization":"Bearer "+SB_KEY};
const hdrsSel={"apikey":SB_KEY,"Authorization":"Bearer "+SB_KEY};

// ─── 색상 ──────────────────────────────────────────────────
const C={bg:"#0c0c1a",bg2:"#12122a",bg3:"#1a1a30",txt:"#e8e8f0",txm:"#a0a0b8",txd:"#666680",bdr:"#252540",gold:"#d4a834"};

// ─── 낙찰하한율 테이블 ─────────────────────────────────────
const OLD_RULES={
  "조달청":[{min:5e9,max:1e11,rate:85.495},{min:1e9,max:5e9,rate:86.745},{min:0,max:1e9,rate:87.745}],
  "지자체":[{min:1e10,max:3e11,rate:79.995},{min:5e9,max:1e10,rate:85.495},{min:3e9,max:5e9,rate:86.745},{min:1e9,max:3e9,rate:86.745},{min:0,max:1e9,rate:87.745}],
  "교육청":[{min:5e9,max:1e11,rate:85.495},{min:1e9,max:5e9,rate:86.745},{min:0,max:1e9,rate:87.745}],
  "한전":[{min:5e9,max:1e11,rate:85.495},{min:1e9,max:5e9,rate:86.745},{min:0,max:1e9,rate:87.745}],
  "LH":[{min:5e9,max:1e11,rate:85.495},{min:1e9,max:5e9,rate:86.745},{min:0,max:1e9,rate:87.745}],
  "군시설":[{min:5e9,max:1e11,rate:85.495},{min:1e9,max:5e9,rate:86.745},{min:0,max:1e9,rate:87.745}],
  "수자원공사":[{min:5e9,max:1e11,rate:85.495},{min:1e9,max:5e9,rate:86.745},{min:0,max:1e9,rate:87.745}],
};
const NEW_RULES={};
Object.keys(OLD_RULES).forEach(k=>{NEW_RULES[k]=OLD_RULES[k].map(r=>({...r,rate:r.rate+2}))});

function getFloorRate(at,ep,isNew){const rules=isNew?NEW_RULES:OLD_RULES;const t=rules[at]||rules["조달청"];for(const r of t){if(ep>=r.min&&ep<r.max)return r.rate}return t[t.length-1].rate}

// ─── 기관 분류 ─────────────────────────────────────────────
function clsAg(name){if(!name)return"조달청";const n=name.trim();
  if(/조달청/.test(n))return"조달청";if(/교육/.test(n))return"교육청";
  if(/한국전력|한전/.test(n))return"한전";if(/LH|주택공사|토지주택/.test(n))return"LH";
  if(/군|사단|국방|해군|공군|육군|해병/.test(n))return"군시설";
  if(/수자원/.test(n))return"수자원공사";return"지자체"}

// ─── 문자열 정리 ───────────────────────────────────────────
function clean(v){if(v==null)return"";return String(v).replace(/[\u0000\u2800-\u2BFF\uE000-\uF8FF]/g,"").replace(/[嬀崀巇巍嶰嶬壂磆峈烓⧂⧅⧈]/g,"").replace(/\s+/g," ").trim()}

// ─── 숫자 파싱 ─────────────────────────────────────────────
function pnv(v){if(v==null||v==="")return 0;if(typeof v==="number")return v;const s=String(v).replace(/,/g,"").trim();const n=parseFloat(s);return isNaN(n)?0:n}
function sn(v){const n=pnv(v);return n===0?null:n}
function tc(v){return Number(v||0).toLocaleString()}
function tn(s){return Number(String(s).replace(/,/g,""))||0}

// ─── 날짜 파싱 ─────────────────────────────────────────────
function pDt(v){if(!v)return null;const s=String(v).trim();
  let m;if((m=s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/)))return`${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
  if((m=s.match(/^(\d{2})[-./](\d{1,2})[-./](\d{1,2})/)))return`20${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
  return null}

// ─── MD5 (dedup key용) ─────────────────────────────────────
function md5(s){function rl(n,c){return(n<<c)|(n>>>(32-c))}function tI(s){let h="";for(let i=0;i<=3;i++)h+="0123456789abcdef".charAt((s>>>(i*8+4))&0xF)+"0123456789abcdef".charAt((s>>>(i*8))&0xF);return h}
  function aI(x,y){let l=(x&0xFFFF)+(y&0xFFFF);return((x>>16)+(y>>16)+(l>>16))<<16|l&0xFFFF}
  const K=[],S=[];for(let i=0;i<64;i++){K[i]=Math.floor(Math.abs(Math.sin(i+1))*4294967296);S[i]=[7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21][((i>>4)<<2)+(i%4)]}
  let a0=0x67452301,b0=0xEFCDAB89,c0=0x98BADCFE,d0=0x10325476;
  const bytes=[];for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c<128)bytes.push(c);else if(c<2048){bytes.push(192|(c>>6));bytes.push(128|(c&63))}else{bytes.push(224|(c>>12));bytes.push(128|((c>>6)&63));bytes.push(128|(c&63))}}
  const bl=bytes.length*8;bytes.push(128);while(bytes.length%64!==56)bytes.push(0);
  for(let i=0;i<4;i++)bytes.push((bl>>>(i*8))&0xFF);for(let i=0;i<4;i++)bytes.push(0);
  for(let o=0;o<bytes.length;o+=64){const M=[];for(let j=0;j<16;j++)M[j]=bytes[o+j*4]|(bytes[o+j*4+1]<<8)|(bytes[o+j*4+2]<<16)|(bytes[o+j*4+3]<<24);
    let a=a0,b=b0,c=c0,d=d0;
    for(let i=0;i<64;i++){let f,g;if(i<16){f=(b&c)|((~b)&d);g=i}else if(i<32){f=(d&b)|((~d)&c);g=(5*i+1)%16}else if(i<48){f=b^c^d;g=(3*i+5)%16}else{f=c^(b|(~d));g=(7*i)%16}
      const tmp=d;d=c;c=b;b=aI(b,rl(aI(a,aI(f,aI(K[i],M[g]))),S[i]));a=tmp}
    a0=aI(a0,a);b0=aI(b0,b);c0=aI(c0,c);d0=aI(d0,d)}
  return tI(a0)+tI(b0)+tI(c0)+tI(d0)}

// ─── 시대 판별 & 투찰율 ────────────────────────────────────
function eraFR(at,ep,od){const isNew=(at==="지자체"||at==="교육청")?(od>="2025-07-01"):(od>="2026-01-30");return getFloorRate(at,ep||0,isNew)}

// ─── XLS/XLSX 파싱 (SheetJS) ───────────────────────────────
async function parseFile(file){
  const buf=await file.arrayBuffer();
  const wb=XLSX.read(new Uint8Array(buf),{type:"array",codepage:949,cellDates:false,raw:true});
  const ws=wb.Sheets[wb.SheetNames[0]];
  const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:"",raw:true});
  if(!rows.length)throw new Error("빈 파일");
  const hdr=rows[0].map(v=>String(v||"").trim());
  const pnIdx=hdr.findIndex(h=>/공고명/.test(h));
  if(pnIdx<0)throw new Error("공고명 컬럼 없음");
  const fmt=file.name.toLowerCase().endsWith(".xlsx")?"XLSX":"XLS";
  return{rows:rows.slice(1),format:fmt}}

// ─── 레코드 변환 ───────────────────────────────────────────
function toRecord(r){
  const pn=clean(r[1]);if(!pn||pn.length<2)return null;
  const ag=clean(r[3]);const at=clsAg(ag);
  const ep=sn(r[4]);const ba=sn(r[5]);const av=pnv(r[6]);
  const od=pDt(clean(r[19]));
  const era=(at==="지자체"||at==="교육청")?(od>="2025-07-01"?"new":"old"):(od>="2026-01-30"?"new":"old");
  const dk=pn+"|"+ag+"|"+(od||"")+"|"+(ba||"");
  if(dk.length<5)return null;
  const hk=md5(dk);
  return{dedup_key:hk,pn,pn_no:clean(r[2]),ag,at,ep:ep||null,ba:ba||null,av:av||0,raw_cost:clean(r[7]),
    xp:sn(r[8]),floor_price:sn(r[9]),ar1:sn(r[10]),ar0:sn(r[11]),
    co:clean(r[12]),co_no:clean(r[13]),bp:sn(r[14]),br1:sn(r[15]),br0:sn(r[16]),base_ratio:sn(r[17]),
    pc:Math.round(pnv(r[18]))||0,od:od||null,input_date:pDt(clean(r[20]))||null,
    cat:clean(r[21]),g2b:clean(r[22]),reg:clean(r[23]),era,has_a:av>0,fr:eraFR(at,ep,od)}}

function toRecords(rows){return rows.map(toRecord).filter(Boolean)}

// ─── 통계 계산 ─────────────────────────────────────────────
function calcStats(recs,filter){
  const src=filter?recs.filter(filter):recs;
  const ts={},as={};
  for(const r of src){
    if(r.br1==null)continue;
    const t=r.at||"기타";if(!ts[t])ts[t]={n:0,sum:0,vals:[]};ts[t].n++;ts[t].sum+=r.br1;ts[t].vals.push(r.br1);
    const a=r.ag;if(a){if(!as[a])as[a]={n:0,sum:0,vals:[],type:t};as[a].n++;as[a].sum+=r.br1;as[a].vals.push(r.br1)}}
  const fin=(o)=>{for(const k of Object.keys(o)){const v=o[k];v.avg=v.n?v.sum/v.n:0;v.vals.sort((a,b)=>a-b);v.med=v.vals.length?v.vals[Math.floor(v.vals.length/2)]:0}};
  fin(ts);fin(as);return{ts,as}}

// ─── 예측 v2 ───────────────────────────────────────────────
function predictV2({at,agName,ba,ep,av,pc},ts,as){
  if(!ba)return null;
  const agSt=as[agName];const tSt=ts[at]||ts["조달청"];
  let baseAdj;
  if(agSt&&agSt.n>=3)baseAdj=agSt.avg;
  else if(agSt&&agSt.n===2)baseAdj=agSt.avg*0.6+(tSt?tSt.avg:0)*0.4;
  else baseAdj=tSt?tSt.avg:0;
  const pcMul=pc>=100?0.7:pc>=30?1.0:pc>=10?1.5:2.5;
  const amtMul=ba>=5e9?0.5:ba>=1e9?1.0:1.2;
  const adj=baseAdj*pcMul*amtMul;
  const xp=ba*(1+adj/100);
  const fr=eraFR(at,ep||ba,new Date().toISOString().slice(0,10));
  let bid;
  if(av>0)bid=av+(xp-av)*(fr/100);
  else bid=xp*(fr/100);
  return{adj:Math.round(adj*10000)/10000,xp:Math.round(xp),bid:Math.ceil(bid),fr,baseAdj:Math.round(baseAdj*10000)/10000,pcMul,amtMul,src:agSt?`${agName}(${agSt.n}건)`:at}}

// ─── 데이터 현황 계산 ──────────────────────────────────────
function calcDataStatus(rows){
  if(!rows||rows.length===0)return null;
  const withOd=rows.filter(r=>r.od);
  if(withOd.length===0)return{total:rows.length,latestDate:null,latestPn:null,latestAg:"",sameDayCount:0};
  withOd.sort((a,b)=>(b.od>a.od?1:b.od<a.od?-1:0));
  const latest=withOd[0];
  const sameDay=withOd.filter(r=>r.od===latest.od);
  const pnShort=latest.pn?(latest.pn.length>35?latest.pn.slice(0,35)+"…":latest.pn):"(공고명 없음)";
  return{total:rows.length,latestDate:latest.od,latestPn:pnShort,latestAg:latest.ag||"",sameDayCount:sameDay.length}}

// ─── JSON sanitize ─────────────────────────────────────────
function sanitizeJson(s){return s.replace(/\\u0000/g,"").replace(/[\uD800-\uDFFF]/g,"")}

// ─── Supabase CRUD ─────────────────────────────────────────
async function sbFetchAll(){
  const PAGE=1000;let all=[];let offset=0;
  while(true){
    const res=await fetch(SB_URL+"/rest/v1/bid_records?select=*&order=od.desc&offset="+offset+"&limit="+PAGE,{headers:hdrsSel});
    const rows=await res.json();
    if(!Array.isArray(rows))break;
    all=all.concat(rows);
    if(rows.length<PAGE)break;
    offset+=PAGE}
  return all}

async function sbUpsert(rows){
  const BATCH=200;
  for(let i=0;i<rows.length;i+=BATCH){
    const batch=rows.slice(i,i+BATCH);
    // dedup within batch
    const seen=new Set();const unique=[];
    for(const r of batch){if(!seen.has(r.dedup_key)){seen.add(r.dedup_key);unique.push(r)}}
    const body=sanitizeJson(JSON.stringify(unique));
    const res=await fetch(SB_URL+"/rest/v1/bid_records?on_conflict=dedup_key",{method:"POST",headers:{...hdrs,"Prefer":"resolution=merge-duplicates,return=minimal"},body});
    if(!res.ok){const t=await res.text();throw new Error(`Upsert 실패: ${res.status} ${t}`)}}}

async function sbDeleteIds(ids){
  const BATCH=50;
  for(let i=0;i<ids.length;i+=BATCH){
    const chunk=ids.slice(i,i+BATCH);
    await fetch(SB_URL+"/rest/v1/bid_records?id=in.("+chunk.join(",")+")",{method:"DELETE",headers:hdrs})}}

async function sbDeleteAll(){await fetch(SB_URL+"/rest/v1/bid_records?id=gt.0",{method:"DELETE",headers:hdrs})}

// ─── 초성 검색 ─────────────────────────────────────────────
const CHO="ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
function getCho(c){const code=c.charCodeAt(0);if(code>=0xAC00&&code<=0xD7A3)return CHO[Math.floor((code-0xAC00)/588)];return c}
function mSch(t,q){if(!q)return true;const tl=t.toLowerCase();const ql=q.toLowerCase();if(tl.includes(ql))return true;
  const tc=Array.from(t).map(getCho).join("");return tc.includes(q);return false}

// ─── 숫자 입력 컴포넌트 ────────────────────────────────────
const inpS={width:"100%",padding:"7px 10px",background:"#0c0c1a",border:"1px solid #252540",borderRadius:5,color:"#e8e8f0",fontSize:12,outline:"none"};
function NI({value,onChange}){return<input value={value==="0"?"0":tc(value)} onChange={e=>{const r=e.target.value.replace(/,/g,"").replace(/[^0-9]/g,"");onChange(r===""?"0":r)}} style={{...inpS,textAlign:"right",fontFamily:"monospace"}}/>}

// ═══════════════════════════════════════════════════════════
// 메인 앱
// ═══════════════════════════════════════════════════════════
const PAGE=50;

export default function App(){
  const[tab,setTab]=useState("upload");
  const[recs,setRecs]=useState([]);
  const[allS,setAllS]=useState({ts:{},as:{}});
  const[newS,setNewS]=useState({ts:{},as:{}});
  const[oldS,setOldS]=useState({ts:{},as:{}});
  const[drag,setDrag]=useState(false);
  const[busy,setBusy]=useState(false);
  const[msg,setMsg]=useState({type:"",text:""});
  const[uploadLog,setUploadLog]=useState([]);
  const[dataStatus,setDataStatus]=useState(null);
  const[inp,setInp]=useState({agency:"",baseAmount:"0",estimatedPrice:"0",aValue:"0"});
  const[pred,setPred]=useState(null);
  const[search,setSearch]=useState("");
  const[sV,setSV]=useState("type");
  const[agSch,setAgSch]=useState("");
  const[eF,setEF]=useState("all");
  const[sel,setSel]=useState({});
  const[dlgType,setDlgType]=useState("");
  const[dataPage,setDataPage]=useState(0);
  const[dbLoading,setDbLoading]=useState(true);

  const refreshStats=useCallback((rows)=>{
    setAllS(calcStats(rows));setNewS(calcStats(rows,r=>r.era==="new"));setOldS(calcStats(rows,r=>r.era==="old"))},[]);

  // ── DB 로드 ──
  useEffect(()=>{
    sbFetchAll().then(rows=>{
      setRecs(rows);refreshStats(rows);setDataStatus(calcDataStatus(rows));setDbLoading(false);
      if(rows.length>0)setTab("stats");
    }).catch(e=>{setMsg({type:"err",text:"DB 로드 실패: "+e.message});setDbLoading(false)})},[refreshStats]);

  // ── 파일 업로드 (다중) ──
  const loadFiles=useCallback(async(fileList)=>{
    const files=Array.from(fileList).filter(Boolean);
    if(!files.length)return;
    setBusy(true);setMsg({type:"",text:""});setUploadLog([]);
    let snapshot=null;const logs=[];
    for(const file of files){
      try{
        const{rows:raw,format}=await parseFile(file);
        if(!raw.length)throw new Error("파싱된 데이터가 0건");
        const nr=toRecords(raw);
        // DB upsert
        await sbUpsert(nr);
        const nc=nr.filter(r=>r.era==="new").length;
        const oc=nr.filter(r=>r.era==="old").length;
        logs.push({name:file.name,type:"ok",text:`[${format}] ${nr.length}건 처리 | 신${nc} · 구${oc}`});
        setUploadLog([...logs]);
      }catch(e){logs.push({name:file.name,type:"err",text:e.message});setUploadLog([...logs])}}
    // DB에서 다시 로드
    try{const rows=await sbFetchAll();setRecs(rows);refreshStats(rows);setDataStatus(calcDataStatus(rows))}
    catch(e){setMsg({type:"err",text:"DB 재로드 실패"})}
    setSel({});if(logs.some(l=>l.type==="ok"))setTab("stats");
    setBusy(false)},[refreshStats]);

  // ── 삭제 ──
  const selCount=Object.keys(sel).filter(k=>sel[k]).length;
  const doDelete=useCallback(async()=>{
    setBusy(true);
    try{
      if(dlgType==="all"){await sbDeleteAll();setRecs([]);refreshStats([]);setDataStatus(null);setMsg({type:"ok",text:"전체 삭제 완료"})}
      else if(dlgType==="sel"){const ids=Object.keys(sel).filter(k=>sel[k]).map(Number);await sbDeleteIds(ids);
        setRecs(prev=>{const next=prev.filter(r=>!sel[r.id]);refreshStats(next);setDataStatus(calcDataStatus(next));return next});
        setMsg({type:"ok",text:`${ids.length}건 삭제 완료`});setSel({})}
    }catch(e){setMsg({type:"err",text:"삭제 실패: "+e.message})}
    setDlgType("");setBusy(false)},[dlgType,sel,refreshStats]);

  const curSt=eF==="new"?newS:eF==="old"?oldS:allS;
  const filteredRecs=useMemo(()=>{const t=search.toLowerCase();let src=recs;
    if(eF==="new")src=recs.filter(r=>r.era==="new");else if(eF==="old")src=recs.filter(r=>r.era==="old");
    return t?src.filter(r=>((r.pn||"")+(r.ag||"")+(r.co||"")).toLowerCase().includes(t)):src},[recs,search,eF]);
  const pagedRecs=useMemo(()=>filteredRecs.slice(dataPage*PAGE,(dataPage+1)*PAGE),[filteredRecs,dataPage]);
  const totalPages=Math.max(1,Math.ceil(filteredRecs.length/PAGE));
  const fAg=useMemo(()=>{const t=agSch.toLowerCase();return Object.entries(curSt.as||{}).filter(([k])=>!t||mSch(k,t)).sort((a,b)=>b[1].n-a[1].n)},[curSt.as,agSch]);
  const doPred=useCallback(()=>{setPred(predictV2({at:clsAg(inp.agency),agName:inp.agency.trim(),ba:tn(inp.baseAmount),ep:tn(inp.estimatedPrice),av:tn(inp.aValue),pc:0},allS.ts,allS.as))},[inp,allS]);
  const nC=recs.filter(r=>r.era==="new").length;const oC=recs.filter(r=>r.era==="old").length;
  const allSel=pagedRecs.length>0&&pagedRecs.every(r=>sel[r.id]);
  const agencyList=useMemo(()=>Object.keys(allS.as||{}).sort(),[allS.as]);

  const btnS=(act,c)=>({padding:"3px 10px",fontSize:10,fontWeight:act?600:400,background:act?c+"22":"#1a1a30",color:act?c:"#888",border:"1px solid "+(act?c+"44":"#252540"),borderRadius:4,cursor:"pointer",marginRight:4});
  const Tb=({id,ch})=>(<button onClick={()=>{setTab(id);setDataPage(0)}} style={{padding:"8px 18px",fontSize:12,fontWeight:tab===id?600:400,background:tab===id?C.bg3:"transparent",color:tab===id?C.gold:C.txm,border:"none",borderBottom:tab===id?`2px solid ${C.gold}`:"2px solid transparent",cursor:"pointer"}}>{ch}</button>);
  const Era=({id,ch})=>(<button onClick={()=>setEF(id)} style={btnS(eF===id,id==="new"?"#5dca96":id==="old"?"#e24b4a":C.gold)}>{ch}</button>);

  return(<div style={{fontFamily:"system-ui,sans-serif",background:C.bg,color:C.txt,minHeight:"100vh"}}>
    {/* 삭제 확인 다이얼로그 */}
    {dlgType&&<div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,.6)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setDlgType("")}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,padding:24,maxWidth:360,width:"90%"}}>
        <div style={{fontSize:14,fontWeight:600,color:C.gold,marginBottom:8}}>{dlgType==="sel"?selCount+"건 삭제":"전체 삭제"}</div>
        <div style={{fontSize:12,color:C.txm,marginBottom:16}}>DB에서 영구 삭제됩니다.</div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <button onClick={()=>setDlgType("")} style={{padding:"6px 16px",background:C.bg3,border:"1px solid "+C.bdr,borderRadius:5,color:C.txt,fontSize:11,cursor:"pointer"}}>취소</button>
          <button onClick={doDelete} disabled={busy} style={{padding:"6px 16px",background:"#e24b4a",border:"none",borderRadius:5,color:"#fff",fontSize:11,fontWeight:600,cursor:"pointer"}}>{busy?"처리중...":"삭제"}</button>
        </div></div></div>}

    {/* 헤더 */}
    <div style={{padding:"10px 20px",borderBottom:"1px solid "+C.bdr,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <span style={{fontSize:16,fontWeight:700,color:C.gold}}>입찰 분석 시스템 v2</span>
        <span style={{fontSize:10,color:C.txd}}>총 {recs.length.toLocaleString()}건 (신{nC}/구{oC})</span>
      </div>
      <div style={{display:"flex",gap:0}}><Tb id="upload" ch="업로드"/><Tb id="stats" ch="통계"/><Tb id="data" ch="데이터"/><Tb id="predict" ch="예측"/></div>
    </div>

    <div style={{maxWidth:960,margin:"0 auto",padding:"16px 12px"}}>
      {/* 시대 필터 */}
      <div style={{marginBottom:12,display:"flex",gap:4,alignItems:"center"}}>
        <Era id="all" ch="전체"/><Era id="new" ch="신기준"/><Era id="old" ch="구기준"/>
      </div>

      {/* 메시지 */}
      {msg.text&&<div style={{marginBottom:12,padding:"8px 14px",background:msg.type==="ok"?"rgba(93,202,165,0.08)":"rgba(220,50,50,0.08)",border:`1px solid ${msg.type==="ok"?"rgba(93,202,165,0.3)":"rgba(220,50,50,0.3)"}`,borderRadius:6,fontSize:11,color:msg.type==="ok"?"#5ca":"#e55"}}>{msg.type==="ok"?"✓ ":"✕ "}{msg.text}</div>}

      {/* ═══ 업로드 탭 ═══ */}
      {tab==="upload"&&(<div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,padding:20}}>
        <div style={{border:`2px dashed ${drag?C.gold:C.bdr}`,borderRadius:10,padding:"44px 20px",textAlign:"center",cursor:busy?"default":"pointer",background:drag?"rgba(212,168,52,0.05)":"transparent",transition:"border-color .15s,background .15s"}}
          onDrop={e=>{e.preventDefault();setDrag(false);if(!busy)loadFiles(e.dataTransfer.files)}}
          onDragOver={e=>{e.preventDefault();if(!busy)setDrag(true)}}
          onDragLeave={()=>setDrag(false)}
          onClick={()=>{if(!busy)document.getElementById("fi").click()}}>
          <input id="fi" type="file" accept=".xls,.xlsx,.csv" multiple style={{display:"none"}} onChange={e=>{if(e.target.files?.length){loadFiles(e.target.files);e.target.value=""}}}/>
          {busy?<div style={{color:C.gold,fontSize:14}}>처리 중...</div>
          :<>
            <div style={{fontSize:36,opacity:0.4,marginBottom:8}}>↑</div>
            <div style={{fontSize:14,fontWeight:600,marginBottom:6}}>낙찰정보리스트 파일 업로드</div>
            <div style={{fontSize:11,color:C.txd}}>XLS / XLSX · 복수 파일 가능 · 중복 자동 제거</div>
            {/* ★ 데이터 현황 표시 */}
            {dbLoading&&<div style={{marginTop:14,fontSize:11,color:C.txd}}>DB 연결 중...</div>}
            {dataStatus&&(
              <div style={{marginTop:14,padding:"10px 16px",background:"rgba(212,168,52,0.06)",border:"1px solid rgba(212,168,52,0.15)",borderRadius:6,textAlign:"left",fontSize:11,lineHeight:1.7}}>
                <div style={{fontWeight:600,color:C.gold,marginBottom:4,fontSize:12}}>업로드 데이터 현황</div>
                <div style={{color:C.txm}}>총 <span style={{color:C.txt,fontWeight:600}}>{dataStatus.total.toLocaleString()}건</span> 저장됨</div>
                {dataStatus.latestDate&&(<>
                  <div style={{color:C.txm}}>최신 개찰일: <span style={{color:"#5dca96",fontWeight:600}}>{dataStatus.latestDate}</span>
                    <span style={{color:C.txd,marginLeft:6}}>({dataStatus.sameDayCount}건)</span></div>
                  <div style={{color:C.txd,fontSize:10,marginTop:2}}>{dataStatus.latestPn}
                    {dataStatus.latestAg&&<span style={{marginLeft:6,color:"#888"}}>- {dataStatus.latestAg}</span>}
                  </div></>)}
              </div>)}
          </>}
        </div>
        {/* 업로드 로그 */}
        {uploadLog.length>0&&<div style={{marginTop:12}}>
          {uploadLog.map((l,i)=><div key={i} style={{padding:"6px 10px",fontSize:11,color:l.type==="ok"?"#5ca":"#e55",borderBottom:"1px solid "+C.bdr}}>
            {l.type==="ok"?"✓":"✕"} {l.name} — {l.text}</div>)}
          <div style={{padding:"6px 10px",fontSize:10,color:C.txd,borderTop:"1px solid "+C.bdr}}>
            총 {uploadLog.length}개 파일 · 성공 {uploadLog.filter(l=>l.type==="ok").length} / 실패 {uploadLog.filter(l=>l.type==="err").length}</div>
        </div>}
        {/* 데이터 관리 */}
        {recs.length>0&&<div style={{marginTop:16,display:"flex",gap:8}}>
          <button onClick={()=>setDlgType("all")} style={{padding:"6px 14px",background:"rgba(220,50,50,0.1)",border:"1px solid rgba(220,50,50,0.3)",borderRadius:5,color:"#e55",fontSize:11,cursor:"pointer"}}>전체 삭제 ({recs.length}건)</button>
        </div>}
      </div>)}

      {/* ═══ 통계 탭 ═══ */}
      {tab==="stats"&&(<div>
        <div style={{display:"flex",gap:4,marginBottom:12}}>
          <button onClick={()=>setSV("type")} style={btnS(sV==="type",C.gold)}>기관유형별</button>
          <button onClick={()=>setSV("agency")} style={btnS(sV==="agency",C.gold)}>발주기관별</button>
        </div>
        {sV==="type"&&<div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,overflow:"hidden"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
            <thead><tr style={{background:C.bg3}}>{["기관유형","건수","평균사정율","중앙값"].map((h,i)=>
              <th key={i} style={{padding:"8px 10px",textAlign:i>0?"right":"left",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr}}>{h}</th>)}</tr></thead>
            <tbody>{Object.entries(curSt.ts||{}).sort((a,b)=>b[1].n-a[1].n).map(([k,v])=>
              <tr key={k} style={{borderBottom:"1px solid "+C.bdr}}>
                <td style={{padding:"7px 10px",color:C.gold}}>{k}</td>
                <td style={{padding:"7px 10px",textAlign:"right"}}>{v.n}</td>
                <td style={{padding:"7px 10px",textAlign:"right",color:"#5dca96"}}>{v.avg.toFixed(4)}%</td>
                <td style={{padding:"7px 10px",textAlign:"right"}}>{v.med.toFixed(4)}%</td>
              </tr>)}</tbody></table></div>}
        {sV==="agency"&&<div>
          <input value={agSch} onChange={e=>setAgSch(e.target.value)} placeholder="발주기관 검색 (초성 가능)" style={{...inpS,marginBottom:8}}/>
          <div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,overflow:"hidden",maxHeight:500,overflowY:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{background:C.bg3}}>{["발주기관","유형","건수","평균","중앙값"].map((h,i)=>
                <th key={i} style={{padding:"8px 10px",textAlign:i>1?"right":"left",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr}}>{h}</th>)}</tr></thead>
              <tbody>{fAg.slice(0,100).map(([k,v])=>
                <tr key={k} style={{borderBottom:"1px solid "+C.bdr}}>
                  <td style={{padding:"6px 10px",maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{k}</td>
                  <td style={{padding:"6px 10px",color:C.txd,fontSize:10}}>{v.type}</td>
                  <td style={{padding:"6px 10px",textAlign:"right"}}>{v.n}</td>
                  <td style={{padding:"6px 10px",textAlign:"right",color:"#5dca96"}}>{v.avg.toFixed(4)}%</td>
                  <td style={{padding:"6px 10px",textAlign:"right"}}>{v.med.toFixed(4)}%</td>
                </tr>)}</tbody></table></div></div>}
      </div>)}

      {/* ═══ 데이터 탭 ═══ */}
      {tab==="data"&&(<div>
        <div style={{display:"flex",gap:8,marginBottom:8,flexWrap:"wrap",alignItems:"center"}}>
          <input value={search} onChange={e=>{setSearch(e.target.value);setDataPage(0)}} placeholder="검색 (공고명/기관/업체)" style={{...inpS,flex:1,minWidth:150}}/>
          {selCount>0&&<button onClick={()=>setDlgType("sel")} style={{padding:"5px 12px",background:"rgba(220,50,50,0.1)",border:"1px solid rgba(220,50,50,0.3)",borderRadius:5,color:"#e55",fontSize:11,cursor:"pointer"}}>{selCount}건 삭제</button>}
          <span style={{fontSize:10,color:C.txd}}>{filteredRecs.length}건</span>
        </div>
        <div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,overflow:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:10,tableLayout:"fixed"}}>
            <colgroup><col style={{width:30}}/><col style={{width:"22%"}}/><col style={{width:"14%"}}/><col style={{width:"8%"}}/><col style={{width:"10%"}}/><col style={{width:"8%"}}/><col style={{width:"8%"}}/><col style={{width:"8%"}}/><col style={{width:"7%"}}/></colgroup>
            <thead><tr style={{background:C.bg3}}>
              <th style={{padding:6}}><input type="checkbox" checked={allSel} onChange={()=>{const n={};if(!allSel)pagedRecs.forEach(r=>{n[r.id]=true});setSel(n)}}/></th>
              {["공고명","발주기관","유형","기초금액","사정율","1순위사정율","개찰일","시대"].map((h,i)=>
                <th key={i} style={{padding:"6px 4px",textAlign:i>=3?"right":"left",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr}}>{h}</th>)}</tr></thead>
            <tbody>{pagedRecs.map(r=>
              <tr key={r.id} style={{borderBottom:"1px solid "+C.bdr}}>
                <td style={{padding:4,textAlign:"center"}}><input type="checkbox" checked={!!sel[r.id]} onChange={()=>setSel(p=>({...p,[r.id]:!p[r.id]}))}/></td>
                <td style={{padding:"5px 4px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={r.pn}>{r.pn||"(없음)"}</td>
                <td style={{padding:"5px 4px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={r.ag}>{r.ag||""}</td>
                <td style={{padding:"5px 4px",color:C.txd}}>{r.at}</td>
                <td style={{padding:"5px 4px",textAlign:"right",fontFamily:"monospace"}}>{r.ba?tc(r.ba):""}</td>
                <td style={{padding:"5px 4px",textAlign:"right",color:"#5dca96"}}>{r.ar1!=null?r.ar1.toFixed(4):""}</td>
                <td style={{padding:"5px 4px",textAlign:"right",color:C.gold}}>{r.br1!=null?r.br1.toFixed(4):""}</td>
                <td style={{padding:"5px 4px",textAlign:"right"}}>{r.od||""}</td>
                <td style={{padding:"5px 4px",textAlign:"right",color:r.era==="new"?"#5dca96":"#e24b4a",fontSize:9}}>{r.era==="new"?"신":"구"}</td>
              </tr>)}</tbody></table></div>
        {/* 페이지네이션 */}
        <div style={{display:"flex",justifyContent:"center",gap:6,marginTop:10,alignItems:"center"}}>
          <button disabled={dataPage===0} onClick={()=>setDataPage(p=>p-1)} style={{padding:"4px 10px",fontSize:10,background:C.bg3,border:"1px solid "+C.bdr,borderRadius:4,color:C.txt,cursor:dataPage===0?"default":"pointer"}}>◀</button>
          <span style={{fontSize:10,color:C.txd}}>{dataPage+1} / {totalPages}</span>
          <button disabled={dataPage>=totalPages-1} onClick={()=>setDataPage(p=>p+1)} style={{padding:"4px 10px",fontSize:10,background:C.bg3,border:"1px solid "+C.bdr,borderRadius:4,color:C.txt,cursor:dataPage>=totalPages-1?"default":"pointer"}}>▶</button>
        </div>
      </div>)}

      {/* ═══ 예측 탭 ═══ */}
      {tab==="predict"&&(<div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,padding:20}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
          <div><div style={{fontSize:10,color:C.txm,marginBottom:4}}>발주기관</div>
            <input value={inp.agency} onChange={e=>setInp(p=>({...p,agency:e.target.value}))} placeholder="기관명 입력" style={inpS} list="agList"/>
            <datalist id="agList">{agencyList.slice(0,20).map(a=><option key={a} value={a}/>)}</datalist>
          </div>
          <div><div style={{fontSize:10,color:C.txm,marginBottom:4}}>기관유형: <span style={{color:C.gold}}>{clsAg(inp.agency)||"조달청"}</span></div></div>
          <div><div style={{fontSize:10,color:C.txm,marginBottom:4}}>기초금액 (원)</div><NI value={inp.baseAmount} onChange={v=>setInp(p=>({...p,baseAmount:v}))}/></div>
          <div><div style={{fontSize:10,color:C.txm,marginBottom:4}}>추정가격 (원)</div><NI value={inp.estimatedPrice} onChange={v=>setInp(p=>({...p,estimatedPrice:v}))}/></div>
          <div><div style={{fontSize:10,color:C.txm,marginBottom:4}}>A값 (원, 없으면 0)</div><NI value={inp.aValue} onChange={v=>setInp(p=>({...p,aValue:v}))}/></div>
        </div>
        <button onClick={doPred} style={{width:"100%",padding:"10px",background:C.gold,border:"none",borderRadius:6,color:"#000",fontWeight:700,fontSize:13,cursor:"pointer"}}>예측 실행</button>
        {pred&&<div style={{marginTop:16,padding:16,background:C.bg3,borderRadius:8,fontSize:12,lineHeight:2}}>
          <div style={{fontWeight:600,color:C.gold,marginBottom:8,fontSize:14}}>예측 결과</div>
          <div>예측 사정율: <span style={{color:"#5dca96",fontWeight:700}}>{pred.adj.toFixed(4)}%</span></div>
          <div>예정가격(추정): <span style={{fontWeight:600}}>{tc(pred.xp)}원</span></div>
          <div>적용 투찰율: <span style={{color:C.gold}}>{pred.fr}%</span></div>
          <div style={{fontWeight:700,fontSize:14,color:C.gold,marginTop:8}}>추천 투찰금액: {tc(pred.bid)}원</div>
          <div style={{marginTop:8,fontSize:10,color:C.txd}}>기준: {pred.src} | 기본{pred.baseAdj.toFixed(4)}% × 참여{pred.pcMul} × 금액{pred.amtMul}</div>
        </div>}
      </div>)}
    </div>
  </div>)}
