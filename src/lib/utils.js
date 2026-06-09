import * as XLSX from "xlsx";
import { CHO } from "./constants.js";
import { WIN_OPT_GAP, RATE_TABLE, TYPE_OFF, ASSUMED_ADJ_TABLE, FAIL_RATES, WIN_PROB_MATRIX, SHRINKAGE_K, GLOBAL_MEAN, INVALID_KEYWORDS, tierOf, AT_AVG_PARTICIPANTS, PARTICIPANT_THRESHOLD_HIGH } from "./constants-tables.js";
import { ceilToWon, ceilToThousand } from "./fmtAdj.js";
import { calcEffectiveFloorRate } from "./effectiveFloor.js";
// 도메인 상수 테이블은 constants-tables.js에 분리. 아래는 App.jsx 호환을 위한 re-export.
export { WIN_OPT_GAP, RATE_TABLE, TYPE_OFF, ASSUMED_ADJ_TABLE, FAIL_RATES, WIN_PROB_MATRIX, SHRINKAGE_K, GLOBAL_MEAN, INVALID_KEYWORDS, tierOf, AT_AVG_PARTICIPANTS, PARTICIPANT_THRESHOLD_HIGH };

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
// WIN_OPT_GAP 상수는 constants-tables.js에 분리됨.
export function calcWin1stBid(bid, fr, at){
  if(!bid||!fr)return null;
  const gap=WIN_OPT_GAP[at]??0.3;
  return Math.round(Number(bid)*Number(fr)/(Number(fr)+gap));
}

// 낙찰하한율 테이블은 constants-tables.js에 분리됨.
// 미지 발주유형(at) fallback — 명시 처리 (Codex consult 2026-05-24 결함2: silent wrong-rate risk).
// 타깃은 조달청 유지: 조달청 new==지자체 new, old도 <1e10 구간 동일 → 현행 숫자 무변화.
// 단 silent 금지 — 미지 at은 1회 경고해 clsAg 분류 오류를 표면화 (at별 dedup).
const FLOOR_RATE_FALLBACK_AT="조달청";
const _warnedUnknownAt=new Set();
function resolveRateTable(at){
  if(RATE_TABLE[at])return RATE_TABLE[at];
  if(at!=null&&!_warnedUnknownAt.has(at)){
    _warnedUnknownAt.add(at);
    try{console.warn(`[getFloorRate] 미지 발주유형 at='${at}' → ${FLOOR_RATE_FALLBACK_AT} 낙찰하한율 테이블 fallback (분류 확인 필요)`);}catch(e){/* noop */}
  }
  return RATE_TABLE[FLOOR_RATE_FALLBACK_AT];
}
export function getFloorRate(at,ep,isNew){const tbl=resolveRateTable(at);const rules=isNew?tbl.new:tbl.old;for(const r of rules){if(ep>=r.min&&ep<r.max)return r.rate}return rules[rules.length-1].rate}
export function getCutoffDate(at){return resolveRateTable(at).cutoff}
export function isNewEra(at,od){if(!od)return false;return od>=getCutoffDate(at)}
// LH 종심제/순심제 대형 공사 감지 — 예측 모델이 -2.941로 수렴하는 구조적 미지원 구간
export function isLhJongsim(at,ba,pn){
  if(at!=="LH")return false;
  if((Number(ba)||0)<1e10)return false;
  return /\[공의\]|종합심사|종심제|순심제/.test(String(pn||""));
}
// Phase 12: 표준 RATE_TABLE만 사용 (여성기업 가산 등 특수 규정 제외)
export function eraFR(at,ep,od){return getFloorRate(at,ep||0,isNewEra(at,od))}
// 재export가 아니라 import+export — utils.js 내부(parseBidDoc:126, toRecord:414)에서도
// clsAg를 호출하므로 로컬 바인딩 필요 (86c6670 회귀: "clsAg is not defined" 수정).
import { clsAg, isMilitaryAgency } from "./agencyClass.js";
import { parseBidResultRows, parseParticipants } from "./sucviewParse.js";
export { clsAg, isMilitaryAgency };
// ─── 유틸 ──────────────────────────────────────────────────
// Phase 23-8: agency_predictor 학습 키 정규화 — DB normalize_agency_name 함수와 동일 로직.
// 경기도교육청 학교명 변형 / 조달청 지방조달청 prefix 등을 canonical_ag 기준으로 통합.
export function normalizeAgencyName(rawAg){
  if(rawAg==null)return null;
  let r=String(rawAg);
  if(/경기도교육청 .*교육지원청/.test(r)) r=r.replace(/^경기도교육청 /,'');
  if(/교육지원청 /.test(r)) r=r.replace(/ .+$/,'');
  if(/^경기도[가-힣]+교육청$/.test(r) && r!=='경기도교육청') r=r.replace(/교육청$/,'교육지원청');
  if(/^경기도[가-힣]+교육청 /.test(r)) r=r.replace(/^(경기도[가-힣]+)교육청 .+$/,'$1교육지원청');
  if(/^경기도교육청 /.test(r) && !/교육지원청/.test(r)) r='경기도교육청';
  if(/^조달청 .+지방조달청/.test(r)) r=r.replace(/^조달청 /,'');
  return r.trim();
}
export function clean(v){if(v==null)return"";return String(v).replace(/[\u0000\u2800-\u2BFF\uE000-\uF8FF]/g,"").replace(/\s+/g," ").trim()}
export function pnv(v){if(v==null||v==="")return 0;if(typeof v==="number")return v;return parseFloat(String(v).replace(/,/g,"").trim())||0}
export function sn(v){const n=pnv(v);return n===0?null:n}
export function tc(v){return Number(v||0).toLocaleString()}
export function tn(s){return Number(String(s).replace(/,/g,""))||0}
export function pDt(v){if(!v)return null;const s=String(v).trim();let m;if((m=s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/)))return`${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;if((m=s.match(/^(\d{2})[-./](\d{1,2})[-./](\d{1,2})/)))return`20${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;return null}
// V6-B1: DB amount_tier_of() 의 JS 사본 — bid_predictions_v3.amount_tier INSERT용
export function amountTierOf(amt){const n=Number(amt);if(!isFinite(n))return null;if(n<1e8)return"~1억";if(n<3e8)return"1억~3억";if(n<5e8)return"3억~5억";if(n<1e9)return"5억~10억";if(n<3e9)return"10억~30억";return"30억~"}
// CHO imported from constants.js
export function getCho(c){const code=c.charCodeAt(0);if(code>=0xAC00&&code<=0xD7A3)return CHO[Math.floor((code-0xAC00)/588)];return c}
export function mSch(t,q){if(!q)return true;const tl=t.toLowerCase(),ql=q.toLowerCase();if(tl.includes(ql))return true;return Array.from(t).map(getCho).join("").includes(q)}

// ─── MD5 ───────────────────────────────────────────────────
export function md5(s){function rl(n,c){return(n<<c)|(n>>>(32-c))}function tI(s){let h="";for(let i=0;i<=3;i++)h+="0123456789abcdef".charAt((s>>>(i*8+4))&0xF)+"0123456789abcdef".charAt((s>>>(i*8))&0xF);return h}function aI(x,y){let l=(x&0xFFFF)+(y&0xFFFF);return((x>>16)+(y>>16)+(l>>16))<<16|l&0xFFFF}const K=[],S=[];for(let i=0;i<64;i++){K[i]=Math.floor(Math.abs(Math.sin(i+1))*4294967296);S[i]=[7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21][((i>>4)<<2)+(i%4)]}let a0=0x67452301,b0=0xEFCDAB89,c0=0x98BADCFE,d0=0x10325476;const bytes=[];for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c<128)bytes.push(c);else if(c<2048){bytes.push(192|(c>>6));bytes.push(128|(c&63))}else{bytes.push(224|(c>>12));bytes.push(128|((c>>6)&63));bytes.push(128|(c&63))}}const bl=bytes.length*8;bytes.push(128);while(bytes.length%64!==56)bytes.push(0);for(let i=0;i<4;i++)bytes.push((bl>>>(i*8))&0xFF);for(let i=0;i<4;i++)bytes.push(0);for(let o=0;o<bytes.length;o+=64){const M=[];for(let j=0;j<16;j++)M[j]=bytes[o+j*4]|(bytes[o+j*4+1]<<8)|(bytes[o+j*4+2]<<16)|(bytes[o+j*4+3]<<24);let a=a0,b=b0,c=c0,d=d0;for(let i=0;i<64;i++){let f,g;if(i<16){f=(b&c)|((~b)&d);g=i}else if(i<32){f=(d&b)|((~d)&c);g=(5*i+1)%16}else if(i<48){f=b^c^d;g=(3*i+5)%16}else{f=c^(b|(~d));g=(7*i)%16}const tmp=d;d=c;c=b;b=aI(b,rl(aI(a,aI(f,aI(K[i],M[g]))),S[i]));a=tmp}a0=aI(a0,a);b0=aI(b0,b);c0=aI(c0,c);d0=aI(d0,d)}return tI(a0)+tI(b0)+tI(c0)+tI(d0)}
export function sanitizeJson(s){return s.replace(/\\u0000/g,"").replace(/[\uD800-\uDFFF]/g,"")}

// ─── 파싱 ──────────────────────────────────────────────────
export async function parseFile(file){const buf=await file.arrayBuffer();const wb=XLSX.read(new Uint8Array(buf),{type:"array",codepage:949,cellDates:false,raw:true});const ws=wb.Sheets[wb.SheetNames[0]];const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:"",raw:true});if(!rows.length)throw new Error("빈 파일");return{rows,format:file.name.toLowerCase().endsWith(".xlsx")?"XLSX":"XLS"}}

// 낙찰정보리스트 레코드 변환
// 사정률(ar1/ar0)·낙찰가율(br1/br0) 단위 자동 감지: |v|<50이면 0% 기준 → +100 보정해 100% 기준으로 통일
// (인포21c 표준 파일은 100% 기준이지만 일부 외부 형식이 0% 기준으로 출력되어 ar1 단위 혼재 발생)
const _normRate=(v)=>(v!=null&&Math.abs(v)<50)?v+100:v;
// dedup_key = md5(공고번호|개찰일|기초금액|낙찰가). 2026-05-30: 기존 공고명 기반에서 변경(공고명 미세변동 재임포트가 중복 생성하던 버그).
// pn_no 없으면 공고명(pn) fallback. ※ 변경 시 DB 기존 dedup_key도 동일 공식으로 재계산 필요(안 그러면 재임포트가 전건 중복 삽입).
//   SQL: md5(COALESCE(NULLIF(pn_no,''),pn)||'|'||COALESCE(to_char(od,'YYYY-MM-DD'),'')||'|'||COALESCE(ba::text,'')||'|'||COALESCE(bp::text,''))
export function toRecord(r){const pn=clean(r[1]);if(!pn||pn.length<2)return null;const ag=clean(r[3]);const at=clsAg(ag);const ep=sn(r[4]);const ba=sn(r[5]);const av=pnv(r[6]);const od=pDt(clean(r[19]));const era=isNewEra(at,od)?"new":"old";const pnNo=clean(r[2]);const bp=sn(r[14]);const idPart=pnNo||pn;const dk=idPart+"|"+(od||"")+"|"+(ba!=null?ba:"")+"|"+(bp!=null?bp:"");if(dk.length<5)return null;return{dedup_key:md5(dk),pn,pn_no:pnNo,ag,at,ep:ep||null,ba:ba||null,av:av||0,raw_cost:clean(r[7]),xp:sn(r[8]),floor_price:sn(r[9]),ar1:_normRate(sn(r[10])),ar0:_normRate(sn(r[11])),co:clean(r[12]),co_no:clean(r[13]),bp,br1:_normRate(sn(r[15])),br0:_normRate(sn(r[16])),base_ratio:sn(r[17]),pc:Math.round(pnv(r[18]))||0,od:od||null,input_date:pDt(clean(r[20]))||null,cat:clean(r[21]),g2b:clean(r[22]),reg:clean(r[23]),era,has_a:av>0,fr:eraFR(at,ep,od)}}
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
    // 공고일 — era(낙찰하한율 시점) 판정 법적 기준. 개찰일과 별도 캡처 (Codex 결함1).
    if(h.includes("공고일")&&!col.nd)col.nd=i;
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
    const ndRaw=col.nd!=null?clean(r[col.nd]):"";const nd=pDt(ndRaw);
    const cat=col.cat!=null?clean(r[col.cat]):"";
    const pn_no=col.pn_no!=null?clean(r[col.pn_no]):"";
    if(!ba&&!ep)continue; // 금액 정보 없으면 스킵
    result.push({pn,pn_no,ag,at,ep:ep||null,ba:ba||ep||null,av:av||0,raw_cost:rawCost,cat,open_date:od,notice_date:nd||null,
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

// pred_source 신뢰도 분류 — 두 형식 통합 (모달 배지 + 리스트 강조 공유 진실)
// 신뢰도 분류(predConfidence·predConfidenceV2)는 ./predConfidence.js로 분리 — standalone(import.meta.env 체인 없음)이라 node 단위테스트 가능. App.jsx 호환 위해 re-export.
export { predConfidence, predConfidenceV2, CONF_HIGH, CONF_MED, CONF_TIER_MIN_N, WIN_ZONE_AREAS } from "./predConfidence.js";

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

export function predictV5({at,agName,ba,ep,av,ownScore,od},ts,as,details,agencyPred,floorBench){
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

  // era 키: 입력 공고일/개찰일(od) 우선, 누락 시 today fallback (Codex 결함1; old 강제 방지 위해 today 명시).
  const fr=eraFR(at,ep||ba,od||new Date().toISOString().slice(0,10));
  // V2_DOMAIN_RULES_CHECK #1-b: 자사 유효 낙찰하한율 (ownScore 디폴트 20=만점)
  const effFr=calcEffectiveFloorRate(at,fr,ownScore);
  const calcBid=(adjRate)=>{const xp=ba*(1+adjRate/100);return av>0?Math.ceil(av+(xp-av)*(effFr/100)):Math.ceil(xp*(effFr/100))};
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
  const ci70={low:rnd4(ref.med-effStd*0.95),high:rnd4(ref.med+effStd*0.95)};
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
  // TYPE_OFF 상수는 constants-tables.js에 분리됨.
  const typeOff=TYPE_OFF[at]??-0.10;

  // 발주사별 오프셋 (agency_predictor 기반, n/10 shrinkage)
  // 발주사가 등록되어 있으면 적용, 없으면 자연스럽게 0 (typeOff만 유효)
  const agPred=agencyPred&&agencyPred[normalizeAgencyName(agName)];
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
  // 나의업체/1순위 — 라벨 스캔(자회사 행 끼어도 정확). sucviewParse.js로 분리(node 테스트).
  const {my_rank,my_bid_rate,my_adj_rate,win_bid_rate,win_adj_rate}=parseBidResultRows(rows);
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
  const participants=parseParticipants(rows);
  return{pn_no,pn,ag,at,od,ba,ep,xp,av,floor_rate,adj_rate,pre_rates,selected_nums,pre_avg,pre_min,pre_max,participant_count,bid_dist,bid_median,bid_q1,bid_q3,my_rank,my_bid_rate,my_adj_rate,win_bid_rate,win_adj_rate,source_file:fileName,participants}}

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
// ASSUMED_ADJ_TABLE / FAIL_RATES 상수는 constants-tables.js에 분리됨.

export function recommendAssumedAdj({at,agName,ba,ep,av,pc,ownScore,od},ts,as,agAss){
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
  // era 키: 입력 공고일/개찰일(od) 우선, 누락 시 today fallback (Codex 결함1; old 강제 방지 위해 today 명시).
  const fr=eraFR(at,ep||ba,od||new Date().toISOString().slice(0,10));
  // V2_DOMAIN_RULES_CHECK #1-b: 자사 유효 낙찰하한율 (ownScore 디폴트 20=만점)
  const effFr=calcEffectiveFloorRate(at,fr,ownScore);
  const calcBid=(adjRate)=>{
    const xp=ba*(1+adjRate/100);
    const raw=av>0?av+(xp-av)*(effFr/100):xp*(effFr/100);
    return at==="LH"?ceilToThousand(raw):ceilToWon(raw);
  };

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


// ============ Phase 5.3: ROI 통합 점수 시스템 ============
// WIN_PROB_MATRIX / SHRINKAGE_K / GLOBAL_MEAN / INVALID_KEYWORDS / tierOf
// 상수는 constants-tables.js에 분리됨. setWinProbMatrix는 sbFetchRoiMatrix가
// Phase 12 정리로 no-op화된 뒤 호출처 0이 되어 제거됨.

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

// Phase 5.4의 BIAS_MAP / TREND_MAP / getEnhancedAdj 체인은 제거됨
// — 공급원 sbFetchBiasMap / sbFetchTrendMap 이 Phase 12에서 no-op 화된 뒤
// 실질적으로 항상 빈 맵을 사용하던 dead path였음.
// 현재 편향 보정은 getFinalRecommendation(App.jsx) + pred_bias_map VIEW로 대체.

// ============ Claude API 통합 ============

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
      model:"claude-sonnet-4-6",
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

// ─── Phase 23-9: 자사 1위 낙찰 추천 (recommendBid1st) ──────────
// Abramowitz & Stegun 7.1.26 erf 근사 (max error 1.5e-7)
function _erf(x){
  const sign=x<0?-1:1;
  x=Math.abs(x);
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,
        a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const t=1/(1+p*x);
  const y=1-((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
  return sign*y;
}

// 표준정규 CDF Φ(z)
function _phi(z){return 0.5*(1+_erf(z/Math.SQRT2));}

// 1위 확률 (Phase 23-9 v2 보정): 종형 분포로 정의
// = 4 × Φ(z) × (1 − Φ(z)) — z=0(mean)에서 1.0 max, 양 극단 0
// 도메인 정합: 1위 사정률 분포의 평균이 곧 자사가 1위 될 가장 빈도 높은 위치
// 적격성 미달이면 0
export function calcWinProb(adj,mean,effStd,floorSafe){
  if(!floorSafe)return 0;
  if(!effStd||effStd<=0)return 0;
  const z=(adj-mean)/effStd;
  const cdf=_phi(z);
  return 4*cdf*(1-cdf);
}

// ─── V2 Mode B 엔진 (B2) ────────────────────────────────────
// 근거: docs/v2/HANDOFF_V2_PREDICTION_DEFINITION §1.3, HANDOFF_V2_DIAGNOSIS_RESULT §6 Step2
// 정의: P(자사투찰 ≥ 낙찰하한가) = P(실제 사정률 ≤ X) = Φ((X − mean) / std)
//   - 정규분포 가정 (사정률 분포 위치·폭은 발주사별 학습)
//   - mean: 발주사 사정률 분포 평균 / std: 표준편차 (노이즈 플로어 0.642%보다 작으면 floor 적용)
// 입력: adj (자사 후보 사정률), mean (분포 중심), std (분포 폭)
// 반환: 0~1 확률
export function calcFloorPassProb(adj, mean, std) {
  if (adj == null) return null;
  const effStd = Math.max(Number(std) || 0, 0.642); // 노이즈 플로어
  if (effStd <= 0) return null;
  const m = Number(mean) || 0;
  const z = (Number(adj) - m) / effStd;
  return _phi(z);
}

// V2 Mode A 추천 — 군시설 한정 gap 분포 기반 (B3.3)
// 근거: docs/v2/HANDOFF_V2_MASTER_PLAN §4 B3, V2_PREDICTION_DEFINITION §1.3
// 정의:
//   gap = win_bid_rate - floor_rate (1위 vs 낙찰하한율)
//   자사 추천 = floor + δ_recommend, δ_recommend ∈ [0, gap]
//   P(낙찰 | δ) = P(δ ≤ winner_gap) = 1 − CDF_gap(δ)
//   δ가 작을수록 P(낙찰)↑ but 0이면 하한 미달 위험
//
// 전략:
//   strategy='balanced' (기본): δ = gap_p25 — P(낙찰) ≈ 75%
//   strategy='aggressive':       δ = gap_p10 — P(낙찰) ≈ 90%, 하한 미달 위험 약간↑
//   strategy='safe':             δ = gap_p50 — P(낙찰) ≈ 50%, 안전 마진 확보
//
// 입력:
//   gapDist: { n, gap_p10, gap_p25, gap_p50, gap_p75, gap_p90, gap_mean, gap_std }
//   strategy: 'balanced' | 'aggressive' | 'safe' (기본 balanced)
// 반환: { delta_adj, win_prob_estimate, strategy_used } | null
//
// δ_adj는 자사 사정률 단위 (실제 사정률 단위). bid_rate 공간에서 floor_rate 위의 위치.
// 실제 추천 사정률 = b_pred_adj_floor + δ_adj (where b_pred_adj_floor는 사정률 분포에서 가져옴)
// V2 Mode A 추천 (Phase 2a) — 군시설 floorErr 분포 기반 m_star
// 근거: docs/v2/A_MODE_A_MILITARY_WIN_DESIGN_2026-05-23 §3~§6, predict-architect Phase2 검토, Codex consult 2026-05-23
// floorErr = (actual_floor − predicted_floor)/base [분수], predicted_floor = pred_expected_price×pred_floor_rate/100
// m_star = clamp(p85(α=0.15), lo=max(0,p50), hi=p95)  — floor-pass 1차, 1위는 보너스
// 입력:
//   floorErrDist: lookup_floorerr_distribution 결과 { n, confidence, floorerr_mean, floorerr_std, floorerr_p50, floorerr_p85, floorerr_p95, ... }
//   options: { predExpectedPrice, predFloorRate, ba, alpha=0.15 }
// 반환: { m_star, recommended_bid_amount, recommended_bid_rate, predicted_floor_amount, floor_pass_prob, sample_status, alpha_used, src_n } | null
export function recommendModeA(floorErrDist, options) {
  const opt = Object.assign({ alpha: 0.15 }, options || {});
  if (!floorErrDist || floorErrDist.n == null || floorErrDist.n < 5) return null;
  const predEp = Number(opt.predExpectedPrice);
  const predFr = Number(opt.predFloorRate);
  const ba = Number(opt.ba);
  if (!(predEp > 0) || !(predFr > 0) || !(ba > 0)) return null;

  // α=0.15 LOCK → p85 (p90/p95 직접 사용 금지: n<300 꼬리 불안정)
  const p50 = Number(floorErrDist.floorerr_p50);
  const p85 = Number(floorErrDist.floorerr_p85);
  const p95 = Number(floorErrDist.floorerr_p95);
  if (isNaN(p85)) return null;
  const lo = isNaN(p50) ? 0 : Math.max(0, p50);   // floor-pass 1차: m_star ≥ 0
  const hi = isNaN(p95) ? p85 : p95;
  let mStar = Math.min(Math.max(p85, lo), hi);
  if (isNaN(mStar)) return null;

  const predictedFloorAmount = predEp * predFr / 100;
  const recommendedBidAmount = Math.ceil(predictedFloorAmount + ba * mStar);
  const recommendedBidRate = recommendedBidAmount / ba;

  // floor_pass_prob ≈ P(floorErr ≤ m_star) = Φ((m_star−mean)/std) ≈ 1−α
  const mean = Number(floorErrDist.floorerr_mean);
  const std = Number(floorErrDist.floorerr_std);
  let floorPassProb = 1 - opt.alpha;
  if (!isNaN(mean) && std > 0) {
    const p = _phi((mStar - mean) / std);
    if (p != null && !isNaN(p)) floorPassProb = p;
  }

  return {
    m_star: mStar,
    recommended_bid_amount: recommendedBidAmount,
    recommended_bid_rate: recommendedBidRate,
    predicted_floor_amount: predictedFloorAmount,
    floor_pass_prob: floorPassProb,
    sample_status: floorErrDist.confidence || null,
    alpha_used: opt.alpha,
    src_n: floorErrDist.n,
  };
}

// V2 Mode B 추천 — 하한 통과확률 ≥ targetProb 만족하는 가장 공격적(작은) X
// 근거: docs/v2/HANDOFF_V2_MASTER_PLAN §4 B2 — "≥95% 만족하는 가장 공격적인 X"
// calibration 검증은 floor_pass_daily 일배치가 사후 1주 실측과 비교
// 입력:
//   distribution: { mean, std, n }  // 발주사 사정률 분포 (Bayesian shrinkage 적용된 형태)
//   targetProb:   0.95              // 하한 통과율 임계
//   gridStep:     0.0001            // 사정률 그리드 정밀도
//   gridRange:    1.5               // mean ± gridRange 탐색 범위
// 반환: { adj, floor_pass_prob } | null
export function recommendModeB(distribution, options) {
  const opt = Object.assign({ targetProb: 0.95, gridStep: 0.0001, gridRange: 1.5 }, options || {});
  if (!distribution || distribution.mean == null) return null;
  const { mean, std } = distribution;
  const startAdj = Number(mean) - opt.gridRange;
  const endAdj = Number(mean) + opt.gridRange;

  // 가장 작은 X부터 탐색해 P(통과) >= targetProb 처음 만족하는 지점
  let bestAdj = null;
  let bestProb = null;
  for (let adj = startAdj; adj <= endAdj; adj += opt.gridStep) {
    const p = calcFloorPassProb(adj, mean, std);
    if (p != null && p >= opt.targetProb) {
      bestAdj = adj;
      bestProb = p;
      break; // 가장 공격적 X — 가장 작은 X 채택
    }
  }
  // targetProb 도달 불가 시 — 분포 우측 끝(가장 높은 X)을 fallback
  if (bestAdj == null) {
    bestAdj = endAdj;
    bestProb = calcFloorPassProb(endAdj, mean, std);
  }
  return { adj: bestAdj, floor_pass_prob: bestProb };
}

// ba_seg 분할 (predictV5와 동일)
export function baSegOf(ba){
  const n=Number(ba)||0;
  if(n<1e8)return 'S1';
  if(n<3e8)return 'S2';
  if(n<1e9)return 'S3';
  if(n<3e9)return 'S4';
  return 'S5';
}

// 다단 fallback lookup: AG_BA → AG → AT_BA → AT
// distMap: {agBa, ag, atBa, at} 각 객체는 sbFetchWin1stDistMap 결과
// baSeg: 'S1'~'S5' (predictV5와 동일 분할)
// 반환: {n, mean, std, grain, src} 또는 null
export function lookupWin1stDist(at,agName,baSeg,distMap){
  if(!distMap)return null;
  const ag_ba_key=`${agName}|${baSeg}`;
  if(distMap.agBa&&distMap.agBa[ag_ba_key]){
    const v=distMap.agBa[ag_ba_key];
    return{...v,grain:'AG_BA',src:`${agName} ${baSeg}(${v.n}건)`};
  }
  if(distMap.ag&&distMap.ag[agName]){
    const v=distMap.ag[agName];
    return{...v,grain:'AG',src:`${agName}(${v.n}건)`};
  }
  const at_ba_key=`${at}|${baSeg}`;
  if(distMap.atBa&&distMap.atBa[at_ba_key]){
    const v=distMap.atBa[at_ba_key];
    return{...v,grain:'AT_BA',src:`${at} ${baSeg}(${v.n}건)`};
  }
  if(distMap.at&&distMap.at[at]){
    const v=distMap.at[at];
    return{...v,grain:'AT',src:`${at}(${v.n}건)`};
  }
  return null;
}

// ─── Phase 23-9 메인: recommendBid1st ───────────────────────────
// bid: {at, agName, ba, ep, av, fr}
// context: {distMap}  // 1단계는 distMap만 사용. bidDetails는 2단계.
// options: {gridStep, gridRange, minSamples, noiseFloor, enableMonteCarlo}
// 반환: {auto, scenarios, distribution} 또는 null
export function recommendBid1st(bid,context,options){
  const opt=Object.assign({
    gridStep:0.0001,gridRange:1.5,minSamples:5,
    noiseFloor:0.642,enableMonteCarlo:false
  },options||{});
  const{at,agName,ba,ep,av,fr}=bid||{};
  if(!at||!ba||!fr)return null;

  // Step 1: 분포 lookup (다단 fallback)
  const baSeg=baSegOf(ba);
  let dist=lookupWin1stDist(at,agName,baSeg,context?.distMap);
  let distSrc=dist?dist.src:'시스템 기본(표본 부족)';
  let distGrain=dist?dist.grain:null;
  let distN=dist?dist.n:0;
  let mean=dist?Number(dist.mean):0;
  let std=dist?Number(dist.std):0.642;
  if(!dist||dist.n<opt.minSamples){
    distGrain=null;mean=0;std=0.642;distN=0;
    distSrc='시스템 기본(표본 부족)';
  }

  // Step 2: 노이즈 floor 적용
  const effStd=Math.max(std,opt.noiseFloor);

  // Step 3: Monte Carlo는 2단계 (1단계 noop)

  // Step 4: Grid search 0.0001% 정밀도
  const xpC=(adj)=>ba*(1+adj/100);
  // V2_DOMAIN_RULES_CHECK #1-b: 자사 유효 낙찰하한율 (context.ownScore 디폴트 20=만점)
  const effFr=calcEffectiveFloorRate(at,fr,context?.ownScore);
  const bidC=(adj)=>{
    const xp=xpC(adj);
    return(av&&av>0)
      ?Math.ceil(av+(xp-av)*(effFr/100))
      :Math.ceil(xp*(effFr/100));
  };
  // 적격성: bidC(adj) ≥ legal_min(adj). 두 식이 동일하므로
  // 자연스럽게 floorSafe = (xp ≥ av), 즉 ba(1+adj/100) ≥ av.
  // av=0이거나 av≪ba면 항상 true. 자격 미달은 av가 큰 LH 같은 case에서 발생.
  const floorSafeC=(adj)=>{
    const xp=xpC(adj);
    return(!av||av<=0)?true:xp>=av;
  };

  const startAdj=mean-opt.gridRange;
  const endAdj=mean+opt.gridRange;
  let bestAdj=mean,bestProb=-1;
  for(let adj=startAdj;adj<=endAdj;adj+=opt.gridStep){
    const fs=floorSafeC(adj);
    const wp=calcWinProb(adj,mean,effStd,fs);
    // tie-break: mean에 가까운 쪽 우선
    if(wp>bestProb||(wp===bestProb&&Math.abs(adj-mean)<Math.abs(bestAdj-mean))){
      bestProb=wp;bestAdj=adj;
    }
  }

  const r4=(v)=>Math.round(v*10000)/10000;
  const buildOption=(adj)=>{
    const fs=floorSafeC(adj);
    const wp=calcWinProb(adj,mean,effStd,fs);
    return{
      adj:r4(adj),bid:bidC(adj),
      winProb:Math.round(wp*100)/100,
      floorSafe:fs,
      label:fs?`자격OK·적합${Math.round(wp*100)}%`:'자격미달'
    };
  };

  // Step 5: 출력
  // P25/P75: 정규분포 분위수 ±0.6745 × effStd
  return{
    auto:buildOption(bestAdj),
    scenarios:{
      aggressive:buildOption(mean-0.6745*effStd),
      balanced:buildOption(mean),
      conservative:buildOption(mean+0.6745*effStd)
    },
    distribution:{
      grain:distGrain,n:distN,
      mean:r4(mean),std:r4(std),
      src:distSrc,
      monteCarloUsed:false
    }
  };
}

// bidC 무손실 역산: 주어진 bid_amount를 만드는 사정률 adj 산출 (b_pred_adj 컬럼 표시용)
// bidC(adj) = ceil(av + (ba*(1+adj/100) − av)*(effFr/100))  (av>0)
//           = ceil(ba*(1+adj/100)*(effFr/100))               (av≤0)
// → adj = ((av + (bid−av)*100/effFr)/ba − 1)*100   (av>0)
//        = ((bid*100/effFr)/ba − 1)*100             (av≤0)
function _invertBidCToAdj(bid, ba, av, effFr) {
  if (!(ba > 0) || !(effFr > 0)) return 0;
  const xp = (av && av > 0)
    ? av + (bid - av) * 100 / effFr
    : bid * 100 / effFr;
  return (xp / ba - 1) * 100;
}

// ─── V2 통합 추천 함수 (B2.3) ────────────────────────────────
// 근거: docs/v2/HANDOFF_V2_MASTER_PLAN §4 B2 + V2_UI_SPEC §3
// 모드 분기:
//   Mode B (안착, 한전·LH·교육청·조달청·지자체): recommendModeB → 하한 통과확률 ≥95%
//   Mode A (공략, 군시설): 기존 recommendBid1st 종형 (B3에서 컨볼루션 교체 예정)
// 기존 recommendBid1st는 보존 — 호환성 + Mode A fallback용
//
// 입력:
//   bid:     { at, agName, ba, ep, av, fr }
//   context: { distMap, modeResolution, agencyDist }
//     - distMap        : win1stDistMap (Mode A 종형용)
//     - modeResolution : lookup_agency_mode 결과 { mode_recommend, confidence, n, median_gap, p90_gap, matched_grain }
//     - agencyDist     : Mode B용 사정률 분포 { mean, std, n } (없으면 분포 lookup의 mean/std fallback)
// 반환:
//   { mode, adj, bid, floor_pass_prob, win_prob, grain, src, source }
//   - source: 'modeB' | 'modeA_bell' | 'modeA_convolution' | 'fallback'
export function recommendV2(bid, context, options) {
  const opt = Object.assign({ targetProb: 0.95, gridStep: 0.0001, gridRange: 1.5 }, options || {});
  const { at, agName, ba, ep, av, fr } = bid || {};
  if (!at || !ba || !fr) return null;
  // 표시용 4dp 스냅. bid/floor_safe는 raw adj로 계산해 투찰금 byte-identical 보장 (predict-architect 검토).
  const r4 = (v) => Math.round(v * 10000) / 10000;

  const mode = context?.modeResolution?.mode_recommend || 'B'; // 미조회 시 안전한 안착 모드
  const grain = context?.modeResolution?.matched_grain || null;
  const baSeg = baSegOf(ba);

  // V2_DOMAIN_RULES_CHECK #1 — 자사 유효 낙찰하한율 (context.ownScore 없으면 디폴트 20=만점)
  const effFr = calcEffectiveFloorRate(at, fr, context?.ownScore);

  // V2_DOMAIN_RULES_CHECK #6 (m24) — agency_mode_lookup의 adj_range_min/max로 grid 범위 클램프
  // predict-architect 라운드 11 권고: 메타가 1.5보다 좁으면 좁히고, 넓으면 1.5 유지 (보수적)
  const metaRangeMin = context?.modeResolution?.adj_range_min;
  const metaRangeMax = context?.modeResolution?.adj_range_max;
  if (metaRangeMin != null && metaRangeMax != null) {
    const metaWidth = Math.max(Math.abs(Number(metaRangeMin)), Math.abs(Number(metaRangeMax)));
    if (Number.isFinite(metaWidth) && metaWidth > 0) {
      opt.gridRange = Math.min(opt.gridRange, metaWidth);
    }
  }

  // 투찰금액 계산식 (recommendBid1st와 동일 — A값 보정, effFr 사용)
  const xpC = (adj) => ba * (1 + adj / 100);
  const bidC = (adj) => {
    const xp = xpC(adj);
    return (av && av > 0)
      ? Math.ceil(av + (xp - av) * (effFr / 100))
      : Math.ceil(xp * (effFr / 100));
  };
  const floorSafeC = (adj) => {
    const xp = xpC(adj);
    return (!av || av <= 0) ? true : xp >= av;
  };

  if (mode === 'B') {
    // Mode B: 하한 통과확률 ≥ 95% 만족하는 가장 공격적 X
    // 사정률 분포 입력: 우선 agencyDist, 없으면 distMap lookup의 mean/std fallback
    let distribution = context?.agencyDist || null;
    if (!distribution || distribution.mean == null) {
      const lookup = lookupWin1stDist(at, agName, baSeg, context?.distMap);
      if (lookup) distribution = { mean: Number(lookup.mean) || 0, std: Number(lookup.std) || 0.642, n: lookup.n };
    }
    if (!distribution || distribution.mean == null) {
      // 분포 lookup 완전 실패 — at-level 기본값 (mean=0, 노이즈 플로어)
      distribution = { mean: 0, std: 0.642, n: 0 };
    }

    const result = recommendModeB(distribution, opt);
    if (!result || result.adj == null) return null;
    const adjRaw = result.adj; // bid/floor_safe는 raw로 계산 — 투찰금/적격 판정 byte-identical 유지
    return {
      mode: 'B',
      adj: r4(adjRaw),
      bid: bidC(adjRaw),
      floor_pass_prob: result.floor_pass_prob,
      win_prob: null, // Mode B는 낙찰 확률 미산출 (안착 모드 거짓 약속 방지)
      grain,
      src: `modeB(${distribution.n||0}건 · μ=${distribution.mean?.toFixed?.(4) ?? '?'} · σ=${distribution.std?.toFixed?.(4) ?? '?'})`,
      source: 'modeB',
      floor_safe: floorSafeC(adjRaw)
    };
  }

  // Mode A: 군시설 공략 — Phase 2a floorErr m_star 기반 (recommendModeA)
  // floorErrDist는 context에서 전달 (App.jsx의 lookup_floorerr_distribution RPC 결과, era=current)
  // 표본 부족(n<5)·미전달·predExpectedPrice 부재 시 기존 종형 fallback
  const floorErrDist = context?.floorErrDist;
  const predEp = Number(context?.predExpectedPrice);
  const predFr = Number(fr); // recommendV2 입력 fr = pred_floor_rate (App.jsx에서 전달)
  if (floorErrDist && floorErrDist.n >= 5 && predEp > 0 && predFr > 0) {
    const result = recommendModeA(floorErrDist, { predExpectedPrice: predEp, predFloorRate: predFr, ba, alpha: opt.alpha || 0.15 });
    if (result && result.recommended_bid_amount != null) {
      const bidAmt = result.recommended_bid_amount;
      // b_pred_adj 컬럼 의미 보존: bidC 역산으로 사정률 환산 (표시용 — bid=bidAmt와 독립, r4 4dp 스냅)
      const adj = r4(_invertBidCToAdj(bidAmt, ba, av, effFr));
      return {
        mode: 'A',
        adj,
        bid: bidAmt,
        floor_pass_prob: result.floor_pass_prob,
        win_prob: null, // Mode A 1위는 보너스 — 과신 약속 금지 (insufficient_sample)
        grain,
        src: `modeA_floorErr(n=${result.src_n} · m*=${result.m_star?.toFixed?.(5) ?? '?'} · α=${result.alpha_used} · ${result.sample_status || '?'})`,
        source: 'modeA_floorerr',
        floor_safe: bidAmt >= result.predicted_floor_amount,
        m_star: result.m_star,
        sample_status: result.sample_status,
        recommended_bid_rate: result.recommended_bid_rate,
      };
    }
  }

  // Fallback: 기존 종형 (floorErrDist 미전달 또는 표본 부족)
  // V2_DOMAIN_RULES_CHECK #1-b: ownScore도 함께 전달 (recommendBid1st 내부에서 effFr 계산)
  const v1 = recommendBid1st({ at, agName, ba, ep, av, fr }, { distMap: context?.distMap, ownScore: context?.ownScore }, { enableMonteCarlo: false });
  if (!v1 || !v1.auto) return null;
  return {
    mode: 'A',
    adj: v1.auto.adj,
    bid: v1.auto.bid,
    floor_pass_prob: null,
    win_prob: v1.auto.winProb,
    grain,
    src: `modeA_bell_fallback(${v1.distribution?.grain || 'fallback'}: ${v1.distribution?.src || '-'})`,
    source: 'modeA_bell_fallback',
    floor_safe: v1.auto.floorSafe
  };
}
