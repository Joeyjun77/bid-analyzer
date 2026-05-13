# 발주처사정율 예측 시스템 V6-B1 — MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** bid-analyzer에 `💎 발주처 예측 V6` 신규 탭을 추가해 사용자가 SUCVIEW/입찰서류함 엑셀을 업로드하면 `predict_with_history()` 호출 → 3-strategy 투찰가 + 부적격 위험을 한 화면에서 확인하게 한다.

**Architecture:** V6-A에서 완성된 5개 테이블·8개 RPC·2개 트리거 그대로 사용. 신규 fetch 헬퍼 4개를 `src/lib/supabase.js`에 append, `src/lib/utils.js`에 `amountTierOf` 한 줄 추가, `src/components/AgencyPredictorTab.jsx` 단독 파일에 컴포넌트 2개(메인+행), `src/App.jsx`에 import+Tb+분기 3곳 수정. App.jsx 본문 비대를 피하기 위해 컴포넌트는 별도 파일. 신규 의존성 0(기존 react/react-dom/xlsx만).

**Tech Stack:** React 18 (이미 사용), `xlsx` (이미 사용), Supabase REST + `authedFetch` (기존 패턴). 자세한 설계 근거는 `docs/superpowers/specs/2026-05-13-agency-predictor-v6b1-mvp-design.md`.

---

## 사전 컨벤션 (모든 Task 공통)

- Windows PowerShell 환경. CRLF 경고는 무시.
- 각 Task 끝의 빌드는 `npx vite build` (CLAUDE.md 규약).
- 커밋 메시지 prefix는 `feat(agency-predictor-v6b1):` 또는 `chore(agency-predictor-v6b1):`로 통일.
- 코드 스타일: `src/lib/supabase.js`는 기존 한 줄 함수 다수 패턴. JSX는 가독성을 위해 풀어 써도 무방하나 `style={{...}}` inline 스타일은 유지.
- 색상 토큰: `C.bg2`(메인 패널), `C.bg3`(헤더), `C.bdr`(테두리), `C.gold`(강조), `C.txt`/`C.txm`/`C.txd`(텍스트 강·중·약). `import { C, PAGE, inpS } from "./lib/constants.js"`.
- DB 객체 변경 0 — V6-A 완료된 5개 테이블·8개 RPC·2개 트리거 그대로 사용.
- Phase 23-3 게이트: src/* 변경 → 4단계에서 `deploy-gate` 서브에이전트 호출. `getFinalRecommendation`/`opt_adj`/`pred_bias_map`/낙찰하한율 함수 일체 미수정 → PostToolUse hook 비트리거. `/evaluate` 면제(기존 `bid_predictions.opt_adj` 변경 0).

---

## File Structure (변경 매트릭스)

| 파일 | 변경 유형 | 책임 |
|---|---|---|
| `src/lib/supabase.js` | append only | 신규 fetch 헬퍼 4개(`sbCallPredictWithHistory`, `sbBatchInsertBidHistoryUpload`, `sbBatchInsertBidPredictionsV3`, `sbFetchAgencyPredictionsV3`). 기존 함수 한 줄도 수정 안 함 |
| `src/lib/utils.js` | append only | `amountTierOf(numeric)→TEXT` 한 줄 추가 (DB `amount_tier_of` JS 사본) |
| `src/components/AgencyPredictorTab.jsx` | 신규 | 메인 탭 컨테이너 + `AgencyPredictorRow` 행 컴포넌트 |
| `src/App.jsx` | 수정 3곳 | (a) import 확장, (b) Tb 묶음에 새 탭 1개, (c) 탭 분기에 `<AgencyPredictorTab/>` |
| `src/lib/constants.js`, `src/lib/probability.js`, `src/auth.js` | 변경 없음 | — |
| DB 객체 | 변경 없음 | — |

---

## Task 1: supabase.js — fetch 헬퍼 4개 추가

**Files:**
- Modify: `src/lib/supabase.js` (파일 끝에 append)

**Why this task first:** 컴포넌트가 호출할 모든 데이터 fetch를 먼저 갖춰 둠. 빌드는 통과해야 하나 호출처가 없어 트리쉐이킹 후 무시될 수 있음.

- [ ] **Step 1-1: 파일 끝에 헬퍼 4개 append**

`src/lib/supabase.js` 최하단(마지막 함수 뒤)에 아래 블록 그대로 추가:

```js


// ─── V6-B1: 발주처 예측 탭 (2026-05-13) ──────────────────────
// 디자인 문서: docs/superpowers/specs/2026-05-13-agency-predictor-v6b1-mvp-design.md
// 4개 헬퍼: (1) predict_with_history RPC, (2) bid_history file_upload 일괄 INSERT,
//          (3) bid_predictions_v3 일괄 INSERT, (4) 최근 예측 조회.

// (1) predict_with_history RPC 호출 — 행 1건당
export async function sbCallPredictWithHistory({bid_no,canonical_ag,industry,base_amount,a_value,floor_rate}){
  try{
    const body=JSON.stringify({
      p_bid_no:bid_no,p_canonical_ag:canonical_ag,p_industry:industry,
      p_base_amount:base_amount,p_a_value:a_value,p_floor_rate:floor_rate
    });
    const res=await authedFetch("/rest/v1/rpc/predict_with_history",{method:"POST",headers:JSON_H,body});
    if(!res.ok)return null;
    const rows=await res.json();
    return Array.isArray(rows)&&rows[0]?rows[0]:null;
  }catch(e){return null}
}

// (2) bid_history file_upload 일괄 INSERT — UNIQUE (bid_no, source) ON CONFLICT DO NOTHING
//     rows: [{bid_no,ag,industry,opened_at,base_amount,a_value,floor_rate,notice_title,contract_method}]
export async function sbBatchInsertBidHistoryUpload(rows){
  if(!rows||!rows.length)return;
  const BATCH=100;
  for(let i=0;i<rows.length;i+=BATCH){
    const batch=rows.slice(i,i+BATCH).map(r=>({...r,source:"file_upload"}));
    const body=sanitizeJson(JSON.stringify(batch));
    await authedFetch("/rest/v1/bid_history?on_conflict=bid_no,source",{
      method:"POST",
      headers:{...JSON_H,"Prefer":"resolution=merge-duplicates,return=minimal"},
      body
    });
  }
}

// (3) bid_predictions_v3 일괄 INSERT — model_version DEFAULT 'v3.0' (DB 측)
export async function sbBatchInsertBidPredictionsV3(rows){
  if(!rows||!rows.length)return;
  const BATCH=50;
  for(let i=0;i<rows.length;i+=BATCH){
    const batch=rows.slice(i,i+BATCH);
    const body=sanitizeJson(JSON.stringify(batch));
    const res=await authedFetch("/rest/v1/bid_predictions_v3",{
      method:"POST",
      headers:{...JSON_H,"Prefer":"return=minimal"},
      body
    });
    if(!res.ok)throw new Error(`bpv3 INSERT: ${res.status}`);
  }
}

// (4) 최근 예측 조회 — 탭 진입 시 첫 표시
export async function sbFetchAgencyPredictionsV3(limit=200){
  try{
    const cols="id,bid_no,canonical_ag,industry,amount_tier,base_amount,"
      +"predicted_ratio,predicted_floor_amount,"
      +"strategy_aggressive_bid,strategy_balanced_bid,strategy_safe_bid,"
      +"aggressive_margin,balanced_margin,safe_margin,"
      +"disq_risk_aggressive,disq_risk_balanced,disq_risk_safe,"
      +"confidence_tier,signal_stage,sample_size_used,model_version,"
      +"match_status,actual_ratio,result,created_at";
    const res=await authedFetch(
      "/rest/v1/bid_predictions_v3?select="+cols
      +"&order=created_at.desc&limit="+limit
    );
    if(!res.ok)return[];
    const rows=await res.json();
    return Array.isArray(rows)?rows:[];
  }catch(e){return[]}
}
```

- [ ] **Step 1-2: 빌드 검증**

Run: `npx vite build`
Expected: `built in ...ms` 성공. 호출처가 없어도 export만 늘어남.

- [ ] **Step 1-3: 커밋**

```
git add src/lib/supabase.js
git commit -m "feat(agency-predictor-v6b1): add 4 fetch helpers (predict RPC, bid_history upload, bpv3 batch insert, predictions fetch)"
```

---

## Task 2: utils.js — `amountTierOf` 한 줄 추가

**Files:**
- Modify: `src/lib/utils.js` (export 그룹 안에 한 줄 추가)

- [ ] **Step 2-1: `pDt` 함수 직후에 추가**

`src/lib/utils.js`의 `pDt` 함수 정의 끝(`return null}`로 끝나는 라인) 바로 다음에 한 줄 추가:

```js
// V6-B1: DB amount_tier_of() 의 JS 사본 — bid_predictions_v3.amount_tier INSERT용
export function amountTierOf(amt){const n=Number(amt);if(!isFinite(n))return null;if(n<1e8)return"~1억";if(n<3e8)return"1억~3억";if(n<5e8)return"3억~5억";if(n<1e9)return"5억~10억";if(n<3e9)return"10억~30억";return"30억~"}
```

- [ ] **Step 2-2: 빌드 검증**

Run: `npx vite build`
Expected: 성공. 호출처 없어도 export 추가만.

- [ ] **Step 2-3: 단위 검증 (브라우저 콘솔 또는 임시 인라인)** — 선택

수동 확인용 (필수 아님):
```js
// 예상: null, "~1억", "1억~3억", "5억~10억", "30억~"
amountTierOf(null);amountTierOf(50e6);amountTierOf(250e6);amountTierOf(656e6);amountTierOf(5e9);
```

- [ ] **Step 2-4: 커밋**

```
git add src/lib/utils.js
git commit -m "feat(agency-predictor-v6b1): add amountTierOf() — JS copy of DB amount_tier_of()"
```

---

## Task 3: AgencyPredictorTab.jsx — 컴포넌트 스켈레톤 + 데이터 로딩

**Files:**
- Create: `src/components/AgencyPredictorTab.jsx`

**Why this order:** 탭 본체를 먼저 만들고 다음 Task에서 App.jsx와 연결. 컴포넌트가 호출하는 fetch는 Task 1에서 이미 export됨.

- [ ] **Step 3-1: 파일 생성 — fetch 로딩 + 테이블 스켈레톤만 (업로드·예측·요약은 후속 Task)**

`src/components/AgencyPredictorTab.jsx` 신규 생성:

```jsx
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
```

- [ ] **Step 3-2: 빌드 검증**

Run: `npx vite build`
Expected: 성공. 컴포넌트가 어디서도 import 안 되어 트리쉐이킹.

- [ ] **Step 3-3: 커밋**

```
git add src/components/AgencyPredictorTab.jsx
git commit -m "feat(agency-predictor-v6b1): AgencyPredictorTab skeleton + AgencyPredictorRow (9-col table)"
```

---

## Task 4: App.jsx — import + Tb + 탭 분기 (3곳 수정)

**Files:**
- Modify: `src/App.jsx` (라인 10 import 부근, Tb 묶음 라인 988 부근, 탭 분기 라인 2781 부근)

**Why this order:** 컴포넌트가 준비됐으니 탭으로 진입 가능하게 연결. 이 Task 끝나면 새 탭에 진입 가능 (단, 파일 업로드/일괄 예측은 후속 Task).

- [ ] **Step 4-1: 컴포넌트 import 추가 (App.jsx 최상단 부근, 다른 component import 옆)**

기존 import 묶음에서 `WinStrategyDashboard` 또는 `AdminTab` import가 있는 위치를 찾아 그 옆에 한 줄 추가:

```jsx
import AgencyPredictorTab from "./components/AgencyPredictorTab.jsx";
```

(이미 `src/components/` 폴더에서 `AdminTab.jsx`, `NoticesTab.jsx`, `AuthGate.jsx`, `PredictionFeedback.jsx`가 import되어 있으므로 같은 그룹에 삽입)

- [ ] **Step 4-2: 라인 988 부근 Tb 묶음에 새 탭 1개 추가**

라인 988에서 다음을 찾는다:
```jsx
<Tb id="chat" ch="AI 상담"/>{isAdmin&&<Tb id="admin" ch="👤 관리자"/>}
```

→ 이를 다음으로 교체한다 (chat 앞에 새 탭 1개 삽입):
```jsx
<Tb id="agency_predict_v6" ch="💎 발주처 예측 V6"/><Tb id="chat" ch="AI 상담"/>{isAdmin&&<Tb id="admin" ch="👤 관리자"/>}
```

(만약 V1 `🎯 발주사 하한` 탭이 이미 추가되어 있다면 그 옆에 삽입. 둘 다 새 탭이지만 다른 변수를 예측하므로 공존)

- [ ] **Step 4-3: 탭 분기 추가 (라인 2781 부근 chat 탭 분기 직전)**

라인 2781 부근에서 `{tab==="chat"&&(()=>{` 라인을 찾는다.

이 라인 직전에 새 탭 분기 한 줄 삽입:
```jsx
    {tab==="agency_predict_v6"&&<AgencyPredictorTab/>}
```

다른 탭 분기들과 동일한 들여쓰기 유지.

- [ ] **Step 4-4: 빌드 검증**

Run: `npx vite build`
Expected: 성공. 이제 탭바에 새 탭이 보이고 클릭 시 진입 가능.

- [ ] **Step 4-5: 수동 진입 스모크 (선택, dev 서버)**

Run: `npx vite preview` (또는 `npx vite`)

브라우저에서 확인:
- 탭바에 `💎 발주처 예측 V6` 등장
- 클릭 시 로딩 후 "예측 결과가 없습니다" 또는 V6-A에서 smoke로 INSERT됐다가 cleanup된 영향으로 0건 표시
- 기존 8개 탭 모두 정상 라운드트립

- [ ] **Step 4-6: 커밋**

```
git add src/App.jsx
git commit -m "feat(agency-predictor-v6b1): wire new tab into App tabbar and tab branch"
```

---

## Task 5: 파일 업로드 + 파싱 핸들러 추가

**Files:**
- Modify: `src/components/AgencyPredictorTab.jsx`

기존 `parseFile`, `parseSucview`, `parseBidDoc`, `isSucviewFile`, `normalizeAgencyName`, `clsAg`, `eraFR`, `clean`, `pDt`, `sn`, `pnv`, `amountTierOf`를 utils.js에서 import해 활용.

- [ ] **Step 5-1: 파일 상단 import 확장**

`src/components/AgencyPredictorTab.jsx` 최상단의 import 묶음을:
```jsx
import { useState, useEffect } from "react";
import { C } from "../lib/constants.js";
import { sbFetchAgencyPredictionsV3 } from "../lib/supabase.js";
```

다음으로 교체:
```jsx
import { useState, useEffect } from "react";
import { C } from "../lib/constants.js";
import { sbFetchAgencyPredictionsV3, sbBatchInsertBidHistoryUpload, sbCallPredictWithHistory, sbBatchInsertBidPredictionsV3 } from "../lib/supabase.js";
import { parseFile, parseSucview, parseBidDoc, isSucviewFile, normalizeAgencyName, clsAg, eraFR, clean, pDt, sn, pnv, amountTierOf } from "../lib/utils.js";
```

- [ ] **Step 5-2: 파일 → 입력 행 변환 함수 추가**

`tierBadgeStyle` 함수 직후, `AgencyPredictorRow` 함수 직전에 추가:

```jsx
// V6-B1: SUCVIEW/입찰서류함 파싱 결과 → predict_with_history 입력 행으로 변환
// 반환: {validInputs:[{bid_no,ag,canonical_ag,industry,base_amount,a_value,floor_rate,opened_at,notice_title,contract_method}], skipReasons:[{bid_no,reason}]}
function toPredictInputs(parsedRows,sourceType){
  const validInputs=[],skipReasons=[];
  for(const r of parsedRows){
    if(!r||typeof r!=="object")continue;
    // sourceType에 따라 컬럼 매핑이 다름 — parseSucview/parseBidDoc은 이미 정규화된 객체를 반환
    const bid_no=clean(r.pn_no||r.bid_no||"");
    if(!bid_no){skipReasons.push({bid_no:"(empty)",reason:"공고번호 없음"});continue;}
    const ag=clean(r.ag||"");
    if(!ag){skipReasons.push({bid_no,reason:"발주사명 없음"});continue;}
    const ba=Number(r.ba||0);
    if(!isFinite(ba)||ba<=0){skipReasons.push({bid_no,reason:"기초금액 없음/0"});continue;}
    const av=Number(r.av||0);
    const ep=Number(r.ep||0);
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
async function processFile(file){
  const {rows}=await parseFile(file);
  if(isSucviewFile(rows)){
    const parsed=parseSucview(rows,file.name);
    return{type:"SUCVIEW",rows:parsed.records||parsed||[]};
  }
  // 입찰서류함 가정 (헤더 동적 매핑)
  const parsed=parseBidDoc(rows);
  if(parsed&&parsed.records&&parsed.records.length){
    return{type:"BIDDOC",rows:parsed.records};
  }
  // 낙찰정보리스트 가능성 → 차단
  if(rows[0]&&String(rows[0][1]||"").includes("공고명")){
    throw new Error("낙찰정보리스트는 데이터탭에 업로드해주세요");
  }
  throw new Error("인식 불가 파일 형식");
}
```

- [ ] **Step 5-3: `AgencyPredictorTab` 안에 업로드 핸들러 + 진행 상태 추가**

`AgencyPredictorTab` 본체에서 기존 state 부분을:
```jsx
  const [preds,setPreds]=useState(null);
  const [loading,setLoading]=useState("idle");
```

다음으로 교체:
```jsx
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
```

- [ ] **Step 5-4: 업로드 UI 추가 (요약 헤더 직후)**

`AgencyPredictorTab`의 return JSX 첫 `<div>` 직후, 요약 헤더 다음에 업로드 영역 추가. 요약 헤더 블록 직후 `{preds.length===0?` 라인 직전:

```jsx
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
```

- [ ] **Step 5-5: 빌드 검증**

Run: `npx vite build`
Expected: 성공.

- [ ] **Step 5-6: 수동 진입 스모크 (선택)**

dev 서버에서 파일 선택 → parseLogs에 성공 메시지 표시, pendingInputs.length 갱신 확인. 예측 시작은 다음 Task.

- [ ] **Step 5-7: 커밋**

```
git add src/components/AgencyPredictorTab.jsx
git commit -m "feat(agency-predictor-v6b1): file upload + SUCVIEW/입찰서류함 parsing + parse logs"
```

---

## Task 6: 일괄 예측 핸들러 + Promise pool + bpv3 INSERT

**Files:**
- Modify: `src/components/AgencyPredictorTab.jsx`

- [ ] **Step 6-1: 일괄 예측 핸들러 추가**

`handleFileUpload` 함수 직후, `useEffect` 직전에 추가:

```jsx
  async function handleBatchPredict(){
    if(!pendingInputs.length)return;
    setLoading("predicting");
    setProgress({done:0,total:pendingInputs.length});

    // 1) bid_history file_upload 일괄 INSERT (예측 호출 직전 — 매칭/감사 추적용)
    try{
      await sbBatchInsertBidHistoryUpload(pendingInputs.map(i=>({
        bid_no:i.bid_no, ag:i.ag, canonical_ag:i.canonical_ag,
        industry:i.industry, opened_at:i.opened_at, base_amount:i.base_amount,
        a_value:i.a_value, floor_rate:i.floor_rate,
        notice_title:i.notice_title, contract_method:i.contract_method
      })));
    }catch(e){
      // history INSERT 실패는 치명적 아님 (예측은 진행 가능). 로그만.
      console.warn("bid_history upload INSERT failed:",e);
    }

    // 2) Promise pool (concurrency=5) — 행마다 predict_with_history 호출
    const results=[],errors=[];
    const CONCURRENCY=5;
    let cursor=0,done=0;
    async function worker(){
      while(cursor<pendingInputs.length){
        const idx=cursor++;
        const input=pendingInputs[idx];
        try{
          const r=await sbCallPredictWithHistory({
            bid_no:input.bid_no, canonical_ag:input.canonical_ag,
            industry:input.industry, base_amount:input.base_amount,
            a_value:input.a_value||0, floor_rate:input.floor_rate
          });
          if(r){
            results.push({input,output:r});
          }else{
            errors.push({input,reason:"RPC null"});
          }
        }catch(e){
          errors.push({input,reason:e.message||"RPC error"});
        }
        done++;
        setProgress({done,total:pendingInputs.length});
      }
    }
    const workers=[];
    for(let i=0;i<Math.min(CONCURRENCY,pendingInputs.length);i++)workers.push(worker());
    await Promise.all(workers);

    // 3) bid_predictions_v3 일괄 INSERT
    setLoading("saving");
    const insertRows=results.map(({input,output})=>({
      bid_no:input.bid_no,
      canonical_ag:input.canonical_ag,
      industry:input.industry,
      amount_tier:amountTierOf(input.base_amount),
      base_amount:input.base_amount,
      a_value:input.a_value,
      floor_rate:input.floor_rate,
      predicted_ratio:output.predicted_ratio,
      predicted_floor_amount:output.predicted_floor_amount,
      aggressive_margin:output.aggressive_margin,
      balanced_margin:output.balanced_margin,
      safe_margin:output.safe_margin,
      strategy_aggressive_bid:output.aggressive_bid,
      strategy_balanced_bid:output.balanced_bid,
      strategy_safe_bid:output.safe_bid,
      disq_risk_aggressive:output.disq_risk_aggressive,
      disq_risk_balanced:output.disq_risk_balanced,
      disq_risk_safe:output.disq_risk_safe,
      confidence_tier:output.confidence_tier,
      signal_stage:output.signal_stage,
      sample_size_used:output.sample_size_used
    }));
    if(insertRows.length){
      try{
        await sbBatchInsertBidPredictionsV3(insertRows);
      }catch(e){
        console.error("bpv3 INSERT failed:",e);
      }
    }

    // 4) 결과 재조회 + 상태 초기화
    const rows=await sbFetchAgencyPredictionsV3(200);
    setPreds(rows||[]);
    setPendingInputs([]);
    setProgress({done:0,total:0});
    setLoading("idle");

    // 5) 에러 로그를 parseLogs에 한 줄 추가
    if(errors.length){
      setParseLogs(prev=>[...prev,{name:"(예측 실패)",ok:false,msg:`${errors.length}건 RPC 실패 — 건너뜀`}]);
    }
  }
```

- [ ] **Step 6-2: 업로드 영역에 "예측 시작" 버튼 추가**

업로드 영역 div 안에 (Task 5-4에서 추가한 div) `pendingInputs.length>0` 조건 블록 직후 버튼 추가:

기존 (Task 5-4 결과):
```jsx
      {pendingInputs.length>0&&<>
        <span style={{color:C.bdr}}>|</span>
        <span><strong>{pendingInputs.length}건</strong> 대기</span>
      </>}
      {loading==="parsing"&&<span style={{color:C.gold}}>파싱 중...</span>}
```

→ 다음으로 교체:
```jsx
      {pendingInputs.length>0&&<>
        <span style={{color:C.bdr}}>|</span>
        <span><strong>{pendingInputs.length}건</strong> 대기</span>
        <button onClick={handleBatchPredict} disabled={loading!=="idle"}
          style={{padding:"6px 14px",background:C.gold,color:"#000",border:"none",borderRadius:6,fontWeight:700,cursor:loading==="idle"?"pointer":"not-allowed",opacity:loading==="idle"?1:0.6}}>
          ▶ 일괄 예측 시작
        </button>
      </>}
      {loading==="parsing"&&<span style={{color:C.gold}}>파싱 중...</span>}
      {loading==="predicting"&&<span style={{color:C.gold}}>예측 중... {progress.done}/{progress.total}</span>}
      {loading==="saving"&&<span style={{color:C.gold}}>저장 중...</span>}
```

- [ ] **Step 6-3: 빌드 검증**

Run: `npx vite build`
Expected: 성공.

- [ ] **Step 6-4: 커밋**

```
git add src/components/AgencyPredictorTab.jsx
git commit -m "feat(agency-predictor-v6b1): batch predict handler (concurrency 5 + bpv3 INSERT)"
```

---

## Task 7: 요약 헤더 통계 강화

**Files:**
- Modify: `src/components/AgencyPredictorTab.jsx`

- [ ] **Step 7-1: 요약 통계 useMemo 추가 + JSX 갱신**

`AgencyPredictorTab` 함수 내부의 `if(preds==null){...}` 직전에 추가:

```jsx
  // 요약 통계 (클라이언트 집계)
  const summary=preds?(()=>{
    const n=preds.length;
    if(n===0)return{n:0,avgDisqB:null,stage1:0,stage2:0,stage3:0};
    let disqSum=0,disqCnt=0,s1=0,s2=0,s3=0;
    for(const p of preds){
      const d=Number(p.disq_risk_balanced);
      if(isFinite(d)){disqSum+=d;disqCnt++;}
      if(p.signal_stage===1)s1++;
      else if(p.signal_stage===2)s2++;
      else if(p.signal_stage===3)s3++;
    }
    return{n,avgDisqB:disqCnt?disqSum/disqCnt:null,stage1:s1,stage2:s2,stage3:s3};
  })():null;
```

그리고 기존 요약 헤더 JSX:
```jsx
    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12,padding:"10px 12px",background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,fontSize:12,flexWrap:"wrap"}}>
      <span style={{fontWeight:700,color:C.gold}}>💎 발주처 예측 V6</span>
      <span style={{color:C.bdr}}>|</span>
      <span>예측 대상 <strong>{preds.length}건</strong></span>
      <span style={{color:C.bdr}}>·</span>
      <span style={{color:C.txd}}>파일 업로드 + 일괄 예측은 후속 Task에서 추가됩니다</span>
    </div>
```

→ 다음으로 교체:
```jsx
    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12,padding:"10px 12px",background:C.bg2,border:"1px solid "+C.bdr,borderRadius:8,fontSize:12,flexWrap:"wrap"}}>
      <span style={{fontWeight:700,color:C.gold}}>💎 발주처 예측 V6</span>
      <span style={{color:C.bdr}}>|</span>
      <span>예측 대상 <strong>{summary?summary.n:0}건</strong></span>
      {summary&&summary.avgDisqB!=null&&<>
        <span style={{color:C.bdr}}>·</span>
        <span>평균 부적격(균형) <strong>{(summary.avgDisqB*100).toFixed(1)}%</strong></span>
      </>}
      {summary&&summary.n>0&&<>
        <span style={{color:C.bdr}}>·</span>
        <span>단계 1/2/3 = <strong>{summary.stage1}/{summary.stage2}/{summary.stage3}</strong></span>
      </>}
      <span style={{color:C.bdr}}>·</span>
      <span style={{color:C.txd}}>v3.0</span>
    </div>
```

- [ ] **Step 7-2: 빌드 검증**

Run: `npx vite build`
Expected: 성공.

- [ ] **Step 7-3: 커밋**

```
git add src/components/AgencyPredictorTab.jsx
git commit -m "feat(agency-predictor-v6b1): summary header stats (count, avg disq, stage distribution)"
```

---

## Task 8: 스모크 테스트 (사용자 수행)

**Files:** 변경 없음 — 수동 검증.

자동 테스트 인프라가 없으므로(`package.json` 의존성: `react/react-dom/xlsx`만) 빌드 + 수동 진입 체크리스트로 마무리.

- [ ] **Step 8-1: 최종 빌드 확인**

Run: `npx vite build`
Expected: 성공. 번들 사이즈 증가는 컴포넌트 1개 + 헬퍼 4개 분량(~5KB gzip 이내).

- [ ] **Step 8-2: dev 서버 또는 preview에서 수동 검증**

Run: `npx vite preview` (또는 `npx vite`)

브라우저에서 다음 9가지 확인 (체크리스트, 사용자 진행):
- [ ] (a) 탭바에 `💎 발주처 예측 V6` 등장
- [ ] (b) 탭 진입 시 로딩 후 마지막 예측 ≥ 0건 표시 (첫 사용 시 0건도 OK)
- [ ] (c) 상단 헤더에 `예측 대상 N건 · 평균 부적격(균형) X.X% · 단계 1/2/3 = a/b/c · v3.0` 표시 (N>0일 때)
- [ ] (d) 파일 업로드 영역의 `📁 파일 선택` 클릭 → SUCVIEW 또는 입찰서류함 엑셀 선택
- [ ] (e) parseLogs에 `파일명: SUCVIEW · 성공 N건 · 스킵 M건` 형식 메시지 표시
- [ ] (f) `▶ 일괄 예측 시작` 클릭 → 진행률 `예측 중... a/b` 표시
- [ ] (g) 완료 후 결과 행 9컬럼 표시 (개찰일·발주사/업종·기초·예측사정율·공격·균형·안전·부적격·신뢰)
- [ ] (h) 부적격 색상 룰 작동 (≥0.40 빨강, ≥0.20 주황, 그 외 회색) — 적어도 1개 행에 색상 적용 확인
- [ ] (i) 신뢰 배지 high/medium/low/insufficient 중 ≥ 2종류 등장 (1단계 매치 + 글로벌 폴백 혼합 케이스)
- [ ] (j) 같은 파일 재업로드 시 → `pendingInputs` 갱신 후 `▶ 일괄 예측 시작` → bid_history 중복 차단 OK, bid_predictions_v3는 새 행 추가됨 (`SELECT COUNT(*) FROM bid_predictions_v3` 직전·직후 비교)
- [ ] (k) 기존 8개 탭(대시보드/분석/예측/공고/피드백/검증/AI 상담/관리자) 라운드트립 — 모두 정상 진입·렌더링 (회귀 0)

- [ ] **Step 8-3: 스모크 통과 후 fix가 있다면 추가 커밋, 없으면 끝**

수정이 발생했다면:
```
git add src/components/AgencyPredictorTab.jsx
git commit -m "fix(agency-predictor-v6b1): smoke test followups"
```

수정 없으면 추가 커밋 없음.

---

## Task 9: V6-B1 완료 게이트 + deploy-gate 호출

**Files:** 변경 없음 — 운영 검증.

V6-A와 달리 V6-B1은 src/* 변경이 있어 Vercel 자동 배포가 트리거됨. Phase 23-3 4단계 게이트 적용 필요.

- [ ] **Step 9-1: V6-B1 완료 정의 확인**

다음을 모두 만족하면 V6-B1 완료:
- [ ] `npx vite build` 통과
- [ ] 새 탭 `💎 발주처 예측 V6` 탭바에 보임
- [ ] sbFetchAgencyPredictionsV3 호출 정상 (network 탭에서 200)
- [ ] 파일 업로드 → 일괄 예측 → bpv3 INSERT 사이클 1회 이상 성공
- [ ] 기존 8개 탭 회귀 0

- [ ] **Step 9-2: deploy-gate 서브에이전트 호출 (또는 사용자 확인 후 git push)**

```
Agent 호출 (subagent_type: deploy-gate)
prompt: "V6-B1 메인 탭(💎 발주처 예측 V6) main 푸시 직전 통합 게이트. 빌드 + 핵심 영역 MAE(한전·고양시·군부대) 보존 + evaluate_model_release 무회귀 확인. 본 변경은 신규 컴포넌트 + 신규 fetch 헬퍼만이며 getFinalRecommendation/opt_adj/pred_bias_map/낙찰하한율 함수 일체 미수정 — 회귀 위험 0 예상."
```

`deploy-gate`가 PASS 판정 시 push.

- [ ] **Step 9-3: git push**

```
git pull --rebase origin main
git push origin main
```

CLAUDE.md 규약대로 pull --rebase 먼저. Vercel 자동 배포가 2-3분 후 발생.

- [ ] **Step 9-4: 배포 후 24시간 내 검증 (deploy-gate가 WARN/PASS 이상이면)**

24시간 후 또는 다음 세션에서 `/accuracy` 슬래시 커맨드로 핵심 영역 MAE 재측정. WARN 판정이었으면 필수.

---

## Phase 23-3 게이트 적용 (참고)

| 단계 | V6-B1 적용 |
|---|---|
| 1. Design | spec 완료. `predict-architect` 면제 — 신규 변수 예측, 기존 `opt_adj` 미수정 |
| 2. Build | `src/components/AgencyPredictorTab.jsx` 신규 + `src/lib/supabase.js` append + `src/lib/utils.js` 1줄 + `src/App.jsx` 3곳. `getFinalRecommendation`/`opt_adj`/`pred_bias_map`/낙찰하한율 함수 미수정 → PostToolUse hook 비트리거 |
| 3. Verify | `/evaluate` 면제 — 기존 `bid_predictions.opt_adj` 변경 0. V6-B1 자체 KPI는 V6-B4에서 별도 트래킹 |
| 4. Operate | `deploy-gate` 호출(Task 9). 빌드 + 핵심 영역 MAE 보존 검증 |
| 5. Predict | 본 탭은 정보 제공 + bpv3 자동 INSERT만. "확정/제출" 류 액션 없음 ✓ |

---

## V6-B2 진입 조건 (V6-B1 완료 정의)

- 모든 Task 1-9 완료
- 새 탭 정상 동작
- bid_predictions_v3에 사용자 첫 일괄 예측 결과 ≥ 1건 영구 저장
- 기존 시스템 회귀 0

V6-B2 (외부 인포나·낙찰정보 임포트) 진입 가능.

---

## V6-B1 완료 후 보류된 결정 (V6-B2 시작 시 처리)

- `parseInfonaFile.js`·`parseAwardListFile.js` 신규 작성
- bid_history 외부 source('infona', 'external_award') 누적 → recalibrate 자동 트리거
- recalibrate outlier 필터 (`price_ratio BETWEEN 70 AND 130`) 도입 검토
- 자사 사업자번호 매칭 (V6-D)
- 결과 매칭 RPC `auto_match_predictions` (V6-D)
- `parseBidDoc`/`parseSucview` 반환 객체 구조 정확 명세 — Task 5에서 `r.pn_no`/`r.ag`/`r.ba` 등을 가정했으나 실제 반환 키 이름이 다를 수 있음. V6-B1 스모크에서 확인 후 Task 5-2 매핑 보정 필요 가능
