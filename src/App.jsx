import { useState, useCallback, useMemo, useEffect } from "react";
import * as XLSX from "xlsx";

// ─── Supabase ──────────────────────────────────────────────
const SB_URL="https://sadunejfkstxbxogzutl.supabase.co";
const SB_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhZHVuZWpma3N0eGJ4b2d6dXRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2ODYxOTksImV4cCI6MjA5MDI2MjE5OX0.C5kNr-4urLImKfqOi_yl2-SUbrpcSgz2N3IiWGbObgc";
const hdrs={"Content-Type":"application/json","apikey":SB_KEY,"Authorization":"Bearer "+SB_KEY};
const hdrsSel={"apikey":SB_KEY,"Authorization":"Bearer "+SB_KEY};
const C={bg:"#0c0c1a",bg2:"#12122a",bg3:"#1a1a30",txt:"#e8e8f0",txm:"#a0a0b8",txd:"#666680",bdr:"#252540",gold:"#d4a834"};

// ─── 낙찰하한율 (2026 기관별 개정 반영) ──────────────────────
// 구기준: 산식기준 88/100 기반
// 신기준: 조달청계열 → 90/100, 지자체/교육청 → 88/100 유지 (구간만 변경)
// 시행일: 기관별 상이 (cutoffDate 참조)
const RATE_TABLE={
  // ── 조달청 (시행 2026.01.30) ──
  "조달청":{cutoff:"2026-01-30",
    old:[{min:5e9,max:1e11,rate:85.495},{min:1e9,max:5e9,rate:86.745},{min:3e8,max:1e9,rate:87.745},{min:0,max:3e8,rate:87.745}],
    new:[{min:5e9,max:1e11,rate:87.495},{min:1e9,max:5e9,rate:88.745},{min:3e8,max:1e9,rate:89.745},{min:0,max:3e8,rate:89.745}]},
  // ── 지자체 (행정안전부 기준, 시행 2025.07.01) - 88/100 유지 ──
  "지자체":{cutoff:"2025-07-01",
    old:[{min:1e10,max:3e11,rate:79.995},{min:5e9,max:1e10,rate:85.495},{min:3e9,max:5e9,rate:86.745},{min:1e9,max:3e9,rate:86.745},{min:4e8,max:1e9,rate:87.745},{min:2e8,max:4e8,rate:87.745},{min:0,max:2e8,rate:87.745}],
    new:[{min:1e10,max:3e11,rate:81.995},{min:5e9,max:1e10,rate:87.495},{min:3e9,max:5e9,rate:88.745},{min:1e9,max:3e9,rate:88.745},{min:4e8,max:1e9,rate:89.745},{min:2e8,max:4e8,rate:89.745},{min:0,max:2e8,rate:89.745}]},
  // ── 교육청 (행정안전부 기준 준용) ──
  "교육청":{cutoff:"2025-07-01",
    old:[{min:5e9,max:1e11,rate:85.495},{min:3e9,max:5e9,rate:86.745},{min:1e9,max:3e9,rate:86.745},{min:4e8,max:1e9,rate:87.745},{min:2e8,max:4e8,rate:87.745},{min:0,max:2e8,rate:87.745}],
    new:[{min:5e9,max:1e11,rate:87.495},{min:3e9,max:5e9,rate:88.745},{min:1e9,max:3e9,rate:88.745},{min:4e8,max:1e9,rate:89.745},{min:2e8,max:4e8,rate:89.745},{min:0,max:2e8,rate:89.745}]},
  // ── 한전 (한국전력공사) ──
  "한전":{cutoff:"2026-01-30",
    old:[{min:5e9,max:1e11,rate:85.495},{min:1e9,max:5e9,rate:86.745},{min:3e8,max:1e9,rate:87.745},{min:0,max:3e8,rate:87.745}],
    new:[{min:5e9,max:1e11,rate:87.495},{min:1e9,max:5e9,rate:88.745},{min:3e8,max:1e9,rate:89.745},{min:0,max:3e8,rate:89.745}]},
  // ── LH (한국토지주택공사, 시행 2026.02.01) ──
  "LH":{cutoff:"2026-02-01",
    old:[{min:5e9,max:1e11,rate:85.495},{min:1e9,max:5e9,rate:86.745},{min:3e8,max:1e9,rate:87.745},{min:0,max:3e8,rate:87.745}],
    new:[{min:5e9,max:1e11,rate:87.495},{min:1e9,max:5e9,rate:88.745},{min:3e8,max:1e9,rate:89.745},{min:0,max:3e8,rate:89.745}]},
  // ── 군시설 (시행 2026.01.19, 자체훈령/계약예규 상이 가능) ──
  "군시설":{cutoff:"2026-01-19",
    old:[{min:5e9,max:1e11,rate:83.495},{min:1e9,max:5e9,rate:84.745},{min:3e8,max:1e9,rate:85.745},{min:0,max:3e8,rate:85.745}],
    new:[{min:5e9,max:1e11,rate:87.495},{min:1e9,max:5e9,rate:88.745},{min:3e8,max:1e9,rate:89.745},{min:0,max:3e8,rate:89.745}]},
  // ── 수자원공사 (시행 2026.02.27) ──
  "수자원공사":{cutoff:"2026-02-27",
    old:[{min:5e9,max:1e11,rate:85.495},{min:1e9,max:5e9,rate:86.745},{min:3e8,max:1e9,rate:87.745},{min:0,max:3e8,rate:87.745}],
    new:[{min:5e9,max:1e11,rate:87.495},{min:1e9,max:5e9,rate:88.745},{min:3e8,max:1e9,rate:89.745},{min:0,max:3e8,rate:89.745}]}
};
function getFloorRate(at,ep,isNew){const tbl=RATE_TABLE[at]||RATE_TABLE["조달청"];const rules=isNew?tbl.new:tbl.old;for(const r of rules){if(ep>=r.min&&ep<r.max)return r.rate}return rules[rules.length-1].rate}
function getCutoffDate(at){return(RATE_TABLE[at]||RATE_TABLE["조달청"]).cutoff}
function isNewEra(at,od){if(!od)return false;return od>=getCutoffDate(at)}

// ─── 유틸 ──────────────────────────────────────────────────
function clsAg(n){if(!n)return"조달청";const s=n.trim();if(/조달청/.test(s))return"조달청";if(/교육/.test(s))return"교육청";if(/한국전력|한전/.test(s))return"한전";if(/LH|주택공사|토지주택/.test(s))return"LH";if(/군|사단|국방|해군|공군|육군|해병/.test(s))return"군시설";if(/수자원/.test(s))return"수자원공사";return"지자체"}
function clean(v){if(v==null)return"";return String(v).replace(/[\u0000\u2800-\u2BFF\uE000-\uF8FF]/g,"").replace(/\s+/g," ").trim()}
function pnv(v){if(v==null||v==="")return 0;if(typeof v==="number")return v;return parseFloat(String(v).replace(/,/g,"").trim())||0}
function sn(v){const n=pnv(v);return n===0?null:n}
function tc(v){return Number(v||0).toLocaleString()}
function tn(s){return Number(String(s).replace(/,/g,""))||0}
function pDt(v){if(!v)return null;const s=String(v).trim();let m;if((m=s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/)))return`${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;if((m=s.match(/^(\d{2})[-./](\d{1,2})[-./](\d{1,2})/)))return`20${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;return null}
function eraFR(at,ep,od){return getFloorRate(at,ep||0,isNewEra(at,od))}
const CHO="ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
function getCho(c){const code=c.charCodeAt(0);if(code>=0xAC00&&code<=0xD7A3)return CHO[Math.floor((code-0xAC00)/588)];return c}
function mSch(t,q){if(!q)return true;const tl=t.toLowerCase(),ql=q.toLowerCase();if(tl.includes(ql))return true;return Array.from(t).map(getCho).join("").includes(q)}

// ─── MD5 ───────────────────────────────────────────────────
function md5(s){function rl(n,c){return(n<<c)|(n>>>(32-c))}function tI(s){let h="";for(let i=0;i<=3;i++)h+="0123456789abcdef".charAt((s>>>(i*8+4))&0xF)+"0123456789abcdef".charAt((s>>>(i*8))&0xF);return h}function aI(x,y){let l=(x&0xFFFF)+(y&0xFFFF);return((x>>16)+(y>>16)+(l>>16))<<16|l&0xFFFF}const K=[],S=[];for(let i=0;i<64;i++){K[i]=Math.floor(Math.abs(Math.sin(i+1))*4294967296);S[i]=[7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21][((i>>4)<<2)+(i%4)]}let a0=0x67452301,b0=0xEFCDAB89,c0=0x98BADCFE,d0=0x10325476;const bytes=[];for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c<128)bytes.push(c);else if(c<2048){bytes.push(192|(c>>6));bytes.push(128|(c&63))}else{bytes.push(224|(c>>12));bytes.push(128|((c>>6)&63));bytes.push(128|(c&63))}}const bl=bytes.length*8;bytes.push(128);while(bytes.length%64!==56)bytes.push(0);for(let i=0;i<4;i++)bytes.push((bl>>>(i*8))&0xFF);for(let i=0;i<4;i++)bytes.push(0);for(let o=0;o<bytes.length;o+=64){const M=[];for(let j=0;j<16;j++)M[j]=bytes[o+j*4]|(bytes[o+j*4+1]<<8)|(bytes[o+j*4+2]<<16)|(bytes[o+j*4+3]<<24);let a=a0,b=b0,c=c0,d=d0;for(let i=0;i<64;i++){let f,g;if(i<16){f=(b&c)|((~b)&d);g=i}else if(i<32){f=(d&b)|((~d)&c);g=(5*i+1)%16}else if(i<48){f=b^c^d;g=(3*i+5)%16}else{f=c^(b|(~d));g=(7*i)%16}const tmp=d;d=c;c=b;b=aI(b,rl(aI(a,aI(f,aI(K[i],M[g]))),S[i]));a=tmp}a0=aI(a0,a);b0=aI(b0,b);c0=aI(c0,c);d0=aI(d0,d)}return tI(a0)+tI(b0)+tI(c0)+tI(d0)}
function sanitizeJson(s){return s.replace(/\\u0000/g,"").replace(/[\uD800-\uDFFF]/g,"")}

// ─── 파싱 ──────────────────────────────────────────────────
async function parseFile(file){const buf=await file.arrayBuffer();const wb=XLSX.read(new Uint8Array(buf),{type:"array",codepage:949,cellDates:false,raw:true});const ws=wb.Sheets[wb.SheetNames[0]];const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:"",raw:true});if(!rows.length)throw new Error("빈 파일");return{rows,format:file.name.toLowerCase().endsWith(".xlsx")?"XLSX":"XLS"}}

// 낙찰정보리스트 레코드 변환
function toRecord(r){const pn=clean(r[1]);if(!pn||pn.length<2)return null;const ag=clean(r[3]);const at=clsAg(ag);const ep=sn(r[4]);const ba=sn(r[5]);const av=pnv(r[6]);const od=pDt(clean(r[19]));const era=isNewEra(at,od)?"new":"old";const dk=pn+"|"+ag+"|"+(od||"")+"|"+(ba||"");if(dk.length<5)return null;return{dedup_key:md5(dk),pn,pn_no:clean(r[2]),ag,at,ep:ep||null,ba:ba||null,av:av||0,raw_cost:clean(r[7]),xp:sn(r[8]),floor_price:sn(r[9]),ar1:sn(r[10]),ar0:sn(r[11]),co:clean(r[12]),co_no:clean(r[13]),bp:sn(r[14]),br1:sn(r[15]),br0:sn(r[16]),base_ratio:sn(r[17]),pc:Math.round(pnv(r[18]))||0,od:od||null,input_date:pDt(clean(r[20]))||null,cat:clean(r[21]),g2b:clean(r[22]),reg:clean(r[23]),era,has_a:av>0,fr:eraFR(at,ep,od)}}
function toRecords(rows){return rows.map(toRecord).filter(Boolean)}

// 입찰서류함 파싱 (헤더 동적 매핑)
function parseBidDoc(rows){
  // 헤더 행 찾기
  let hdrIdx=-1;
  for(let i=0;i<Math.min(5,rows.length);i++){
    const h=rows[i].map(v=>String(v).trim());
    if(h.some(v=>v.includes("공고명"))){hdrIdx=i;break}}
  if(hdrIdx<0)return[];
  // 헤더 컬럼 매핑 (유연하게)
  const hdr=rows[hdrIdx].map(v=>String(v).trim());
  const col={};
  hdr.forEach((h,i)=>{
    if(h.includes("공고명")&&!col.pn)col.pn=i;
    if(h.includes("공고번호")&&!col.pn_no)col.pn_no=i;
    if((h.includes("발주기관")||h.includes("발주처")||h.includes("수요기관"))&&!col.ag)col.ag=i;
    if((h.includes("추정가격")||h==="추정가")&&!col.ep)col.ep=i;
    if((h.includes("기초금액")||h.includes("기초가격"))&&!col.ba)col.ba=i;
    if(h.includes("A값")||h==="A가")col.av=i;
    if(h.includes("설계금액")||h.includes("원가"))col.raw=i;
    if(h.includes("개찰")||h.includes("입찰일"))col.od=i;
    if(h.includes("업종")||h.includes("종목"))col.cat=i;
  });
  if(col.pn==null)return[];
  const result=[];
  for(let i=hdrIdx+1;i<rows.length;i++){
    const r=rows[i];const pn=clean(r[col.pn]);if(!pn||pn.length<2)continue;
    const ag=col.ag!=null?clean(r[col.ag]):"";const at=clsAg(ag);
    const ep=col.ep!=null?sn(r[col.ep]):null;
    const ba=col.ba!=null?sn(r[col.ba]):null;
    const av=col.av!=null?pnv(r[col.av]):0;
    const rawCost=col.raw!=null?sn(r[col.raw]):null;
    const odRaw=col.od!=null?clean(r[col.od]):"";const od=pDt(odRaw);
    const cat=col.cat!=null?clean(r[col.cat]):"";
    const pn_no=col.pn_no!=null?clean(r[col.pn_no]):"";
    if(!ba&&!ep)continue; // 금액 정보 없으면 스킵
    result.push({pn,pn_no,ag,at,ep:ep||null,ba:ba||ep||null,av:av||0,raw_cost:rawCost,cat,open_date:od,
      dedup_key:md5("pred|"+(pn_no||pn)+"|"+(od||""))})
  }
  return result}

// ─── 통계 (사정율 분포 + 투찰율 통계) ──────────────────────
function calcStats(recs,filter){const src=filter?recs.filter(filter):recs;const ts={},as={};
  for(const r of src){if(r.br1==null)continue;
    const adj=r.br1-100;if(adj<-5||adj>5)continue;
    const bidRate=(r.bp&&r.xp&&r.xp>0)?r.bp/r.xp*100:null;
    const t=r.at||"기타";
    if(!ts[t])ts[t]={n:0,sum:0,vals:[],bidRates:[]};
    ts[t].n++;ts[t].sum+=adj;ts[t].vals.push(adj);
    if(bidRate&&bidRate>80&&bidRate<95)ts[t].bidRates.push(bidRate);
    const a=r.ag;if(a){
      if(!as[a])as[a]={n:0,sum:0,vals:[],bidRates:[],type:t};
      as[a].n++;as[a].sum+=adj;as[a].vals.push(adj);
      if(bidRate&&bidRate>80&&bidRate<95)as[a].bidRates.push(bidRate)}}
  const fin=o=>{for(const k of Object.keys(o)){const v=o[k];v.avg=v.n?v.sum/v.n:0;v.vals.sort((a,b)=>a-b);
    const len=v.vals.length;v.med=len?v.vals[Math.floor(len/2)]:0;
    v.q1=len>=4?v.vals[Math.floor(len*0.25)]:v.avg;
    v.q3=len>=4?v.vals[Math.floor(len*0.75)]:v.avg;
    v.std=len>=2?Math.sqrt(v.vals.reduce((s,x)=>s+(x-v.avg)**2,0)/(len-1)):0;
    // 투찰율 통계
    v.bidRates.sort((a,b)=>a-b);const bl=v.bidRates.length;
    v.bidAvg=bl?v.bidRates.reduce((s,x)=>s+x,0)/bl:0;
    v.bidMed=bl?v.bidRates[Math.floor(bl/2)]:0;
    v.bidQ1=bl>=4?v.bidRates[Math.floor(bl*0.25)]:v.bidAvg;
    v.bidQ3=bl>=4?v.bidRates[Math.floor(bl*0.75)]:v.bidAvg;
    v.bidStd=bl>=2?Math.sqrt(v.bidRates.reduce((s,x)=>s+(x-v.bidAvg)**2,0)/(bl-1)):0}};
  fin(ts);fin(as);return{ts,as}}

// ─── 예측 v4 (v3 + bid_details 복수예가 패턴 보정) ──────────
function predictV4({at,agName,ba,ep,av},ts,as,details){
  if(!ba)return null;
  // ts가 비어있으면 예측 불가
  const tKeys=Object.keys(ts||{});
  if(!tKeys.length)return null;
  const agSt=as[agName];const tSt=ts[at]||ts[tKeys[0]];
  // tSt가 없으면 전체 통계에서 아무거나 사용
  if(!tSt)return null;
  let ref=tSt;
  let src=at;
  if(agSt&&agSt.n>=5){ref=agSt;src=`${agName}(${agSt.n}건)`}
  else if(agSt&&agSt.n>=2){
    const w=agSt.n>=3?0.7:0.5;
    ref={avg:agSt.avg*w+tSt.avg*(1-w),q1:agSt.q1*w+tSt.q1*(1-w),med:agSt.med*w+tSt.med*(1-w),
      q3:agSt.q3*w+tSt.q3*(1-w),std:Math.max(agSt.std,tSt.std),
      bidAvg:agSt.bidAvg*w+tSt.bidAvg*(1-w),bidMed:agSt.bidMed*w+tSt.bidMed*(1-w),
      bidQ1:agSt.bidQ1*w+tSt.bidQ1*(1-w),bidQ3:agSt.bidQ3*w+tSt.bidQ3*(1-w),bidStd:Math.max(agSt.bidStd,tSt.bidStd)};
    src=`${agName}(${agSt.n}건)+${at}`}

  // ★ bid_details 복수예가 패턴 보정
  let detailInsight=null;
  const dets=(details||[]).filter(d=>d.pre_rates&&Array.isArray(d.pre_rates)&&d.pre_rates.length===15);
  // 같은 기관 → 같은 기관유형 순으로 찾기
  const agDets=dets.filter(d=>d.ag===agName);
  const atDets=agDets.length>=1?agDets:dets.filter(d=>d.at===at);
  if(atDets.length>=1){
    // 15개 평균의 평균 (편향 지표)
    const preAvgs=atDets.map(d=>d.pre_avg||0);
    const avgBias=preAvgs.reduce((a,b)=>a+b,0)/preAvgs.length;
    // 음수 비율 분석
    const allRates=atDets.flatMap(d=>d.pre_rates);
    const negRatio=allRates.filter(v=>v<0).length/allRates.length;
    // 실제 추첨 결과(adj_rate)와 15개 평균(pre_avg) 차이 → 추첨 편향
    const drawBiases=atDets.filter(d=>d.adj_rate!=null&&d.pre_avg!=null).map(d=>d.adj_rate-d.pre_avg);
    const avgDrawBias=drawBiases.length?drawBiases.reduce((a,b)=>a+b,0)/drawBiases.length:0;
    // 최근 건의 C(15,4) 시뮬레이션
    const latestSim=simDraws(atDets[0].pre_rates);
    // 보정 적용: 기존 중앙값에 편향 보정
    const biasAdj=avgBias*0.3+avgDrawBias*0.2; // 15개 평균 편향의 30% + 추첨편향의 20% 반영
    const correctedMed=ref.med+biasAdj;
    const correctedQ1=ref.q1+biasAdj;
    const correctedQ3=ref.q3+biasAdj;
    // 음수 비율이 높으면 표준편차도 보정
    const correctedStd=negRatio>0.6?ref.std*1.1:ref.std;
    detailInsight={
      count:atDets.length,
      source:agDets.length>=1?agName:at,
      avgBias:Math.round(avgBias*10000)/10000,
      negRatio:Math.round(negRatio*1000)/10,
      avgDrawBias:Math.round(avgDrawBias*10000)/10000,
      biasAdj:Math.round(biasAdj*10000)/10000,
      latestSim,
      corrected:true};
    // 보정된 ref 적용
    ref={...ref,med:correctedMed,q1:correctedQ1,q3:correctedQ3,std:correctedStd,avg:ref.avg+biasAdj};
    src+=` + 상세${atDets.length}건 보정`}

  const fr=eraFR(at,ep||ba,new Date().toISOString().slice(0,10));
  const calcBid=(adjRate)=>{const xp=ba*(1+adjRate/100);return av>0?Math.ceil(av+(xp-av)*(fr/100)):Math.ceil(xp*(fr/100))};
  const calcXp=(adjRate)=>Math.round(ba*(1+adjRate/100));
  const scenarios=[
    {name:"보수적 (Q1)",adj:Math.round(ref.q1*10000)/10000,xp:calcXp(ref.q1),bid:calcBid(ref.q1)},
    {name:"중앙값",adj:Math.round(ref.med*10000)/10000,xp:calcXp(ref.med),bid:calcBid(ref.med)},
    {name:"공격적 (Q3)",adj:Math.round(ref.q3*10000)/10000,xp:calcXp(ref.q3),bid:calcBid(ref.q3)}];
  const bidRateRec={avg:Math.round(ref.bidAvg*10000)/10000,med:Math.round(ref.bidMed*10000)/10000,
    q1:Math.round(ref.bidQ1*10000)/10000,q3:Math.round(ref.bidQ3*10000)/10000,std:Math.round(ref.bidStd*10000)/10000};
  const bidByRate=Math.ceil(ba*ref.bidMed/100);
  return{scenarios,fr,src,bidRateRec,bidByRate,
    adjAvg:Math.round(ref.avg*10000)/10000,adjStd:Math.round(ref.std*10000)/10000,
    adj:Math.round(ref.med*10000)/10000,xp:calcXp(ref.med),bid:calcBid(ref.med),baseAdj:Math.round(ref.avg*10000)/10000,
    detailInsight}}

// ─── 데이터 현황 (최근 업로드 + 실제 최신 개찰일 분리) ────
function calcDataStatus(rows){
  if(!rows||!rows.length)return null;
  const today=new Date().toISOString().slice(0,10);
  // 실제 최신 개찰일 (오늘 이하)
  const pastOd=rows.filter(r=>r.od&&r.od<=today);
  pastOd.sort((a,b)=>(b.od>a.od?1:b.od<a.od?-1:0));
  const latest=pastOd[0]||null;
  const latestDate=latest?latest.od:null;
  const sameDayCount=latestDate?pastOd.filter(r=>r.od===latestDate).length:0;
  // 최근 업로드 배치 (created_at 기준)
  const withCa=rows.filter(r=>r.created_at);
  withCa.sort((a,b)=>(b.created_at>a.created_at?1:b.created_at<a.created_at?-1:0));
  const latestUpload=withCa[0]||null;
  const uploadTime=latestUpload?latestUpload.created_at:null;
  // 같은 배치(created_at 같은 초)의 건수
  let uploadBatchCount=0;
  if(uploadTime){const ts=uploadTime.slice(0,19);uploadBatchCount=withCa.filter(r=>r.created_at&&r.created_at.slice(0,19)===ts).length}
  // 미래 데이터 수
  const futureCount=rows.filter(r=>r.od&&r.od>today).length;
  return{total:rows.length,latestDate,latestPn:latest?(latest.pn||"").length>35?(latest.pn||"").slice(0,35)+"…":(latest.pn||"(없음)"):"",latestAg:latest?latest.ag||"":"",sameDayCount,
    uploadTime,uploadBatchCount,uploadPn:latestUpload?(latestUpload.pn||"").length>35?(latestUpload.pn||"").slice(0,35)+"…":(latestUpload.pn||""):"",uploadAg:latestUpload?latestUpload.ag||"":"",uploadOd:latestUpload?latestUpload.od:"",
    futureCount}}

// ─── Supabase CRUD ─────────────────────────────────────────
async function sbFetchAll(){const PAGE=1000;let all=[],offset=0;while(true){const res=await fetch(SB_URL+"/rest/v1/bid_records?select=*&order=od.desc&offset="+offset+"&limit="+PAGE,{headers:hdrsSel});const rows=await res.json();if(!Array.isArray(rows))break;all=all.concat(rows);if(rows.length<PAGE)break;offset+=PAGE}return all}
async function sbUpsert(rows){const BATCH=200;for(let i=0;i<rows.length;i+=BATCH){const batch=rows.slice(i,i+BATCH);const seen=new Set(),unique=[];for(const r of batch){if(!seen.has(r.dedup_key)){seen.add(r.dedup_key);unique.push(r)}}const body=sanitizeJson(JSON.stringify(unique));const res=await fetch(SB_URL+"/rest/v1/bid_records?on_conflict=dedup_key",{method:"POST",headers:{...hdrs,"Prefer":"resolution=merge-duplicates,return=minimal"},body});if(!res.ok)throw new Error(`Upsert: ${res.status}`)}}
async function sbDeleteIds(ids){const BATCH=50;for(let i=0;i<ids.length;i+=BATCH){await fetch(SB_URL+"/rest/v1/bid_records?id=in.("+ids.slice(i,i+BATCH).join(",")+")",{method:"DELETE",headers:hdrs})}}
async function sbDeleteAll(){await fetch(SB_URL+"/rest/v1/bid_records?id=gt.0",{method:"DELETE",headers:hdrs})}

// 예측 DB
async function sbSavePredictions(preds){const BATCH=50;for(let i=0;i<preds.length;i+=BATCH){const batch=preds.slice(i,i+BATCH);const seen=new Set(),unique=[];for(const r of batch){if(!seen.has(r.dedup_key)){seen.add(r.dedup_key);unique.push(r)}}const body=sanitizeJson(JSON.stringify(unique));await fetch(SB_URL+"/rest/v1/bid_predictions?on_conflict=dedup_key",{method:"POST",headers:{...hdrs,"Prefer":"resolution=merge-duplicates,return=minimal"},body})}}
async function sbFetchPredictions(){try{const PAGE=1000;let all=[],offset=0;while(true){const res=await fetch(SB_URL+"/rest/v1/bid_predictions?select=*&order=created_at.desc&offset="+offset+"&limit="+PAGE,{headers:hdrsSel});if(!res.ok)return[];const rows=await res.json();if(!Array.isArray(rows))return all;all=all.concat(rows);if(rows.length<PAGE)break;offset+=PAGE}return all}catch(e){return[]}}

// 자동 매칭: bid_predictions.pn_no → bid_records.pn_no (날짜 검증 포함)
async function sbMatchPredictions(predictions,records){
  // pn_no 기준으로 모든 후보를 배열로 저장 (동일 pn_no 복수 존재 가능)
  const recMap={};for(const r of records){if(r.pn_no&&r.pn_no.length>5){if(!recMap[r.pn_no])recMap[r.pn_no]=[];recMap[r.pn_no].push(r)}}
  const updates=[];
  for(const p of predictions){
    if(p.match_status==="matched")continue;
    if(!p.pn_no)continue;
    const candidates=recMap[p.pn_no];
    if(!candidates||!candidates.length)continue;
    // 후보가 1개면 바로 매칭, 복수면 날짜 가장 근접한 건 선택
    let match=null;
    if(candidates.length===1){match=candidates[0]}
    else if(p.open_date){
      // 예측 개찰일과 가장 가까운 낙찰 건 선택
      const pOd=p.open_date;
      let bestDist=Infinity;
      for(const c of candidates){
        if(!c.od)continue;
        const dist=Math.abs(new Date(pOd)-new Date(c.od));
        if(dist<bestDist){bestDist=dist;match=c}
      }
      // 30일 이상 차이나면 오매칭으로 판단하여 스킵
      if(bestDist>30*24*60*60*1000)match=null;
    }else{
      // 개찰일 없으면 가장 최근 건
      match=candidates.sort((a,b)=>(b.od>a.od?1:b.od<a.od?-1:0))[0];
    }
    if(!match)continue;
    const actualAdj=match.br1!=null?Math.round((match.br1-100)*10000)/10000:null;
    const adjErr=p.pred_adj_rate!=null&&actualAdj!=null?Math.round((p.pred_adj_rate-actualAdj)*10000)/10000:null;
    const bidErr=p.pred_bid_amount!=null&&match.bp!=null?Math.round(p.pred_bid_amount-match.bp):null;
    updates.push({id:p.id,actual_adj_rate:actualAdj,actual_expected_price:match.xp,actual_bid_amount:match.bp,actual_winner:match.co,actual_participant_count:match.pc,adj_rate_error:adjErr,bid_amount_error:bidErr,match_status:"matched",matched_record_id:match.id,matched_at:new Date().toISOString()})
  }
  for(const u of updates){
    const{id,...data}=u;
    await fetch(SB_URL+"/rest/v1/bid_predictions?id=eq."+id,{method:"PATCH",headers:{...hdrs,"Prefer":"return=minimal"},body:JSON.stringify(data)})
  }
  return updates.length}

// ─── bid_details CRUD ────────────────────────────────────
async function sbSaveDetail(detail){
  const body=sanitizeJson(JSON.stringify(detail));
  const res=await fetch(SB_URL+"/rest/v1/bid_details?on_conflict=pn_no",{method:"POST",headers:{...hdrs,"Prefer":"resolution=merge-duplicates,return=minimal"},body});
  return res.ok}
async function sbFetchDetails(){
  try{const res=await fetch(SB_URL+"/rest/v1/bid_details?select=*&order=od.desc&limit=200",{headers:hdrsSel});if(!res.ok)return[];return await res.json()}catch(e){return[]}}
async function sbFetchDetailsByAg(ag){
  try{const res=await fetch(SB_URL+"/rest/v1/bid_details?ag=eq."+encodeURIComponent(ag)+"&select=*&order=od.desc&limit=50",{headers:hdrsSel});if(!res.ok)return[];return await res.json()}catch(e){return[]}}

// ─── SUCVIEW XLS 파싱 ──────────────────────────────────────
function isSucviewFile(rows){return rows.length>7&&String(rows[0]?.[0]||"").trim()==="공고명"&&String(rows[2]?.[0]||"").trim()==="공고번호"}

function parseSucview(rows,fileName){
  const g=(r,c)=>String(rows[r]?.[c]||"").trim();
  const pn=g(0,2);const pn_no=g(2,2);const ag=g(2,8);const at=clsAg(ag);
  const odRaw=g(3,2);const od=pDt(odRaw);
  const ba=pnv(g(3,8).replace(/,/g,""));
  const ep=pnv(g(4,2).replace(/,/g,""));
  const floorRaw=g(4,8);const floor_rate=parseFloat(floorRaw)||0;
  // 예정가격 + A값 파싱: "46,778,225 (A값:2,809,541)"
  const xpRaw=g(5,2);let xp=0,av=0;
  const xpM=xpRaw.match(/([\d,]+)\s*\(A값[:\s]*([\d,]+)\)/);
  if(xpM){xp=pnv(xpM[1]);av=pnv(xpM[2])}else{xp=pnv(xpRaw.replace(/\(.*\)/,""))}
  // 사정율 파싱: "98.8358% (-1.1641%)"
  const arRaw=g(5,8);const arM=arRaw.match(/\(([-\d.]+)%?\)/);
  const adj_rate=arM?parseFloat(arM[1]):0;
  // 복수예비가격 15개 사정율
  const pre_rates=[];
  for(let i=8;i<=12;i++){[3,7,11].forEach(j=>{const v=parseFloat(String(rows[i]?.[j]||""));if(!isNaN(v))pre_rates.push(Math.round(v*10000)/10000)})}
  // 선택번호 파싱: "복 수 예 가  [ 선택번호:  ② ④ ⑦ ⑪ ]"
  const selRaw=g(7,0);const circled={"①":1,"②":2,"③":3,"④":4,"⑤":5,"⑥":6,"⑦":7,"⑧":8,"⑨":9,"⑩":10,"⑪":11,"⑫":12,"⑬":13,"⑭":14,"⑮":15};
  const selNums=[];for(const[ch,n]of Object.entries(circled)){if(selRaw.includes(ch))selNums.push(n)}
  const selected_nums=selNums.join(",");
  const pre_avg=pre_rates.length?Math.round(pre_rates.reduce((a,b)=>a+b,0)/pre_rates.length*10000)/10000:0;
  const pre_min=pre_rates.length?Math.min(...pre_rates):0;
  const pre_max=pre_rates.length?Math.max(...pre_rates):0;
  // 나의업체 (row17), 1순위 (row19)
  let my_rank=null,my_bid_rate=null,my_adj_rate=null,win_bid_rate=null,win_adj_rate=null;
  const myRaw=g(17,0);const myRankM=myRaw.match(/\((\d+)\)/);
  if(myRankM)my_rank=parseInt(myRankM[1]);
  my_bid_rate=parseFloat(g(17,8))||null;my_adj_rate=parseFloat(g(17,11))||null;
  win_bid_rate=parseFloat(g(19,8))||null;win_adj_rate=parseFloat(g(19,11))||null;
  // 참여업체 투찰 분포
  const bidRates=[];
  let startRow=-1;
  for(let i=20;i<Math.min(rows.length,25);i++){if(String(rows[i]?.[0]).trim()==="순위"&&String(rows[i]?.[1]||"").includes("등록번호")){startRow=i+1;break}}
  if(startRow>0){for(let i=startRow;i<rows.length;i++){const rank=parseInt(String(rows[i]?.[0]));if(isNaN(rank))break;const br=parseFloat(String(rows[i]?.[8]));if(!isNaN(br)&&br>0&&br<200)bidRates.push(br)}}
  const participant_count=bidRates.length;
  const sorted=[...bidRates].sort((a,b)=>a-b);
  const bid_median=sorted.length?sorted[Math.floor(sorted.length/2)]:null;
  const bid_q1=sorted.length>=4?sorted[Math.floor(sorted.length*0.25)]:bid_median;
  const bid_q3=sorted.length>=4?sorted[Math.floor(sorted.length*0.75)]:bid_median;
  const bid_dist={"<89":0,"89-89.5":0,"89.5-90":0,"90-90.5":0,"90.5-91":0,"91-91.5":0,"91.5-92":0,">92":0};
  bidRates.forEach(r=>{if(r<89)bid_dist["<89"]++;else if(r<89.5)bid_dist["89-89.5"]++;else if(r<90)bid_dist["89.5-90"]++;else if(r<90.5)bid_dist["90-90.5"]++;else if(r<91)bid_dist["90.5-91"]++;else if(r<91.5)bid_dist["91-91.5"]++;else if(r<92)bid_dist["91.5-92"]++;else bid_dist[">92"]++});
  return{pn_no,pn,ag,at,od,ba,ep,xp,av,floor_rate,adj_rate,pre_rates,selected_nums,pre_avg,pre_min,pre_max,participant_count,bid_dist,bid_median,bid_q1,bid_q3,my_rank,my_bid_rate,my_adj_rate,win_bid_rate,win_adj_rate,source_file:fileName}}

// ─── 추첨 시뮬레이션 (C(15,4)=1365) ─────────────────────
function simDraws(preRates){
  if(!preRates||preRates.length!==15)return null;
  const avgs=[];
  for(let a=0;a<12;a++)for(let b=a+1;b<13;b++)for(let c=b+1;c<14;c++)for(let d=c+1;d<15;d++){
    avgs.push(Math.round((preRates[a]+preRates[b]+preRates[c]+preRates[d])/4*10000)/10000)}
  avgs.sort((a,b)=>a-b);const n=avgs.length;
  const negCount=avgs.filter(v=>v<0).length;
  const hist={};avgs.forEach(v=>{const b=(Math.floor(v*2)/2).toFixed(1);hist[b]=(hist[b]||0)+1});
  return{total:n,avgs,min:avgs[0],max:avgs[n-1],
    p10:avgs[Math.floor(n*0.1)],p25:avgs[Math.floor(n*0.25)],p50:avgs[Math.floor(n*0.5)],p75:avgs[Math.floor(n*0.75)],p90:avgs[Math.floor(n*0.9)],
    negPct:Math.round(negCount/n*1000)/10,hist,
    belowMinus05:Math.round(avgs.filter(v=>v<-0.5).length/n*1000)/10,
    belowMinus10:Math.round(avgs.filter(v=>v<-1.0).length/n*1000)/10}}

// ─── 컴포넌트 ──────────────────────────────────────────────
const inpS={width:"100%",padding:"8px 10px",background:"#0c0c1a",border:"1px solid #252540",borderRadius:6,color:"#e8e8f0",fontSize:13,outline:"none"};
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

const PAGE=50;

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
  const[predResults,setPredResults]=useState([]);
  const[predictions,setPredictions]=useState([]);
  const[compFilter,setCompFilter]=useState("all");
  const[bidDetails,setBidDetails]=useState([]);
  const[simResult,setSimResult]=useState(null);
  const[expandedDetail,setExpandedDetail]=useState(null);

  const refreshStats=useCallback(rows=>{setAllS(calcStats(rows));setNewS(calcStats(rows,r=>r.era==="new"));setOldS(calcStats(rows,r=>r.era==="old"))},[]);

  // DB 로드
  useEffect(()=>{(async()=>{
    try{const rows=await sbFetchAll();setRecs(rows);refreshStats(rows);setDataStatus(calcDataStatus(rows));if(rows.length>0)setTab("dash")}catch(e){setMsg({type:"err",text:"DB 로드 실패: "+e.message})}
    try{const preds=await sbFetchPredictions();setPredictions(preds||[])}catch(e){setPredictions([])}
    try{const dets=await sbFetchDetails();setBidDetails(dets||[])}catch(e){setBidDetails([])}
    setDbLoading(false)
  })()},[refreshStats]);

  // 파일 업로드 (3종 자동 판별: SUCVIEW / 입찰서류함 / 낙찰정보리스트)
  const loadFiles=useCallback(async(fileList)=>{
    const files=Array.from(fileList).filter(Boolean);if(!files.length)return;setBusy(true);setMsg({type:"",text:""});setUploadLog([]);const logs=[];
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
          const results=items.map(item=>{const p=predictV4({at:item.at,agName:item.ag,ba:item.ba,ep:item.ep,av:item.av},allS.ts,allS.as,bidDetails);return{...item,pred:p}}).filter(r=>r.pred);
          if(!results.length)throw new Error("예측 결과 0건");
          setPredResults(results);
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

  // 입찰서류함 예측
  const loadPredFile=useCallback(async(file)=>{
    if(!file)return;
    if(!Object.keys(allS.ts||{}).length){setMsg({type:"err",text:"낙찰 데이터를 먼저 로드해주세요 (통계 없음)"});return}
    setBusy(true);setMsg({type:"",text:""});
    try{const{rows}=await parseFile(file);const items=parseBidDoc(rows);if(!items.length)throw new Error("예측 대상 0건");
      const results=items.map(item=>{const p=predictV4({at:item.at,agName:item.ag,ba:item.ba,ep:item.ep,av:item.av},allS.ts,allS.as,bidDetails);return{...item,pred:p}}).filter(r=>r.pred);
      if(!results.length)throw new Error("예측 결과 0건 (기관/기초금액 확인)");
      setPredResults(results);
      const dbRows=results.map(r=>({dedup_key:r.dedup_key,pn:r.pn,pn_no:r.pn_no,ag:r.ag,at:r.at,ep:r.ep,ba:r.ba,av:r.av,raw_cost:r.raw_cost,cat:r.cat,open_date:r.open_date,pred_adj_rate:r.pred.adj,pred_expected_price:r.pred.xp,pred_floor_rate:r.pred.fr,pred_bid_amount:r.pred.bid,pred_source:r.pred.src,pred_base_adj:r.pred.baseAdj,source:"file_upload",match_status:"pending"}));
      await sbSavePredictions(dbRows);const preds=await sbFetchPredictions();setPredictions(preds);
      setMsg({type:"ok",text:`${results.length}건 예측 완료 · DB 저장`})
    }catch(e){setMsg({type:"err",text:"예측 실패: "+e.message})}setBusy(false)},[allS,bidDetails]);

  // 수동 예측
  const doManualPred=useCallback(async()=>{
    if(!Object.keys(allS.ts||{}).length){setMsg({type:"err",text:"낙찰 데이터가 없습니다. 먼저 데이터를 업로드해주세요."});return}
    const p=predictV4({at:clsAg(inp.agency),agName:inp.agency.trim(),ba:tn(inp.baseAmount),ep:tn(inp.estimatedPrice),av:tn(inp.aValue)},allS.ts,allS.as,bidDetails);
    if(!p){setMsg({type:"err",text:"예측 실패: 기관 또는 금액 정보를 확인해주세요."});return}
    setPred(p);
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
  const filteredRecs=useMemo(()=>{const t=search.toLowerCase();let src=recs;
    if(eF==="new")src=recs.filter(r=>r.era==="new");else if(eF==="old")src=recs.filter(r=>r.era==="old");
    if(atF!=="all")src=src.filter(r=>r.at===atF);
    return t?src.filter(r=>((r.pn||"")+(r.ag||"")+(r.co||"")).toLowerCase().includes(t)):src},[recs,search,eF,atF]);
  const pagedRecs=useMemo(()=>filteredRecs.slice(dataPage*PAGE,(dataPage+1)*PAGE),[filteredRecs,dataPage]);
  const totalPages=Math.max(1,Math.ceil(filteredRecs.length/PAGE));
  const fAg=useMemo(()=>{const t=agSch.toLowerCase();return Object.entries(curSt.as||{}).filter(([k])=>!t||mSch(k,t)).sort((a,b)=>b[1].n-a[1].n)},[curSt.as,agSch]);
  const agencyList=useMemo(()=>Object.keys(allS.as||{}).sort(),[allS.as]);
  const nC=recs.filter(r=>r.era==="new").length,oC=recs.filter(r=>r.era==="old").length;
  const allSel=pagedRecs.length>0&&pagedRecs.every(r=>sel[r.id]);

  const compStats=useMemo(()=>{
    const preds=predictions||[];const matched=preds.filter(p=>p.match_status==="matched");const pending=preds.filter(p=>p.match_status==="pending");
    const errors=matched.filter(p=>p.adj_rate_error!=null).map(p=>Math.abs(p.adj_rate_error));
    const avgErr=errors.length?Math.round(errors.reduce((a,b)=>a+b,0)/errors.length*10000)/10000:0;
    const byType={};matched.forEach(p=>{const t=p.at||"기타";if(!byType[t])byType[t]={n:0,errSum:0};byType[t].n++;if(p.adj_rate_error!=null)byType[t].errSum+=Math.abs(p.adj_rate_error)});
    Object.values(byType).forEach(v=>{v.avgErr=v.n?Math.round(v.errSum/v.n*10000)/10000:0});
    return{total:preds.length,matched:matched.length,pending:pending.length,avgErr,byType}},[predictions]);
  const compList=useMemo(()=>{const p=predictions||[];if(compFilter==="matched")return p.filter(x=>x.match_status==="matched");if(compFilter==="pending")return p.filter(x=>x.match_status==="pending");return p},[predictions,compFilter]);

  // 스타일
  const btnS=(act,c)=>({padding:"4px 12px",fontSize:11,fontWeight:act?600:400,background:act?c+"22":"#1a1a30",color:act?c:"#888",border:"1px solid "+(act?c+"44":"#252540"),borderRadius:5,cursor:"pointer"});
  const Tb=({id,ch,badge})=>(<button onClick={()=>{setTab(id);setDataPage(0)}} style={{padding:"10px 20px",fontSize:12,fontWeight:tab===id?600:400,background:tab===id?C.bg3:"transparent",color:tab===id?C.gold:C.txm,border:"none",borderBottom:tab===id?`2px solid ${C.gold}`:"2px solid transparent",cursor:"pointer",position:"relative"}}>{ch}{badge>0&&<span style={{position:"absolute",top:4,right:4,background:"#e24b4a",color:"#fff",fontSize:8,padding:"1px 5px",borderRadius:8,minWidth:14,textAlign:"center"}}>{badge}</span>}</button>);

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

      {/* 요약 카드 4개 */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
        {[
          {l:"낙찰 데이터",v:recs.length.toLocaleString(),s:dataStatus?.latestDate?"최신 "+dataStatus.latestDate:"",c:C.txt},
          {l:"상세 데이터",v:String(bidDetails.length),s:"복수예가 15개",c:"#a8b4ff"},
          {l:"예측 대기",v:String(compStats.pending),s:"미매칭",c:compStats.pending>0?"#e24b4a":"#5dca96"},
          {l:"평균 오차",v:compStats.matched>0?compStats.avgErr.toFixed(2)+"%":"—",s:compStats.matched+"건 매칭",c:"#d4a834"}
        ].map((c,i)=><div key={i} style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,padding:"12px",textAlign:"center",cursor:"pointer"}} onClick={()=>{if(i===0)setTab("analysis");if(i===2||i===3)setTab("predict")}}>
          <div style={{fontSize:11,color:C.txd,marginBottom:4}}>{c.l}</div>
          <div style={{fontSize:22,fontWeight:600,color:c.c}}>{c.v}</div>
          <div style={{fontSize:10,color:C.txd,marginTop:2}}>{c.s}</div>
        </div>)}
      </div>

      {/* 복수예가 상세 데이터 리스트 */}
      {bidDetails.length>0&&<div style={{marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:600,color:C.gold,marginBottom:8}}>복수예가 상세 데이터 ({bidDetails.length}건)</div>
        {bidDetails.slice(0,10).map((d,i)=><div key={d.id||i} style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,marginBottom:6,overflow:"hidden"}}>
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

      {/* 낙찰 데이터 목록 */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <span style={{fontSize:12,fontWeight:600,color:C.gold}}>낙찰 데이터 ({filteredRecs.length.toLocaleString()}건)</span>
        {selCount>0&&<button onClick={()=>setDlgType("sel")} style={{padding:"4px 12px",background:"rgba(220,50,50,0.1)",border:"1px solid rgba(220,50,50,0.3)",borderRadius:5,color:"#e55",fontSize:11,cursor:"pointer"}}>{selCount}건 삭제</button>}
      </div>
      <div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,overflow:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,tableLayout:"fixed"}}>
          <colgroup><col style={{width:30}}/><col style={{width:"22%"}}/><col style={{width:"12%"}}/><col style={{width:"6%"}}/><col style={{width:"12%"}}/><col style={{width:"10%"}}/><col style={{width:"10%"}}/><col style={{width:"10%"}}/><col style={{width:"5%"}}/></colgroup>
          <thead><tr style={{background:C.bg3}}><th style={{padding:6}}><input type="checkbox" checked={allSel} onChange={()=>{const n={};if(!allSel)pagedRecs.forEach(r=>{n[r.id]=true});setSel(n)}}/></th>
            {["공고명","발주기관","유형","기초금액","사정율(100%)","1순위","개찰일","시대"].map((h,i)=><th key={i} style={{padding:"8px 4px",textAlign:i>=3?"right":"left",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:11}}>{h}</th>)}</tr></thead>
          <tbody>{pagedRecs.map(r=>{
            const isYuchal=r.co==="유찰";const rowBg=isYuchal?"rgba(226,75,74,0.03)":"transparent";
            return<tr key={r.id} style={{borderBottom:"1px solid "+C.bdr,background:rowBg}}>
              <td style={{padding:4,textAlign:"center"}}><input type="checkbox" checked={!!sel[r.id]} onChange={()=>setSel(p=>({...p,[r.id]:!p[r.id]}))}/></td>
              <td style={{padding:"6px 4px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",opacity:isYuchal?.5:1}} title={r.pn}>{r.pn||"(없음)"}</td>
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
            onDrop={e=>{e.preventDefault();setDragPred(false);if(!busy&&e.dataTransfer.files?.[0])loadPredFile(e.dataTransfer.files[0])}}
            onDragOver={e=>{e.preventDefault();if(!busy)setDragPred(true)}} onDragLeave={()=>setDragPred(false)}
            onClick={()=>{if(!busy)document.getElementById("pfi").click()}}>
            <input id="pfi" type="file" accept=".xls,.xlsx" style={{display:"none"}} onChange={e=>{if(e.target.files?.[0]){loadPredFile(e.target.files[0]);e.target.value=""}}}/>
            {busy?<div style={{color:C.gold,fontSize:14}}>예측 처리 중...</div>:<>
              <div style={{fontSize:28,opacity:0.3,marginBottom:6}}>↑</div>
              <div style={{fontSize:13,fontWeight:600,marginBottom:4}}>입찰서류함 드래그 또는 클릭</div>
              <div style={{fontSize:11,color:C.txd}}>XLS 파일 각 건에 대해 일괄 예측 + DB 저장</div>
            </>}
          </div>
        </div>
      </div>

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
      </div>}

      {/* 예측 내역 + 비교 통합 */}
      <div style={{background:C.bg2,border:"1px solid "+C.bdr,borderRadius:10,padding:16}}>
        <div style={{fontSize:13,fontWeight:600,color:C.gold,marginBottom:10}}>예측 내역 + 정확도 비교</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
          {[{l:"총 예측",v:compStats.total,c:C.txt},{l:"매칭 완료",v:compStats.matched,c:"#5dca96"},{l:"평균 오차",v:compStats.matched>0?compStats.avgErr.toFixed(4)+"%":"—",c:"#d4a834"},{l:"대기 중",v:compStats.pending,c:"#e24b4a"}].map((c,i)=>
            <div key={i} style={{background:C.bg3,borderRadius:6,padding:"8px",textAlign:"center"}}>
              <div style={{fontSize:10,color:C.txd}}>{c.l}</div>
              <div style={{fontSize:18,fontWeight:600,color:c.c}}>{c.v}</div>
            </div>)}
        </div>
        <div style={{display:"flex",gap:4,marginBottom:10}}>
          <button onClick={()=>setCompFilter("all")} style={btnS(compFilter==="all",C.gold)}>전체 ({compStats.total})</button>
          <button onClick={()=>setCompFilter("matched")} style={btnS(compFilter==="matched","#5dca96")}>매칭 ({compStats.matched})</button>
          <button onClick={()=>setCompFilter("pending")} style={btnS(compFilter==="pending","#e24b4a")}>대기 ({compStats.pending})</button>
        </div>
        {compList.length>0?<div style={{overflow:"auto",maxHeight:500}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,tableLayout:"fixed"}}>
            <colgroup><col style={{width:"22%"}}/><col style={{width:"10%"}}/><col style={{width:"10%"}}/><col style={{width:"10%"}}/><col style={{width:"8%"}}/><col style={{width:"12%"}}/><col style={{width:"10%"}}/><col style={{width:"8%"}}/><col style={{width:"6%"}}/></colgroup>
            <thead><tr style={{background:C.bg3}}>{["공고명","발주기관","예측(100%)","실제(100%)","오차","추천금액","실제금액","개찰일","상태"].map((h,i)=>
              <th key={i} style={{padding:"7px 6px",textAlign:i>=2?"right":"left",color:C.txm,fontWeight:500,borderBottom:"1px solid "+C.bdr,fontSize:11}}>{h}</th>)}</tr></thead>
            <tbody>{compList.slice(0,100).map(p=>{
              const errColor=p.adj_rate_error!=null?(Math.abs(p.adj_rate_error)<0.3?"#5dca96":Math.abs(p.adj_rate_error)<1?"#d4a834":"#e24b4a"):C.txd;
              return<tr key={p.id} style={{borderBottom:"1px solid "+C.bdr}}>
                <td style={{padding:"6px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={p.pn}>{p.pn}</td>
                <td style={{padding:"6px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.ag}</td>
                <td style={{padding:"6px",textAlign:"right",color:"#5dca96"}}>{p.pred_adj_rate!=null?(100+Number(p.pred_adj_rate)).toFixed(4)+"%":""}</td>
                <td style={{padding:"6px",textAlign:"right",color:C.gold}}>{p.actual_adj_rate!=null?(100+Number(p.actual_adj_rate)).toFixed(4)+"%":""}</td>
                <td style={{padding:"6px",textAlign:"right",color:errColor,fontWeight:600}}>{p.adj_rate_error!=null?Number(p.adj_rate_error).toFixed(4):""}</td>
                <td style={{padding:"6px",textAlign:"right",fontFamily:"monospace"}}>{p.pred_bid_amount?tc(p.pred_bid_amount):""}</td>
                <td style={{padding:"6px",textAlign:"right",fontFamily:"monospace"}}>{p.actual_bid_amount?tc(p.actual_bid_amount):""}</td>
                <td style={{padding:"6px",textAlign:"right"}}>{p.open_date||""}</td>
                <td style={{padding:"6px",textAlign:"center"}}><span style={{fontSize:10,padding:"2px 6px",borderRadius:4,background:p.match_status==="matched"?"rgba(93,202,165,0.15)":"rgba(226,75,74,0.15)",color:p.match_status==="matched"?"#5dca96":"#e24b4a"}}>{p.match_status==="matched"?"매칭":"대기"}</span></td>
              </tr>})}</tbody>
          </table>
        </div>:<div style={{textAlign:"center",padding:30,color:C.txd,fontSize:12}}>예측 내역이 없습니다.</div>}
      </div>
    </div>}

    </div>
  </div>)}
