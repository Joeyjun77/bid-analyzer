import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";

function md5(s){const k=[7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21];const T=[];for(let i=0;i<64;i++)T[i]=(Math.abs(Math.sin(i+1))*0x100000000)>>>0;function f(x,n){return(x<<n)|(x>>>(32-n))}const bytes=[];for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c<128)bytes.push(c);else if(c<2048){bytes.push(192|(c>>6));bytes.push(128|(c&63))}else{bytes.push(224|(c>>12));bytes.push(128|((c>>6)&63));bytes.push(128|(c&63))}}const bl=bytes.length*8;bytes.push(128);while(bytes.length%64!==56)bytes.push(0);bytes.push(bl&0xff,(bl>>8)&0xff,(bl>>16)&0xff,(bl>>24)&0xff,0,0,0,0);let a0=0x67452301,b0=0xefcdab89,c0=0x98badcfe,d0=0x10325476;for(let i=0;i<bytes.length;i+=64){const M=[];for(let j=0;j<16;j++)M[j]=bytes[i+j*4]|(bytes[i+j*4+1]<<8)|(bytes[i+j*4+2]<<16)|(bytes[i+j*4+3]<<24);let A=a0,B=b0,C=c0,D=d0;for(let j=0;j<64;j++){let F,g;if(j<16){F=(B&C)|((~B)&D);g=j}else if(j<32){F=(D&B)|((~D)&C);g=(5*j+1)%16}else if(j<48){F=B^C^D;g=(3*j+5)%16}else{F=C^(B|(~D));g=(7*j)%16}F=(F+A+T[j]+M[g])>>>0;A=D;D=C;C=B;B=(B+f(F,k[(j>>4)*4+(j%4)]))>>>0}a0=(a0+A)>>>0;b0=(b0+B)>>>0;c0=(c0+C)>>>0;d0=(d0+D)>>>0}const hex=n=>{let s="";for(let i=0;i<4;i++)s+=((n>>(i*8))&0xff).toString(16).padStart(2,"0");return s};return hex(a0)+hex(b0)+hex(c0)+hex(d0)}

const SB_URL="https://sadunejfkstxbxogzutl.supabase.co";
const SB_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhZHVuZWpma3N0eGJ4b2d6dXRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2ODYxOTksImV4cCI6MjA5MDI2MjE5OX0.C5kNr-4urLImKfqOi_yl2-SUbrpcSgz2N3IiWGbObgc";
const hdrs={"Content-Type":"application/json","apikey":SB_KEY,"Authorization":"Bearer "+SB_KEY,"Prefer":"return=minimal"};
const hdrsSel={"apikey":SB_KEY,"Authorization":"Bearer "+SB_KEY};

async function sbFetch(path,opt={}){return fetch(SB_URL+"/rest/v1"+path,{headers:opt.select?hdrsSel:hdrs,...opt})}
function sanitizeJson(s){return s.replace(/\\u0000/g,"").replace(/[\uD800-\uDFFF]/g,"").replace(/\x00/g,"")}
async function sbUpsert(rows){
  if(!rows.length)return;
  const seen={};const unique=[];
  for(const r of rows){const k=r.dedup_key;if(k&&k.length>=5&&!seen[k]){seen[k]=true;unique.push(r)}}
  if(!unique.length)return;
  const safify=obj=>{const o={};for(const[k,v]of Object.entries(obj)){if(v===undefined||v===null){o[k]=null}else if(typeof v==="number"){o[k]=isFinite(v)?v:null}else if(typeof v==="string"){o[k]=v.replace(/\x00/g,"").replace(/[\uD800-\uDFFF]/g,"").replace(/[\x01-\x08\x0B\x0C\x0E-\x1F]/g,"")}else{o[k]=v}}return o};
  const safe=unique.map(safify);
  const BATCH=200;
  for(let i=0;i<safe.length;i+=BATCH){
    const batch=safe.slice(i,i+BATCH);
    if(!batch.length)continue;
    const body=sanitizeJson(JSON.stringify(batch));
    if(!body||body==="[]"||body.length<3)continue;
    const res=await fetch(SB_URL+"/rest/v1/bid_records?on_conflict=dedup_key",{
      method:"POST",
      headers:{"Content-Type":"application/json;charset=utf-8","apikey":SB_KEY,"Authorization":"Bearer "+SB_KEY,"Prefer":"resolution=merge-duplicates,return=minimal"},
      body:body});
    if(!res.ok){const t=await res.text();throw new Error("DB upsert 실패(batch "+Math.floor(i/BATCH)+"/"+Math.ceil(safe.length/BATCH)+"): "+res.status+" "+t.slice(0,200))}}}
async function sbDeleteIds(ids){const BATCH=50;for(let i=0;i<ids.length;i+=BATCH){const chunk=ids.slice(i,i+BATCH);await sbFetch("/bid_records?id=in.("+chunk.join(",")+")",{method:"DELETE"})}}
async function sbDeleteAll(){await sbFetch("/bid_records?id=gt.0",{method:"DELETE"})}
async function sbLoadAll(){const PAGE=1000;let all=[],from=0;while(true){const res=await fetch(SB_URL+"/rest/v1/bid_records?order=id.asc&limit="+PAGE+"&offset="+from,{headers:{"apikey":SB_KEY,"Authorization":"Bearer "+SB_KEY,"Accept":"application/json"}});if(!res.ok)throw new Error("DB로드 실패: "+res.status);const rows=await res.json();all=all.concat(rows);if(rows.length<PAGE)break;from+=PAGE}return all}

const OLD_R={"조달청":[{n:5e9,x:1e11,r:85.495},{n:1e9,x:5e9,r:86.745},{n:0,x:1e9,r:87.745}],"지자체":[{n:1e10,x:3e11,r:79.995},{n:5e9,x:1e10,r:85.495},{n:3e9,x:5e9,r:86.745},{n:1e9,x:3e9,r:86.745},{n:0,x:1e9,r:87.745}],"한전":[{n:5e9,x:1e11,r:85.495},{n:1e9,x:5e9,r:86.745},{n:0,x:1e9,r:87.745}],"LH":[{n:5e9,x:1e11,r:85.495},{n:1e9,x:5e9,r:86.745},{n:0,x:1e9,r:87.745}],"군시설":[{n:5e9,x:1e11,r:85.495},{n:1e9,x:5e9,r:86.745},{n:0,x:1e9,r:87.745}],"수자원공사":[{n:5e9,x:1e11,r:85.495},{n:1e9,x:5e9,r:86.745},{n:0,x:1e9,r:87.745}],"교육청":[{n:5e9,x:1e11,r:85.495},{n:1e9,x:5e9,r:86.745},{n:0,x:1e9,r:87.745}],"환경공단":[{n:5e9,x:1e11,r:83.495},{n:1e9,x:5e9,r:84.745},{n:0,x:1e9,r:85.745}],"공기업":[{n:5e9,x:1e11,r:85.495},{n:1e9,x:5e9,r:86.745},{n:0,x:1e9,r:87.745}],"발전사":[{n:5e9,x:1e11,r:85.495},{n:1e9,x:5e9,r:86.745},{n:0,x:1e9,r:87.745}]};
const NEW_R={"조달청":[{n:5e9,x:1e11,r:87.495},{n:1e9,x:5e9,r:88.745},{n:0,x:1e9,r:89.745}],"지자체":[{n:1e10,x:3e11,r:81.995},{n:5e9,x:1e10,r:87.495},{n:3e9,x:5e9,r:88.745},{n:1e9,x:3e9,r:88.745},{n:0,x:1e9,r:89.745}],"한전":[{n:5e9,x:1e11,r:87.495},{n:1e9,x:5e9,r:88.745},{n:0,x:1e9,r:89.745}],"LH":[{n:5e9,x:1e11,r:87.495},{n:1e9,x:5e9,r:88.745},{n:0,x:1e9,r:89.745}],"군시설":[{n:5e9,x:1e11,r:87.495},{n:1e9,x:5e9,r:88.745},{n:0,x:1e9,r:89.745}],"수자원공사":[{n:5e9,x:1e11,r:87.495},{n:1e9,x:5e9,r:88.745},{n:0,x:1e9,r:89.745}],"교육청":[{n:5e9,x:1e11,r:87.495},{n:1e9,x:5e9,r:88.745},{n:0,x:1e9,r:89.745}],"환경공단":[{n:5e9,x:1e11,r:85.495},{n:1e9,x:5e9,r:86.745},{n:0,x:1e9,r:87.745}],"공기업":[{n:5e9,x:1e11,r:87.495},{n:1e9,x:5e9,r:88.745},{n:0,x:1e9,r:89.745}],"발전사":[{n:5e9,x:1e11,r:87.495},{n:1e9,x:5e9,r:88.745},{n:0,x:1e9,r:89.745}]};
const CUT={"지자체":"2025-07-01","교육청":"2025-07-01"};const DCUT="2026-01-30";

function clsAg(n){if(!n)return"지자체";if(/한국전력/.test(n))return"한전";if(/남동발전|서부발전|중부발전|동서발전|남부발전/.test(n))return"발전사";if(/수자원/.test(n))return"수자원공사";if(/토지주택/.test(n))return"LH";if(/교육청|교육지원청/.test(n))return"교육청";if(/조달청/.test(n))return"조달청";if(/환경공단/.test(n))return"환경공단";if(/사단|부대|군단|비행단|여단/.test(n))return"군시설";if(/도시공사|교통공사|소방재난|의료원/.test(n))return"공기업";return"지자체"}
function pDt(s){if(!s)return null;const t=String(s).trim();let m;if((m=t.match(/^(\d{2})\.(\d{2})\.(\d{2})$/)))return"20"+m[1]+"-"+m[2]+"-"+m[3];if((m=t.match(/^(\d{4})[-.](\d{2})[-.](\d{2})$/)))return m[1]+"-"+m[2]+"-"+m[3];return null}
function isNew(at,d){return!d||d>=(CUT[at]||DCUT)}
function curFR(at,ep){const r=NEW_R[at]||NEW_R["지자체"];for(const x of r)if(ep>=x.n&&ep<x.x)return x.r;return r[r.length-1].r}
function eraFR(at,ep,d){const t=isNew(at,d)?NEW_R:OLD_R;const r=t[at]||t["지자체"];for(const x of r)if(ep>=x.n&&ep<x.x)return x.r;return r[r.length-1].r}
function fm(n){return n==null||isNaN(n)?"—":Math.round(n).toLocaleString()}
function fp(n){return n==null||isNaN(n)?"—":Number(n).toFixed(4)+"%"}
function tn(s){if(typeof s==="number")return s;return parseFloat(String(s).replace(/,/g,""))||0}
function tc(n){const v=tn(n);return v?v.toLocaleString():"0"}
const CHO="ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
function gCho(s){let r="";for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);r+=(c>=0xAC00&&c<=0xD7A3)?CHO[Math.floor((c-0xAC00)/588)]:s[i]}return r}
function mSch(nm,q){if(!q)return false;return nm.toLowerCase().includes(q.toLowerCase())||gCho(nm).includes(q)}

function parseSheetJS(buf){
  const wb=XLSX.read(new Uint8Array(buf),{type:"array",codepage:949});
  const sn=wb.SheetNames[0];if(!sn)throw new Error("시트 없음");
  const json=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,defval:"",raw:false});
  if(json.length<2)throw new Error("데이터 부족("+json.length+"행)");
  const kn=["번호","공고명","공고번호","발주기관","추정가격","기초금액","A값","순공사원가","예정가격","낙찰하한가","예가/기초(100%)","예가/기초(0%)","1순위업체","1순위사업자번호","1순위투찰금액","1순위사정율(100%)","1순위사정율(0%)","1순위기초대비","업체수","개찰일","입력일","업종","G2B물품분류","지역"];
  const hdr=json[0];const cm={};hdr.forEach((h,i)=>{const idx=kn.indexOf(String(h).trim());if(idx>=0)cm[idx]=i});
  const useMap=Object.keys(cm).length>=5;const data=[];
  for(let i=1;i<json.length;i++){const r=json[i];if(!r||r.length<3)continue;
    const rd={};if(useMap){for(const[ki,ci]of Object.entries(cm))rd[parseInt(ki)]=r[ci]!=null?String(r[ci]):""}else{r.forEach((v,j)=>{rd[j]=v!=null?String(v):""})}
    let hasData=false;for(const v of Object.values(rd)){if(v&&String(v).trim()){hasData=true;break}}
    if(hasData)data.push(rd)}
  return data}

async function parseFile(file){const buf=await file.arrayBuffer();const u8=new Uint8Array(buf);
  if(u8[0]===0xD0&&u8[1]===0xCF)return{rows:parseSheetJS(buf),f:"XLS"};
  if(u8[0]===0x50&&u8[1]===0x4B)return{rows:parseSheetJS(buf),f:"XLSX"};
  const text=await file.text();const html=parseHTML(text);if(html)return{rows:html,f:"HTML"};
  const csv=Papa.parse(text,{skipEmptyLines:true});if(csv.data){const v=csv.data.filter(r=>r.length>=5);if(v.length>=2){const kn=["번호","공고명","공고번호","발주기관","추정가격","기초금액","A값","순공사원가","예정가격","낙찰하한가","예가/기초(100%)","예가/기초(0%)","1순위업체","1순위사업자번호","1순위투찰금액","1순위사정율(100%)","1순위사정율(0%)","1순위기초대비","업체수","개찰일","입력일","업종","G2B물품분류","지역"];const cm={};v[0].forEach((h,i)=>{const idx=kn.indexOf(String(h).trim());if(idx>=0)cm[idx]=i});const um=Object.keys(cm).length>=5;const data=[];for(let i=1;i<v.length;i++){const r=v[i],rd={};if(um)for(const[ki,ci]of Object.entries(cm))rd[parseInt(ki)]=r[ci];else r.forEach((vv,j)=>{rd[j]=vv});data.push(rd)}return{rows:data,f:"CSV"}}}
  throw new Error("지원되지 않는 형식")}

function rowToDbRecord(r){
  const pnv=s=>{if(s==null||s==="")return 0;if(typeof s==="number")return isFinite(s)?s:0;const n=parseFloat(String(s).replace(/,/g,""));return isFinite(n)?n:0};
  const sn=s=>{const v=pnv(s);return v||null};
  const clean=s=>{const v=String(s||"");return v.replace(/[\x00\uD800-\uDFFF]/g,"").replace(/[\x01-\x08\x0B\x0C\x0E-\x1F]/g,"").replace(/[\u2800-\u2BFF\uE000-\uF8FF]/g,"").replace(/[嬀崀巇巍嶰嶬壂磆峈烓⧂⧅⧈]/g,"").replace(/\s+/g," ").trim()};
  const ag=clean(r[3]),at=clsAg(ag),ba=pnv(r[5]),ep=pnv(r[4]),av=pnv(r[6]);
  const pn=clean(r[1]);
  if(!pn||pn.length<2)return null;
  const od=pDt(clean(r[19])),era=isNew(at,od)?"new":"old";
  const dk=pn+"|"+ag+"|"+clean(r[19])+"|"+ba;
  if(dk.length<5)return null;
  const hk=md5(dk);
  return{dedup_key:hk,pn:pn,pn_no:clean(r[2]),ag,at,ep:ep||null,ba:ba||null,av:av||0,raw_cost:clean(r[7]),xp:sn(r[8]),floor_price:sn(r[9]),ar1:sn(r[10]),ar0:sn(r[11]),co:clean(r[12]),co_no:clean(r[13]),bp:sn(r[14]),br1:sn(r[15]),br0:sn(r[16]),base_ratio:sn(r[17]),pc:Math.round(pnv(r[18]))||0,od:od||null,input_date:pDt(clean(r[20]))||null,cat:clean(r[21]),g2b:clean(r[22]),reg:clean(r[23]),era,has_a:av>0,fr:eraFR(at,ep,od)}}

function dbToLocal(r){return{id:r.id,pn:r.pn||"",ag:r.ag||"",at:r.at||"지자체",ep:Number(r.ep)||0,ba:Number(r.ba)||0,av:Number(r.av)||0,ar1:r.ar1!=null?Number(r.ar1):null,br1:r.br1!=null?Number(r.br1):null,pc:r.pc||0,od:r.od||"",odP:r.od,co:r.co||"",hasA:Number(r.av)>0,fr:Number(r.fr)||89.745,era:r.era||"new"}}

const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const std=a=>{if(a.length<2)return 0;const u=avg(a);return Math.sqrt(a.reduce((x,y)=>x+(y-u)**2,0)/a.length)};
function calcS(recs,filter){const src=filter?recs.filter(filter):recs;const bT={},bA={};for(const r of src){if(r.ar1==null||r.br1==null)continue;if(!bT[r.at])bT[r.at]={a:[],b:[],d:[],p:[],ba:[]};const t=bT[r.at];t.a.push(r.ar1);t.b.push(r.br1);t.d.push(r.br1-r.ar1);t.p.push(r.pc);t.ba.push(r.ba);if(!r.ag)continue;if(!bA[r.ag])bA[r.ag]={at:r.at,a:[],b:[],d:[],p:[],ba:[]};const aa=bA[r.ag];aa.a.push(r.ar1);aa.b.push(r.br1);aa.d.push(r.br1-r.ar1);aa.p.push(r.pc);aa.ba.push(r.ba)}const mk=v=>({n:v.a.length,am:avg(v.a),as:std(v.a),bm:avg(v.b),bs:std(v.b),dm:avg(v.d),pp:avg(v.p),pb:avg(v.ba)});const ts={},as={};for(const[k,v]of Object.entries(bT))ts[k]=mk(v);for(const[k,v]of Object.entries(bA))as[k]={...mk(v),at:v.at};return{ts,as}}

function predictV2(inp,aT,aA){const ex=aA[inp.agName],tS=aT[inp.at];let s,src;if(ex&&ex.n>=3){s=ex;src="발주기관"}else if(ex&&ex.n===2&&tS){s={n:ex.n+tS.n,am:ex.am*.6+tS.am*.4,as:Math.max(ex.as,tS.as),bm:ex.bm*.6+tS.bm*.4,bs:Math.max(ex.bs,tS.bs),dm:ex.dm*.6+tS.dm*.4,pp:ex.pp*.6+tS.pp*.4,pb:ex.pb};src="블렌딩"}else if(tS){s=tS;src="유형"}else{s={am:100,as:.5,bm:100.02,bs:.5,dm:.02,n:1,pp:100,pb:1e8};src="기본"}const ePC=inp.pc||s.pp||100;let pcM=1;if(ePC<10)pcM=2.5;else if(ePC<30)pcM=1.5;else if(ePC>=100)pcM=.7;let amM=1;if(inp.ba<3e8)amM=1.2;else if(inp.ba>=1e9)amM=.5;const bD=s.dm,aD=bD*pcM*amM,fr=curFR(inp.at,inp.ep),hA=inp.av>0;const conf=Math.min(.95,(s.n/50)*Math.max(0.1,1-Math.min(s.as,1)/2));const strats=[{nm:"안전",off:-Math.abs(aD)*.5},{nm:"추천",off:0},{nm:"공격",off:Math.abs(aD)*1.5}].map(st=>{const ar=s.bm+aD+st.off,ep=Math.round(inp.ba*ar/100);let bid;if(hA)bid=Math.ceil((ep-inp.av)*fr/100+inp.av);else bid=Math.ceil(ep*fr/100);return{...st,adjRate:ar,expectedPrice:ep,bidAmount:bid,wp:st.nm==="안전"?Math.round(conf*25):st.nm==="추천"?Math.round(conf*40):Math.round(conf*20)}});return{at:inp.at,fr,pa:s.am,pb:s.bm+aD,d:aD,bD,pcM,amM,conf,n:s.n,hasA:hA,src,srcName:ex&&ex.n>=2?inp.agName:inp.at,strats}}

const C={bg:"#0c0c1a",bg2:"#12122a",bg3:"#1a1a30",bdr:"#252540",gold:"#d4a834",txt:"#ccc",txm:"#888",txd:"#555"};
const inpS={width:"100%",background:"#1a1a30",border:"1px solid #252540",borderRadius:5,padding:"7px 10px",color:"#ccc",fontSize:12,outline:"none",boxSizing:"border-box"};
function MI({value,onChange}){return<input value={value===0||value==="0"?"0":tc(value)} onChange={e=>{const r=e.target.value.replace(/,/g,"").replace(/[^0-9]/g,"");onChange(r===""?"0":r)}} style={{...inpS,textAlign:"right",fontFamily:"monospace"}}/>}
function AS({value,onChange,agencies}){const[open,setOpen]=useState(false);const[q,setQ]=useState(value);const ref=useRef(null);useEffect(()=>{setQ(value)},[value]);useEffect(()=>{const h=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false)};document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h)},[]);const fl=useMemo(()=>(!q||q.length<1)?agencies.slice(0,8):agencies.filter(a=>mSch(a,q)).slice(0,8),[q,agencies]);return(<div ref={ref} style={{position:"relative"}}><input value={q} onChange={e=>{setQ(e.target.value);onChange(e.target.value);setOpen(true)}} onFocus={()=>setOpen(true)} placeholder="초성/이름 검색" style={inpS}/>{open&&fl.length>0&&<div style={{position:"absolute",top:"100%",left:0,right:0,background:"#12122a",border:"1px solid #252540",borderRadius:"0 0 6px 6px",zIndex:10,maxHeight:200,overflowY:"auto"}}>{fl.map((a,i)=><div key={i} onClick={()=>{setQ(a);onChange(a);setOpen(false)}} style={{padding:"7px 10px",fontSize:11,cursor:"pointer",borderBottom:"1px solid #0c0c1a",color:"#ccc"}} onMouseEnter={e=>{e.currentTarget.style.background="#1a1a30"}} onMouseLeave={e=>{e.currentTarget.style.background="transparent"}}>{a} <span style={{fontSize:9,color:"#555",marginLeft:4}}>{clsAg(a)}</span></div>)}</div>}</div>)}

export default function App(){
  const[tab,setTab]=useState("upload");const[recs,setRecs]=useState([]);const[allS,setAllS]=useState({ts:{},as:{}});const[newS,setNewS]=useState({ts:{},as:{}});const[oldS,setOldS]=useState({ts:{},as:{}});const[drag,setDrag]=useState(false);const[busy,setBusy]=useState(false);const[msg,setMsg]=useState({type:"",text:""});const[inp,setInp]=useState({agency:"",baseAmount:"0",estimatedPrice:"0",aValue:"0"});const[pred,setPred]=useState(null);const[search,setSearch]=useState("");const[sV,setSV]=useState("type");const[agSch,setAgSch]=useState("");const[eF,setEF]=useState("all");const[sel,setSel]=useState({});const[dlgType,setDlgType]=useState("");const[dataPage,setDataPage]=useState(0);const[dbStatus,setDbStatus]=useState("loading");

  const agList=useMemo(()=>Object.keys(allS.as||{}).sort(),[allS.as]);
  const PAGE=50;const selCount=Object.keys(sel).length;
  const refreshStats=useCallback(all=>{setAllS(calcS(all));setNewS(calcS(all,r=>r.era==="new"));setOldS(calcS(all,r=>r.era==="old"))},[]);

  useEffect(()=>{(async()=>{try{const dbRows=await sbLoadAll();const local=dbRows.map(dbToLocal);setRecs(local);refreshStats(local);setDbStatus("connected");setMsg({type:"ok",text:"DB에서 "+local.length+"건 로드 완료"})}catch(e){setDbStatus("offline");setMsg({type:"err",text:"DB 연결 실패: 오프라인 모드"})}})()},[refreshStats]);

  const loadFiles=useCallback(async files=>{
    if(!files||!files.length)return;setBusy(true);setMsg({type:"",text:""});
    let total=0,errs=0,skipped=0;const dbRows=[];
    for(const file of files){try{const{rows}=await parseFile(file);for(const r of rows){const rec=rowToDbRecord(r);if(rec){dbRows.push(rec);total++}else{skipped++}}}catch(e){errs++}}
    if(!dbRows.length){setMsg({type:"err",text:"유효한 데이터 없음 (스킵 "+skipped+"건, 오류 "+errs+"파일)"});setBusy(false);return}
    try{await sbUpsert(dbRows);const fresh=await sbLoadAll();const local=fresh.map(dbToLocal);setRecs(local);refreshStats(local);
      setMsg({type:"ok",text:files.length+"파일→"+total+"건 DB 저장 완료 (총 "+local.length+"건)"});setTab("stats")}
    catch(e){setMsg({type:"err",text:"DB 저장 실패: "+e.message})}
    setBusy(false)},[refreshStats]);

  const doDelete=useCallback(async()=>{
    try{setBusy(true);
      if(dlgType==="sel"){const ids=Object.keys(sel).map(Number);await sbDeleteIds(ids)}
      else if(dlgType==="all"){await sbDeleteAll()}
      else if(dlgType==="dup"){const seen={},delIds=[];for(const r of recs){const k=r.pn+"|"+r.ag+"|"+r.od+"|"+r.ba;if(seen[k])delIds.push(r.id);else seen[k]=true}if(delIds.length)await sbDeleteIds(delIds)}
      const fresh=await sbLoadAll();const local=fresh.map(dbToLocal);setRecs(local);refreshStats(local);setSel({});
      setMsg({type:"ok",text:"삭제 완료 ("+local.length+"건 남음)"})}
    catch(e){setMsg({type:"err",text:"삭제 실패"})}
    setDlgType("");setBusy(false)},[dlgType,sel,recs,refreshStats]);

  const curSt=eF==="new"?newS:eF==="old"?oldS:allS;
  const filteredRecs=useMemo(()=>{const t=search.toLowerCase();let src=recs;if(eF==="new")src=recs.filter(r=>r.era==="new");else if(eF==="old")src=recs.filter(r=>r.era==="old");return t?src.filter(r=>(r.pn+r.ag+r.co).toLowerCase().includes(t)):src},[recs,search,eF]);
  const pagedRecs=useMemo(()=>filteredRecs.slice(dataPage*PAGE,(dataPage+1)*PAGE),[filteredRecs,dataPage]);
  const totalPages=Math.max(1,Math.ceil(filteredRecs.length/PAGE));
  const fAg=useMemo(()=>{const t=agSch.toLowerCase();return Object.entries(curSt.as||{}).filter(([k])=>!t||k.toLowerCase().includes(t)).sort((a,b)=>b[1].n-a[1].n)},[curSt.as,agSch]);
  const doPred=useCallback(()=>{setPred(predictV2({at:clsAg(inp.agency),agName:inp.agency.trim(),ba:tn(inp.baseAmount),ep:tn(inp.estimatedPrice),av:tn(inp.aValue),pc:0},allS.ts,allS.as))},[inp,allS]);
  const nC=recs.filter(r=>r.era==="new").length;const oC=recs.filter(r=>r.era==="old").length;
  const allSel=pagedRecs.length>0&&pagedRecs.every(r=>sel[r.id]);
  const btnS=(act,c)=>({padding:"3px 10px",fontSize:10,fontWeight:act?600:400,background:act?c+"22":"#1a1a30",color:act?c:"#888",border:"1px solid "+(act?c+"44":"#252540"),borderRadius:4,cursor:"pointer",marginRight:4});

  return(<div style={{fontFamily:"system-ui,sans-serif",background:C.bg,color:C.txt,minHeight:"100vh"}}>
    {dlgType&&<div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,.6)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setDlgType("")}><div onClick={e=>e.stopPropagation()} style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,padding:24,maxWidth:360,width:"90%"}}><div style={{fontSize:14,fontWeight:600,color:C.gold,marginBottom:8}}>{dlgType==="sel"?selCount+"건 삭제":dlgType==="all"?"전체 삭제":"중복 제거"}</div><div style={{fontSize:12,color:C.txm,marginBottom:16}}>DB에서 영구 삭제됩니다.</div><div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><button onClick={()=>setDlgType("")} style={{padding:"6px 16px",background:C.bg3,border:"1px solid "+C.bdr,borderRadius:5,color:C.txt,fontSize:11,cursor:"pointer"}}>취소</button><button onClick={doDelete} disabled={busy} style={{padding:"6px 16px",background:"#e24b4a",border:"none",borderRadius:5,color:"#fff",fontSize:11,fontWeight:600,cursor:"pointer"}}>{busy?"처리중...":"확인"}</button></div></div></div>}

    <div style={{background:C.bg2,padding:"20px 24px 0",borderBottom:"1px solid "+C.bdr}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div><div style={{fontSize:20,fontWeight:700,color:C.gold}}>입찰 분석 시스템 <span style={{fontSize:11,fontWeight:400,color:C.txd}}>v2</span></div><div style={{fontSize:11,color:C.txd,margin:"4px 0 14px"}}>Supabase DB 연동 · 다변량 보정 모델</div></div>
        <div style={{fontSize:10,padding:"3px 8px",borderRadius:4,background:dbStatus==="connected"?"#5ca2":"#e552",color:dbStatus==="connected"?"#5ca":"#e55"}}>{dbStatus==="connected"?"DB 연결됨":dbStatus==="loading"?"로딩...":"오프라인"}</div>
      </div>
      <div style={{display:"flex"}}>{[["upload","업로드"],["stats","패턴분석"],["predict","예측"],["data","데이터"]].map(([id,ch])=><button key={id} onClick={()=>setTab(id)} style={{padding:"8px 18px",fontSize:12,fontWeight:tab===id?600:400,background:tab===id?C.bg3:"transparent",color:tab===id?C.gold:C.txm,border:"none",borderBottom:tab===id?"2px solid "+C.gold:"2px solid transparent",cursor:"pointer"}}>{ch}</button>)}</div></div>

    <div style={{padding:"16px 24px 40px"}}>
      {recs.length>0&&<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>{[["총 데이터",recs.length,C.gold],["신기준",nC,"#5ca"],["구기준",oC,"#e55"],["발주기관",Object.keys(allS.as||{}).length,C.gold]].map(([l,v,c])=><div key={l} style={{background:C.bg3,borderRadius:8,padding:"10px 12px",textAlign:"center"}}><div style={{fontSize:9,color:C.txd}}>{l}</div><div style={{fontSize:20,fontWeight:700,color:c,marginTop:2}}>{typeof v==="number"?v.toLocaleString():v}</div></div>)}</div>}

      {tab==="upload"&&<div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,padding:20}}>
        <div style={{border:"2px dashed "+(drag?C.gold:C.bdr),borderRadius:10,padding:"50px 20px",textAlign:"center",cursor:"pointer"}} onDrop={e=>{e.preventDefault();setDrag(false);loadFiles(Array.from(e.dataTransfer.files))}} onDragOver={e=>{e.preventDefault();setDrag(true)}} onDragLeave={()=>setDrag(false)} onClick={()=>document.getElementById("fi").click()}>
          <input id="fi" type="file" accept=".xls,.xlsx,.csv,.html,.htm" multiple style={{display:"none"}} onChange={e=>{if(e.target.files.length)loadFiles(Array.from(e.target.files))}}/>
          {busy?<div style={{color:C.gold}}>DB 저장 중...</div>:<><div style={{fontSize:36,opacity:.4,marginBottom:8}}>+</div><div style={{fontSize:14,fontWeight:600,marginBottom:6}}>파일 업로드 → Supabase DB 저장</div><div style={{fontSize:11,color:C.txd}}>XLS/XLSX/CSV/HTML · 여러 파일 동시 · DB 중복 자동 제거</div></>}
        </div>
        {msg.text&&<div style={{marginTop:12,padding:"10px 14px",borderRadius:6,fontSize:12,color:msg.type==="ok"?"#5ca":"#e55",background:msg.type==="ok"?"rgba(93,202,165,.08)":"rgba(220,50,50,.08)"}}>{msg.type==="ok"?"✓ ":"✕ "}{msg.text}</div>}
      </div>}

      {tab==="stats"&&!Object.keys(allS.ts||{}).length&&<div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,padding:60,textAlign:"center",color:C.txd}}>데이터를 업로드하세요</div>}
      {tab==="stats"&&Object.keys(allS.ts||{}).length>0&&<div>
        <div style={{marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>{[["type","유형별"],["agency","발주기관별"]].map(([id,ch])=><button key={id} onClick={()=>setSV(id)} style={{padding:"4px 12px",fontSize:11,fontWeight:sV===id?600:400,background:sV===id?C.gold:C.bg3,color:sV===id?C.bg:C.txm,border:"none",borderRadius:4,cursor:"pointer",marginRight:4}}>{ch}</button>)}</div>
          <div>{[["all","전체("+recs.length+")",C.gold],["new","신("+nC+")","#5ca"],["old","구("+oC+")","#e55"]].map(([id,ch,c])=><button key={id} onClick={()=>setEF(id)} style={btnS(eF===id,c)}>{ch}</button>)}</div></div>
        {sV==="type"&&<div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,padding:18,overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}><thead><tr style={{borderBottom:"1px solid "+C.bdr}}>{["유형","건수","예가사정율","σ","1순위사정율","σ","델타","업체수"].map(h=><th key={h} style={{padding:"6px 8px",textAlign:"left",color:C.txd,fontSize:9}}>{h}</th>)}</tr></thead><tbody>{Object.entries(curSt.ts||{}).sort((a,b)=>b[1].n-a[1].n).map(([k,v])=><tr key={k} style={{borderBottom:"1px solid "+C.bg}}><td style={{padding:"7px 8px",fontWeight:600,color:C.gold}}>{k}</td><td style={{padding:"7px 8px"}}>{v.n}</td><td style={{padding:"7px 8px",fontFamily:"monospace"}}>{fp(v.am)}</td><td style={{padding:"7px 8px",fontFamily:"monospace",color:C.txd}}>{v.as.toFixed(4)}</td><td style={{padding:"7px 8px",fontFamily:"monospace",fontWeight:600}}>{fp(v.bm)}</td><td style={{padding:"7px 8px",fontFamily:"monospace",color:C.txd}}>{v.bs.toFixed(4)}</td><td style={{padding:"7px 8px",fontFamily:"monospace"}}>+{v.dm.toFixed(4)}</td><td style={{padding:"7px 8px"}}>{Math.round(v.pp).toLocaleString()}</td></tr>)}</tbody></table></div>}
        {sV==="agency"&&<div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,padding:18,overflowX:"auto"}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}><div style={{fontSize:13,fontWeight:600,color:C.gold}}>발주기관별</div><input value={agSch} onChange={e=>setAgSch(e.target.value)} placeholder="검색..." style={{...inpS,width:200}}/></div><table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}><thead><tr style={{borderBottom:"1px solid "+C.bdr}}>{["발주기관","유형","건수","예가사정율","σ","1순위사정율","σ","델타","업체수"].map(h=><th key={h} style={{padding:"6px 8px",textAlign:"left",color:C.txd,fontSize:9,whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead><tbody>{fAg.map(([k,v])=><tr key={k} style={{borderBottom:"1px solid "+C.bg}}><td style={{padding:"7px 8px",fontWeight:600,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={k}>{k}</td><td style={{padding:"7px 8px"}}><span style={{fontSize:8,padding:"1px 5px",borderRadius:3,background:C.gold+"15",color:C.gold}}>{v.at}</span></td><td style={{padding:"7px 8px",color:v.n>=3?C.gold:C.txt}}>{v.n}</td><td style={{padding:"7px 8px",fontFamily:"monospace"}}>{fp(v.am)}</td><td style={{padding:"7px 8px",fontFamily:"monospace",color:C.txd}}>{v.n>=2?v.as.toFixed(4):"—"}</td><td style={{padding:"7px 8px",fontFamily:"monospace",fontWeight:600}}>{fp(v.bm)}</td><td style={{padding:"7px 8px",fontFamily:"monospace",color:C.txd}}>{v.n>=2?v.bs.toFixed(4):"—"}</td><td style={{padding:"7px 8px",fontFamily:"monospace"}}>{v.dm>=0?"+":""}{v.dm.toFixed(4)}</td><td style={{padding:"7px 8px"}}>{Math.round(v.pp).toLocaleString()}</td></tr>)}</tbody></table></div>}
      </div>}

      {tab==="predict"&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        <div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,padding:18}}>
          <div style={{fontSize:13,fontWeight:600,color:C.gold,marginBottom:14}}>신규 입찰 정보</div>
          <div style={{marginBottom:10}}><div style={{fontSize:10,color:C.txd,marginBottom:3}}>발주기관명</div><AS value={inp.agency} onChange={v=>setInp(p=>({...p,agency:v}))} agencies={agList}/></div>
          <div style={{marginBottom:10}}><div style={{fontSize:10,color:C.txd,marginBottom:3}}>기초금액 (원)</div><MI value={inp.baseAmount} onChange={v=>setInp(p=>({...p,baseAmount:v}))}/></div>
          <div style={{marginBottom:10}}><div style={{fontSize:10,color:C.txd,marginBottom:3}}>추정가격 (원)</div><MI value={inp.estimatedPrice} onChange={v=>setInp(p=>({...p,estimatedPrice:v}))}/></div>
          <div style={{marginBottom:10}}><div style={{fontSize:10,color:C.txd,marginBottom:3}}>A값 (원)</div><MI value={inp.aValue} onChange={v=>setInp(p=>({...p,aValue:v}))}/></div>
          <button onClick={doPred} disabled={!Object.keys(allS.ts||{}).length} style={{width:"100%",padding:"10px",background:Object.keys(allS.ts||{}).length?C.gold:C.bdr,color:C.bg,border:"none",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer",marginTop:4}}>1순위사정율 예측</button></div>
        <div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,padding:18}}>
          <div style={{fontSize:13,fontWeight:600,color:C.gold,marginBottom:14}}>예측 결과</div>
          {pred===null?<div style={{textAlign:"center",padding:50,color:C.txd}}>입찰 정보 입력 후 예측 실행</div>:<div>
            <div style={{background:C.bg3,borderRadius:6,padding:"8px 10px",marginBottom:10,fontSize:10}}><span style={{color:pred.src==="발주기관"?"#5ca":pred.src==="블렌딩"?"#8b8":C.gold}}>{pred.src==="발주기관"?"✓ \""+pred.srcName+"\" 개별("+pred.n+"건)":pred.src==="블렌딩"?"\""+pred.srcName+"\" 블렌딩":"\""+pred.srcName+"\" 유형("+pred.n+"건)"}</span></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>{[["예가사정율",fp(pred.pa)],["1순위사정율",fp(pred.pb)],["투찰율",pred.fr+"%"]].map(([l,v],i)=><div key={l} style={{background:C.bg3,borderRadius:6,padding:"8px 10px",textAlign:"center"}}><div style={{fontSize:9,color:C.txd}}>{l}</div><div style={{fontSize:i===1?16:13,fontWeight:700,color:C.gold,marginTop:2}}>{v}</div></div>)}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}><div style={{background:C.bg3,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:9,color:C.txd}}>기본δ</div><div style={{fontSize:11,fontFamily:"monospace"}}>{pred.bD>=0?"+":""}{pred.bD.toFixed(4)}</div></div><div style={{background:C.bg3,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:9,color:C.txd}}>보정</div><div style={{fontSize:11,fontFamily:"monospace"}}>×{pred.pcM}×{pred.amM}</div></div><div style={{background:C.bg3,borderRadius:6,padding:"6px 8px",textAlign:"center"}}><div style={{fontSize:9,color:C.txd}}>보정δ</div><div style={{fontSize:11,fontFamily:"monospace",color:C.gold}}>{pred.d>=0?"+":""}{pred.d.toFixed(4)}</div></div></div>
            <div style={{background:C.bg3,borderRadius:6,padding:"6px 10px",marginBottom:14,fontSize:10,color:C.txd}}>신뢰도 {(pred.conf*100).toFixed(0)}% | A값 {pred.hasA?"있음":"없음"}</div>
            <div style={{fontSize:10,color:C.txd,fontWeight:600,marginBottom:8}}>투찰 전략</div>
            {pred.strats.map((st,i)=><div key={i} style={{background:i===1?C.gold+"0d":C.bg3,border:"1px solid "+(i===1?C.gold+"44":C.bdr),borderRadius:7,padding:"10px 12px",marginBottom:6}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}><div><span style={{fontSize:9,fontWeight:600,padding:"2px 7px",borderRadius:3,background:i===0?"#5ca2":i===1?C.gold+"22":"#e552",color:i===0?"#5ca":i===1?C.gold:"#e55",marginRight:8}}>{st.nm}</span><span style={{fontSize:10,color:C.txd}}>사정율 {st.adjRate.toFixed(4)}%</span></div><div style={{fontSize:9,color:C.txd}}>~{st.wp}%</div></div><div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}><div style={{fontSize:10,color:C.txm}}>예정가격 {fm(st.expectedPrice)}</div><div style={{fontSize:15,fontWeight:700,fontFamily:"monospace",color:i===1?C.gold:C.txt}}>{fm(st.bidAmount)}원</div></div></div>)}
            <div style={{marginTop:8,padding:"8px 10px",background:C.bg3,borderRadius:6,fontSize:9,color:C.txd}}>{pred.hasA?"(예정가격-A값)×"+pred.fr+"%+A값":"예정가격×"+pred.fr+"%"}</div>
          </div>}</div></div>}

      {tab==="data"&&<div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,padding:18}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:13,fontWeight:600,color:C.gold}}>데이터</span>{[["all","전체",C.gold],["new","신","#5ca"],["old","구","#e55"]].map(([id,ch,c])=><button key={id} onClick={()=>{setEF(id);setDataPage(0)}} style={btnS(eF===id,c)}>{ch}</button>)}</div>
          <div style={{display:"flex",alignItems:"center",gap:6}}><input value={search} onChange={e=>{setSearch(e.target.value);setDataPage(0)}} placeholder="검색..." style={{...inpS,width:140}}/>{selCount>0&&<button onClick={()=>setDlgType("sel")} style={{padding:"4px 10px",fontSize:10,background:"#e24b4a22",color:"#e55",border:"1px solid #e554",borderRadius:4,cursor:"pointer"}}>{selCount}건 삭제</button>}<button onClick={()=>setDlgType("dup")} style={{padding:"4px 10px",fontSize:10,background:C.bg3,color:C.txm,border:"1px solid "+C.bdr,borderRadius:4,cursor:"pointer"}}>중복제거</button><button onClick={()=>setDlgType("all")} style={{padding:"4px 10px",fontSize:10,background:C.bg3,color:"#e55",border:"1px solid #e554",borderRadius:4,cursor:"pointer"}}>전체삭제</button></div></div>
        {recs.length===0?<div style={{textAlign:"center",padding:40,color:C.txd}}>데이터를 업로드하세요</div>:<div>
          <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:10,tableLayout:"fixed"}}><colgroup><col style={{width:28}}/><col style={{width:36}}/><col style={{width:32}}/><col style={{width:"22%"}}/><col style={{width:"14%"}}/><col style={{width:48}}/><col style={{width:"10%"}}/><col style={{width:"8%"}}/><col style={{width:"8%"}}/><col style={{width:48}}/><col style={{width:72}}/></colgroup><thead><tr style={{borderBottom:"1px solid "+C.bdr}}><th style={{padding:"5px 4px",width:28}}><input type="checkbox" checked={allSel} onChange={()=>{const next={...sel};if(allSel)pagedRecs.forEach(r=>{delete next[r.id]});else pagedRecs.forEach(r=>{next[r.id]=true});setSel(next)}}/></th>{["#","기준","공고명","발주기관","유형","기초금액","예가사정율","1순위사정율","업체수","개찰일"].map(h=><th key={h} style={{padding:"5px 4px",textAlign:"left",color:C.txd,fontSize:9,whiteSpace:"nowrap",overflow:"hidden"}}>{h}</th>)}</tr></thead><tbody>{pagedRecs.map((r,idx)=><tr key={r.id} style={{borderBottom:"1px solid "+C.bg,background:sel[r.id]?C.gold+"08":"transparent"}}><td style={{padding:"5px 4px"}}><input type="checkbox" checked={!!sel[r.id]} onChange={()=>{const next={...sel};if(next[r.id])delete next[r.id];else next[r.id]=true;setSel(next)}}/></td><td style={{padding:"5px 4px",color:C.txd}}>{dataPage*PAGE+idx+1}</td><td style={{padding:"5px 4px"}}><span style={{fontSize:8,padding:"1px 4px",borderRadius:2,background:r.era==="new"?"#5ca2":"#e552",color:r.era==="new"?"#5ca":"#e55"}}>{r.era==="new"?"신":"구"}</span></td><td style={{padding:"5px 4px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={r.pn}>{r.pn||"(없음)"}</td><td style={{padding:"5px 4px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={r.ag}>{r.ag}</td><td style={{padding:"5px 4px"}}><span style={{fontSize:8,padding:"1px 4px",borderRadius:3,background:C.gold+"15",color:C.gold}}>{r.at}</span></td><td style={{padding:"5px 4px",fontFamily:"monospace",textAlign:"right",overflow:"hidden",textOverflow:"ellipsis"}}>{fm(r.ba)}</td><td style={{padding:"5px 4px",fontFamily:"monospace",textAlign:"right"}}>{fp(r.ar1)}</td><td style={{padding:"5px 4px",fontFamily:"monospace",textAlign:"right",fontWeight:600,color:C.gold}}>{fp(r.br1)}</td><td style={{padding:"5px 4px",textAlign:"right"}}>{r.pc.toLocaleString()}</td><td style={{padding:"5px 4px",color:C.txd,whiteSpace:"nowrap"}}>{r.od}</td></tr>)}</tbody></table></div>
          {totalPages>1&&<div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:8,marginTop:12}}><button onClick={()=>setDataPage(p=>Math.max(0,p-1))} disabled={dataPage===0} style={{padding:"4px 10px",fontSize:10,background:C.bg3,color:C.txt,border:"1px solid "+C.bdr,borderRadius:4,cursor:"pointer"}}>이전</button><span style={{fontSize:11,color:C.txm}}>{dataPage+1}/{totalPages} ({filteredRecs.length}건)</span><button onClick={()=>setDataPage(p=>Math.min(totalPages-1,p+1))} disabled={dataPage>=totalPages-1} style={{padding:"4px 10px",fontSize:10,background:C.bg3,color:C.txt,border:"1px solid "+C.bdr,borderRadius:4,cursor:"pointer"}}>다음</button></div>}
        </div>}</div>}
    </div></div>)}
