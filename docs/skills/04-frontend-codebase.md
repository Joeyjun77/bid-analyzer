# 프론트엔드 코드베이스 — App.jsx 구조 & UI
> React 18 + Vite. 모든 UI 컴포넌트가 src/App.jsx 단일 파일 (1,745줄)
> 표기 규칙, 색상 시스템, 컴포넌트 카탈로그, 탭 구조

## 파일 분리 원칙

이 시스템은 **의도적으로 단일 App.jsx**를 유지합니다. 이유:
- 컴포넌트 간 상태 공유가 많아 분리 시 prop drilling 폭증
- 1700줄은 단일 파일로 충분히 관리 가능한 수준
- Vite HMR이 단일 파일에서 가장 빠름

분리는 **utils.js** (순수 함수)와 **supabase.js** (REST API)로만.

## 표기 규칙 (절대 원칙)

### 사정률 표기는 100% 기준

```javascript
// ✅ 올바른 표기
{(100 + Number(adj)).toFixed(4) + "%"}  // 99.7800%
fmtP100(adj)                              // 99.780%

// ❌ 잘못된 표기 (사용자 화면에 노출 금지)
{adj.toFixed(4) + "%"}                    // -0.2200% (0-base)
```

### 헬퍼 함수 (App.jsx 상단 정의)

```javascript
// 0-base → 100-base 변환
function toP100(adj0) {
  return adj0 == null ? null : (100 + Number(adj0));
}

// 100-base 포맷팅
function fmtP100(adj0, decimals = 3) {
  const v = toP100(adj0);
  if (v == null || isNaN(v)) return "-";
  return v.toFixed(decimals) + "%";
}
```

### 모든 사정률 라벨에 "(100%)" 명시
- "추천 사정률(100%)"
- "실제 1위 사정률(100%)"
- "예측 사정률(100%)"
- "기관 통계 평균(100%)"

AI 프롬프트에도 100% 표기 적용 (`buildAiPrompt`, `buildChatSystem`).

## 색상 시스템

```javascript
const C = {
  bg:  "#0c0c1a",   // 페이지 배경 (다크)
  bg2: "#12122a",   // 카드 배경 (1단계 위)
  bg3: "#1a1a30",   // 박스 배경 (2단계 위)
  txt: "#e8e8f0",   // 본문 텍스트
  txm: "#a0a0b8",   // 보조 텍스트
  txd: "#666680",   // 흐린 텍스트
  bdr: "#252540",   // 보더
  gold: "#d4a834"   // 강조 색
};

// 시맨틱 색상
"#5dca96"  // 녹색 (정상, 성공)
"#e24b4a"  // 빨강 (오류, 위험)
"#d4a834"  // 금색 (중요, 강조)
"#a8b4ff"  // 보라 (상세, 시뮬레이션)
"#85b7eb"  // 파랑 (투찰율, 정보)
```

### Phase 12-C 티어 색상

```javascript
const TIER_STYLES = {
  1: {emoji: "🏆", label: "P1", color: "#e24b4a", bg: "rgba(226,75,74,0.12)", border: "#e24b4a"},
  2: {emoji: "⭐", label: "P2", color: "#ff9933", bg: "rgba(255,153,51,0.10)", border: "#ff9933"},
  3: {emoji: "📊", label: "P3", color: "#5b9dd9", bg: "rgba(91,157,217,0.08)", border: "#5b9dd9"},
  4: {emoji: "⚠️", label: "P4", color: "#a8a8ff", bg: "rgba(168,168,255,0.06)", border: "#a8a8ff"},
  5: {emoji: "⛔", label: "P5", color: "#666680", bg: "rgba(102,102,128,0.06)", border: "#666680"}
};
```

## 탭 구조

| 탭 | id | 용도 |
|---|---|---|
| 대시보드 | `dash` | 데이터 현황, 기관유형 통계, 신선도 |
| 분석 | `analysis` | 사정률 분포, 발주사 검색, 전체 데이터 테이블 |
| 예측 | `predict` | 수동 예측, 파일 업로드, **예측 리스트** (메인) |

## 컴포넌트 카탈로그

### 기본 입력
- **`<NI>`**: 숫자 입력 (콤마 자동 포맷, monospace 폰트)
- **`<AgencyInput>`**: 발주기관 자동완성 (초성 검색 지원, 1,717개 기관)

### 정렬/표시
- **`<SortTh>`**: 정렬 가능한 테이블 헤더 (한국어 locale)
- **`<Tb>`**: 탭 버튼 (pending 뱃지 포함)
- **`<SimView>`**: 추첨 시뮬레이션 인라인 뷰 (퍼센타일 + 히스토그램)

### Phase 12-C
- **`<TierBadge>`**: P1~P5 배지 (이모지 + 레이블 + 색상)
- **`<ConfBar>`**: 신뢰도 0~1 시각화 바

### Phase 12-C 헬퍼 함수
```javascript
// App 컴포넌트 외부 정의
function assessPrediction(p, agencyStats, agencyPred) {
  // p: bid_prediction 객체
  // 반환: {tier, win_rate, confidence, offset, label, n, mae, median_adj, strategy}
}
```

## 주요 상태 변수

### 데이터 상태
```javascript
const [recs, setRecs] = useState([]);              // bid_records
const [predictions, setPredictions] = useState([]); // bid_predictions
const [bidDetails, setBidDetails] = useState([]);  // bid_details
const [allS, setAllS] = useState({ts:{}, as:{}}); // 전체 통계
const [newS, setNewS] = useState({ts:{}, as:{}}); // 2025-07 이후
const [oldS, setOldS] = useState({ts:{}, as:{}}); // 2025-07 이전
const [agAss, setAgAss] = useState({});            // ag_assumed_stats (일부)
```

### Phase 12-C 신규
```javascript
const [agencyStats, setAgencyStats] = useState({}); // agency_win_stats (ag → row)
const [agencyPred, setAgencyPred] = useState({});   // agency_predictor (ag → row)
const [hideP5, setHideP5] = useState(true);         // P5 자동 숨김 (기본 ON)
const [onlyPrimary, setOnlyPrimary] = useState(false); // P1~P2만 보기
```

### UI 제어
```javascript
const [tab, setTab] = useState("dash");
const [compFilter, setCompFilter] = useState("all"); // "all"/"matched"/"pending"
const [hideYuchal, setHideYuchal] = useState(true);
const [hideSuui, setHideSuui] = useState(true);
const [gradeFilter, setGradeFilter] = useState("all"); // "SA"/"SAB"/"notD"
const [predListShow, setPredListShow] = useState(50); // 페이지네이션
```

### AI 챗봇 (localStorage 세션)
```javascript
const [chatSessions, setChatSessions] = useState(/* localStorage 로드 */);
const [chatSid, setChatSid] = useState("");
const [chatMsgs, setChatMsgs] = useState([]);
const [chatInput, setChatInput] = useState("");
```

## 예측 리스트 테이블 구조 (메인 UI)

12개 컬럼:

```
| 등급(ROI) | 타깃(P12) | 공고명 | 발주기관 | 추천사정률(100%) | 추천투찰금액 | 개찰일 | 실제1위(100%) | 오차 | 상태 | 낙찰 | (액션) |
```

**colgroup 너비**:
```jsx
<colgroup>
  <col style={{width:"4%"}}/>   {/* 등급 */}
  <col style={{width:"6%"}}/>   {/* P12 타깃 */}
  <col style={{width:"14%"}}/>  {/* 공고명 */}
  <col style={{width:"10%"}}/>  {/* 발주기관 */}
  <col style={{width:"9%"}}/>   {/* 추천 사정률 */}
  <col style={{width:"11%"}}/>  {/* 추천 투찰금액 */}
  <col style={{width:"7%"}}/>   {/* 개찰일 */}
  <col style={{width:"9%"}}/>   {/* 실제 1위 */}
  <col style={{width:"7%"}}/>   {/* 오차 */}
  <col style={{width:"6%"}}/>   {/* 상태 */}
  <col style={{width:"5%"}}/>   {/* 낙찰 */}
  <col style={{width:"4%"}}/>   {/* 액션 */}
</colgroup>
```

## 행 시각 강조 (Phase 12-C)

```javascript
// P1~P2: 좌측 보더 강조
const rowBorder = tierStyle && agAsmt.tier <= 2 
  ? {borderLeft: "3px solid " + tierStyle.border} 
  : {};

// P5: opacity 감소
const p5Fade = agAsmt && agAsmt.tier === 5 ? 0.55 : 1;

<tr style={{
  borderBottom: "1px solid " + C.bdr,
  opacity: (isAnomaly || isYuchal || isSuui ? 0.5 : 1) * p5Fade,
  ...rowBorder
}}>
```

## Phase 12 타깃팅 대시보드

예측 리스트 상단에 카드:

```
🎯 발주사별 낙찰 예측 · pending N건 기준    [P5 숨김] [P1~P2만]
┌─────┬─────┬─────┬─────┬─────┬──────┬──────────┐
│🏆 P1│⭐ P2│📊 P3│⚠️ P4│⛔ P5│❓미분류│📈기대낙찰│
│ 20%+│13~20│7~13%│3~7% │~2%  │      │   이론   │
└─────┴─────┴─────┴─────┴─────┴──────┴──────────┘
```

7개 카드, grid-template-columns: repeat(7,1fr).

## compList useMemo (필터링 로직)

```javascript
const compList = useMemo(() => {
  const p = predictions || [];
  let list;
  
  // 1. status 필터
  if (compFilter === "matched") list = p.filter(x => x.match_status === "matched");
  else if (compFilter === "pending") list = p.filter(x => x.match_status === "pending");
  else list = p.filter(x => x.match_status !== "expired");
  
  // 2. 유찰/수의 숨김
  if (hideYuchal) list = list.filter(x => !(x.actual_winner && x.actual_winner.includes("유찰")));
  if (hideSuui) list = list.filter(x => /* 수의계약 필터 */);
  
  // 3. ROI 등급 필터 (Phase 5)
  if (gradeFilter !== "all") list = list.filter(/* S/A/B/C/D */);
  
  // 4. Phase 12-C: P5 숨김 (pending에만 적용)
  if (hideP5) list = list.filter(x => {
    if (x.match_status !== "pending") return true;
    const a = assessPrediction(x, agencyStats, agencyPred);
    return !a || a.tier == null || a.tier < 5;
  });
  
  // 5. Phase 12-C: P1~P2만 (pending에만)
  if (onlyPrimary) list = list.filter(x => {
    if (x.match_status !== "pending") return true;
    const a = assessPrediction(x, agencyStats, agencyPred);
    return a && a.tier != null && a.tier <= 2;
  });
  
  // 6. 정렬
  return [...list].sort((a, b) => sortFn(a, b, predSort.key, predSort.dir));
}, [predictions, compFilter, predSort, hideYuchal, hideSuui, gradeFilter, scoringMap, hideP5, onlyPrimary, agencyStats, agencyPred]);
```

## 파일 업로드 드롭존 패턴

모든 파일 업로드 영역에 **3가지 필수 이벤트**:
```jsx
<div 
  onDrop={handleDrop} 
  onDragOver={e => e.preventDefault()} 
  onClick={() => inputRef.current.click()}
>
  <input 
    ref={inputRef} 
    type="file" 
    multiple 
    style={{display:"none"}} 
    onChange={e => {
      handleFiles(e.target.files);
      e.target.value = "";  // ← 동일 파일 재선택 가능하게 초기화
    }}
  />
</div>
```

## 자동 판별: 3종 파일 (parseFile 후)

```javascript
function detectFileType(rows) {
  // 1. SUCVIEW (복수예가 상세)
  if (rows[0][0] === "공고명" && rows[2][0] === "공고번호") {
    return "sucview";
  }
  // 2. 입찰서류함 (예측 대상)
  const headerInTop5 = rows.slice(0, 5).some(r => 
    r.some(c => String(c).includes("공고명"))
  );
  if (headerInTop5 && !hasBaseAmountColumn(rows)) {
    return "biddoc";
  }
  // 3. 낙찰정보리스트 (기본)
  return "records";
}
```

## getFinalRecommendation 우선순위

```javascript
const getFinalRecommendation = useCallback((p) => {
  if (!p) return {adj: null, bid: null, source: null};
  
  // 1순위: opt_adj (편향 보정 + 오프셋 적용된 최종값)
  if (p.opt_adj != null) {
    return {
      adj: Number(p.opt_adj),
      bid: p.opt_bid ? Number(p.opt_bid) : calcBid(Number(p.opt_adj)),
      source: "추천"
    };
  }
  
  // 2순위 fallback: pred_adj_rate (편향 보정 전 순수 예측)
  if (p.pred_adj_rate != null) {
    return {
      adj: Number(p.pred_adj_rate),
      bid: p.pred_bid_amount ? Number(p.pred_bid_amount) : calcBid(Number(p.pred_adj_rate)),
      source: "순수예측"
    };
  }
  
  return {adj: null, bid: null, source: null};
}, []);
```

## 수동 예측 카드 (Phase 12-D 표시)

```jsx
{pred && <div>
  {/* 기본 예측 */}
  <div>📊 예측: 사정률 {(100+pred.adj).toFixed(4)}% · 하한율 {pred.fr}%</div>
  
  {/* Phase 12-D: 발주사 보정 표시 */}
  {pred.agencyOffset != null && pred.agencyN > 0 && <div style={{
    fontSize: 10, 
    color: "#e24b4a",
    padding: "3px 6px",
    background: "rgba(226,75,74,0.06)",
    borderRadius: 4
  }}>
    🎯 발주사 보정: 
    기관유형 {pred.typeOffset >= 0 ? "+" : ""}{pred.typeOffset.toFixed(3)}% +
    발주사 {pred.agencyOffset >= 0 ? "+" : ""}{pred.agencyOffset.toFixed(3)}% 
    (샘플 {pred.agencyN}건) 
    = 최종 {pred.optOffset >= 0 ? "+" : ""}{pred.optOffset.toFixed(3)}%
  </div>}
  
  {/* 추천 투찰 (메인) */}
  <div>★ 추천 투찰</div>
  ...
</div>}
```

## 일관성 함정

| 함정 | 대처 |
|---|---|
| 사정률 0-base 노출 | 모든 사용자 화면에 100% 변환 적용 |
| 같은 정보 두 곳 표시 시 다른 포맷 | 헬퍼 함수(`fmtP100`) 통일 사용 |
| 컬럼 추가 시 colspan 누락 | thead 그룹 헤더 colSpan 재계산 |
| useMemo dependency 누락 | hideP5, onlyPrimary 추가 시 dependencies 갱신 |
| 새 기능에 dependency 누락 | useCallback dependencies 점검 (특히 doManualPred) |

## 스타일 패턴 (자주 쓰는)

### 카드 헤더
```jsx
<div style={{
  padding: "8px 14px",
  fontSize: 12,
  fontWeight: 600,
  color: C.gold,
  borderBottom: "1px solid " + C.bdr
}}>제목</div>
```

### 강조 박스 (가운데 정렬)
```jsx
<div style={{
  padding: "12px 14px",
  background: "rgba(0,0,0,0.25)",
  borderRadius: 8
}}>
  <div style={{fontSize: 10, color: C.txm, marginBottom: 4, fontWeight: 600}}>
    🎯 추천 사정률(100%)
  </div>
  <div style={{
    fontSize: 24,
    fontWeight: 700,
    color: "#5dca96",
    fontFamily: "monospace",
    lineHeight: 1.1
  }}>{fmtP100(adj)}</div>
</div>
```

### 그라데이션 박스 (Phase 12-C 대시보드 스타일)
```jsx
<div style={{
  padding: "10px 12px",
  background: "linear-gradient(90deg, rgba(226,75,74,0.06), rgba(93,202,150,0.06))",
  borderRadius: 8,
  border: "1px solid " + C.bdr
}}>...</div>
```

### 작은 토글 라벨
```jsx
<label style={{
  display: "flex",
  alignItems: "center",
  gap: 4,
  cursor: "pointer",
  fontSize: 10,
  color: hideP5 ? "#5dca96" : C.txd
}}>
  <input 
    type="checkbox" 
    checked={hideP5} 
    onChange={e => setHideP5(e.target.checked)}
    style={{accentColor: "#5dca96", width: 12, height: 12}}
  />
  <span>P5 숨김</span>
</label>
```

## 빌드 검증 명령

```bash
cd /home/claude/bid-analyzer
npx vite build 2>&1 | tail -10
```

기대 출력:
```
✓ 34 modules transformed.
dist/assets/index-XXXXXX.js  ~707 kB │ gzip: ~230 kB
✓ built in 4-6s
```

## Vite/Vercel 빌드 함정

| 함정 | 해결 |
|---|---|
| `catch{}` | `catch(e){}` 명시 (Vite 빌드 실패) |
| 같은 함수 스코프 변수 shadowing | 변수명 변경 |
| ESM 호환성 | `import * as XLSX from "xlsx"` (named import 아님) |
| 캐시 문제 | Vercel 배포 후 사용자에 Ctrl+Shift+R 안내 |
| useEffect dependency 경고 | 새 변수 추가 시 dependencies 갱신 |
