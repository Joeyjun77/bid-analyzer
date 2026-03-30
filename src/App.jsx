import { useState, useCallback, useMemo, useEffect } from "react";
import * as XLSX from "xlsx";

// ─── Supabase ──────────────────────────────────────────────
const SB_URL="https://sadunejfkstxbxogzutl.supabase.co";
const SB_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhZHVuZWpma3N0eGJ4b2d6dXRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2ODYxOTksImV4cCI6MjA5MDI2MjE5OX0.C5kNr-4urLImKfqOi_yl2-SUbrpcSgz2N3IiWGbObgc";
const hdrs={"Content-Type":"application/json","apikey":SB_KEY,"Authorization":"Bearer "+SB_KEY};
const hdrsSel={"apikey":SB_KEY,"Authorization":"Bearer "+SB_KEY};
const C={bg:"#0c0c1a",bg2:"#12122a",bg3:"#1a1a30",txt:"#e8e8f0",txm:"#a0a0b8",txd:"#666680",bdr:"#252540",gold:"#d4a834"};

// ─── 낙찰하한율 ────────────────────────────────────────────
const OLD_RULES={"조달청":[{min:5e9,max:1e11,rate:85.495},{min:1e9,max:5e9,rate:86.745},{min:0,max:1e9,rate:87.745}],"지자체":[{min:1e10,max:3e11,rate:79.995},{min:5e9,max:1e10,rate:85.495},{min:3e9,max:5e9,rate:86.745},{min:1e9,max:3e9,rate:86.745},{min:0,max:1e9,rate:87.745}],"교육청":[{min:5e9,max:1e11,rate:85.495},{min:1e9,max:5e9,rate:86.745},{min:0,max:1e9,rate:87.745}],"한전":[{min:5e9,max:1e11,rate:85.495},{min:1e9,max:5e9,rate:86.745},{min:0,max:1e9,rate:87.745}],"LH":[{min:5e9,max:1e11,rate:85.495},{min:1e9,max:5e9,rate:86.745},{min:0,max:1e9,rate:87.745}],"군시설":[{min:5e9,max:1e11,rate:85.495},{min:1e9,max:5e9,rate:86.745},{min:0,max:1e9,rate:87.745}],"수자원공사":[{min:5e9,max:1e11,rate:85.495},{min:1e9,max:5e9,rate:86.745},{min:0,max:1e9,rate:87.745}]};
const NEW_RULES={};Object.keys(OLD_RULES).forEach(k=>{NEW_RULES[k]=OLD_RULES[k].map(r=>({...r,rate:r.rate+2}))});
function getFloorRate(at,ep,isNew){const rules=isNew?NEW_RULES:OLD_RULES;const t=rules[at]||rules["조달청"];for(const r of t){if(ep>=r.min&&ep<r.max)return r.rate}return t[t.length-1].rate}

// ─── 유틸 ──────────────────────────────────────────────────
function clsAg(n){if(!n)return"조달청";const s=n.trim();if(/조달청/.test(s))return"조달청";if(/교육/.test(s))return"교육청";if(/한국전력|한전/.test(s))return"한전";if(/LH|주택공사|토지주택/.test(s))return"LH";if(/군|사단|국방|해군|공군|육군|해병/.test(s))return"군시설";if(/수자원/.test(s))return"수자원공사";return"지자체"}
function clean(v){if(v==null)return"";return String(v).replace(/[\u0000\u2800-\u2BFF\uE000-\uF8FF]/g,"").replace(/\s+/g," ").trim()}
function pnv(v){if(v==null||v==="")return 0;if(typeof v==="number")return v;return parseFloat(String(v).replace(/,/g,"").trim())||0}
function sn(v){const n=pnv(v);return n===0?null:n}
function tc(v){return Number(v||0).toLocaleString()}
function tn(s){return Number(String(s).replace(/,/g,""))||0}
function pDt(v){if(!v)return null;const s=String(v).trim();let m;if((m=s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/)))return`${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;if((m=s.match(/^(\d{2})[-./](\d{1,2})[-./](\d{1,2})/)))return`20${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;return null}
function eraFR(at,ep,od){const isNew=(at==="지자체"||at==="교육청")?(od>="2025-07-01"):(od>="2026-01-30");return getFloorRate(at,ep||0,isNew)}
const CHO="ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
function getCho(c){const code=c.charCodeAt(0);if(code>=0xAC00&&code<=0xD7A3)return CHO[Math.floor((code-0xAC00)/588)];return c}
function mSch(t,q){if(!q)return true;const tl=t.toLowerCase(),ql=q.toLowerCase();if(tl.includes(ql))return true;return Array.from(t).map(getCho).join("").includes(q)}

// ─── MD5 ───────────────────────────────────────────────────
function md5(s){function rl(n,c){return(n<<c)|(n>>>(32-c))}function tI(s){let h="";for(let i=0;i<=3;i++)h+="0123456789abcdef".charAt((s>>>(i*8+4))&0xF)+"0123456789abcdef".charAt((s>>>(i*8))&0xF);return h}function aI(x,y){let l=(x&0xFFFF)+(y&0xFFFF);return((x>>16)+(y>>16)+(l>>16))<<16|l&0xFFFF}const K=[],S=[];for(let i=0;i<64;i++){K[i]=Math.floor(Math.abs(Math.sin(i+1))*4294967296);S[i]=[7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21][((i>>4)<<2)+(i%4)]}let a0=0x67452301,b0=0xEFCDAB89,c0=0x98BADCFE,d0=0x10325476;const bytes=[];for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c<128)bytes.push(c);else if(c<2048){bytes.push(192|(c>>6));bytes.push(128|(c&63))}else{bytes.push(224|(c>>12));bytes.push(128|((c>>6)&63));bytes.push(128|(c&63))}}const bl=bytes.length*8;bytes.push(128);while(bytes.length%64!==56)bytes.push(0);for(let i=0;i<4;i++)bytes.push((bl>>>(i*8))&0xFF);for(let i=0;i<4;i++)bytes.push(0);for(let o=0;o<bytes.length;o+=64){const M=[];for(let j=0;j<16;j++)M[j]=bytes[o+j*4]|(bytes[o+j*4+1]<<8)|(bytes[o+j*4+2]<<16)|(bytes[o+j*4+3]<<24);let a=a0,b=b0,c=c0,d=d0;for(let i=0;i<64;i++){let f,g;if(i<16){f=(b&c)|((~b)&d);g=i}else if(i<32){f=(d&b)|((~d)&c);g=(5*i+1)%16}else if(i<48){f=b^c^d;g=(3*i+5)%16}else{f=c^(b|(~d));g=(7*i)%16}const tmp=d;d=c;c=b;b=aI(b,rl(aI(a,aI(f,aI(K[i],M[g]))),S[i]));a=tmp}a0=aI(a0,a);b0=aI(b0,b);c0=aI(c0,c);d0=aI(d0,d)}return tI(a0)+tI(b0)+tI(c0)+tI(d0)}
function sanitizeJson(s){return s.replace(/\\u0000/g,"").replace(/[\uD800-\uDFFF]/g,"")}

// ─── 파싱 ──────────────────────────────────────────────────
async function parseFile(file){const buf=await file.arrayBuffer();const wb=XLSX.read(new Uint8Array(buf),{type:"array",codepage:949,cellDates:false,raw:true});const ws=wb.Sheets[wb.SheetNames[0]];const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:"",raw:true});if(!rows.length)throw new Error("빈 파일");return{rows,format:file.name.toLowerCase().endsWith(".xlsx")?"XLSX":"XLS"}}

// 낙찰정보리스트 레코드 변환
function toRecord(r){const pn=clean(r[1]);if(!pn||pn.length<2)return null;const ag=clean(r[3]);const at=clsAg(ag);const ep=sn(r[4]);const ba=sn(r[5]);const av=pnv(r[6]);const od=pDt(clean(r[19]));const era=(at==="지자체"||at==="교육청")?(od>="2025-07-01"?"new":"old"):(od>="2026-01-30"?"new":"old");const dk=pn+"|"+ag+"|"+(od||"")+"|"+(ba||"");if(dk.length<5)return null;return{dedup_key:md5(dk),pn,pn_no:clean(r[2]),ag,at,ep:ep||null,ba:ba||null,av:av||0,raw_cost:clean(r[7]),xp:sn(r[8]),floor_price:sn(r[9]),ar1:sn(r[10]),ar0:sn(r[11]),co:clean(r[12]),co_no:clean(r[13]),bp:sn(r[14]),br1:sn(r[15]),br0:sn(r[16]),base_ratio:sn(r[17]),pc:Math.round(pnv(r[18]))||0,od:od||null,input_date:pDt(clean(r[20]))||null,cat:clean(r[21]),g2b:clean(r[22]),reg:clean(r[23]),era,has_a:av>0,fr:eraFR(at,ep,od)}}
function toRecords(rows){return rows.map(toRecord).filter(Boolean)}

// 입찰서류함 파싱 (헤더가 2행, 데이터 3행부터)
function parseBidDoc(rows){
  // 헤더 찾기: "공고명" 컬럼이 있는 행
  let hdrIdx=0;
  for(let i=0;i<Math.min(5,rows.length);i++){if(rows[i].some(v=>String(v).includes("공고명"))){hdrIdx=i;break}}
  const result=[];
  for(let i=hdrIdx+1;i<rows.length;i++){
    const r=rows[i];const pn=clean(r[2]);if(!pn||pn.length<2)continue;
    const ag=clean(r[4]);const at=clsAg(ag);const ep=sn(r[5]);const ba=sn(r[6]);const av=pnv(r[7]);
    const rawCost=sn(r[8]);const odRaw=clean(r[9]);const od=pDt(odRaw);const cat=clean(r[14]);
    const pn_no=clean(r[3]);
    result.push({pn,pn_no,ag,at,ep:ep||null,ba:ba||null,av:av||0,raw_cost:rawCost,cat,open_date:od,
      dedup_key:md5("pred|"+(pn_no||pn)+"|"+(od||""))})
  }
  return result}

// ─── 통계 ──────────────────────────────────────────────────
function calcStats(recs,filter){const src=filter?recs.filter(filter):recs;const ts={},as={};for(const r of src){if(r.br1==null)continue;
  // br1은 100% 기준(예: 99.95) → 사정율 = br1-100 (예: -0.05%)
  const adj=r.br1-100;
  // 이상치 필터: ±5% 범위 밖 제외
  if(adj<-5||adj>5)continue;
  const t=r.at||"기타";if(!ts[t])ts[t]={n:0,sum:0,vals:[]};ts[t].n++;ts[t].sum+=adj;ts[t].vals.push(adj);
  const a=r.ag;if(a){if(!as[a])as[a]={n:0,sum:0,vals:[],type:t};as[a].n++;as[a].sum+=adj;as[a].vals.push(adj)}}
  const fin=o=>{for(const k of Object.keys(o)){const v=o[k];v.avg=v.n?v.sum/v.n:0;v.vals.sort((a,b)=>a-b);v.med=v.vals.length?v.vals[Math.floor(v.vals.length/2)]:0}};fin(ts);fin(as);return{ts,as}}

// ─── 예측 v2 ───────────────────────────────────────────────
function predictV2({at,agName,ba,ep,av,pc},ts,as){if(!ba)return null;const agSt=as[agName];const tSt=ts[at]||ts["조달청"];
  // 사정율 추정 (이미 -100 보정된 값: 예 -0.05%)
  let baseAdj;
  if(agSt&&agSt.n>=3)baseAdj=agSt.avg;
  else if(agSt&&agSt.n===2)baseAdj=agSt.avg*0.6+(tSt?tSt.avg:0)*0.4;
  else baseAdj=tSt?tSt.avg:0;
  // 사정율은 ±3% 범위이므로 보정 계수는 소폭만 적용
  const adj=baseAdj;
  const xp=ba*(1+adj/100);
  const fr=eraFR(at,ep||ba,new Date().toISOString().slice(0,10));
  let bid;if(av>0)bid=av+(xp-av)*(fr/100);else bid=xp*(fr/100);
  return{adj:Math.round(adj*10000)/10000,xp:Math.round(xp),bid:Math.ceil(bid),fr,baseAdj:Math.round(baseAdj*10000)/10000,src:agSt?`${agName}(${agSt.n}건)`:at}}

// ─── 데이터 현황 ───────────────────────────────────────────
function calcDataStatus(rows){if(!rows||!rows.length)return null;const withOd=rows.filter(r=>r.od);if(!withOd.length)return{total:rows.length,latestDate:null,latestPn:null,latestAg:"",sameDayCount:0};withOd.sort((a,b)=>(b.od>a.od?1:b.od<a.od?-1:0));const l=withOd[0];const sc=withOd.filter(r=>r.od===l.od);return{total:rows.length,latestDate:l.od,latestPn:l.pn?(l.pn.length>35?l.pn.slice(0,35)+"…":l.pn):"(없음)",latestAg:l.ag||"",sameDayCount:sc.length}}

// ─── Supabase CRUD ─────────────────────────────────────────
async function sbFetchAll(){const PAGE=1000;let all=[],offset=0;while(true){const res=await fetch(SB_URL+"/rest/v1/bid_records?select=*&order=od.desc&offset="+offset+"&limit="+PAGE,{headers:hdrsSel});const rows=await res.json();if(!Array.isArray(rows))break;all=all.concat(rows);if(rows.length<PAGE)break;offset+=PAGE}return all}
async function sbUpsert(rows){const BATCH=200;for(let i=0;i<rows.length;i+=BATCH){const batch=rows.slice(i,i+BATCH);const seen=new Set(),unique=[];for(const r of batch){if(!seen.has(r.dedup_key)){seen.add(r.dedup_key);unique.push(r)}}const body=sanitizeJson(JSON.stringify(unique));const res=await fetch(SB_URL+"/rest/v1/bid_records?on_conflict=dedup_key",{method:"POST",headers:{...hdrs,"Prefer":"resolution=merge-duplicates,return=minimal"},body});if(!res.ok)throw new Error(`Upsert: ${res.status}`)}}
async function sbDeleteIds(ids){const BATCH=50;for(let i=0;i<ids.length;i+=BATCH){await fetch(SB_URL+"/rest/v1/bid_records?id=in.("+ids.slice(i,i+BATCH).join(",")+")",{method:"DELETE",headers:hdrs})}}
async function sbDeleteAll(){await fetch(SB_URL+"/rest/v1/bid_records?id=gt.0",{method:"DELETE",headers:hdrs})}

// 예측 DB
async function sbSavePredictions(preds){const BATCH=50;for(let i=0;i<preds.length;i+=BATCH){const batch=preds.slice(i,i+BATCH);const seen=new Set(),unique=[];for(const r of batch){if(!seen.has(r.dedup_key)){seen.add(r.dedup_key);unique.push(r)}}const body=sanitizeJson(JSON.stringify(unique));await fetch(SB_URL+"/rest/v1/bid_predictions?on_conflict=dedup_key",{method:"POST",headers:{...hdrs,"Prefer":"resolution=merge-duplicates,return=minimal"},body})}}
async function sbFetchPredictions(){try{const PAGE=1000;let all=[],offset=0;while(true){const res=await fetch(SB_URL+"/rest/v1/bid_predictions?select=*&order=created_at.desc&offset="+offset+"&limit="+PAGE,{headers:hdrsSel});if(!res.ok)return[];const rows=await res.json();if(!Array.isArray(rows))return all;all=all.concat(rows);if(rows.length<PAGE)break;offset+=PAGE}return all}catch(e){return[]}}

// 자동 매칭: bid_predictions.pn_no → bid_records.pn_no
async function sbMatchPredictions(predictions,records){
  const recMap={};for(const r of records){if(r.pn_no&&r.pn_no.length>5)recMap[r.pn_no]=r}
  const updates=[];
  for(const p of predictions){
    if(p.match_status==="matched")continue;
    if(!p.pn_no)continue;
    const match=recMap[p.pn_no];
    if(match){
      const actualAdj=match.br1!=null?Math.round((match.br1-100)*10000)/10000:null;
      const adjErr=p.pred_adj_rate!=null&&actualAdj!=null?Math.round((p.pred_adj_rate-actualAdj)*10000)/10000:null;
      const bidErr=p.pred_bid_amount!=null&&match.bp!=null?Math.round(p.pred_bid_amount-match.bp):null;
      updates.push({id:p.id,actual_adj_rate:actualAdj,actual_expected_price:match.xp,actual_bid_amount:match.bp,actual_winner:match.co,actual_participant_count:match.pc,adj_rate_error:adjErr,bid_amount_error:bidErr,match_status:"matched",matched_record_id:match.id,matched_at:new Date().toISOString()})
    }
  }
  // patch each
  for(const u of updates){
    const{id,...data}=u;
    await fetch(SB_URL+"/rest/v1/bid_predictions?id=eq."+id,{method:"PATCH",headers:{...hdrs,"Prefer":"return=minimal"},body:JSON.stringify(data)})
  }
  return updates.length}

// ─── 컴포넌트 ──────────────────────────────────────────────
const inpS={width:"100%",padding:"7px 10px",background:"#0c0c1a",border:"1px solid #252540",borderRadius:5,color:"#e8e8f0",fontSize:12,outline:"none"};
function NI({value,onChange}){return<input value={value==="0"?"0":tc(value)} onChange={e=>{const r=e.target.value.replace(/,/g,"").replace(/[^0-9]/g,"");onChange(r===""?"0":r)}} style={{...inpS,textAlign:"right",fontFamily:"monospace"}}/>}
const PAGE=50;

// ═══════════════════════════════════════════════════════════
export default function App(){
  const[tab,setTab]=useState("upload");
  const[recs,setRecs]=useState([]);
  const[allS,setAllS]=useState({ts:{},as:{}});const[newS,setNewS]=useState({ts:{},as:{}});const[oldS,setOldS]=useState({ts:{},as:{}});
  const[drag,setDrag]=useState(false);const[busy,setBusy]=useState(false);const[msg,setMsg]=useState({type:"",text:""});
  const[uploadLog,setUploadLog]=useState([]);const[dataStatus,setDataStatus]=useState(null);
  const[inp,setInp]=useState({agency:"",baseAmount:"0",estimatedPrice:"0",aValue:"0"});const[pred,setPred]=useState(null);
  const[search,setSearch]=useState("");const[sV,setSV]=useState("type");const[agSch,setAgSch]=useState("");const[eF,setEF]=useState("all");
  const[sel,setSel]=useState({});const[dlgType,setDlgType]=useState("");const[dataPage,setDataPage]=useState(0);const[dbLoading,setDbLoading]=useState(true);
  // 예측 관련
  const[predMode,setPredMode]=useState("manual"); // manual | file
  const[predResults,setPredResults]=useState([]); // 파일 업로드 예측 결과
  const[predictions,setPredictions]=useState([]); // DB에서 로드한 예측 내역
  const[compFilter,setCompFilter]=useState("all"); // all | matched | pending
  const[predListFilter,setPredListFilter]=useState("all"); // all | file_upload | manual

  const refreshStats=useCallback(rows=>{setAllS(calcStats(rows));setNewS(calcStats(rows,r=>r.era==="new"));setOldS(calcStats(rows,r=>r.era==="old"))},[]);

  // DB 로드
  useEffect(()=>{
    (async()=>{
      try{
        const rows=await sbFetchAll();
        setRecs(rows);refreshStats(rows);setDataStatus(calcDataStatus(rows));
        if(rows.length>0)setTab("stats");
      }catch(e){setMsg({type:"err",text:"낙찰DB 로드 실패: "+e.message})}
      try{
        const preds=await sbFetchPredictions();
        setPredictions(preds||[]);
      }catch(e){setPredictions([])}
      setDbLoading(false);
    })()},[refreshStats]);

  // 낙찰정보리스트 업로드
  const loadFiles=useCallback(async(fileList)=>{
    const files=Array.from(fileList).filter(Boolean);if(!files.length)return;setBusy(true);setMsg({type:"",text:""});setUploadLog([]);const logs=[];
    for(const file of files){try{const{rows:raw,format}=await parseFile(file);if(!raw.length)throw new Error("0건");const hdr=raw[0]||[];const isPn=hdr.some(v=>String(v).includes("공고명"));if(!isPn)throw new Error("공고명 컬럼 없음");const nr=toRecords(raw.slice(1));await sbUpsert(nr);const nc=nr.filter(r=>r.era==="new").length,oc=nr.filter(r=>r.era==="old").length;logs.push({name:file.name,type:"ok",text:`[${format}] ${nr.length}건 | 신${nc}·구${oc}`});setUploadLog([...logs])}catch(e){logs.push({name:file.name,type:"err",text:e.message});setUploadLog([...logs])}}
    try{const[rows,preds]=await Promise.all([sbFetchAll(),sbFetchPredictions()]);setRecs(rows);refreshStats(rows);setDataStatus(calcDataStatus(rows));
      // 자동 매칭 실행
      const matched=await sbMatchPredictions(preds,rows);
      if(matched>0){const updPreds=await sbFetchPredictions();setPredictions(updPreds);setMsg({type:"ok",text:`업로드 완료 · ${matched}건 예측 자동 매칭`})}
      else setPredictions(preds);
    }catch(e){setMsg({type:"err",text:"DB 재로드 실패"})}
    setSel({});if(logs.some(l=>l.type==="ok"))setTab("stats");setBusy(false)},[refreshStats]);

  // 입찰서류함 예측
  const loadPredFile=useCallback(async(file)=>{
    if(!file)return;setBusy(true);setMsg({type:"",text:""});
    try{
      const{rows}=await parseFile(file);const items=parseBidDoc(rows);if(!items.length)throw new Error("예측 대상 0건");
      const results=items.map(item=>{
        const p=predictV2({at:item.at,agName:item.ag,ba:item.ba,ep:item.ep,av:item.av,pc:0},allS.ts,allS.as);
        return{...item,pred:p}}).filter(r=>r.pred);
      setPredResults(results);
      // DB 저장
      const dbRows=results.map(r=>({dedup_key:r.dedup_key,pn:r.pn,pn_no:r.pn_no,ag:r.ag,at:r.at,ep:r.ep,ba:r.ba,av:r.av,raw_cost:r.raw_cost,cat:r.cat,open_date:r.open_date,pred_adj_rate:r.pred.adj,pred_expected_price:r.pred.xp,pred_floor_rate:r.pred.fr,pred_bid_amount:r.pred.bid,pred_source:r.pred.src,pred_base_adj:r.pred.baseAdj,source:"file_upload",match_status:"pending"}));
      await sbSavePredictions(dbRows);
      const preds=await sbFetchPredictions();setPredictions(preds);
      setMsg({type:"ok",text:`${results.length}건 예측 완료 · DB 저장됨`});
    }catch(e){setMsg({type:"err",text:"예측 실패: "+e.message})}
    setBusy(false)},[allS]);

  // 수동 예측 + DB 저장
  const doManualPred=useCallback(async()=>{
    const p=predictV2({at:clsAg(inp.agency),agName:inp.agency.trim(),ba:tn(inp.baseAmount),ep:tn(inp.estimatedPrice),av:tn(inp.aValue),pc:0},allS.ts,allS.as);
    setPred(p);
    if(p){
      const dk=md5("pred|manual|"+inp.agency+"|"+inp.baseAmount+"|"+Date.now());
      const row={dedup_key:dk,pn:"수동입력: "+inp.agency,pn_no:null,ag:inp.agency.trim(),at:clsAg(inp.agency),ep:tn(inp.estimatedPrice)||null,ba:tn(inp.baseAmount),av:tn(inp.aValue),raw_cost:null,cat:null,open_date:null,pred_adj_rate:p.adj,pred_expected_price:p.xp,pred_floor_rate:p.fr,pred_bid_amount:p.bid,pred_source:p.src,pred_base_adj:p.baseAdj,source:"manual",match_status:"pending"};
      try{await sbSavePredictions([row]);const preds=await sbFetchPredictions();setPredictions(preds)}catch(e){/* silent */}
    }},[inp,allS]);

  // 삭제
  const selCount=Object.keys(sel).filter(k=>sel[k]).length;
  const[delConfirm,setDelConfirm]=useState("");
  const doDelete=useCallback(async()=>{
    if(dlgType==="all"&&delConfirm!=="삭제"){return}
    setBusy(true);try{if(dlgType==="all"){await sbDeleteAll();setRecs([]);refreshStats([]);setDataStatus(null);setMsg({type:"ok",text:"전체 삭제 완료"})}else if(dlgType==="sel"){const ids=Object.keys(sel).filter(k=>sel[k]).map(Number);await sbDeleteIds(ids);setRecs(prev=>{const next=prev.filter(r=>!sel[r.id]);refreshStats(next);setDataStatus(calcDataStatus(next));return next});setMsg({type:"ok",text:`${ids.length}건 삭제`});setSel({})}}catch(e){setMsg({type:"err",text:"삭제 실패"})}setDlgType("");setDelConfirm("");setBusy(false)},[dlgType,sel,refreshStats,delConfirm]);

  const curSt=eF==="new"?newS:eF==="old"?oldS:allS;
  const filteredRecs=useMemo(()=>{const t=search.toLowerCase();let src=recs;if(eF==="new")src=recs.filter(r=>r.era==="new");else if(eF==="old")src=recs.filter(r=>r.era==="old");return t?src.filter(r=>((r.pn||"")+(r.ag||"")+(r.co||"")).toLowerCase().includes(t)):src},[recs,search,eF]);
  const pagedRecs=useMemo(()=>filteredRecs.slice(dataPage*PAGE,(dataPage+1)*PAGE),[filteredRecs,dataPage]);
  const totalPages=Math.max(1,Math.ceil(filteredRecs.length/PAGE));
  const fAg=useMemo(()=>{const t=agSch.toLowerCase();return Object.entries(curSt.as||{}).filter(([k])=>!t||mSch(k,t)).sort((a,b)=>b[1].n-a[1].n)},[curSt.as,agSch]);
  const agencyList=useMemo(()=>Object.keys(allS.as||{}).sort(),[allS.as]);
  const nC=recs.filter(r=>r.era==="new").length,oC=recs.filter(r=>r.era==="old").length;
  const allSel=pagedRecs.length>0&&pagedRecs.every(r=>sel[r.id]);

  // 비교 탭 통계
  const compStats=useMemo(()=>{
    const preds=predictions||[];
    const matched=preds.filter(p=>p.match_status==="matched");
    const pending=preds.filter(p=>p.match_status==="pending");
    const errors=matched.filter(p=>p.adj_rate_error!=null).map(p=>Math.abs(p.adj_rate_error));
    const avgErr=errors.length?Math.round(errors.reduce((a,b)=>a+b,0)/errors.length*10000)/10000:0;
    // 기관유형별
    const byType={};matched.forEach(p=>{const t=p.at||"기타";if(!byType[t])byType[t]={n:0,errSum:0};byType[t].n++;if(p.adj_rate_error!=null)byType[t].errSum+=Math.abs(p.adj_rate_error)});
    Object.values(byType).forEach(v=>{v.avgErr=v.n?Math.round(v.errSum/v.n*10000)/10000:0});
    return{total:preds.length,matched:matched.length,pending:pending.length,avgErr,byType,matchedList:matched,pendingList:pending}},[predictions]);
  const compList=useMemo(()=>{const p=predictions||[];if(compFilter==="matched")return compStats.matchedList;if(compFilter==="pending")return compStats.pendingList;return p},[predictions,compFilter,compStats]);
  const filteredPreds=useMemo(()=>{const p=predictions||[];if(predListFilter==="all")return p;return p.filter(x=>x.source===predListFilter)},[predictions,predListFilter]);

  const btnS=(act,c)=>({padding:"3px 10px",fontSize:10,fontWeight:act?600:400,background:act?c+"22":"#1a1a30",color:act?c:"#888",border:"1px solid "+(act?c+"44":"#252540"),borderRadius:4,cursor:"pointer",marginRight:4});
  const Tb=({id,ch,badge})=>(<button onClick={()=>{setTab(id);setDataPage(0)}} style={{padding:"8px 14px",fontSize:11,fontWeight:tab===id?600:400,background:tab===id?C.bg3:"transparent",color:tab===id?C.gold:C.txm,border:"none",borderBottom:tab===id?`2px solid ${C.gold}`:"2px solid transparent",cursor:"pointer",position:"relative"}}>{ch}{badge>0&&<span style={{position:"absolute",top:2,right:2,background:"#e24b4a",color:"#fff",fontSize:8,padding:"1px 4px",borderRadius:6,minWidth:14,textAlign:"center"}}>{badge}</span>}</button>);
  const Era=({id,ch})=>(<button onClick={()=>setEF(id)} style={btnS(eF===id,id==="new"?"#5dca96":id==="old"?"#e24b4a":C.gold)}>{ch}</button>);

  return(<div style={{fontFamily:"system-ui,sans-serif",background:C.bg,color:C.txt,minHeight:"100vh"}}>
    {dlgType&&<div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,.6)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>{setDlgType("");setDelConfirm("")}}><div onClick={e=>e.stopPropagation()} style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,padding:24,maxWidth:380,width:"90%"}}>
      <div style={{fontSize:14,fontWeight:600,color:"#e24b4a",marginBottom:8}}>{dlgType==="sel"?selCount+"건 삭제":"전체 삭제"}</div>
      <div style={{fontSize:12,color:C.txm,marginBottom:12}}>DB에서 영구 삭제됩니다. 복구할 수 없습니다.</div>
      {dlgType==="all"&&<div style={{marginBottom:12}}>
        <div style={{fontSize:11,color:C.txd,marginBottom:4}}>확인을 위해 <span style={{color:"#e24b4a",fontWeight:600}}>"삭제"</span>를 입력하세요</div>
        <input value={delConfirm} onChange={e=>setDelConfirm(e.target.value)} placeholder="삭제" style={{...inpS,borderColor:"#e24b4a44"}}/>
      </div>}
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <button onClick={()=>{setDlgType("");setDelConfirm("")}} style={{padding:"6px 16px",background:C.bg3,border:"1px solid "+C.bdr,borderRadius:5,color:C.txt,fontSize:11,cursor:"pointer"}}>취소</button>
        <button onClick={doDelete} disabled={busy||(dlgType==="all"&&delConfirm!=="삭제")} style={{padding:"6px 16px",background:dlgType==="all"&&delConfirm!=="삭제"?"#555":"#e24b4a",border:"none",borderRadius:5,color:"#fff",fontSize:11,fontWeight:600,cursor:dlgType==="all"&&delConfirm!=="삭제"?"not-allowed":"pointer"}}>{busy?"처리중...":"삭제 실행"}</button>
      </div></div></div>}

    {/* 헤더 */}
    <div style={{padding:"10px 20px",borderBottom:"1px solid "+C.bdr,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}><span style={{fontSize:15,fontWeight:700,color:C.gold}}>입찰 분석 시스템 v2.1</span><span style={{fontSize:10,color:C.txd}}>{recs.length.toLocaleString()}건 (신{nC}/구{oC})</span></div>
      <div style={{display:"flex",gap:0,flexWrap:"wrap"}}><Tb id="upload" ch="업로드"/><Tb id="stats" ch="통계"/><Tb id="data" ch="데이터"/><Tb id="predict" ch="예측"/><Tb id="compare" ch="비교" badge={compStats.pending}/></div>
    </div>

    <div style={{maxWidth:980,margin:"0 auto",padding:"16px 12px"}}>
      {/* 시대 필터 */}
      {(tab==="stats"||tab==="data")&&<div style={{marginBottom:12,display:"flex",gap:4}}><Era id="all" ch="전체"/><Era id="new" ch="신기준"/><Era id="old" ch="구기준"/></div>}
      {msg.text&&<div style={{marginBottom:12,padding:"8px 14px",background:msg.type==="ok"?"rgba(93,202,165,0.08)":"rgba(220,50,50,0.08)",border:`1px solid ${msg.type==="ok"?"rgba(93,202,165,0.3)":"rgba(220,50,50,0.3)"}`,borderRadius:6,fontSize:11,color:msg.type==="ok"?"#5ca":"#e55"}}>{msg.type==="ok"?"✓ ":"✕ "}{msg.text}</div>}

      {/* ═══ 업로드 탭 ═══ */}
      {tab==="upload"&&<div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,padding:20}}>
        <div style={{border:`2px dashed ${drag?C.gold:C.bdr}`,borderRadius:10,padding:"44px 20px",textAlign:"center",cursor:busy?"default":"pointer",background:drag?"rgba(212,168,52,0.05)":"transparent"}}
          onDrop={e=>{e.preventDefault();setDrag(false);if(!busy)loadFiles(e.dataTransfer.files)}} onDragOver={e=>{e.preventDefault();if(!busy)setDrag(true)}} onDragLeave={()=>setDrag(false)}
          onClick={()=>{if(!busy)document.getElementById("fi").click()}}>
          <input id="fi" type="file" accept=".xls,.xlsx" multiple style={{display:"none"}} onChange={e=>{if(e.target.files?.length){loadFiles(e.target.files);e.target.value=""}}}/>
          {busy?<div style={{color:C.gold,fontSize:14}}>처리 중...</div>:<>
            <div style={{fontSize:36,opacity:0.4,marginBottom:8}}>↑</div>
            <div style={{fontSize:14,fontWeight:600,marginBottom:6}}>낙찰정보리스트 업로드</div>
            <div style={{fontSize:11,color:C.txd}}>XLS/XLSX · 복수 파일 · 중복 제거 · 예측 자동 매칭</div>
            {dbLoading&&<div style={{marginTop:14,fontSize:11,color:C.txd}}>DB 연결 중...</div>}
            {!dbLoading&&recs.length===0&&<div style={{marginTop:14,padding:"12px 16px",background:"rgba(226,75,74,0.08)",border:"1px solid rgba(226,75,74,0.2)",borderRadius:6,textAlign:"left",fontSize:11,lineHeight:1.7,color:"#e24b4a"}}>
              낙찰 데이터가 없습니다. 낙찰정보리스트 XLS 파일을 업로드해주세요.
            </div>}
            {dataStatus&&dataStatus.total>0&&<div style={{marginTop:14,padding:"10px 16px",background:"rgba(212,168,52,0.06)",border:"1px solid rgba(212,168,52,0.15)",borderRadius:6,textAlign:"left",fontSize:11,lineHeight:1.7}}>
              <div style={{fontWeight:600,color:C.gold,marginBottom:4,fontSize:12}}>데이터 현황</div>
              <div style={{color:C.txm}}>총 <span style={{color:C.txt,fontWeight:600}}>{dataStatus.total.toLocaleString()}건</span> 저장</div>
              {dataStatus.latestDate&&<><div style={{color:C.txm}}>최신 개찰일: <span style={{color:"#5dca96",fontWeight:600}}>{dataStatus.latestDate}</span> <span style={{color:C.txd}}>({dataStatus.sameDayCount}건)</span></div>
              <div style={{color:C.txd,fontSize:10,marginTop:2}}>{dataStatus.latestPn}{dataStatus.latestAg&&<span style={{marginLeft:6,color:"#888"}}>- {dataStatus.latestAg}</span>}</div></>}
            </div>}
          </>}
        </div>
        {uploadLog.length>0&&<div style={{marginTop:12}}>{uploadLog.map((l,i)=><div key={i} style={{padding:"6px 10px",fontSize:11,color:l.type==="ok"?"#5ca":"#e55",borderBottom:"1px solid "+C.bdr}}>{l.type==="ok"?"✓":"✕"} {l.name} — {l.text}</div>)}</div>}
        {recs.length>0&&<div style={{marginTop:16}}><button onClick={()=>setDlgType("all")} style={{padding:"6px 14px",background:"rgba(220,50,50,0.1)",border:"1px solid rgba(220,50,50,0.3)",borderRadius:5,color:"#e55",fontSize:11,cursor:"pointer"}}>전체 삭제 ({recs.length}건)</button></div>}
      </div>}

      {/* ═══ 통계 탭 ═══ */}
      {tab==="stats"&&<div>
        <div style={{display:"flex",gap:4,marginBottom:12}}><button onClick={()=>setSV("type")} style={btnS(sV==="type",C.gold)}>기관유형별</button><button onClick={()=>setSV("agency")} style={btnS(sV==="agency",C.gold)}>발주기관별</button></div>
        {sV==="type"&&<div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,overflow:"hidden"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}><thead><tr style={{background:C.bg3}}>{["기관유형","건수","평균사정율","중앙값"].map((h,i)=><th key={i} style={{padding:"8px 10px",textAlign:i>0?"right":"left",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr}}>{h}</th>)}</tr></thead><tbody>{Object.entries(curSt.ts||{}).sort((a,b)=>b[1].n-a[1].n).map(([k,v])=><tr key={k} style={{borderBottom:"1px solid "+C.bdr}}><td style={{padding:"7px 10px",color:C.gold}}>{k}</td><td style={{padding:"7px 10px",textAlign:"right"}}>{v.n}</td><td style={{padding:"7px 10px",textAlign:"right",color:"#5dca96"}}>{v.avg.toFixed(4)}%</td><td style={{padding:"7px 10px",textAlign:"right"}}>{v.med.toFixed(4)}%</td></tr>)}</tbody></table></div>}
        {sV==="agency"&&<div><input value={agSch} onChange={e=>setAgSch(e.target.value)} placeholder="발주기관 검색 (초성 가능)" style={{...inpS,marginBottom:8}}/><div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,overflow:"hidden",maxHeight:500,overflowY:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}><thead><tr style={{background:C.bg3}}>{["발주기관","유형","건수","평균","중앙값"].map((h,i)=><th key={i} style={{padding:"8px 10px",textAlign:i>1?"right":"left",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr}}>{h}</th>)}</tr></thead><tbody>{fAg.slice(0,100).map(([k,v])=><tr key={k} style={{borderBottom:"1px solid "+C.bdr}}><td style={{padding:"6px 10px",maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{k}</td><td style={{padding:"6px 10px",color:C.txd,fontSize:10}}>{v.type}</td><td style={{padding:"6px 10px",textAlign:"right"}}>{v.n}</td><td style={{padding:"6px 10px",textAlign:"right",color:"#5dca96"}}>{v.avg.toFixed(4)}%</td><td style={{padding:"6px 10px",textAlign:"right"}}>{v.med.toFixed(4)}%</td></tr>)}</tbody></table></div></div>}
      </div>}

      {/* ═══ 데이터 탭 ═══ */}
      {tab==="data"&&<div>
        <div style={{display:"flex",gap:8,marginBottom:8,flexWrap:"wrap",alignItems:"center"}}><input value={search} onChange={e=>{setSearch(e.target.value);setDataPage(0)}} placeholder="검색" style={{...inpS,flex:1,minWidth:150}}/>{selCount>0&&<button onClick={()=>setDlgType("sel")} style={{padding:"5px 12px",background:"rgba(220,50,50,0.1)",border:"1px solid rgba(220,50,50,0.3)",borderRadius:5,color:"#e55",fontSize:11,cursor:"pointer"}}>{selCount}건 삭제</button>}<span style={{fontSize:10,color:C.txd}}>{filteredRecs.length}건</span></div>
        <div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,overflow:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:10,tableLayout:"fixed"}}><colgroup><col style={{width:28}}/><col style={{width:"22%"}}/><col style={{width:"14%"}}/><col style={{width:"7%"}}/><col style={{width:"10%"}}/><col style={{width:"8%"}}/><col style={{width:"8%"}}/><col style={{width:"8%"}}/><col style={{width:"5%"}}/></colgroup>
          <thead><tr style={{background:C.bg3}}><th style={{padding:6}}><input type="checkbox" checked={allSel} onChange={()=>{const n={};if(!allSel)pagedRecs.forEach(r=>{n[r.id]=true});setSel(n)}}/></th>{["공고명","발주기관","유형","기초금액","사정율","1순위","개찰일",""].map((h,i)=><th key={i} style={{padding:"6px 4px",textAlign:i>=3?"right":"left",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr}}>{h}</th>)}</tr></thead>
          <tbody>{pagedRecs.map(r=><tr key={r.id} style={{borderBottom:"1px solid "+C.bdr}}><td style={{padding:4,textAlign:"center"}}><input type="checkbox" checked={!!sel[r.id]} onChange={()=>setSel(p=>({...p,[r.id]:!p[r.id]}))}/></td><td style={{padding:"5px 4px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={r.pn}>{r.pn||"(없음)"}</td><td style={{padding:"5px 4px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={r.ag}>{r.ag||""}</td><td style={{padding:"5px 4px",color:C.txd}}>{r.at}</td><td style={{padding:"5px 4px",textAlign:"right",fontFamily:"monospace"}}>{r.ba?tc(r.ba):""}</td><td style={{padding:"5px 4px",textAlign:"right",color:"#5dca96"}}>{r.ar1!=null?r.ar1.toFixed(4):""}</td><td style={{padding:"5px 4px",textAlign:"right",color:C.gold}}>{r.br1!=null?r.br1.toFixed(4):""}</td><td style={{padding:"5px 4px",textAlign:"right"}}>{r.od||""}</td><td style={{padding:"5px 4px",textAlign:"center",color:r.era==="new"?"#5dca96":"#e24b4a",fontSize:9}}>{r.era==="new"?"신":"구"}</td></tr>)}</tbody></table></div>
        <div style={{display:"flex",justifyContent:"center",gap:6,marginTop:10}}><button disabled={dataPage===0} onClick={()=>setDataPage(p=>p-1)} style={{padding:"4px 10px",fontSize:10,background:C.bg3,border:"1px solid "+C.bdr,borderRadius:4,color:C.txt,cursor:dataPage===0?"default":"pointer"}}>◀</button><span style={{fontSize:10,color:C.txd}}>{dataPage+1}/{totalPages}</span><button disabled={dataPage>=totalPages-1} onClick={()=>setDataPage(p=>p+1)} style={{padding:"4px 10px",fontSize:10,background:C.bg3,border:"1px solid "+C.bdr,borderRadius:4,color:C.txt,cursor:dataPage>=totalPages-1?"default":"pointer"}}>▶</button></div>
      </div>}

      {/* ═══ 예측 탭 ═══ */}
      {tab==="predict"&&<div>
        <div style={{display:"flex",gap:4,marginBottom:12}}>
          <button onClick={()=>setPredMode("manual")} style={btnS(predMode==="manual","#5dca96")}>수동 입력</button>
          <button onClick={()=>setPredMode("file")} style={btnS(predMode==="file","#5dca96")}>파일 업로드</button>
        </div>

        {predMode==="manual"&&<div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,padding:20,marginBottom:16}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
            <div><div style={{fontSize:10,color:C.txm,marginBottom:4}}>발주기관</div><input value={inp.agency} onChange={e=>setInp(p=>({...p,agency:e.target.value}))} placeholder="기관명" style={inpS} list="agL"/><datalist id="agL">{agencyList.slice(0,20).map(a=><option key={a} value={a}/>)}</datalist></div>
            <div><div style={{fontSize:10,color:C.txm,marginBottom:4}}>기관유형: <span style={{color:C.gold}}>{clsAg(inp.agency)}</span></div></div>
            <div><div style={{fontSize:10,color:C.txm,marginBottom:4}}>기초금액</div><NI value={inp.baseAmount} onChange={v=>setInp(p=>({...p,baseAmount:v}))}/></div>
            <div><div style={{fontSize:10,color:C.txm,marginBottom:4}}>추정가격</div><NI value={inp.estimatedPrice} onChange={v=>setInp(p=>({...p,estimatedPrice:v}))}/></div>
            <div><div style={{fontSize:10,color:C.txm,marginBottom:4}}>A값 (없으면 0)</div><NI value={inp.aValue} onChange={v=>setInp(p=>({...p,aValue:v}))}/></div>
          </div>
          <button onClick={doManualPred} style={{width:"100%",padding:"10px",background:C.gold,border:"none",borderRadius:6,color:"#000",fontWeight:700,fontSize:13,cursor:"pointer"}}>예측 실행 + DB 저장</button>
          {pred&&<div style={{marginTop:16,padding:16,background:C.bg3,borderRadius:8,fontSize:12,lineHeight:2}}>
            <div style={{fontWeight:600,color:C.gold,marginBottom:8,fontSize:14}}>예측 결과</div>
            <div>예측 사정율: <span style={{color:"#5dca96",fontWeight:700}}>{pred.adj.toFixed(4)}%</span> <span style={{color:C.txd,fontSize:11}}>( 100% 기준: {(100+pred.adj).toFixed(4)}% )</span></div>
            <div>예정가격(추정): <span style={{fontWeight:600}}>{tc(pred.xp)}원</span></div>
            <div>적용 투찰율: <span style={{color:C.gold}}>{pred.fr}%</span></div>
            <div style={{fontWeight:700,fontSize:14,color:C.gold,marginTop:8}}>추천 투찰금액: {tc(pred.bid)}원</div>
            <div style={{marginTop:8,fontSize:10,color:C.txd}}>근거: {pred.src} | 평균사정율 {pred.baseAdj.toFixed(4)}%</div>
          </div>}
        </div>}

        {predMode==="file"&&<div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,padding:20,marginBottom:16}}>
          <div style={{border:`2px dashed ${C.bdr}`,borderRadius:10,padding:"30px 20px",textAlign:"center",cursor:busy?"default":"pointer"}}
            onClick={()=>{if(!busy)document.getElementById("pfi").click()}}>
            <input id="pfi" type="file" accept=".xls,.xlsx" style={{display:"none"}} onChange={e=>{if(e.target.files?.[0]){loadPredFile(e.target.files[0]);e.target.value=""}}}/>
            {busy?<div style={{color:C.gold,fontSize:14}}>예측 처리 중...</div>:<>
              <div style={{fontSize:28,opacity:0.4,marginBottom:6}}>↑</div>
              <div style={{fontSize:14,fontWeight:600,marginBottom:4}}>입찰서류함 업로드</div>
              <div style={{fontSize:11,color:C.txd}}>XLS 파일의 각 건에 대해 일괄 예측 실행 + DB 저장</div>
            </>}
          </div>
        </div>}

        {/* ── 예측 내역 리스트 (DB 기반, 항상 표시) ── */}
        <div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,padding:16}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{fontSize:13,fontWeight:600,color:C.gold}}>예측 내역 ({(predictions||[]).length}건)</div>
            <div style={{display:"flex",gap:4}}>
              <button onClick={()=>setPredListFilter("all")} style={btnS(predListFilter==="all",C.gold)}>전체</button>
              <button onClick={()=>setPredListFilter("file_upload")} style={btnS(predListFilter==="file_upload","#5dca96")}>파일</button>
              <button onClick={()=>setPredListFilter("manual")} style={btnS(predListFilter==="manual","#5dca96")}>수동</button>
            </div>
          </div>
          {filteredPreds.length>0?<div style={{overflow:"auto",maxHeight:500}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:10,tableLayout:"fixed"}}>
              <colgroup><col style={{width:"20%"}}/><col style={{width:"10%"}}/><col style={{width:"10%"}}/><col style={{width:"7%"}}/><col style={{width:"7%"}}/><col style={{width:"8%"}}/><col style={{width:"9%"}}/><col style={{width:"7%"}}/><col style={{width:"12%"}}/><col style={{width:"5%"}}/><col style={{width:"5%"}}/></colgroup>
              <thead><tr style={{background:C.bg3}}>{["공고명","발주기관","기초금액","A값","사정율","사정율(100%)","예정가격","투찰율","추천투찰금액","개찰일","구분"].map((h,i)=><th key={i} style={{padding:"6px 3px",textAlign:i>=2?"right":"left",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:9}}>{h}</th>)}</tr></thead>
              <tbody>{filteredPreds.map(p=><tr key={p.id} style={{borderBottom:"1px solid "+C.bdr}}>
                <td style={{padding:"5px 3px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={p.pn}>{p.pn}</td>
                <td style={{padding:"5px 3px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.ag}</td>
                <td style={{padding:"5px 3px",textAlign:"right",fontFamily:"monospace"}}>{p.ba?tc(p.ba):""}</td>
                <td style={{padding:"5px 3px",textAlign:"right",fontFamily:"monospace"}}>{p.av?tc(p.av):"0"}</td>
                <td style={{padding:"5px 3px",textAlign:"right",color:"#5dca96"}}>{p.pred_adj_rate!=null?Number(p.pred_adj_rate).toFixed(4)+"%":""}</td>
                <td style={{padding:"5px 3px",textAlign:"right",color:"#5dca96"}}>{p.pred_adj_rate!=null?(100+Number(p.pred_adj_rate)).toFixed(4)+"%":""}</td>
                <td style={{padding:"5px 3px",textAlign:"right",fontFamily:"monospace"}}>{p.pred_expected_price?tc(p.pred_expected_price):""}</td>
                <td style={{padding:"5px 3px",textAlign:"right",color:C.gold}}>{p.pred_floor_rate?Number(p.pred_floor_rate).toFixed(3)+"%":""}</td>
                <td style={{padding:"5px 3px",textAlign:"right",fontWeight:600,color:C.gold,fontFamily:"monospace"}}>{p.pred_bid_amount?tc(p.pred_bid_amount):""}</td>
                <td style={{padding:"5px 3px",textAlign:"right",fontSize:9}}>{p.open_date||""}</td>
                <td style={{padding:"5px 3px",textAlign:"center"}}><span style={{fontSize:8,padding:"1px 4px",borderRadius:3,background:p.source==="file_upload"?"rgba(93,202,165,0.15)":"rgba(212,168,52,0.15)",color:p.source==="file_upload"?"#5dca96":C.gold}}>{p.source==="file_upload"?"파일":"수동"}</span></td>
              </tr>)}</tbody>
            </table>
          </div>:<div style={{textAlign:"center",padding:30,color:C.txd,fontSize:12}}>예측 내역이 없습니다. 위에서 수동 입력 또는 파일 업로드로 예측을 실행하세요.</div>}
        </div>
      </div>}

      {/* ═══ 비교 탭 ═══ */}
      {tab==="compare"&&<div>
        {/* 요약 카드 */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:16}}>
          {[{label:"총 예측",value:compStats.total,color:C.txt},{label:"매칭 완료",value:compStats.matched,color:"#5dca96"},{label:"평균 오차",value:compStats.avgErr.toFixed(4)+"%",color:C.gold},{label:"대기 중",value:compStats.pending,color:"#e24b4a"}].map((c,i)=>
            <div key={i} style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,padding:"12px 10px",textAlign:"center"}}>
              <div style={{fontSize:10,color:C.txd,marginBottom:4}}>{c.label}</div>
              <div style={{fontSize:18,fontWeight:600,color:c.color}}>{c.value}</div>
            </div>)}
        </div>

        {/* 기관유형별 정확도 */}
        {Object.keys(compStats.byType).length>0&&<div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,overflow:"hidden",marginBottom:16}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
            <thead><tr style={{background:C.bg3}}>{["기관유형","매칭 건수","평균 오차"].map((h,i)=><th key={i} style={{padding:"8px 10px",textAlign:i>0?"right":"left",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr}}>{h}</th>)}</tr></thead>
            <tbody>{Object.entries(compStats.byType).sort((a,b)=>b[1].n-a[1].n).map(([k,v])=>
              <tr key={k} style={{borderBottom:"1px solid "+C.bdr}}>
                <td style={{padding:"7px 10px",color:C.gold}}>{k}</td>
                <td style={{padding:"7px 10px",textAlign:"right"}}>{v.n}건</td>
                <td style={{padding:"7px 10px",textAlign:"right",color:v.avgErr<0.5?"#5dca96":"#e24b4a"}}>{v.avgErr.toFixed(4)}%</td>
              </tr>)}</tbody>
          </table>
        </div>}

        {/* 필터 + 목록 */}
        <div style={{display:"flex",gap:4,marginBottom:8}}>
          <button onClick={()=>setCompFilter("all")} style={btnS(compFilter==="all",C.gold)}>전체 ({(predictions||[]).length})</button>
          <button onClick={()=>setCompFilter("matched")} style={btnS(compFilter==="matched","#5dca96")}>매칭 ({compStats.matched})</button>
          <button onClick={()=>setCompFilter("pending")} style={btnS(compFilter==="pending","#e24b4a")}>대기 ({compStats.pending})</button>
        </div>
        <div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,overflow:"auto",maxHeight:500}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:10,tableLayout:"fixed"}}>
            <colgroup><col style={{width:"22%"}}/><col style={{width:"10%"}}/><col style={{width:"10%"}}/><col style={{width:"10%"}}/><col style={{width:"10%"}}/><col style={{width:"10%"}}/><col style={{width:"8%"}}/><col style={{width:"8%"}}/><col style={{width:"7%"}}/></colgroup>
            <thead><tr style={{background:C.bg3}}>{["공고명","발주기관","예측사정율","실제사정율","오차","추천금액","실제금액","개찰일","상태"].map((h,i)=>
              <th key={i} style={{padding:"6px 4px",textAlign:i>=2?"right":"left",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr}}>{h}</th>)}</tr></thead>
            <tbody>{compList.slice(0,100).map(p=>{
              const errColor=p.adj_rate_error!=null?(Math.abs(p.adj_rate_error)<0.3?"#5dca96":Math.abs(p.adj_rate_error)<1?"#d4a834":"#e24b4a"):C.txd;
              return<tr key={p.id} style={{borderBottom:"1px solid "+C.bdr}}>
                <td style={{padding:"5px 4px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={p.pn}>{p.pn}</td>
                <td style={{padding:"5px 4px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.ag}</td>
                <td style={{padding:"5px 4px",textAlign:"right",color:"#5dca96"}}>{p.pred_adj_rate!=null?Number(p.pred_adj_rate).toFixed(4):""}</td>
                <td style={{padding:"5px 4px",textAlign:"right",color:C.gold}}>{p.actual_adj_rate!=null?Number(p.actual_adj_rate).toFixed(4):""}</td>
                <td style={{padding:"5px 4px",textAlign:"right",color:errColor,fontWeight:600}}>{p.adj_rate_error!=null?Number(p.adj_rate_error).toFixed(4):"-"}</td>
                <td style={{padding:"5px 4px",textAlign:"right",fontFamily:"monospace"}}>{p.pred_bid_amount?tc(p.pred_bid_amount):""}</td>
                <td style={{padding:"5px 4px",textAlign:"right",fontFamily:"monospace"}}>{p.actual_bid_amount?tc(p.actual_bid_amount):""}</td>
                <td style={{padding:"5px 4px",textAlign:"right"}}>{p.open_date||""}</td>
                <td style={{padding:"5px 4px",textAlign:"center"}}><span style={{fontSize:9,padding:"2px 6px",borderRadius:3,background:p.match_status==="matched"?"rgba(93,202,165,0.15)":"rgba(226,75,74,0.15)",color:p.match_status==="matched"?"#5dca96":"#e24b4a"}}>{p.match_status==="matched"?"매칭":"대기"}</span></td>
              </tr>})}</tbody>
          </table>
        </div>
        {(predictions||[]).length===0&&<div style={{textAlign:"center",padding:40,color:C.txd,fontSize:12}}>예측 내역이 없습니다. 예측 탭에서 먼저 예측을 실행하세요.</div>}
      </div>}
    </div>
  </div>)}
