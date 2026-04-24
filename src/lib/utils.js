import * as XLSX from "xlsx";
import { CHO } from "./constants.js";

// Phase 23-4-B: 벤치마크 투찰금 → 사정률(%) 역산
// A값 유무에 따라 예정가격(ep) 역산 공식이 다르므로 통합 처리
export function calcBenchmarkAdj(pred) {
  if (!pred) return null;
  const benchBid = Number(pred.benchmark_bid || 0);
  const ba = Number(pred.ba || 0);
  const fr = Number(pred.pred_floor_rate || 0);
  const av = Number(pred.av || 0);
  if (benchBid <= 0 || ba <= 0 || fr <= 0) return null;
  const benchEp = av > 0 ? av + (benchBid - av) * 100 / fr : benchBid * 100 / fr;
  return (benchEp / ba - 1) * 100;
}

// ─── Phase 17-A: 1위 목표 투찰금 보정 ──────────────────────
// 근거: bid_details 315건 자사 입찰 분석 — 자사 투찰률이 1위보다 기관유형별 중앙값만큼 높음
// bid1st = opt_bid × fr / (fr + gap)  ← 1위 수준으로 낮춤
export const WIN_OPT_GAP={
  "지자체":    0.493,
  "군시설":    0.385,
  "교육청":    0.533,
  "한전":      0.367,
  "조달청":    0.676,
  "LH":        0.088,
  "수자원공사": 0.003,
};
export function calcWin1stBid(bid, fr, at){
  if(!bid||!fr)return null;
  const gap=WIN_OPT_GAP[at]??0.3;
  return Math.round(Number(bid)*Number(fr)/(Number(fr)+gap));
}

// ─── 낙찰하한율 (2026 기관별 개정 반영) ──────────────────────
// ─── 낙찰하한율 (2026 기관별 개정 반영) ──────────────────────
// 구기준: 산식기준 88/100 기반
// 신기준: 조달청계열 → 90/100, 지자체/교육청 → 88/100 유지 (구간만 변경)
// 시행일: 기관별 상이 (cutoffDate 참조)
const RATE_TABLE={
  // ── 조달청 (시행 2026.01.30) ── 별표5/6: 3억미만은 90/100 기준(90.25%)
  "조달청":{cutoff:"2026-01-30",
    old:[{min:5e9,max:1e11,rate:85.495},{min:1e9,max:5e9,rate:86.745},{min:3e8,max:1e9,rate:87.745},{min:0,max:3e8,rate:88.25}],
    new:[{min:5e9,max:1e11,rate:87.495},{min:1e9,max:5e9,rate:88.745},{min:3e8,max:1e9,rate:89.745},{min:0,max:3e8,rate:90.25}]},
  // ── 지자체 (행정안전부 기준, 시행 2025.07.01) ── 3억미만: 88/100→90/100 별표전환
  "지자체":{cutoff:"2025-07-01",
    old:[{min:1e10,max:3e11,rate:79.995},{min:5e9,max:1e10,rate:85.495},{min:3e9,max:5e9,rate:86.745},{min:1e9,max:3e9,rate:86.745},{min:4e8,max:1e9,rate:87.745},{min:3e8,max:4e8,rate:87.745},{min:0,max:3e8,rate:88.25}],
    new:[{min:1e10,max:3e11,rate:81.995},{min:5e9,max:1e10,rate:87.495},{min:3e9,max:5e9,rate:88.745},{min:1e9,max:3e9,rate:88.745},{min:4e8,max:1e9,rate:89.745},{min:3e8,max:4e8,rate:89.745},{min:0,max:3e8,rate:90.25}]},
  // ── 교육청 (행정안전부 기준 준용) ──
  "교육청":{cutoff:"2025-07-01",
    old:[{min:5e9,max:1e11,rate:85.495},{min:3e9,max:5e9,rate:86.745},{min:1e9,max:3e9,rate:86.745},{min:4e8,max:1e9,rate:87.745},{min:3e8,max:4e8,rate:87.745},{min:0,max:3e8,rate:88.25}],
    new:[{min:5e9,max:1e11,rate:87.495},{min:3e9,max:5e9,rate:88.745},{min:1e9,max:3e9,rate:88.745},{min:4e8,max:1e9,rate:89.745},{min:3e8,max:4e8,rate:89.745},{min:0,max:3e8,rate:90.25}]},
  // ── 한전 (한국전력공사) ── 자체 적격심사 기준 사용, 2026 개정 미적용 (데이터 검증: 144건 중앙값 87.745%)
  "한전":{cutoff:"2099-12-31",
    old:[{min:5e9,max:1e11,rate:85.495},{min:1e9,max:5e9,rate:86.745},{min:3e8,max:1e9,rate:87.745},{min:0,max:3e8,rate:88.25}],
    new:[{min:5e9,max:1e11,rate:85.495},{min:1e9,max:5e9,rate:86.745},{min:3e8,max:1e9,rate:87.745},{min:0,max:3e8,rate:88.25}]},
  // ── LH (한국토지주택공사, 시행 2026.02.01) ──
  "LH":{cutoff:"2026-02-01",
    old:[{min:5e9,max:1e11,rate:85.495},{min:1e9,max:5e9,rate:86.745},{min:3e8,max:1e9,rate:87.745},{min:0,max:3e8,rate:88.25}],
    new:[{min:5e9,max:1e11,rate:87.495},{min:1e9,max:5e9,rate:88.745},{min:3e8,max:1e9,rate:89.745},{min:0,max:3e8,rate:90.25}]},
  // ── 군시설 (시행 2026.01.19, 자체훈령/계약예규 상이 가능) ──
  "군시설":{cutoff:"2026-01-19",
    old:[{min:5e9,max:1e11,rate:83.495},{min:1e9,max:5e9,rate:84.745},{min:3e8,max:1e9,rate:85.745},{min:0,max:3e8,rate:86.25}],
    new:[{min:5e9,max:1e11,rate:87.495},{min:1e9,max:5e9,rate:88.745},{min:3e8,max:1e9,rate:89.745},{min:0,max:3e8,rate:90.25}]},
  // ── 수자원공사 (시행 2026.02.27) ──
  "수자원공사":{cutoff:"2026-02-27",
    old:[{min:5e9,max:1e11,rate:85.495},{min:1e9,max:5e9,rate:86.745},{min:3e8,max:1e9,rate:87.745},{min:0,max:3e8,rate:88.25}],
    new:[{min:5e9,max:1e11,rate:87.495},{min:1e9,max:5e9,rate:88.745},{min:3e8,max:1e9,rate:89.745},{min:0,max:3e8,rate:90.25}]}
};
export function getFloorRate(at,ep,isNew){const tbl=RATE_TABLE[at]||RATE_TABLE["조달청"];const rules=isNew?tbl.new:tbl.old;for(const r of rules){if(ep>=r.min&&ep<r.max)return r.rate}return rules[rules.length-1].rate}
export function getCutoffDate(at){return(RATE_TABLE[at]||RATE_TABLE["조달청"]).cutoff}
export function isNewEra(at,od){if(!od)return false;return od>=getCutoffDate(at)}
// LH 종심제/순심제 대형 공사 감지 — 예측 모델이 -2.941로 수렴하는 구조적 미지원 구간
export function isLhJongsim(at,ba,pn){
  if(at!=="LH")return false;
  if((Number(ba)||0)<1e10)return false;
  return /\[공의\]|종합심사|종심제|순심제/.test(String(pn||""));
}
// Phase 12: 표준 RATE_TABLE만 사용 (여성기업 가산 등 특수 규정 제외)
export function eraFR(at,ep,od){return getFloorRate(at,ep||0,isNewEra(at,od))}
// ─── 유틸 ──────────────────────────────────────────────────
export function clsAg(n){if(!n)return"조달청";const s=n.trim();if(/조달청/.test(s))return"조달청";if(/교육/.test(s))return"교육청";if(/한국전력|한전/.test(s))return"한전";if(/LH|주택공사|토지주택/.test(s))return"LH";if(/군|사단|국방|해군|공군|육군|해병/.test(s))return"군시설";if(/수자원/.test(s))return"수자원공사";return"지자체"}
export function clean(v){if(v==null)return"";return String(v).replace(/[\u0000\u2800-\u2BFF\uE000-\uF8FF]/g,"").replace(/\s+/g," ").trim()}
export function pnv(v){if(v==null||v==="")return 0;if(typeof v==="number")return v;return parseFloat(String(v).replace(/,/g,"").trim())||0}
export function sn(v){const n=pnv(v);return n===0?null:n}
export function tc(v){return Number(v||0).toLocaleString()}
export function tn(s){return Number(String(s).replace(/,/g,""))||0}
export function pDt(v){if(!v)return null;const s=String(v).trim();let m;if((m=s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/)))return`${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;if((m=s.match(/^(\d{2})[-./](\d{1,2})[-./](\d{1,2})/)))return`20${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;return null}
// CHO imported from constants.js
export function getCho(c){const code=c.charCodeAt(0);if(code>=0xAC00&&code<=0xD7A3)return CHO[Math.floor((code-0xAC00)/588)];return c}
export function mSch(t,q){if(!q)return true;const tl=t.toLowerCase(),ql=q.toLowerCase();if(tl.includes(ql))return true;return Array.from(t).map(getCho).join("").includes(q)}

// ─── MD5 ───────────────────────────────────────────────────
export function md5(s){function rl(n,c){return(n<<c)|(n>>>(32-c))}function tI(s){let h="";for(let i=0;i<=3;i++)h+="0123456789abcdef".charAt((s>>>(i*8+4))&0xF)+"0123456789abcdef".charAt((s>>>(i*8))&0xF);return h}function aI(x,y){let l=(x&0xFFFF)+(y&0xFFFF);return((x>>16)+(y>>16)+(l>>16))<<16|l&0xFFFF}const K=[],S=[];for(let i=0;i<64;i++){K[i]=Math.floor(Math.abs(Math.sin(i+1))*4294967296);S[i]=[7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21][((i>>4)<<2)+(i%4)]}let a0=0x67452301,b0=0xEFCDAB89,c0=0x98BADCFE,d0=0x10325476;const bytes=[];for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c<128)bytes.push(c);else if(c<2048){bytes.push(192|(c>>6));bytes.push(128|(c&63))}else{bytes.push(224|(c>>12));bytes.push(128|((c>>6)&63));bytes.push(128|(c&63))}}const bl=bytes.length*8;bytes.push(128);while(bytes.length%64!==56)bytes.push(0);for(let i=0;i<4;i++)bytes.push((bl>>>(i*8))&0xFF);for(let i=0;i<4;i++)bytes.push(0);for(let o=0;o<bytes.length;o+=64){const M=[];for(let j=0;j<16;j++)M[j]=bytes[o+j*4]|(bytes[o+j*4+1]<<8)|(bytes[o+j*4+2]<<16)|(bytes[o+j*4+3]<<24);let a=a0,b=b0,c=c0,d=d0;for(let i=0;i<64;i++){let f,g;if(i<16){f=(b&c)|((~b)&d);g=i}else if(i<32){f=(d&b)|((~d)&c);g=(5*i+1)%16}else if(i<48){f=b^c^d;g=(3*i+5)%16}else{f=c^(b|(~d));g=(7*i)%16}const tmp=d;d=c;c=b;b=aI(b,rl(aI(a,aI(f,aI(K[i],M[g]))),S[i]));a=tmp}a0=aI(a0,a);b0=aI(b0,b);c0=aI(c0,c);d0=aI(d0,d)}return tI(a0)+tI(b0)+tI(c0)+tI(d0)}
export function sanitizeJson(s){return s.replace(/\\u0000/g,"").replace(/[\uD800-\uDFFF]/g,"")}

// ─── 파싱 ──────────────────────────────────────────────────
export async function parseFile(file){const buf=await file.arrayBuffer();const wb=XLSX.read(new Uint8Array(buf),{type:"array",codepage:949,cellDates:false,raw:true});const ws=wb.Sheets[wb.SheetNames[0]];const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:"",raw:true});if(!rows.length)throw new Error("빈 파일");return{rows,format:file.name.toLowerCase().endsWith(".xlsx")?"XLSX":"XLS"}}

// 낙찰정보리스트 레코드 변환
export function toRecord(r){const pn=clean(r[1]);if(!pn||pn.length<2)return null;const ag=clean(r[3]);const at=clsAg(ag);const ep=sn(r[4]);const ba=sn(r[5]);const av=pnv(r[6]);const od=pDt(clean(r[19]));const era=isNewEra(at,od)?"new":"old";const dk=pn+"|"+ag+"|"+(od||"")+"|"+(ba||"");if(dk.length<5)return null;return{dedup_key:md5(dk),pn,pn_no:clean(r[2]),ag,at,ep:ep||null,ba:ba||null,av:av||0,raw_cost:clean(r[7]),xp:sn(r[8]),floor_price:sn(r[9]),ar1:sn(r[10]),ar0:sn(r[11]),co:clean(r[12]),co_no:clean(r[13]),bp:sn(r[14]),br1:sn(r[15]),br0:sn(r[16]),base_ratio:sn(r[17]),pc:Math.round(pnv(r[18]))||0,od:od||null,input_date:pDt(clean(r[20]))||null,cat:clean(r[21]),g2b:clean(r[22]),reg:clean(r[23]),era,has_a:av>0,fr:eraFR(at,ep,od)}}
export function toRecords(rows){return rows.map(toRecord).filter(Boolean)}

// 입찰서류함 파싱 (헤더 동적 매핑)
export function parseBidDoc(rows){
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

// ─── 통계 (사정율 분포 + 투찰율 통계 + drift) ──────────────
export function calcStats(recs,filter){const src=filter?recs.filter(filter):recs;const ts={},as={};
  // drift 계산용 날짜 기준 (문자열 비교로 충분)
  const now=new Date();
  const d90=new Date(now-90*24*60*60*1000).toISOString().slice(0,10);
  const d180=new Date(now-180*24*60*60*1000).toISOString().slice(0,10);
  // Phase 14-5: 옛 데이터 100% 발주사 리다이렉트 매핑
  // 특정 발주사가 2024년 이후 데이터가 0건이면서 옛 데이터만 있는 경우,
  // 통계적으로 유사한 대체 발주사로 리다이렉트하여 학습 오염 방지
  // (대안이 없는 경우 null → 해당 발주사 학습 건너뜀)
  const AGENCY_REDIRECT={
    "한국토지주택공사":"한국토지주택공사 경기남부지역본부" // 본사 옛 데이터(2012-2013) 격리
  };
  // Phase 14-5: 데이터 시점 컷오프 (2024년 이전 데이터는 학습 제외)
  const STALE_CUTOFF="2024-01-01";
  for(const r of src){if(r.br1==null)continue;
    if(r.is_excluded===true)continue; // 비정상 건(수의시담·pc=1 등) 학습 제외
    const adj=r.br1-100;if(adj<-5||adj>5)continue;
    const bidRate=(r.bp&&r.xp&&r.xp>0)?r.bp/r.xp*100:null;
    const t=r.at||"기타";
    if(!ts[t])ts[t]={n:0,sum:0,vals:[],bidRates:[],recentVals:[],prevVals:[]};
    ts[t].n++;ts[t].sum+=adj;ts[t].vals.push(adj);
    if(bidRate&&bidRate>80&&bidRate<95)ts[t].bidRates.push(bidRate);
    // drift용 시간대별 분류
    if(r.od&&r.od>=d90){ts[t].recentVals.push(adj)}
    else if(r.od&&r.od>=d180){ts[t].prevVals.push(adj)}
    // ★ 발주사 학습 (Phase 14-5 안전 필터 적용)
    let a=r.ag;
    // 1) 리다이렉트 매핑 적용 (LH 본사 등)
    if(a&&AGENCY_REDIRECT[a]){
      // 옛 데이터 발주사는 본인 학습 건너뛰고, 대체 발주사에 누적하지 않음
      // (대체 발주사는 자기 데이터로 자연스럽게 학습됨)
      a=null;
    }
    // 2) 옛 데이터 필터: 2024년 이전 데이터는 발주사 학습에서 제외
    //    (at별 통계는 그대로 사용, 발주사 개별 학습만 보호)
    if(a&&r.od&&r.od<STALE_CUTOFF){
      a=null;
    }
    if(a){
      if(!as[a])as[a]={n:0,sum:0,vals:[],bidRates:[],type:t,recentVals:[],prevVals:[]};
      as[a].n++;as[a].sum+=adj;as[a].vals.push(adj);
      if(bidRate&&bidRate>80&&bidRate<95)as[a].bidRates.push(bidRate);
      if(r.od&&r.od>=d90){as[a].recentVals.push(adj)}
      else if(r.od&&r.od>=d180){as[a].prevVals.push(adj)}}}
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
    v.bidStd=bl>=2?Math.sqrt(v.bidRates.reduce((s,x)=>s+(x-v.bidAvg)**2,0)/(bl-1)):0;
    // ★ drift: 최근 90일 평균 - 이전 90일 평균 (clamp ±0.5)
    const rLen=v.recentVals.length,pLen=v.prevVals.length;
    const rAvg=rLen>=3?v.recentVals.reduce((s,x)=>s+x,0)/rLen:null;
    const pAvg=pLen>=3?v.prevVals.reduce((s,x)=>s+x,0)/pLen:null;
    v.recentDrift=(rAvg!==null&&pAvg!==null)?Math.max(-0.5,Math.min(0.5,rAvg-pAvg)):0;
    v.recentAvg=rAvg;v.recentN=rLen;v.prevAvg=pAvg;v.prevN=pLen}};
  fin(ts);fin(as);return{ts,as}}

// ─── 예측 v5 (51K 백테스트 기반 보정) ────────────────────────
const rnd4=v=>Math.round((v||0)*10000)/10000;

// ─── Phase 23-5: 추천값 방향·크기 힌트 (pred_bias_map 기반 화살표) ──
// getFinalRecommendation의 lookup 순서(AG×BA → AG → AT×BA → AT)를 재사용.
// biasMap 저장값 해석: predicted - actual (overshoot 양수).
// 화살표 방향 = 실측 위치 = -bias (양수면 실측이 상향, 음수면 하향).
// 크기 임계값: 이론 노이즈 바닥 0.642% 절반 이하를 기준선으로 3단계 + 중립.
export function getBiasArrow(biasMap,{at,ag,ba}){
  if(!biasMap||!at)return null;
  const baNum=Number(ba)||0;
  const seg=baNum<1e8?'S1':baNum<3e8?'S2':baNum<1e9?'S3':baNum<3e9?'S4':'S5';
  let bias=null,src='';
  if(ag&&biasMap.agBa&&biasMap.agBa[ag+'|'+seg]!=null){bias=biasMap.agBa[ag+'|'+seg];src='AG×금액대'}
  else if(ag&&biasMap.ag&&biasMap.ag[ag]!=null){bias=biasMap.ag[ag];src='AG'}
  else if(biasMap.atBa&&biasMap.atBa[at+'|'+seg]!=null){bias=biasMap.atBa[at+'|'+seg];src='AT×금액대'}
  else if(biasMap.at&&biasMap.at[at]!=null){bias=biasMap.at[at];src='AT'}
  if(bias==null)return null;
  const actualDir=-bias;
  const mag=Math.abs(actualDir);
  let size,glyph,color,label;
  if(mag<0.03){size='neutral';glyph='·';color='#666680';label='중립'}
  else if(mag<0.10){size='small';glyph=actualDir>0?'▴':'▾';color='#85b7eb';label='우수'}
  else if(mag<0.25){size='medium';glyph=actualDir>0?'▲':'▼';color='#d4a834';label='보통'}
  else{size='large';glyph=actualDir>0?'⇈':'⇊';color='#e24b4a';label='이상치'}
  return{glyph,color,label,size,sign:Math.sign(actualDir),bias,actualDir,source:src};
}

// Phase 21-R: 라우팅 분류기 — predictV5 내부의 암묵 분기를 명시 레이블로 노출
// DB의 opt_adj_router 컬럼에 저장되며, route별 MAE 분해 분석에 사용
export const AGENCY_LOOKUP_REDIRECT={
  "한국토지주택공사":"한국토지주택공사 경기남부지역본부"
};
export function routePrediction({at,agName},ts,as){
  const lookupKey=AGENCY_LOOKUP_REDIRECT[agName]||agName;
  const agSt=as?.[lookupKey];
  const tSt=ts?.[at];
  const agN=agSt?.n||0;
  if(AGENCY_LOOKUP_REDIRECT[agName]&&agSt)return{route:"agency_redirect",agN,tierExists:!!tSt};
  if(agSt&&agN>=5)return{route:"agency_rich",agN,tierExists:!!tSt};
  if(agSt&&agN>=2)return{route:"blend",agN,tierExists:!!tSt};
  return{route:"tier_fallback",agN:0,tierExists:!!tSt};
}

export function predictV5({at,agName,ba,ep,av},ts,as,details,agencyPred,floorBench){
  if(!ba)return null;
  const tKeys=Object.keys(ts||{});
  if(!tKeys.length)return null;
  // Phase 14-5: LH 본사처럼 옛 데이터만 있는 발주사는 대체 발주사로 리다이렉트
  // calcStats에서 옛 데이터를 필터링했기 때문에 원래 키로는 as[agName]이 없음
  // 따라서 대체 키로 조회하여 예측에 사용
  const lookupKey=AGENCY_LOOKUP_REDIRECT[agName]||agName;
  const agSt=as[lookupKey];const tSt=ts[at]||ts[tKeys[0]];
  if(!tSt)return null;
  let ref=tSt;
  let src=at;
  // 리다이렉트 발생 시 출처 표시
  if(AGENCY_LOOKUP_REDIRECT[agName]&&agSt){
    src=`${agName}→${lookupKey}(${agSt.n}건, 옛데이터 격리)`;
  }
  if(agSt&&agSt.n>=5){ref=agSt;src=`${agName}(${agSt.n}건)`}
  else if(agSt&&agSt.n>=2){
    const w=agSt.n>=3?0.7:0.5;
    ref={avg:agSt.avg*w+tSt.avg*(1-w),q1:agSt.q1*w+tSt.q1*(1-w),med:agSt.med*w+tSt.med*(1-w),
      q3:agSt.q3*w+tSt.q3*(1-w),std:Math.max(agSt.std,tSt.std),
      bidAvg:agSt.bidAvg*w+tSt.bidAvg*(1-w),bidMed:agSt.bidMed*w+tSt.bidMed*(1-w),
      bidQ1:agSt.bidQ1*w+tSt.bidQ1*(1-w),bidQ3:agSt.bidQ3*w+tSt.bidQ3*(1-w),bidStd:Math.max(agSt.bidStd,tSt.bidStd)};
    src=`${agName}(${agSt.n}건)+${at}`}

  // ★ Phase 2 보정: drift 제거 (51K 백테스트에서 MAE 악화 확인), bid_details만 유지
  let biasAdj=0;

  // bid_details 복수예가 패턴 보정 (유효성 검증됨)
  let detailInsight=null;
  const dets=(details||[]).filter(d=>d.pre_rates&&Array.isArray(d.pre_rates)&&d.pre_rates.length>=14);
  const agDets=dets.filter(d=>d.ag===agName);
  const atDets=agDets.length>=1?agDets:dets.filter(d=>d.at===at);
  if(atDets.length>=1){
    const preAvgs=atDets.map(d=>d.pre_avg||0);
    const avgPreBias=preAvgs.reduce((a,b)=>a+b,0)/preAvgs.length;
    const drawBiases=atDets.filter(d=>d.adj_rate!=null&&d.pre_avg!=null).map(d=>d.adj_rate-d.pre_avg);
    const avgDrawBias=drawBiases.length?drawBiases.reduce((a,b)=>a+b,0)/drawBiases.length:0;
    const latestSim=simDraws(atDets[0].pre_rates);
    const detailBias=avgPreBias*0.3+avgDrawBias*0.2;
    biasAdj+=detailBias;
    detailInsight={
      count:atDets.length,source:agDets.length>=1?agName:at,
      avgBias:rnd4(avgPreBias),negRatio:Math.round(atDets.flatMap(d=>d.pre_rates).filter(v=>v<0).length/atDets.flatMap(d=>d.pre_rates).length*1000)/10,
      avgDrawBias:rnd4(avgDrawBias),biasAdj:rnd4(detailBias),latestSim,corrected:true};
    src+=` + 상세${atDets.length}건 보정`}

  // 보정 적용 (clamp ±0.5%)
  biasAdj=Math.max(-0.5,Math.min(0.5,biasAdj));
  ref={...ref,med:ref.med+biasAdj,q1:ref.q1+biasAdj,q3:ref.q3+biasAdj,avg:ref.avg+biasAdj};

  const fr=eraFR(at,ep||ba,new Date().toISOString().slice(0,10));
  const calcBid=(adjRate)=>{const xp=ba*(1+adjRate/100);return av>0?Math.ceil(av+(xp-av)*(fr/100)):Math.ceil(xp*(fr/100))};
  const calcXp=(adjRate)=>Math.round(ba*(1+adjRate/100));
  const scenarios=[
    {name:"보수적 (Q1)",adj:rnd4(ref.q1),xp:calcXp(ref.q1),bid:calcBid(ref.q1)},
    {name:"중앙값",adj:rnd4(ref.med),xp:calcXp(ref.med),bid:calcBid(ref.med)},
    {name:"공격적 (Q3)",adj:rnd4(ref.q3),xp:calcXp(ref.q3),bid:calcBid(ref.q3)}];
  const bidRateRec={avg:rnd4(ref.bidAvg),med:rnd4(ref.bidMed),
    q1:rnd4(ref.bidQ1),q3:rnd4(ref.bidQ3),std:rnd4(ref.bidStd)};
  const bidByRate=Math.ceil(ba*ref.bidMed/100);
  // ★ 신뢰구간 (백테스트 교정: 이론적 노이즈 바닥 0.642% 반영)
  const std=ref.std||0.7;
  const noiseFloor=0.642; // 같은 기관 연속건 사정률 차이 중앙값 (51K건 측정)
  const effStd=Math.max(std,noiseFloor); // 최소한 노이즈 바닥 이상
  const ci70={low:rnd4(ref.med-effStd*0.52),high:rnd4(ref.med+effStd*0.52)};
  const ci90={low:rnd4(ref.med-effStd*1.28),high:rnd4(ref.med+effStd*1.28)};

  // ★ Phase 12-F (2026-04-12 발주사별 예측 강화)
  // 구성: legacy typeOff + 발주사별 agencyOff (shrinkage n/10)
  //
  // 근거 (1,091건 백테스트 + 등록/미등록 발주사 분리 분석):
  //   - 등록 발주사(826건): Phase 12-F MAE 0.508% / WIN±0.1% 15.6%
  //     → Phase 12-D(현재, 재교정) MAE 0.559% 대비 -9.1%
  //   - 미등록 발주사(265건): Phase 12-F MAE 1.052% (예측 가치 낮음)
  //   - 전체 1,091건: MAE 0.640% / WIN±0.5% 55.5% / WIN±0.3% 37.3%
  //     → Phase 12-D 대비 MAE -7.6%, WIN +3.3%p
  //
  // 직전 Phase 12-D(재교정) 롤백 사유:
  //   - 296건 bid_details 샘플 편향으로 "내가 1위보다 +0.5~0.7% 높다" 해석 → typeOff 과잉 하향
  //   - 실제 1,091건 기준 평균 편향은 미미하며, 재교정이 오히려 bias를 음수 방향으로 키움
  //   - 해결: typeOff를 legacy로 롤백, 대신 agencyOff를 모든 at에 일관 적용
  //
  // Phase 12-E(at별 하이브리드) 폐기 사유:
  //   - bid_details의 발주사 분포가 agency_predictor 미등록 발주사에 편중
  //     (부천교육지원청 11건 등) → "교육청 agencyOff 끄자"가 잘못된 추론이었음
  //   - 등록 발주사만 보면 교육청이 agencyOff 효과 최상위 (+14.1% 개선)
  //   - 해결: 발주사 등록 여부가 분기 기준이어야 하며, 이는 agPred 존재 여부로 자연 분기됨
  //
  // 발주사별 예측의 본질:
  //   이 함수의 line 155~166(ref 선택)과 line 174(bid_details 보정)에서 이미
  //   발주사별(agSt) 데이터를 우선 사용 중. OPT_CONFIG는 그 위에 얹는 최종 보정층.
  //   agency_predictor 테이블이 114개 발주사의 개별 adj_offset을 제공하며,
  //   이 값이 n/10 shrinkage로 감쇠 적용되어 발주사 특성을 최종 추천에 반영.
  const TYPE_OFF={
    "지자체":   -0.15,
    "군시설":    0.0,
    "교육청":   -0.45,
    "한전":      0.10,
    "LH":       -0.10,
    "조달청":   -0.10,
    "수자원공사":-0.10
  };
  const typeOff=TYPE_OFF[at]??-0.10;

  // 발주사별 오프셋 (agency_predictor 기반, n/10 shrinkage)
  // 발주사가 등록되어 있으면 적용, 없으면 자연스럽게 0 (typeOff만 유효)
  const agPred=agencyPred&&agencyPred[agName];
  let agencyOff=0;
  if(agPred){
    const rawOffset=Number(agPred.adj_offset||0);
    const n=Number(agPred.n||0);
    agencyOff=rawOffset*Math.min(1, n/10);
  }
  const off=typeOff+agencyOff;
  const optAdj=rnd4(ref.med+off);const optXp=calcXp(ref.med+off);const optBid=calcBid(ref.med+off);
  const {route,agN:routeAgN}=routePrediction({at,agName},ts,as);

  // Phase 23-4: SUCVIEW 기반 at×floor_rate 1위 마진 벤치마크 (bid 보조 지표)
  // 182건 백테스트: MAE 432만원 → 21만원 (95% 개선, 기존 bid/opt_bid 미변경)
  let benchmarkBid=null,benchmarkRate=null,benchmarkMargin=null,benchmarkN=0,benchmarkSrc=null;
  if(floorBench&&fr){
    const frKey=Number(fr).toFixed(3);
    const hit=floorBench[at+"|"+frKey];
    if(hit&&hit.n>=5&&isFinite(hit.med)){
      benchmarkMargin=hit.med;benchmarkN=hit.n;
      benchmarkRate=rnd4(Number(fr)+hit.med);
      benchmarkBid=Math.ceil(ba*benchmarkRate/100);
      benchmarkSrc=`${at}@${frKey}%(${hit.n}건, 마진${hit.med.toFixed(4)}%)`;
    }
  }

  return{scenarios,fr,src,bidRateRec,bidByRate,
    adjAvg:rnd4(ref.avg),adjStd:rnd4(ref.std),
    adj:rnd4(ref.med),xp:calcXp(ref.med),bid:calcBid(ref.med),baseAdj:rnd4(ref.avg),
    detailInsight,biasAdj:rnd4(biasAdj),driftUsed:0,ci70,ci90,optAdj,optXp,optBid,optOffset:off,
    typeOffset:typeOff,agencyOffset:agencyOff,agencyN:agPred?Number(agPred.n||0):0,
    benchmarkBid,benchmarkRate,benchmarkMargin,benchmarkN,benchmarkSrc,
    route,routeAgN}}

// ─── 데이터 현황 (최근 업로드 + 실제 최신 개찰일 분리) ────
export function calcDataStatus(rows){
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

// ─── SUCVIEW XLS 파싱 ──────────────────────────────────────
export function isSucviewFile(rows){return rows.length>7&&String(rows[0]?.[0]||"").trim()==="공고명"&&String(rows[2]?.[0]||"").trim()==="공고번호"}

export function parseSucview(rows,fileName){
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
  // 복수예비가격 15개 사정율 (군시설 SUCVIEW는 열 위치가 다를 수 있으므로 동적 스캔)
  const pre_rates=[];
  for(let i=8;i<=12;i++){
    if(!rows[i])continue;
    // 먼저 고정 위치(3,7,11) 시도
    const fixed=[];
    [3,7,11].forEach(j=>{const v=parseFloat(String(rows[i]?.[j]||""));if(!isNaN(v)&&v>=-5&&v<=5)fixed.push(Math.round(v*10000)/10000)});
    if(fixed.length===3){pre_rates.push(...fixed);continue}
    // 고정 위치에서 3개 미만이면 행 전체 스캔 (군시설 등 레이아웃 차이 대응)
    const scanned=[];
    for(let j=0;j<(rows[i]?.length||0);j++){const s=String(rows[i][j]||"").trim();if(!s)continue;const v=parseFloat(s);if(!isNaN(v)&&v>=-5&&v<=5&&s.includes("."))scanned.push(Math.round(v*10000)/10000)}
    if(scanned.length>=1&&scanned.length<=3)pre_rates.push(...scanned);
    else if(fixed.length>0)pre_rates.push(...fixed)}
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

// ─── 추첨 시뮬레이션 (C(n,4): 15개=1365, 14개=1001) ─────
export function simDraws(preRates){
  if(!preRates||preRates.length<14)return null;
  const n=preRates.length;const avgs=[];
  for(let a=0;a<n-3;a++)for(let b=a+1;b<n-2;b++)for(let c=b+1;c<n-1;c++)for(let d=c+1;d<n;d++){
    avgs.push(Math.round((preRates[a]+preRates[b]+preRates[c]+preRates[d])/4*10000)/10000)}
  avgs.sort((a,b)=>a-b);const len=avgs.length;
  const negCount=avgs.filter(v=>v<0).length;
  const hist={};avgs.forEach(v=>{const b=(Math.floor(v*2)/2).toFixed(1);hist[b]=(hist[b]||0)+1});
  return{total:len,avgs,min:avgs[0],max:avgs[len-1],
    p10:avgs[Math.floor(len*0.1)],p25:avgs[Math.floor(len*0.25)],p50:avgs[Math.floor(len*0.5)],p75:avgs[Math.floor(len*0.75)],p90:avgs[Math.floor(len*0.9)],
    negPct:Math.round(negCount/len*1000)/10,hist,
    belowMinus05:Math.round(avgs.filter(v=>v<-0.5).length/len*1000)/10,
    belowMinus10:Math.round(avgs.filter(v=>v<-1.0).length/len*1000)/10}}

// ─── 가정 사정률 추천 (1위 투찰 패턴 기반) ──────────────────
// V5.1: ag_assumed_stats 4,456건 가중평균 기반 교정 (2026-04-06)
// 이전 버전(3,318건 백테스트) 대비 P25 하향 → 실전 낙찰 가능성 2배 향상
const ASSUMED_ADJ_TABLE={
  "지자체":  {under300M:{p25:-0.22,p50:0.37,p75:1.07},over300M:{p25:0.00,p50:0.53,p75:1.05}},
  "교육청":  {under300M:{p25:0.03,p50:0.57,p75:1.19},over300M:{p25:0.21,p50:0.68,p75:1.19}},
  "군시설":  {under300M:{p25:0.04,p50:0.48,p75:0.92},over300M:{p25:0.59,p50:1.00,p75:1.38}},
  "한전":    {under300M:{p25:0.26,p50:0.67,p75:1.07},over300M:{p25:0.35,p50:0.83,p75:1.12}},
  "조달청":  {under300M:{p25:-1.42,p50:-0.21,p75:0.66},over300M:{p25:0.58,p50:1.29,p75:2.47}},
  "LH":     {under300M:{p25:0.08,p50:0.40,p75:1.01},over300M:{p25:1.09,p50:1.56,p75:2.67}},
  "수자원공사":{under300M:{p25:-0.27,p50:0.04,p75:0.38},over300M:{p25:0.47,p50:1.01,p75:1.09}}
};
// 기관유형별 균형전략 탈락률 참고값
const FAIL_RATES={"지자체":25.0,"교육청":24.5,"군시설":25.0,"한전":25.0,"조달청":25.0,"LH":25.0,"수자원공사":25.0};

export function recommendAssumedAdj({at,agName,ba,ep,av,pc},ts,as,agAss){
  const tbl=ASSUMED_ADJ_TABLE[at]||ASSUMED_ADJ_TABLE["지자체"];
  const tier=(ba||0)<300000000?"under300M":"over300M";
  let base={p25:tbl[tier].p25,p50:tbl[tier].p50,p75:tbl[tier].p75};

  // 2단계: 발주기관 개별 보정 (가정사정률 직접 사용 우선)
  let src=`${at} ${tier==="under300M"?"3억미만":"3억이상"}`;
  const agKey=agName+"|"+tier;
  const agDirect=agAss?.[agKey];
  if(agDirect&&agDirect.n>=5){
    // DB에서 발주기관별 1위 가정사정률 P25/P50/P75 직접 사용
    const w=agDirect.n>=10?0.8:0.5;
    base={p25:base.p25*(1-w)+agDirect.p25*w, p50:base.p50*(1-w)+agDirect.p50*w, p75:base.p75*(1-w)+agDirect.p75*w};
    src+=` + ${agName}(${agDirect.n}건,직접)`;
  }else if(agDirect&&agDirect.n>=3){
    const w=0.3;
    base={p25:base.p25*(1-w)+agDirect.p25*w, p50:base.p50*(1-w)+agDirect.p50*w, p75:base.p75*(1-w)+agDirect.p75*w};
    src+=` + ${agName}(${agDirect.n}건,직접)`;
  }else{
    // DB에 가정사정률 통계 없으면 기존 방식(사정률 간접 보정) 폴백
    const agSt=as?.[agName];
    if(agSt&&agSt.n>=5){
      const agOffset=agSt.med-((ts?.[at]||{}).med||0);
      const w=agSt.n>=10?0.5:0.3;
      base={p25:base.p25+agOffset*w,p50:base.p50+agOffset*w,p75:base.p75+agOffset*w};
      src+=` + ${agName}(${agSt.n}건,간접)`;
    }
  }

  // 3단계: 참여업체수 보정
  if(pc&&pc>0){
    if(pc<100){base.p25-=0.05;base.p75+=0.05;src+=` · ${pc}개사(소규모)`}
    else if(pc>3000){base.p25+=0.05;base.p75-=0.05;src+=` · ${pc}개사(대규모)`}
  }

  const r4=v=>Math.round(v*10000)/10000;
  const fr=eraFR(at,ep||ba,new Date().toISOString().slice(0,10));
  const calcBid=(adjRate)=>{
    const xp=ba*(1+adjRate/100);
    if(at==="LH")return Math.ceil((av>0?av+(xp-av)*(fr/100):xp*(fr/100))/1000)*1000;
    return av>0?Math.ceil(av+(xp-av)*(fr/100)):Math.ceil(xp*(fr/100))};

  // 추천 전략 결정
  let strategy="balanced";
  if(pc&&pc>3000)strategy="balanced";
  else if(pc&&pc<100)strategy="conservative";

  return{
    aggressive:{adj:r4(base.p25),bid:calcBid(base.p25)},
    balanced:{adj:r4(base.p50),bid:calcBid(base.p50)},
    conservative:{adj:r4(base.p75),bid:calcBid(base.p75)},
    fr,source:src,strategy,
    risk:{failRate:FAIL_RATES[at]||25,note:`${at} 균형 전략 기준 탈락률`}
  }}


// ============ Phase 5.3: ROI 통합 점수 시스템 (DB 매트릭스 + 동적) ============
// 매트릭스는 DB에서 로드 가능하지만 fallback으로 하드코딩 유지
// 1,128건 검증 데이터 기반 (2026-04-10)
export let WIN_PROB_MATRIX={
  "LH":       {S:{p:0.1818,n:11}, M:{p:0.0000,n:3},  L:{p:0.3182,n:22}},
  "한전":     {S:{p:0.0476,n:42}, M:{p:0.2121,n:33}, L:{p:0.5000,n:2}},
  "군시설":   {S:{p:0.0135,n:148},M:{p:0.1875,n:16}, L:{p:0.0000,n:1}},
  "지자체":   {S:{p:0.0445,n:449},M:{p:0.0606,n:99}, L:{p:0.0952,n:21}},
  "교육청":   {S:{p:0.0217,n:138},M:{p:0.0800,n:25}, L:{p:0.0000,n:12}},
  "조달청":   {S:{p:0.0000,n:10}, M:{p:0.0833,n:12}, L:{p:0.0500,n:20}},
  "수자원공사":{S:{p:0.0000,n:18}, M:{p:0.0000,n:0},  L:{p:0.0000,n:2}}
};

// DB에서 받은 매트릭스로 교체
export function setWinProbMatrix(newMatrix){
  if(newMatrix&&typeof newMatrix==='object'&&Object.keys(newMatrix).length>0){
    WIN_PROB_MATRIX=newMatrix;
    return true
  }
  return false
}

// Shrinkage 상수: K=5 (Phase 5.2 검증)
export const SHRINKAGE_K=5;
export const GLOBAL_MEAN=0.0544;

// 무효 공고 키워드 (공고명에 포함 시 D등급 강제)
export const INVALID_KEYWORDS=["취소","중지","재공고","정정","연기"];

// 금액대 분류
export const tierOf=(amt)=>{const a=Number(amt)||0;return a<3e8?"S":a<1e9?"M":"L"};

// Phase 5.1: Shrinkage 적용 베이스 확률
// - 표본 많을수록 셀 원본값
// - 표본 적을수록 전역 평균(5.44%)으로 수렴
export const calcRoiBase=(at,amt)=>{
  const tier=tierOf(amt);
  const cell=WIN_PROB_MATRIX[at]&&WIN_PROB_MATRIX[at][tier];
  if(!cell)return GLOBAL_MEAN;
  const{p,n}=cell;
  return(p*n+GLOBAL_MEAN*SHRINKAGE_K)/(n+SHRINKAGE_K)
};

// Phase 5.1: 통합 점수 (골드존/경쟁 보정 제거, 취소 차단 추가)
export const calcRoiV2=(p)=>{
  const pn=p.pn||"";
  // 0. 무효 공고 조기 차단 (대괄호 표기만)
  const isInvalid=INVALID_KEYWORDS.some(k=>pn.includes("["+k+"]"));
  if(isInvalid){
    return{
      winProb:0,expectedMargin:0,expectedValue:0,
      grade:"D",strategy:"무효 공고 (취소/중지/재공고)",
      riskScore:1,factors:{invalid:true,reason:"취소/중지 키워드"}
    }
  }

  const at=p.at||"지자체";
  const amt=Number(p.ep||p.ba||0);
  const tier=tierOf(amt);
  const od=p.open_date||p.od;

  // 1. 베이스 확률 (shrinkage 포함)
  let winProb=calcRoiBase(at,amt);

  // 2. 요일 보정 (유일하게 통계 검증된 신호)
  //    검증: 화/수/목 6.6% vs 월/금 3.5%
  if(od){const dow=new Date(od).getDay();if(dow>=2&&dow<=4)winProb*=1.1}

  // ❌ 경쟁강도 보정 제거 — 검증 결과 역효과 (<1500명 5.0% vs ≥1500명 5.8%)
  // ❌ 골드존 보너스 제거 — 매트릭스 베이스에 이미 반영됨 (이중계산 방지)

  // 3. 회피존 차단 (유지)
  const isAvoid=at==="수자원공사"||(at==="교육청"&&tier==="L")||(at==="조달청"&&tier==="S");
  if(isAvoid)winProb=0.001;

  // max 60%로 상한 (표본 극단값 방어)
  winProb=Math.min(0.60,Math.max(0,winProb));

  // 기대 마진 (기관×금액 평균)
  const marginMap={
    "LH":{S:200000,M:0,L:0},
    "한전":{S:100000,M:500000,L:8666668},
    "군시설":{S:50000,M:300000,L:0},
    "지자체":{S:300000,M:500000,L:1000000},
    "교육청":{S:100000,M:200000,L:0},
    "조달청":{S:0,M:300000,L:500000},
    "수자원공사":{S:0,M:0,L:0}
  };
  const expectedMargin=(marginMap[at]&&marginMap[at][tier])||100000;
  const expectedValue=Math.round(winProb*expectedMargin);

  // 4. 등급 산정 (Phase 5.3: A 임계값 0.12→0.11 미세 조정)
  let grade="D",strategy="제외 권장",riskScore=1-winProb;
  if(winProb>=0.20){grade="S";strategy="반드시 투찰"}
  else if(winProb>=0.11){grade="A";strategy="우선 투찰"}
  else if(winProb>=0.07){grade="B";strategy="선택 투찰"}
  else if(winProb>=0.03){grade="C";strategy="여력시 투찰"}

  return{
    winProb:Math.round(winProb*10000)/10000,
    expectedMargin,
    expectedValue,
    grade,
    strategy,
    riskScore:Math.round(riskScore*10000)/10000,
    factors:{tier,isAvoid,baseProb:calcRoiBase(at,amt),version:"5.1"}
  }
};

// 등급 색상
export const GRADE_COLORS={S:"#a855f7",A:"#5dca96",B:"#d4a834",C:"#a8b4ff",D:"#666680"};

// ============ Phase 5.4: AI 전략 — 편차 보정 + 추세 적용 ============

// 편차 보정 맵 (DB에서 로드)
export let BIAS_MAP={agency:{},at:{}};
export function setBiasMap(newMap){if(newMap)BIAS_MAP=newMap;return true}

// 추세 맵 (DB에서 로드)
export let TREND_MAP={};
export function setTrendMap(newMap){if(newMap)TREND_MAP=newMap;return true}

// 전략 1: 편차 보정 적용
// 발주기관 단위 편차가 있으면 우선, 없으면 기관유형 편차 사용
export function applyBiasCorrection(prediction){
  if(!prediction)return prediction;
  const ag=prediction.ag||"";
  const at=prediction.at||"";
  // 발주기관 편차 우선 (신뢰도 가중)
  const agBias=BIAS_MAP.agency[ag];
  const atBias=BIAS_MAP.at[at];
  let bias=0,source="none",conf=0;
  if(agBias&&agBias.n>=5){
    bias=agBias.offset*agBias.confidence;
    source=`agency(n=${agBias.n})`;conf=agBias.confidence
  }else if(atBias&&atBias.n>=3){
    bias=atBias.offset*atBias.confidence*0.7; // 기관유형은 70%만 적용
    source=`at(n=${atBias.n})`;conf=atBias.confidence*0.7
  }
  return{
    ...prediction,
    adj_corrected:Number(prediction.opt_adj||prediction.pred_adj_rate||0)+bias,
    bias_offset:Math.round(bias*10000)/10000,
    bias_source:source,
    bias_confidence:conf
  }
}

// 전략 2: 추세 보정 적용 (기관유형 단위)
export function applyTrendCorrection(prediction){
  if(!prediction)return prediction;
  const at=prediction.at||"";
  const trend=TREND_MAP[at];
  if(!trend)return{...prediction,trend_offset:0,trend_direction:"none"};
  const t30=Number(trend.trend_30d||0);
  const tall=Number(trend.trend_all||0);
  const drift=t30-tall; // 최근이 전체 평균 대비 얼마나 변했는지
  // 추세 강도가 높을 때만 50% 반영 (보수적)
  const trendOffset=drift*Number(trend.trend_strength||0)*0.5;
  return{
    ...prediction,
    trend_offset:Math.round(trendOffset*10000)/10000,
    trend_direction:trend.direction,
    trend_strength:trend.trend_strength
  }
}

// 통합: 편차 + 추세 모두 적용한 최종 추천 사정률
export function getEnhancedAdj(prediction){
  if(!prediction)return null;
  const baseAdj=Number(prediction.opt_adj||prediction.pred_adj_rate||0);
  const withBias=applyBiasCorrection(prediction);
  const withTrend=applyTrendCorrection(prediction);
  const enhancedAdj=baseAdj+(withBias.bias_offset||0)+(withTrend.trend_offset||0);
  return{
    base:Math.round(baseAdj*10000)/10000,
    enhanced:Math.round(enhancedAdj*10000)/10000,
    biasOffset:withBias.bias_offset||0,
    trendOffset:withTrend.trend_offset||0,
    biasSource:withBias.bias_source,
    trendDirection:withTrend.trend_direction,
    explanation:[
      withBias.bias_source!=="none"?`편차 보정 ${(withBias.bias_offset>=0?"+":"")}${(withBias.bias_offset).toFixed(3)}%p (${withBias.bias_source})`:null,
      withTrend.trend_offset!==0?`추세 보정 ${(withTrend.trend_offset>=0?"+":"")}${withTrend.trend_offset.toFixed(3)}%p (${withTrend.trend_direction})`:null
    ].filter(Boolean)
  }
}

// ============ Phase 5.4 전략 3: Claude API 통합 ============

// Claude API 호출용 컨텍스트 구성
export function buildAiContext(prediction,scoringMap,biasMap,trendMap,records){
  const at=prediction.at||"기타";
  const ag=prediction.ag||"";
  const amt=Number(prediction.ep||prediction.ba||0);
  const sc=scoringMap[prediction.id]||{};
  
  // 같은 기관 최근 5건
  const agencyHistory=(records||[])
    .filter(r=>r.ag===ag&&r.actual_adj_rate!=null)
    .sort((a,b)=>(b.open_date||"").localeCompare(a.open_date||""))
    .slice(0,5)
    .map(r=>({
      pn:r.pn,
      낙찰자사정률:Number(r.actual_adj_rate),
      개찰일:r.open_date,
      금액:Number(r.ep||r.ba||0)
    }));

  return{
    공고:{
      pn:prediction.pn,ag:ag,at:at,
      금액:amt,개찰일:prediction.open_date,
      pn_no:prediction.pn_no
    },
    현재예측:{
      추천사정률:Number(prediction.opt_adj||prediction.pred_adj_rate||0),
      추천투찰금액:Number(prediction.opt_bid||prediction.pred_bid_amount||0),
      낙찰확률:sc.win_prob?(Number(sc.win_prob)*100).toFixed(1)+"%":"미산정",
      등급:sc.roi_grade||"D",
      하한율:Number(prediction.pred_floor_rate||0)
    },
    기관히스토리:agencyHistory,
    편차정보:{
      발주기관편차:biasMap.agency[ag]?(biasMap.agency[ag].offset).toFixed(3)+"%p":"없음",
      기관유형편차:biasMap.at[at]?(biasMap.at[at].offset).toFixed(3)+"%p":"없음"
    },
    추세:trendMap[at]||{}
  }
}

// Claude API 호출 — Phase 5.4-B: Supabase Edge Function 프록시 경유 (브라우저 키 불필요)
// apiKey 파라미터는 호환성을 위해 남겨두지만 사용하지 않음
export async function callClaudeAi(context,apiKey){
  const prompt=`당신은 한국 공공조달 입찰 전문가입니다. 다음 공고를 분석하여 최적 사정률을 JSON으로 응답해주세요.

[공고 정보]
${JSON.stringify(context.공고,null,2)}

[현재 시스템 예측]
${JSON.stringify(context.현재예측,null,2)}

[발주기관 최근 사례 ${context.기관히스토리.length}건]
${JSON.stringify(context.기관히스토리,null,2)}

[편차 정보 — 시스템 예측 vs 낙찰자 평균]
${JSON.stringify(context.편차정보,null,2)}

[시장 추세 (기관유형)]
${JSON.stringify(context.추세,null,2)}

다음을 분석하여 JSON으로 응답해주세요 (반드시 JSON만, 마크다운 ${'```'} 없이):
{
  "분석": "이 공고와 발주기관에 대한 2~3문장 분석",
  "strategy_safe": -0.20,
  "strategy_balanced": 0.05,
  "strategy_aggressive": 0.30,
  "prob_safe": 0.18,
  "prob_balanced": 0.30,
  "prob_aggressive": 0.42,
  "recommended": "balanced",
  "reasons": ["근거 1", "근거 2"],
  "warnings": ["주의 1"]
}

전략 가이드:
- safe: 낙찰자 분포 P25 (안전, 낮은 낙찰률·낮은 마진)
- balanced: 낙찰자 분포 P50 (균형)
- aggressive: 낙찰자 분포 P75 (공격, 높은 낙찰률·높은 마진)
- recommended: 발주기관 패턴 + 추세를 고려한 최적 선택`;

  // Edge Function 프록시로 호출 (API 키는 서버에만 있음)
  const PROXY_URL=(typeof window!=="undefined"&&window.__CLAUDE_PROXY_URL__)
    ||"https://sadunejfkstxbxogzutl.supabase.co/functions/v1/claude-proxy";
  
  const res=await fetch(PROXY_URL,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      prompt:prompt,
      model:"claude-sonnet-4-5",
      max_tokens:1500
    })
  });
  
  if(!res.ok){
    const err=await res.text();
    throw new Error("Claude 프록시 오류: "+res.status+" "+err.slice(0,300))
  }
  const data=await res.json();
  if(data.error)throw new Error(data.error+(data.detail?" - "+data.detail:""));
  const text=data.text||"";
  
  // JSON 파싱 (마크다운 코드 펜스 제거)
  const cleaned=text.replace(/```json|```/g,"").trim();
  try{
    const parsed=JSON.parse(cleaned);
    return{
      ai_analysis:parsed.분석||"",
      strategy_safe:parsed.strategy_safe,
      strategy_balanced:parsed.strategy_balanced,
      strategy_aggressive:parsed.strategy_aggressive,
      prob_safe:parsed.prob_safe,
      prob_balanced:parsed.prob_balanced,
      prob_aggressive:parsed.prob_aggressive,
      recommended:parsed.recommended||"balanced",
      reasons:parsed.reasons||[],
      warnings:parsed.warnings||[]
    }
  }catch(e){
    throw new Error("Claude 응답 파싱 실패: "+text.slice(0,200))
  }
}
