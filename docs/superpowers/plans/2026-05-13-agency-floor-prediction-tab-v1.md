# 발주사 하한 예측탭 V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** bid-analyzer에 "발주사 하한 예측" 신규 탭을 추가해 예측 1순위 사정률(`agency_rate_distribution.median_adj_ratio`)·실측 1순위 사정률(`ar1`)·실측 낙찰가/기초(`base_ratio`)·낙찰하한율(`fr`)·오차를 한 화면에서 보여주고, 행 클릭 시 해당 발주사의 이전 입찰 이력을 펼친다.

**Architecture:** `src/lib/supabase.js`에 fetch 헬퍼 4개 추가, `src/App.jsx`에 함수형 컴포넌트 3개(`AgencyFloorTab`, `AgencyFloorRow`, `AgencyFloorHistoryPanel`) 및 탭 정의·분기 추가. 기존 8개 탭과 예측 산식(`opt_adj`, `bid1st_v2_adj`, `pred_bias_map` 등)은 일체 미수정. 신규 RPC·테이블·라이브러리 없음. 자세한 설계 근거는 `docs/superpowers/specs/2026-05-13-agency-floor-prediction-tab-v1-design.md`.

**Tech Stack:** React 18 (이미 사용), `xlsx` (이미 사용), Supabase REST + `authedFetch` (기존 패턴). 신규 의존성 0.

---

## 사전 컨벤션 (모든 Task 공통)

- Windows PowerShell 환경. CRLF 경고는 무시.
- 각 Task 끝의 빌드는 `npx vite build` (CLAUDE.md 규약).
- 커밋 메시지 prefix는 `feat(agency-floor):` 또는 `chore(agency-floor):`로 통일.
- 코드 스타일: 같은 파일 내 기존 코드와 일치 (한 줄 함수 다수, 공백 없는 인라인 스타일). 새 코드 일부는 들여쓰기 가독성을 위해 적당히 풀어 써도 무방하나 inline `style={{...}}` JSX는 유지.
- 색상 토큰: `C.bg2`(메인 패널), `C.bg3`(헤더), `C.bdr`(테두리), `C.gold`(강조), `C.txt`/`C.txm`/`C.txd`(텍스트 강·중·약). 모두 `import { C, PAGE, inpS } from "./lib/constants.js"`로 이미 가져옴.
- 컬럼 의미 확정 (디자인 §2 데이터 검증 완료):
  - `bid_records.ar1` = 100-base "1위 사정률" (그대로 사용). `br1`은 의미 불일치로 V1에서 사용 안 함.
  - `bid_records.base_ratio` = 100-base 낙찰가/기초.
  - `bid_records.fr` = % 낙찰하한율.
  - `bid_predictions.actual_adj_rate` = 0-base, 화면 표시 시 `100 + value`.
  - `agency_rate_distribution.median_adj_ratio / p25 / p75` = 100-base, 변환 없이 표시.

---

## File Structure (변경 매트릭스)

| 파일 | 변경 유형 | 책임 |
|---|---|---|
| `src/lib/supabase.js` | 수정 (append only) | 신규 fetch 헬퍼 4개 추가. 기존 함수 한 줄도 수정 안 함. |
| `src/App.jsx` | 수정 | (1) 라인 10 import 확장. (2) 컴포넌트 3개 추가(toP100 정의 직후). (3) 라인 988 Tb 묶음에 새 탭 1개 추가. (4) 라인 2781 chat 탭 분기 직후 새 탭 분기 추가. 기존 컴포넌트·함수 무수정. |
| `src/lib/utils.js` | 변경 없음 | — |
| `src/lib/constants.js` | 변경 없음 | — |
| `src/components/*` | 변경 없음 | 신규 디렉토리 추가 없음 |
| DB 객체 | 변경 없음 | RPC·테이블·인덱스 신규 0 |

---

## Task 1: supabase.js — fetch 헬퍼 4개 추가

**Files:**
- Modify: `src/lib/supabase.js` (파일 끝에 append)

**Why this task first:** 컴포넌트가 호출할 모든 데이터 fetch를 먼저 갖춰 둠. 빌드는 통과해야 함(import 시점엔 호출 안 되므로 동작 검증은 Task 5에서).

- [ ] **Step 1-1: 파일 끝에 4개 함수 append**

`src/lib/supabase.js` 최하단(라인 468 다음, 마지막 함수 `sbPredictNotice` 뒤)에 아래 블록을 그대로 추가한다.

```js

// ─── V1: 발주사 하한 예측탭 (2026-05-13) ──────────────────
// 디자인 문서: docs/superpowers/specs/2026-05-13-agency-floor-prediction-tab-v1-design.md
// 4개 헬퍼: (1) file_upload 예측 리스트, (2) 발주사 사정률 분포 신호,
//          (3) 매칭된 bid_records 일괄, (4) 펼침 시 발주사 최근 이력.

// (1) 예측 리스트 — source=file_upload, 필요 컬럼만 select
export async function sbFetchAgencyFloorPredictions(limit=500){
  try{
    const cols="id,ag,canonical_ag,cat,ba,ep,av,od,"
      +"actual_adj_rate,actual_bid_amount,actual_winner,"
      +"match_status,matched_record_id,is_cancelled,created_at";
    const res=await authedFetch(
      "/rest/v1/bid_predictions?source=eq.file_upload"
      +"&select="+cols
      +"&order=od.desc.nullslast&limit="+limit
    );
    if(!res.ok)return[];
    const rows=await res.json();
    return Array.isArray(rows)?rows:[];
  }catch(e){return[]}
}

// (2) 발주사 사정률 분포 신호 — canonical_ag in.() 일괄, 100건 청크
//     반환: {rows:[{canonical_ag,cat,median_adj_ratio,p25_adj_ratio,p75_adj_ratio,
//                   std_adj_ratio,sample_size,tier,confidence}]}
export async function sbFetchAgencyRateDistribution(canonicalAgs){
  if(!canonicalAgs||!canonicalAgs.length)return{rows:[]};
  try{
    const unique=[...new Set(canonicalAgs.filter(Boolean))];
    const CHUNK=100;let all=[];
    for(let i=0;i<unique.length;i+=CHUNK){
      const c=unique.slice(i,i+CHUNK);
      const qs="canonical_ag=in.("+c.map(s=>encodeURIComponent('"'+s+'"')).join(",")+")";
      const res=await authedFetch(
        "/rest/v1/agency_rate_distribution?"+qs
        +"&select=canonical_ag,cat,median_adj_ratio,p25_adj_ratio,p75_adj_ratio,"
        +"std_adj_ratio,sample_size,tier,confidence"
      );
      if(!res.ok)continue;
      const rows=await res.json();
      if(Array.isArray(rows))all=all.concat(rows);
    }
    return{rows:all};
  }catch(e){return{rows:[]}}
}

// (3) 매칭된 bid_records 일괄 — matched_record_id 집합 → {id:{ar1,base_ratio,fr,bp,co}}
export async function sbFetchMatchedRecords(ids){
  if(!ids||!ids.length)return{};
  try{
    const unique=[...new Set(ids.filter(v=>v!=null))];
    const CHUNK=100;const out={};
    for(let i=0;i<unique.length;i+=CHUNK){
      const c=unique.slice(i,i+CHUNK);
      const res=await authedFetch(
        "/rest/v1/bid_records?id=in.("+c.join(",")+")"
        +"&select=id,ar1,base_ratio,fr,bp,co"
      );
      if(!res.ok)continue;
      const rows=await res.json();
      if(Array.isArray(rows))for(const r of rows)out[r.id]=r;
    }
    return out;
  }catch(e){return{}}
}

// (4) 발주사 최근 입찰 이력 — 펼침 시 lazy fetch
//     ar1 not null + is_excluded=false 필터, od desc 30건
export async function sbFetchAgencyHistoryByName(canonicalAg,limit=30){
  if(!canonicalAg)return[];
  try{
    const res=await authedFetch(
      "/rest/v1/bid_records?canonical_ag=eq."+encodeURIComponent(canonicalAg)
      +"&ar1=not.is.null&is_excluded=eq.false"
      +"&order=od.desc.nullslast&limit="+limit
      +"&select=id,od,pn,ba,ar1,base_ratio,fr,bp,co,pc"
    );
    if(!res.ok)return[];
    const rows=await res.json();
    return Array.isArray(rows)?rows:[];
  }catch(e){return[]}
}
```

- [ ] **Step 1-2: 빌드 검증**

Run: `npx vite build`
Expected: `built in ...ms` (성공). 경고는 있어도 무방하나 ERROR는 없을 것.

- [ ] **Step 1-3: 커밋**

```
git add src/lib/supabase.js
git commit -m "feat(agency-floor): supabase.js fetch helpers (V1)"
```

---

## Task 2: App.jsx — import 라인 확장

**Files:**
- Modify: `src/App.jsx` (라인 10)

- [ ] **Step 2-1: 라인 10의 supabase.js import 끝부분에 4개 심볼 추가**

라인 10의 큰 import 문은 닫는 `}`이 있다. 그 직전(마지막 심볼 `sbFetchV8Predictions` 뒤)에 4개를 콤마로 이어 붙인다.

Find (라인 10에서 `sbFetchV8Predictions } from "./lib/supabase.js"` 부분):
```js
sbFetchV8Predictions } from "./lib/supabase.js";
```

Replace with:
```js
sbFetchV8Predictions, sbFetchAgencyFloorPredictions, sbFetchAgencyRateDistribution, sbFetchMatchedRecords, sbFetchAgencyHistoryByName } from "./lib/supabase.js";
```

- [ ] **Step 2-2: 빌드 검증**

Run: `npx vite build`
Expected: 성공. 어디서도 호출 안 했으므로 import만 늘어남.

- [ ] **Step 2-3: 커밋**

```
git add src/App.jsx
git commit -m "chore(agency-floor): import agency-floor fetch helpers"
```

---

## Task 3: AgencyFloorHistoryPanel 컴포넌트 추가

**Files:**
- Modify: `src/App.jsx` (`fmtP100` 정의 직후, 대략 라인 90 근처)

**Why this order:** Panel을 먼저 만들고 Row가 Panel을 호출하도록 한다. JS `function` 선언은 호이스팅되므로 순서가 절대적이진 않지만, 읽는 사람 편의를 위해 안 → 밖 순으로 정의.

- [ ] **Step 3-1: 컴포넌트 추가 위치 결정**

라인 89 `fmtP100` 함수 끝과 라인 91 `const TIER_STYLES` 사이에 추가한다. Find:

```jsx
function fmtP100(adj0,decimals=3){
  const v=toP100(adj0);
  if(v==null||isNaN(v))return"-";
  return v.toFixed(decimals)+"%"
}
// 티어별 배지 스타일
```

Replace with:

```jsx
function fmtP100(adj0,decimals=3){
  const v=toP100(adj0);
  if(v==null||isNaN(v))return"-";
  return v.toFixed(decimals)+"%"
}

// ─── V1: 발주사 하한 예측탭 (2026-05-13) ──────────────────
// 펼침 패널: 해당 canonical_ag의 최근 30건 + 평균/std 요약
function AgencyFloorHistoryPanel({canonicalAg}){
  const [rows,setRows]=useState(null);
  const [loading,setLoading]=useState(false);
  useEffect(()=>{
    if(!canonicalAg)return;
    let cancel=false;
    setLoading(true);
    sbFetchAgencyHistoryByName(canonicalAg,30).then(r=>{
      if(cancel)return;
      setRows(Array.isArray(r)?r:[]);
      setLoading(false);
    });
    return()=>{cancel=true};
  },[canonicalAg]);
  if(loading)return<tr><td colSpan={8} style={{padding:"10px 14px",color:C.txd,fontSize:11,background:C.bg2}}>이력 로딩 중...</td></tr>;
  if(!rows)return null;
  if(rows.length===0)return<tr><td colSpan={8} style={{padding:"10px 14px",color:C.txd,fontSize:11,background:C.bg2}}>이전 입찰 없음</td></tr>;
  const ar1s=rows.map(r=>Number(r.ar1)).filter(v=>isFinite(v));
  const ar1Mean=ar1s.length?ar1s.reduce((a,b)=>a+b,0)/ar1s.length:NaN;
  const ar1Std=ar1s.length?Math.sqrt(ar1s.reduce((s,v)=>s+(v-ar1Mean)**2,0)/ar1s.length):NaN;
  const brs=rows.map(r=>Number(r.base_ratio)).filter(v=>isFinite(v));
  const brMean=brs.length?brs.reduce((a,b)=>a+b,0)/brs.length:NaN;
  const frs=rows.map(r=>Number(r.fr)).filter(v=>isFinite(v));
  const frMean=frs.length?frs.reduce((a,b)=>a+b,0)/frs.length:NaN;
  return<tr><td colSpan={8} style={{padding:0,background:C.bg2}}>
    <div style={{padding:"10px 14px"}}>
      <div style={{fontSize:11,color:C.txm,marginBottom:8,fontWeight:600}}>
        {canonicalAg} — 이전 입찰 이력 (최근 {rows.length}건)
      </div>
      <table style={{width:"100%",fontSize:11,borderCollapse:"collapse"}}>
        <thead><tr style={{color:C.txd}}>
          <th style={{textAlign:"left",padding:"3px 6px"}}>개찰일</th>
          <th style={{textAlign:"left",padding:"3px 6px"}}>공고명</th>
          <th style={{textAlign:"right",padding:"3px 6px"}}>기초(억)</th>
          <th style={{textAlign:"right",padding:"3px 6px"}}>1위 사정률</th>
          <th style={{textAlign:"right",padding:"3px 6px"}}>낙찰가/기초</th>
          <th style={{textAlign:"right",padding:"3px 6px"}}>fr</th>
          <th style={{textAlign:"right",padding:"3px 6px"}}>낙찰가(원)</th>
          <th style={{textAlign:"left",padding:"3px 6px"}}>1위 업체</th>
        </tr></thead>
        <tbody>{rows.map(r=>(
          <tr key={r.id} style={{borderTop:"1px solid "+C.bdr}}>
            <td style={{padding:"3px 6px"}}>{r.od||"-"}</td>
            <td style={{padding:"3px 6px",maxWidth:240,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={r.pn||""}>{(r.pn||"").slice(0,35)}{(r.pn||"").length>35?"...":""}</td>
            <td style={{padding:"3px 6px",textAlign:"right",fontFamily:"monospace"}}>{r.ba!=null?(Number(r.ba)/1e8).toFixed(2):"-"}</td>
            <td style={{padding:"3px 6px",textAlign:"right",fontFamily:"monospace"}}>{r.ar1!=null?Number(r.ar1).toFixed(4)+"%":"-"}</td>
            <td style={{padding:"3px 6px",textAlign:"right",fontFamily:"monospace"}}>{r.base_ratio!=null?Number(r.base_ratio).toFixed(4)+"%":"-"}</td>
            <td style={{padding:"3px 6px",textAlign:"right",fontFamily:"monospace"}}>{r.fr!=null?Number(r.fr).toFixed(3)+"%":"-"}</td>
            <td style={{padding:"3px 6px",textAlign:"right",fontFamily:"monospace"}}>{r.bp!=null?Number(r.bp).toLocaleString():"-"}</td>
            <td style={{padding:"3px 6px"}}>{r.co||"-"}</td>
          </tr>
        ))}</tbody>
      </table>
      <div style={{fontSize:10,color:C.txd,marginTop:8}}>
        평균 1위 사정률 {isFinite(ar1Mean)?ar1Mean.toFixed(4)+"%":"-"} · std {isFinite(ar1Std)?ar1Std.toFixed(4)+"pp":"-"} · 평균 낙찰가/기초 {isFinite(brMean)?brMean.toFixed(4)+"%":"-"} (fr 평균 {isFinite(frMean)?frMean.toFixed(3)+"%":"-"} · 마진 {isFinite(brMean-frMean)?(brMean-frMean).toFixed(4)+"pp":"-"})
      </div>
    </div>
  </td></tr>;
}

// 티어별 배지 스타일
```

- [ ] **Step 3-2: 빌드 검증**

Run: `npx vite build`
Expected: 성공. 함수 호출이 어디에도 없으므로 unused 경고만 있을 수 있음 (Vite는 트리쉐이킹 후 무시).

- [ ] **Step 3-3: 커밋**

```
git add src/App.jsx
git commit -m "feat(agency-floor): AgencyFloorHistoryPanel component"
```

---

## Task 4: AgencyFloorRow 컴포넌트 추가

**Files:**
- Modify: `src/App.jsx` (Task 3에서 추가한 `AgencyFloorHistoryPanel` 직후)

- [ ] **Step 4-1: AgencyFloorHistoryPanel 끝에 이어서 AgencyFloorRow 추가**

Find (Task 3 결과의 마지막 부분):

```jsx
  </td></tr>;
}

// 티어별 배지 스타일
```

Replace with:

```jsx
  </td></tr>;
}

// 메인 테이블 한 행 — 클릭 시 펼침 토글
function AgencyFloorRow({pred,signal,matched,expanded,onToggle}){
  const predRate=signal?signal.median:null;
  const actRate=pred.actual_adj_rate!=null?(100+Number(pred.actual_adj_rate)):null;
  const error=(predRate!=null&&actRate!=null)?(predRate-actRate):null;
  const errColor=error==null?C.txd:(Math.abs(error)>=0.5?"#e24b4a":C.txd);
  const stageBadge=signal?(
    signal.stage===1?"업종·"+(signal.confidence||""):
    signal.stage===2?"발주사평균":
    signal.stage===3?"글로벌":""
  ):"";
  return<>
    <tr style={{borderTop:"1px solid "+C.bdr,cursor:"pointer"}}
        onClick={onToggle}
        title={expanded?"클릭하여 닫기":"클릭하여 이전 입찰 이력 보기"}>
      <td style={{padding:"6px 8px",fontSize:11}}>{pred.od||"-"}</td>
      <td style={{padding:"6px 8px",fontSize:11}}>
        <div style={{fontWeight:600}}>{pred.ag||"-"}</div>
        <div style={{fontSize:9,color:C.txd}}>{pred.cat||"-"}</div>
      </td>
      <td style={{padding:"6px 8px",fontSize:11,textAlign:"right",fontFamily:"monospace"}}>
        {pred.ba!=null?(Number(pred.ba)/1e8).toFixed(2):"-"}
      </td>
      <td style={{padding:"6px 8px",fontSize:11,textAlign:"right",fontFamily:"monospace"}}>
        {predRate!=null?<>
          <div style={{fontWeight:600}}>{Number(predRate).toFixed(4)}%</div>
          {stageBadge&&<div style={{fontSize:9,color:C.txd}}>[{stageBadge}·n={signal.n||0}]</div>}
        </>:<span style={{color:C.txd}}>예측 불가</span>}
      </td>
      <td style={{padding:"6px 8px",fontSize:11,textAlign:"right",fontFamily:"monospace"}}>
        {actRate!=null?Number(actRate).toFixed(4)+"%":<span style={{color:C.txd}}>—</span>}
      </td>
      <td style={{padding:"6px 8px",fontSize:11,textAlign:"right",fontFamily:"monospace"}}>
        {matched&&matched.base_ratio!=null?Number(matched.base_ratio).toFixed(4)+"%":<span style={{color:C.txd}}>—</span>}
      </td>
      <td style={{padding:"6px 8px",fontSize:11,textAlign:"right",fontFamily:"monospace"}}>
        {matched&&matched.fr!=null?Number(matched.fr).toFixed(3)+"%":<span style={{color:C.txd}}>—</span>}
      </td>
      <td style={{padding:"6px 8px",fontSize:11,textAlign:"right",fontFamily:"monospace",color:errColor,fontWeight:Math.abs(error||0)>=0.5?700:400}}>
        {error!=null?(error>0?"+":"")+Number(error).toFixed(4):<span style={{color:C.txd}}>—</span>}
      </td>
    </tr>
    {expanded&&<AgencyFloorHistoryPanel canonicalAg={pred.canonical_ag}/>}
  </>;
}

// 티어별 배지 스타일
```

- [ ] **Step 4-2: 빌드 검증**

Run: `npx vite build`
Expected: 성공.

- [ ] **Step 4-3: 커밋**

```
git add src/App.jsx
git commit -m "feat(agency-floor): AgencyFloorRow component"
```

---

## Task 5: AgencyFloorTab 컴포넌트 추가

**Files:**
- Modify: `src/App.jsx` (Task 4에서 추가한 `AgencyFloorRow` 직후)

- [ ] **Step 5-1: AgencyFloorRow 끝에 이어서 AgencyFloorTab 추가**

Find (Task 4 결과의 마지막 부분):

```jsx
    {expanded&&<AgencyFloorHistoryPanel canonicalAg={pred.canonical_ag}/>}
  </>;
}

// 티어별 배지 스타일
```

Replace with:

```jsx
    {expanded&&<AgencyFloorHistoryPanel canonicalAg={pred.canonical_ag}/>}
  </>;
}

// 메인 컨테이너 — 데이터 fetch + 신호 4단계 폴백 + 요약 헤더 + 테이블
function AgencyFloorTab(){
  const [preds,setPreds]=useState(null);
  const [sigRows,setSigRows]=useState([]);
  const [matched,setMatched]=useState({});
  const [expandedId,setExpandedId]=useState(null);
  const [loading,setLoading]=useState(false);

  useEffect(()=>{
    let cancel=false;
    setLoading(true);
    (async()=>{
      const p=await sbFetchAgencyFloorPredictions(500);
      if(cancel)return;
      const filtered=(p||[]).filter(x=>!x.is_cancelled);
      setPreds(filtered);
      const ags=[...new Set(filtered.map(x=>x.canonical_ag).filter(Boolean))];
      const matchedIds=[...new Set(filtered.map(x=>x.matched_record_id).filter(v=>v!=null))];
      const [d,mr]=await Promise.all([
        sbFetchAgencyRateDistribution(ags),
        sbFetchMatchedRecords(matchedIds)
      ]);
      if(cancel)return;
      setSigRows((d&&d.rows)||[]);
      setMatched(mr||{});
      setLoading(false);
    })().catch(()=>{if(!cancel)setLoading(false)});
    return()=>{cancel=true};
  },[]);

  // 신호 매핑 함수 (3단계 폴백: 업종 정확 → 발주사 평균 → 글로벌 중앙값)
  const sigLookup=useMemo(()=>{
    const byKey={};const byAg={};const allMed=[];
    for(const r of sigRows){
      const med=Number(r.median_adj_ratio);
      if(!isFinite(med))continue;
      const k=r.canonical_ag+"|"+(r.cat||"");
      byKey[k]={median:med,n:Number(r.sample_size)||0,confidence:r.confidence,tier:r.tier};
      if(!byAg[r.canonical_ag])byAg[r.canonical_ag]={sum:0,cnt:0,n:0};
      byAg[r.canonical_ag].sum+=med;
      byAg[r.canonical_ag].cnt+=1;
      byAg[r.canonical_ag].n+=Number(r.sample_size)||0;
      allMed.push(med);
    }
    let globalMed=100;
    if(allMed.length){
      const sorted=allMed.slice().sort((a,b)=>a-b);
      globalMed=sorted[Math.floor(sorted.length/2)];
    }
    return function lookup(canonicalAg,cat){
      if(!canonicalAg)return null;
      const k=canonicalAg+"|"+(cat||"");
      const s1=byKey[k];
      if(s1&&(s1.confidence==="high"||s1.confidence==="medium")&&s1.n>=5){
        return{stage:1,median:s1.median,n:s1.n,confidence:s1.confidence};
      }
      const s2=byAg[canonicalAg];
      if(s2&&s2.cnt>0){
        return{stage:2,median:s2.sum/s2.cnt,n:s2.n,confidence:"avg"};
      }
      return{stage:3,median:globalMed,n:allMed.length,confidence:"global"};
    };
  },[sigRows]);

  // 요약 통계 (전체 n / matched / 평균 |오차| / 1pp 적중률)
  const summary=useMemo(()=>{
    if(!preds)return null;
    const n=preds.length;
    const matchedCnt=preds.filter(p=>p.match_status==="matched"&&p.actual_adj_rate!=null).length;
    const errs=[];let hit1=0;
    for(const p of preds){
      if(p.actual_adj_rate==null)continue;
      const sig=sigLookup(p.canonical_ag,p.cat);
      if(!sig)continue;
      const act=100+Number(p.actual_adj_rate);
      const err=Math.abs(sig.median-act);
      if(!isFinite(err))continue;
      errs.push(err);
      if(err<1.0)hit1++;
    }
    return{
      n:n,
      matched:matchedCnt,
      mae:errs.length?(errs.reduce((a,b)=>a+b,0)/errs.length):null,
      hit1pp:errs.length?((hit1/errs.length)*100):null
    };
  },[preds,sigLookup]);

  if(loading||preds==null){
    return<div style={{padding:24,color:C.txd,fontSize:12}}>발주사 하한 예측 데이터 로딩 중...</div>;
  }

  return<div>
    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12,padding:"10px 12px",background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,fontSize:12,flexWrap:"wrap"}}>
      <span style={{fontWeight:700,color:C.gold}}>발주사 하한 예측</span>
      <span style={{color:C.bdr}}>|</span>
      <span>예측 대상 <strong>{summary?summary.n:0}건</strong></span>
      <span style={{color:C.bdr}}>·</span>
      <span>매칭 <strong>{summary?summary.matched:0}건</strong></span>
      {summary&&summary.mae!=null&&<>
        <span style={{color:C.bdr}}>·</span>
        <span>평균 |오차| <strong>{summary.mae.toFixed(4)}pp</strong></span>
      </>}
      {summary&&summary.hit1pp!=null&&<>
        <span style={{color:C.bdr}}>·</span>
        <span>1pp 적중률 <strong>{summary.hit1pp.toFixed(1)}%</strong></span>
      </>}
    </div>
    {preds.length===0?
      <div style={{padding:24,color:C.txd,textAlign:"center",fontSize:12,background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8}}>업로드된 file_upload 예측이 없습니다.</div>
      :
      <table style={{width:"100%",fontSize:11,borderCollapse:"collapse",background:C.bg2,border:"1px solid "+C.bdr,borderRadius:6,overflow:"hidden"}}>
        <thead><tr style={{color:C.txd,background:C.bg3}}>
          <th style={{textAlign:"left",padding:"6px 8px",fontWeight:600}}>개찰일</th>
          <th style={{textAlign:"left",padding:"6px 8px",fontWeight:600}}>발주사 / 업종</th>
          <th style={{textAlign:"right",padding:"6px 8px",fontWeight:600}}>기초(억)</th>
          <th style={{textAlign:"right",padding:"6px 8px",fontWeight:600}}>예측 1위 사정률</th>
          <th style={{textAlign:"right",padding:"6px 8px",fontWeight:600}}>실측 1위 사정률</th>
          <th style={{textAlign:"right",padding:"6px 8px",fontWeight:600}}>낙찰가/기초</th>
          <th style={{textAlign:"right",padding:"6px 8px",fontWeight:600}}>낙찰하한율</th>
          <th style={{textAlign:"right",padding:"6px 8px",fontWeight:600}}>오차(pp)</th>
        </tr></thead>
        <tbody>{preds.map(p=>{
          const sig=sigLookup(p.canonical_ag,p.cat);
          const m=p.matched_record_id?matched[p.matched_record_id]:null;
          return<AgencyFloorRow key={p.id} pred={p} signal={sig} matched={m}
            expanded={expandedId===p.id}
            onToggle={()=>setExpandedId(expandedId===p.id?null:p.id)} />;
        })}</tbody>
      </table>
    }
  </div>;
}

// 티어별 배지 스타일
```

- [ ] **Step 5-2: 빌드 검증**

Run: `npx vite build`
Expected: 성공. 여전히 호출처가 없어 트리쉐이킹 후 무시될 수 있음 — 다음 Task에서 사용 진입.

- [ ] **Step 5-3: 커밋**

```
git add src/App.jsx
git commit -m "feat(agency-floor): AgencyFloorTab container with 3-stage fallback"
```

---

## Task 6: 탭 정의·분기 추가 (UI 진입)

**Files:**
- Modify: `src/App.jsx` (라인 988 부근 Tb 묶음, 라인 2781 부근 chat 탭 분기 직후)

이 Task가 끝나면 실제 사용자가 신규 탭으로 진입 가능.

- [ ] **Step 6-1: 라인 988의 Tb 묶음에 새 탭 버튼 추가**

라인 988에서 다음을 찾는다:

```jsx
<Tb id="chat" ch="AI 상담"/>{isAdmin&&<Tb id="admin" ch="👤 관리자"/>}
```

→ 이를 다음으로 교체한다 (chat 앞에 새 탭 1개 삽입):

```jsx
<Tb id="agency_floor" ch="🎯 발주사 하한"/><Tb id="chat" ch="AI 상담"/>{isAdmin&&<Tb id="admin" ch="👤 관리자"/>}
```

- [ ] **Step 6-2: 마지막 탭 분기 뒤에 새 탭 분기 추가**

라인 2781 부근에서 chat 탭 분기를 찾는다:

Find (라인 2781):
```jsx
    {tab==="chat"&&(()=>{
```

이 라인 직전(다른 탭 분기들과 같은 들여쓰기, admin 라인 2778 바로 다음, chat 라인 2781 바로 앞)에 한 줄을 삽입한다:

Insert between line 2778 (admin) and line 2781 (chat), at the same indentation level:

```jsx
    {tab==="agency_floor"&&<AgencyFloorTab/>}
```

결과 (라인 2778~2781 부근):
```jsx
    {tab==="admin"&&isAdmin&&<AdminTab C={C}/>}

    {tab==="agency_floor"&&<AgencyFloorTab/>}

    {tab==="chat"&&(()=>{
```

(공백 라인은 임의 — 기존 파일 패턴이 빈 줄을 쓰면 맞추고, 안 쓰면 한 줄로 붙여도 됨.)

- [ ] **Step 6-3: 빌드 검증**

Run: `npx vite build`
Expected: 성공. 이제 탭에 들어가는 코드가 활성화됨 — `AgencyFloorTab`이 JSX 트리에 등장.

- [ ] **Step 6-4: 커밋**

```
git add src/App.jsx
git commit -m "feat(agency-floor): wire new tab into App tabbar and tab branch"
```

---

## Task 7: 스모크 테스트 (사용자 진행)

**Files:** 변경 없음 — 동작 검증.

테스트 인프라가 없으므로 (`package.json` 의존성: react/react-dom/xlsx 뿐) 자동 테스트는 작성하지 않고 빌드 + 수동 진입 체크리스트로 마무리한다.

- [ ] **Step 7-1: 빌드 최종 확인**

Run: `npx vite build`
Expected: 성공, 번들 사이즈 증가는 React 함수 컴포넌트 3개 분량(~3KB gzip 이내).

- [ ] **Step 7-2: dev 서버에서 수동 진입 (또는 `npx vite preview`)**

Run: `npx vite preview` (또는 `npx vite`)

브라우저에서 다음 8가지를 확인한다.

체크리스트 (사용자 확인):
- [ ] (a) 탭바에 "🎯 발주사 하한" 버튼이 chat 옆에 등장
- [ ] (b) 클릭하여 진입 — "로딩 중..." 잠깐 후 표가 표시됨
- [ ] (c) 상단 헤더에 `예측 대상 N건 · 매칭 M건 · 평균 |오차| X.XXpp · 1pp 적중률 Y.Y%` 4개 숫자가 나옴
- [ ] (d) 메인 테이블 8개 컬럼 모두 보임 (개찰일·발주사/업종·기초·예측·실측·낙찰가/기초·낙찰하한율·오차)
- [ ] (e) matched 행은 실측 4개 컬럼이 숫자, pending 행은 `—`로 채워짐
- [ ] (f) 예측 신호 옆의 배지가 `[업종·high·n=...]` / `[발주사평균·n=...]` / `[글로벌·n=...]` 중 하나로 나옴 — 모두 1건 이상 등장 (특히 고양시는 글로벌 또는 발주사평균 폴백일 가능성)
- [ ] (g) 행 클릭 시 같은 위치 아래로 펼침 패널이 나오고 "이전 입찰 N건" 표 + 요약 줄이 나옴. 같은 행 다시 클릭 시 닫힘. 다른 행 클릭 시 이전 패널은 닫히고 새 패널이 펼쳐짐.
- [ ] (h) 기존 8개 탭(`대시보드/분석/예측/공고/피드백/검증/AI 상담`, isAdmin이면 `관리자`)로 라운드트립 — 모두 정상 진입·렌더링 (회귀 없음 확인)

- [ ] **Step 7-3: 스모크 통과 후 최종 커밋 (필요 시)**

위 단계에서 추가 수정이 발생했다면:

```
git add src/App.jsx
git commit -m "fix(agency-floor): smoke test followups"
```

수정이 없으면 커밋 추가 없음.

---

## Phase 23-3 게이트 적용 (참고)

이 plan은 모두 통과로 가는 게 정상:
- **Build (2단계)**: 각 Task 끝에 `npx vite build` 확인. `getFinalRecommendation`, `opt_adj`, `pred_bias_map`, 낙찰하한율 함수 일체 미수정 → PostToolUse hook 비트리거.
- **Verify (3단계)**: `/evaluate` 면제 — 기존 예측 산출물 변경 0, 신규 탭은 정보 표시 레이어.
- **Operate (4단계)**: `deploy-gate` 서브에이전트 호출 — 빌드 통과 + 기존 핵심 영역 MAE(한전·고양시·군부대)는 변화 없음(보존 검증).
- **Predict (5단계)**: "확정/제출" 류 액션 없음 — 정책 부합.
