# G2B 양식 탭 — 발주처별 낙찰하한율·사정율 재현 빈도 강조 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기존 `bid_records`를 나라장터(G2B) 25컬럼 양식으로 보여주는 새 탭을 만들고, 발주처(기관)별로 낙찰하한율(`fr`)·발주처사정율(`ar1`)의 재현 빈도를 점유율 기반 색·글씨크기로 강조한다.

**Architecture:** 순수 계산 로직은 standalone 모듈 `src/lib/g2bFrequency.js`(import.meta 미사용 → node 단위테스트 가능)에 두고, React 컴포넌트 `src/components/G2BSheetTab.jsx`가 이를 소비한다. App.jsx에 탭 1개를 배선한다. 이미 클라이언트에 로드된 `recs`(약 6.5만건)를 props로 재사용 → DB 신규 객체·호출 없음. **Evaluator 분류**(예측 로직 무변경)로 `/evaluate` 면제.

**Tech Stack:** React + Vite, 기존 `C` 팔레트(`src/lib/constants.js`), node 내장 실행 기반 테스트(`node tests/*.test.mjs`).

설계 문서: `docs/superpowers/specs/2026-05-28-g2b-sheet-frequency-highlight-design.md`

> **정정 (2026-05-28, 구현 후):** "투찰하한율" 컬럼은 `fr`(법정 하한율)이 아니라 **1위사정율 `br1`** 로 확정. 강조 대상 = `br1`·`ar1` 두 사정율, 둘 다 0.1% 버킷(`rateBucket`)으로 빈도 집계. 아래 Task 1 코드의 `frKey`/`freqFr`/`fr` 서술은 `rateBucket`/`freqBr1`/`br1`로 대체됨. 최종 구현 기준은 `src/lib/g2bFrequency.js`·`src/components/G2BSheetTab.jsx`.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/lib/g2bFrequency.js` (생성) | 순수 함수: 금액대 세그먼트, fr/ar1 빈도 키, 빈도맵 빌드, 점유율→강조 단계, 강조 스타일 상수 |
| `tests/g2bFrequency.test.mjs` (생성) | 위 순수 함수 node 단위테스트 |
| `src/components/G2BSheetTab.jsx` (생성) | 발주처 선택·필터·25컬럼 테이블·강조·요약·페이지네이션 UI |
| `src/App.jsx` (수정) | 탭 버튼 + `{tab==="g2b_sheet" && <G2BSheetTab recs={recs}/>}` 렌더 분기 배선 |

> 테스트 정책: 순수 로직(Task 1)은 TDD. React 컴포넌트(Task 2~3)는 이 프로젝트에 jsdom/RTL이 없으므로 `npx vite build` 통과 + 브라우저 수동 확인으로 검증한다(프로젝트 관례).

---

## Task 1: 순수 빈도 모듈 + 단위테스트

**Files:**
- Create: `src/lib/g2bFrequency.js`
- Test: `tests/g2bFrequency.test.mjs`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/g2bFrequency.test.mjs`:

```js
import { baSegment, frKey, ar1Bucket, intensityLevel, buildG2BFrequency } from "../src/lib/g2bFrequency.js";

let bad = 0;
const eq = (got, exp, msg) => { if (got !== exp) { console.error(`XX ${msg}: got ${JSON.stringify(got)} expect ${JSON.stringify(exp)}`); bad++; } };
const near = (got, exp, msg, tol=1e-6) => { if (got==null || Math.abs(got-exp)>tol) { console.error(`XX ${msg}: got ${got} expect ~${exp}`); bad++; } };

// 1. baSegment 경계 (utils.js getBiasArrow와 동일)
eq(baSegment(5e7), 'S1', 'baSegment <1억');
eq(baSegment(1e8), 'S2', 'baSegment 1억 경계');
eq(baSegment(3e8), 'S3', 'baSegment 3억 경계');
eq(baSegment(1e9), 'S4', 'baSegment 10억 경계');
eq(baSegment(3e9), 'S5', 'baSegment 30억 경계');

// 2. frKey — 소수 3자리 반올림 문자열 (부동소수 정확일치용)
eq(frKey(87.745), '87.745', 'frKey 87.745');
eq(frKey(87.7451), '87.745', 'frKey 반올림');
eq(frKey(90.25), '90.250', 'frKey 자리수 통일');
eq(frKey(null), null, 'frKey null');

// 3. ar1Bucket — 0.1% 버킷
eq(ar1Bucket(100.324), '100.3', 'ar1Bucket 100.324');
eq(ar1Bucket(99.671), '99.7', 'ar1Bucket 반올림 99.7');
eq(ar1Bucket(null), null, 'ar1Bucket null');

// 4. intensityLevel — 점유율 기반 + n<=2 희귀 override
eq(intensityLevel(50, 100), 'top', 'share 0.50 → top');
eq(intensityLevel(40, 100), 'top', 'share 0.40 → top');
eq(intensityLevel(20, 100), 'high', 'share 0.20 → high');
eq(intensityLevel(10, 100), 'mid', 'share 0.10 → mid');
eq(intensityLevel(4, 100), 'rare', 'share 0.04 → rare');
eq(intensityLevel(2, 4), 'rare', 'n<=2 override → rare');
eq(intensityLevel(0, 100), 'rare', 'count 0 → rare');

// 5. buildG2BFrequency — 발주처 필터 + 빈도 집계 + 제외행 처리
const recs = [
  { canonical_ag:'한전', ag:'한전 경기', cat:'전기', ba:2e8, fr:87.745, ar1:100.32 },
  { canonical_ag:'한전', ag:'한전 경기', cat:'전기', ba:2e8, fr:87.745, ar1:100.34 }, // ar1 다른 행, 같은 버킷 100.3
  { canonical_ag:'한전', ag:'한전 경기', cat:'통신', ba:2e8, fr:88.0,   ar1:99.71 },
  { canonical_ag:'한전', ag:'한전 경기', cat:'전기', ba:2e8, fr:87.745, ar1:100.91, is_excluded:true }, // 표시O 빈도X
  { canonical_ag:'고양시', ag:'고양시', cat:'전기', ba:2e8, fr:87.745, ar1:100.10 }, // 다른 발주처
];
const f = buildG2BFrequency(recs, { agencyKey:'한전' });
eq(f.rows.length, 4, '한전 표시행 4(제외행 포함)');
eq(f.freqFr.get('87.745'), 2, 'fr 87.745 빈도 2(제외행 미집계)');
eq(f.freqFr.get('88.000'), 1, 'fr 88.0 빈도 1');
eq(f.totalFr, 3, 'fr 총 집계 3');
eq(f.freqAr1.get('100.3'), 2, 'ar1 100.3 버킷 2');
eq(f.freqAr1.get('99.7'), 1, 'ar1 99.7 버킷 1');
eq(f.ar1Stats.n, 3, 'ar1 통계 n=3(제외행 미집계)');
near(f.ar1Stats.mean, (100.32+100.34+99.71)/3, 'ar1 평균');

// 6. buildG2BFrequency — cat 필터
const fc = buildG2BFrequency(recs, { agencyKey:'한전', cat:'통신' });
eq(fc.rows.length, 1, 'cat=통신 표시행 1');
eq(fc.freqFr.get('88.000'), 1, 'cat 필터 후 fr 88.0');

console.log(bad===0 ? 'OK g2bFrequency (모든 케이스 통과)' : `FAIL: ${bad}건`);
process.exit(bad===0 ? 0 : 1);
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node tests/g2bFrequency.test.mjs`
Expected: FAIL — `Cannot find module '../src/lib/g2bFrequency.js'` (모듈 미존재)

- [ ] **Step 3: 모듈 구현**

`src/lib/g2bFrequency.js`:

```js
// G2B 양식 탭 — 발주처별 fr/ar1 재현 빈도 순수 계산 모듈.
// standalone(import.meta.env 체인 없음) → node 단위테스트 가능. predConfidence.js와 동일 정책.

// 금액대 세그먼트 — utils.js getBiasArrow와 동일 경계.
export function baSegment(ba){
  const n = Number(ba) || 0;
  return n < 1e8 ? 'S1' : n < 3e8 ? 'S2' : n < 1e9 ? 'S3' : n < 3e9 ? 'S4' : 'S5';
}

// fr 정확일치 키 — 부동소수 비교 회피 위해 소수 3자리 반올림 문자열.
export function frKey(fr){
  if (fr == null || !isFinite(Number(fr))) return null;
  return (Math.round(Number(fr) * 1000) / 1000).toFixed(3);
}

// ar1 0.1% 버킷 키 — 연속값(추첨 결과)을 0.1% 구간으로 묶어 빈도 관찰.
export function ar1Bucket(ar1){
  if (ar1 == null || !isFinite(Number(ar1))) return null;
  return (Math.round(Number(ar1) * 10) / 10).toFixed(1);
}

// 점유율(count/total) → 강조 단계. n<=2는 점유율 무관 희귀.
export function intensityLevel(count, total){
  if (!count || count <= 2 || !total) return 'rare';
  const share = count / total;
  if (share >= 0.40) return 'top';
  if (share >= 0.15) return 'high';
  if (share >= 0.05) return 'mid';
  return 'rare';
}

// 강조 단계 → 스타일 (글씨크기 + 색). 색은 C 팔레트 값과 정렬.
export const INTENSITY_STYLE = {
  top:  { fontWeight: 700, fontSize: 15, color: '#d4a834' },
  high: { fontWeight: 600, fontSize: 13, color: '#5dca96' },
  mid:  { fontWeight: 400, fontSize: 12, color: '#e8e8ef' },
  rare: { fontWeight: 400, fontSize: 12, color: '#666680' },
};

// 선택 발주처 행 추출 + fr/ar1 빈도맵 + ar1 평균/표준편차.
// recs: 전체 bid_records 배열. opts: { agencyKey, cat?, era?, seg? }
// 표시행(rows)은 제외행 포함, 빈도/통계 집계만 is_excluded 제외(is_duplicate는 클라 미페치라 가드 불가).
export function buildG2BFrequency(recs, opts){
  const { agencyKey, cat = null, era = null, seg = null } = opts || {};
  const rows = [];
  const freqFr = new Map();
  const freqAr1 = new Map();
  let sum = 0, sumSq = 0, nAr1 = 0;
  for (const r of (recs || [])){
    const key = r.canonical_ag || r.ag;
    if (key !== agencyKey) continue;
    if (cat && r.cat !== cat) continue;
    if (era && (r.era_v2 || r.era) !== era) continue;
    if (seg && baSegment(r.ba) !== seg) continue;
    rows.push(r);
    if (r.is_excluded === true) continue; // 비정상 건(is_excluded) 빈도/통계 제외
    const fk = frKey(r.fr);
    if (fk != null) freqFr.set(fk, (freqFr.get(fk) || 0) + 1);
    const ak = ar1Bucket(r.ar1);
    if (ak != null){
      freqAr1.set(ak, (freqAr1.get(ak) || 0) + 1);
      const v = Number(r.ar1); sum += v; sumSq += v * v; nAr1++;
    }
  }
  const totalFr = [...freqFr.values()].reduce((a, b) => a + b, 0);
  const totalAr1 = [...freqAr1.values()].reduce((a, b) => a + b, 0);
  const mean = nAr1 ? sum / nAr1 : null;
  const sd = nAr1 >= 2 ? Math.sqrt(Math.max(0, (sumSq - nAr1 * mean * mean) / (nAr1 - 1))) : null;
  return { rows, freqFr, freqAr1, totalFr, totalAr1, ar1Stats: { mean, sd, n: nAr1 } };
}

// 빈도맵 → 상위 N개 [value, count] (count desc).
export function topN(freqMap, n = 3){
  return [...freqMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node tests/g2bFrequency.test.mjs`
Expected: PASS — `OK g2bFrequency (모든 케이스 통과)`, exit 0

- [ ] **Step 5: 커밋**

```bash
git add src/lib/g2bFrequency.js tests/g2bFrequency.test.mjs
git commit -m "feat(g2b): 발주처별 fr/ar1 재현 빈도 순수 계산 모듈 + 단위테스트"
```

---

## Task 2: G2BSheetTab 컴포넌트

**Files:**
- Create: `src/components/G2BSheetTab.jsx`

- [ ] **Step 1: 컴포넌트 구현**

`src/components/G2BSheetTab.jsx`:

```jsx
import React, { useState, useMemo } from "react";
import { C, PAGE } from "../lib/constants.js";
import { buildG2BFrequency, intensityLevel, INTENSITY_STYLE, frKey, ar1Bucket, baSegment, topN } from "../lib/g2bFrequency.js";

const fmtNum  = (v) => (v == null || v === "") ? "—" : Number(v).toLocaleString("ko-KR");
const fmtRate = (v, d = 3) => (v == null || !isFinite(Number(v))) ? "—" : Number(v).toFixed(d);
const AR1_CAVEAT = "추첨 결과 관측값(복수예비가 C(15,4)) — 발주처의 의도적 선택 아님";

// G2B 25컬럼 (순서 유지). hl: 'fr'|'ar1' 인 컬럼만 빈도 강조. 없는 값은 "—".
const COLS = [
  { label: "번호",            get: (r, i) => i + 1,  fmt: v => v },
  { label: "입찰공고번호",     get: r => r.pn_no,     fmt: v => v || "—" },
  { label: "공고명",          get: r => r.pn,        fmt: v => v || "—", wide: true },
  { label: "발주처",          get: r => r.ag,        fmt: v => v || "—" },
  { label: "업종",            get: r => r.cat,       fmt: v => v || "—" },
  { label: "개찰일",          get: r => r.od,        fmt: v => v || "—" },
  { label: "예비기초금액",     get: r => r.ba,        fmt: fmtNum, num: true },
  { label: "A값",             get: r => r.av,        fmt: fmtNum, num: true },
  { label: "예정가격",         get: r => r.xp,        fmt: fmtNum, num: true },
  { label: "순공사원가",       get: r => r.raw_cost,  fmt: fmtNum, num: true },
  { label: "투찰하한율",       get: r => r.fr,        fmt: v => fmtRate(v, 3), num: true, hl: "fr" },
  { label: "발주처사정율",     get: r => r.ar1,       fmt: v => fmtRate(v, 4), num: true, hl: "ar1" },
  { label: "발주가로값",       get: () => null,       fmt: () => "—" },
  { label: "(자사)사정율",     get: () => null,       fmt: () => "—" },
  { label: "사정율편차",       get: () => null,       fmt: () => "—" },
  { label: "투찰율",          get: r => (r.bp && r.ba) ? r.bp / r.ba * 100 : null, fmt: v => fmtRate(v, 3), num: true },
  { label: "(자사)입찰가/기초가", get: () => null,    fmt: () => "—" },
  { label: "(자사)입찰금액",   get: () => null,       fmt: () => "—" },
  { label: "1순위금액",        get: r => r.bp,        fmt: fmtNum, num: true },
  { label: "1순위금액차",      get: r => (r.bp != null && r.floor_price != null) ? r.bp - r.floor_price : null, fmt: v => v == null ? "—" : fmtNum(v), num: true },
  { label: "낙찰하한가",       get: r => r.floor_price, fmt: fmtNum, num: true },
  { label: "낙찰하한금액차",   get: r => (r.floor_price != null && r.bp != null) ? r.floor_price - r.bp : null, fmt: v => v == null ? "—" : fmtNum(v), num: true },
  { label: "자사순위",         get: () => null,       fmt: () => "—" },
  { label: "1순위업체",        get: r => r.co,        fmt: v => v || "—" },
  { label: "1순위업체 사업자번호", get: r => r.co_no,  fmt: v => v || "—" },
];

export default function G2BSheetTab({ recs }){
  const [agency, setAgency] = useState("");
  const [agSearch, setAgSearch] = useState("");
  const [cat, setCat] = useState("");
  const [era, setEra] = useState("");
  const [seg, setSeg] = useState("");
  const [page, setPage] = useState(0);
  const [sortDesc, setSortDesc] = useState(true);

  // 발주처 목록 (canonical_ag, 건수 desc)
  const agencyList = useMemo(() => {
    const m = new Map();
    for (const r of (recs || [])){
      const k = r.canonical_ag || r.ag;
      if (!k) continue;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [recs]);

  // 선택 발주처 기준 필터 옵션 (distinct)
  const filterOpts = useMemo(() => {
    if (!agency) return { cats: [], eras: [], segs: [] };
    const cats = new Set(), eras = new Set(), segs = new Set();
    for (const r of (recs || [])){
      if ((r.canonical_ag || r.ag) !== agency) continue;
      if (r.cat) cats.add(r.cat);
      const e = r.era_v2 || r.era; if (e) eras.add(e);
      segs.add(baSegment(r.ba));
    }
    return { cats: [...cats].sort(), eras: [...eras].sort(), segs: [...segs].sort() };
  }, [recs, agency]);

  const freq = useMemo(() => {
    if (!agency) return null;
    return buildG2BFrequency(recs, { agencyKey: agency, cat: cat || null, era: era || null, seg: seg || null });
  }, [recs, agency, cat, era, seg]);

  const sortedRows = useMemo(() => {
    if (!freq) return [];
    const rs = [...freq.rows];
    rs.sort((a, b) => {
      const x = a.od || "", y = b.od || "";
      return sortDesc ? (y < x ? -1 : y > x ? 1 : 0) : (x < y ? -1 : x > y ? 1 : 0);
    });
    return rs;
  }, [freq, sortDesc]);

  const pageSize = PAGE || 50;
  const pageRows = sortedRows.slice(page * pageSize, (page + 1) * pageSize);
  const pageCount = Math.ceil(sortedRows.length / pageSize);

  const cell = (col, r, i) => {
    const raw = col.get(r, page * pageSize + i);
    const text = col.fmt(raw, r);
    if (!col.hl || raw == null || !freq){
      return <td key={col.label} style={{ padding: "4px 6px", textAlign: col.num ? "right" : "left", whiteSpace: "nowrap", color: C.txt, fontSize: 12 }}>{text}</td>;
    }
    const key = col.hl === "fr" ? frKey(raw) : ar1Bucket(raw);
    const count = (col.hl === "fr" ? freq.freqFr : freq.freqAr1).get(key) || 0;
    const total = col.hl === "fr" ? freq.totalFr : freq.totalAr1;
    const st = INTENSITY_STYLE[intensityLevel(count, total)];
    const tip = (col.hl === "ar1" ? AR1_CAVEAT + " · " : "") + `이 발주처에서 ${count}회 출현`;
    return (
      <td key={col.label} title={tip} style={{ padding: "4px 6px", textAlign: "right", whiteSpace: "nowrap", ...st }}>
        {text} <span style={{ fontSize: 10, color: C.txd, fontWeight: 400 }}>({count})</span>
      </td>
    );
  };

  const selectStyle = { padding: "4px 8px", fontSize: 12, background: C.bg3, color: C.txt, border: "1px solid " + C.bdr, borderRadius: 5 };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, color: C.gold, fontSize: 13 }}>G2B 양식 — 발주처별 빈도</span>
        <span style={{ color: C.bdr }}>|</span>
        <input value={agSearch} onChange={e => setAgSearch(e.target.value)} placeholder="발주처 검색"
          style={{ ...selectStyle, minWidth: 220 }} />
      </div>

      {!agency && (
        <div style={{ padding: 16, background: C.bg2, border: "1px solid " + C.bdr, borderRadius: 8 }}>
          <div style={{ color: C.txm, fontSize: 12, marginBottom: 10 }}>발주처를 선택하세요. (전체 {agencyList.length.toLocaleString()}개 기관 · 빈출 상위 표시)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {agencyList.filter(([k]) => !agSearch || k.includes(agSearch)).slice(0, 40).map(([k, n]) => (
              <button key={k} onClick={() => { setAgency(k); setPage(0); }}
                style={{ padding: "4px 10px", fontSize: 11, background: C.bg3, color: C.txt, border: "1px solid " + C.bdr, borderRadius: 12, cursor: "pointer" }}>
                {k} <span style={{ color: C.txd }}>({n})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {agency && freq && (
        <div>
          {/* 요약 패널 */}
          <div style={{ padding: "10px 12px", background: C.bg2, border: "1px solid " + C.bdr, borderRadius: 8, marginBottom: 10, fontSize: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontWeight: 700, color: C.txt }}>{agency}</span>
              <button onClick={() => { setAgency(""); setCat(""); setEra(""); setSeg(""); setPage(0); }}
                style={{ padding: "2px 8px", fontSize: 10, background: "transparent", color: C.txd, border: "1px solid " + C.bdr, borderRadius: 5, cursor: "pointer" }}>발주처 변경</button>
              <span style={{ color: C.txm }}>표시 {freq.rows.length.toLocaleString()}행</span>
            </div>
            <div style={{ color: C.txm, marginBottom: 4 }}>
              자주 나온 낙찰하한율:&nbsp;
              {topN(freq.freqFr).map(([v, n]) => <span key={v} style={{ color: C.gold, marginRight: 10 }}>{v}% ({n})</span>)}
            </div>
            <div style={{ color: C.txm }}>
              자주 나온 사정율 <span title={AR1_CAVEAT} style={{ color: C.txd, cursor: "help" }}>ⓘ</span>:&nbsp;
              {topN(freq.freqAr1).map(([v, n]) => <span key={v} style={{ color: "#5dca96", marginRight: 10 }}>{v}% ({n})</span>)}
              {freq.ar1Stats.mean != null && (
                <span style={{ color: C.txd, marginLeft: 8 }}>
                  · 평균 {freq.ar1Stats.mean.toFixed(3)}% ±σ {freq.ar1Stats.sd != null ? freq.ar1Stats.sd.toFixed(3) : "—"} (n={freq.ar1Stats.n})
                </span>
              )}
            </div>
          </div>

          {/* 필터바 */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select value={cat} onChange={e => { setCat(e.target.value); setPage(0); }} style={selectStyle}>
              <option value="">업종 전체</option>
              {filterOpts.cats.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={era} onChange={e => { setEra(e.target.value); setPage(0); }} style={selectStyle}>
              <option value="">era 전체</option>
              {filterOpts.eras.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
            <select value={seg} onChange={e => { setSeg(e.target.value); setPage(0); }} style={selectStyle}>
              <option value="">금액대 전체</option>
              {filterOpts.segs.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={() => setSortDesc(d => !d)} style={{ ...selectStyle, cursor: "pointer" }}>개찰일 {sortDesc ? "↓" : "↑"}</button>
          </div>

          {/* 테이블 */}
          <div style={{ overflowX: "auto", border: "1px solid " + C.bdr, borderRadius: 6 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: "100%" }}>
              <thead>
                <tr style={{ background: C.bg3, color: C.txd }}>
                  {COLS.map(c => <th key={c.label} style={{ padding: "6px 6px", textAlign: c.num ? "right" : "left", whiteSpace: "nowrap", borderBottom: "1px solid " + C.bdr, fontWeight: 600 }}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, i) => (
                  <tr key={r.id || i} style={{ borderTop: "1px solid " + C.bdr, background: i % 2 ? C.bg2 : "transparent" }}>
                    {COLS.map(c => cell(c, r, i))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 페이지네이션 */}
          {pageCount > 1 && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8, fontSize: 12, color: C.txm }}>
              <button disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))} style={{ ...selectStyle, cursor: page === 0 ? "default" : "pointer", opacity: page === 0 ? 0.4 : 1 }}>이전</button>
              <span>{page + 1} / {pageCount}</span>
              <button disabled={page >= pageCount - 1} onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} style={{ ...selectStyle, cursor: page >= pageCount - 1 ? "default" : "pointer", opacity: page >= pageCount - 1 ? 0.4 : 1 }}>다음</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 검색어로 발주처 즉시 선택 가능하도록 연결 확인 (코드 리뷰)**

`agSearch`는 미선택 화면의 칩 필터에 사용된다(`agencyList.filter(...)`). 검색 입력 → 칩 목록 좁힘 → 클릭으로 `agency` 확정. 별도 단계 없음. 코드상 연결 확인만.

- [ ] **Step 3: 빌드 통과 확인**

Run: `npx vite build`
Expected: 빌드 성공(에러 0). 컴포넌트는 아직 App에 미배선이라 트리쉐이킹될 수 있음 — import 에러만 없으면 통과.

- [ ] **Step 4: 커밋**

```bash
git add src/components/G2BSheetTab.jsx
git commit -m "feat(g2b): G2B 25컬럼 양식 탭 컴포넌트(발주처 선택·필터·빈도 강조·요약)"
```

---

## Task 3: App.jsx 탭 배선

**Files:**
- Modify: `src/App.jsx` (상단 import 영역, 탭 버튼 바, 탭 렌더 분기)

- [ ] **Step 1: import 추가**

`src/App.jsx` 상단 컴포넌트 import 그룹(예: `AgencyFloorTab`/`AgencyPredictorTab` import 부근)에 추가:

```jsx
import G2BSheetTab from "./components/G2BSheetTab.jsx";
```

(실제 경로는 기존 `import AgencyPredictorTab from "./components/AgencyPredictorTab.jsx";` 류와 동일 디렉터리.)

- [ ] **Step 2: 탭 버튼 추가**

App.jsx의 탭 버튼 바(다른 `setTab("...")` 버튼들이 모여 있는 네비게이션)에 버튼 1개 추가. 기존 버튼 마크업 스타일을 그대로 복제하고 라벨/키만 변경:

```jsx
<button onClick={() => setTab("g2b_sheet")}
  style={{ /* 인접 탭 버튼과 동일 스타일 복제. active 시 tab==="g2b_sheet" 비교로 강조 */ }}>
  G2B 양식
</button>
```

> 주: App.jsx의 탭 버튼은 인라인 스타일 패턴이 일관적이지 않을 수 있으니, **바로 옆 기존 탭 버튼의 스타일/active 처리(예: `tab==="predict"` 비교)를 그대로 따라** 작성한다. 새 패턴을 만들지 말 것.

- [ ] **Step 3: 렌더 분기 추가**

기존 렌더 분기들(`{tab==="winstrat"&&<WinStrategyDashboard/>}`, `{tab==="agency_floor"&&<AgencyFloorTab/>}` 등, App.jsx 2843~3216 부근) 사이에 추가:

```jsx
{tab==="g2b_sheet" && <G2BSheetTab recs={recs} />}
```

- [ ] **Step 4: 빌드 통과 확인**

Run: `npx vite build`
Expected: 빌드 성공(에러 0).

- [ ] **Step 5: 커밋**

```bash
git add src/App.jsx
git commit -m "feat(g2b): App에 G2B 양식 탭 배선(버튼+렌더 분기)"
```

---

## Task 4: 영향도 확인 · 수동 검증 · 배포

**Files:** (코드 변경 없음 — 검증/배포 단계)

- [ ] **Step 1: predict-architect 영향도 확인 (CLAUDE.md 1단계 절차)**

Agent 툴, `subagent_type=predict-architect` 호출. 프롬프트 요지: "신규 G2B 양식 탭은 `bid_records`의 기존 컬럼(`fr`,`ar1` 등)을 읽어 표시·빈도집계만 하며 `getFinalRecommendation`/`opt_adj`/`pred_bias_map`/낙찰하한율 함수를 변경하지 않는다. Generator/Evaluator 분류와 핵심영역(한전·고양시·군부대) 예측 영향 여부를 판정해 달라."
Expected: **Evaluator(검증 면제)** 판정. 만약 Generator로 분류되면 `/evaluate` 실행 후 PASS 확인.

- [ ] **Step 2: 개발 서버 수동 검증**

Run: `npx vite dev` (또는 `npm run dev`) 후 브라우저에서:
- G2B 양식 탭 진입 → "발주처를 선택하세요" + 빈출 칩 노출(전체 65k 미렌더 확인).
- 발주처 검색 입력 → 칩 좁혀짐 → 클릭 → 표 렌더.
- 25컬럼 순서가 엑셀과 일치, 자사 컬럼은 "—".
- 투찰하한율/발주처사정율 셀: 최빈값 굵게+골드, 옆에 `(횟수)`, hover 툴팁(사정율은 추첨 캐비어트 포함).
- 업종/era/금액대 필터 변경 시 빈도·강조 재계산.
- 행 >페이지크기면 이전/다음 페이지 동작.
- 요약 패널: 낙찰하한율 TOP3 / 사정율 TOP3 + 평균±σ + n.

Expected: 위 항목 모두 정상. 콘솔 에러 0.

- [ ] **Step 3: 전체 단위테스트 회귀 확인**

Run: `node tests/g2bFrequency.test.mjs && node tests/predConfidence.test.mjs && node tests/agencyClass.test.mjs && node tests/bidCacheLogic.test.mjs`
Expected: 전부 PASS(exit 0).

- [ ] **Step 4: 배포 (사용자 승인 후)**

```bash
git pull --rebase
git push
```

> CLAUDE.md: main push → Vercel 자동 배포(2~3분). push는 사용자 명시 승인 후에만.

---

## Self-Review

**1. Spec coverage**
- 새 탭 + DB무변경(recs 재사용) → Task 2·3 ✓
- 25컬럼 매핑·순서유지·자사컬럼 "—" → Task 2 COLS ✓
- 강조: 점유율 기반 + n 노출 → Task 1 `intensityLevel`/`INTENSITY_STYLE`, Task 2 `cell` ✓
- ar1 정직 라벨(추첨 캐비어트 툴팁) → Task 2 `AR1_CAVEAT` ✓
- fr era×금액대 필터 → Task 2 필터바 + Task 1 `buildG2BFrequency` opts ✓
- 성능 가드(미선택 시 전체 미렌더, 페이지네이션) → Task 2 ✓
- canonical_ag 집계, is_excluded 빈도 제외(is_duplicate는 클라 미페치라 제외) → Task 1 `buildG2BFrequency` ✓
- Evaluator 면제 + predict-architect 확인 → Task 4 ✓

**2. Placeholder scan**
- Task 3은 App.jsx 기존 탭 버튼 스타일이 파일마다 달라 정확 코드 대신 "인접 버튼 복제" 지시 — 의도된 것(기존 패턴 추종, 새 패턴 금지). 그 외 모든 코드 step은 완전 코드 포함. TODO/TBD 없음.

**3. Type consistency**
- 함수 시그니처 일치 확인: `buildG2BFrequency(recs, opts)` 반환 `{rows, freqFr, freqAr1, totalFr, totalAr1, ar1Stats:{mean,sd,n}}` — Task 2에서 동일 사용. `intensityLevel(count,total)`, `frKey`/`ar1Bucket`(단일 인자), `topN(map,n)`, `INTENSITY_STYLE[level]` — Task 2 사용처와 일치. ✓
```
