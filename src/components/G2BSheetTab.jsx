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
      if (x !== y) return sortDesc ? (y < x ? -1 : 1) : (x < y ? -1 : 1);
      return sortDesc ? (b.id || 0) - (a.id || 0) : (a.id || 0) - (b.id || 0); // 동일 개찰일 id tiebreaker (배치 임포트 동률 비결정성 방지)
    });
    return rs;
  }, [freq, sortDesc]);

  const pageSize = PAGE || 50;
  const pageCount = Math.ceil(sortedRows.length / pageSize);
  const pageRows = useMemo(() => sortedRows.slice(page * pageSize, (page + 1) * pageSize), [sortedRows, page, pageSize]);

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
              <button key={k} onClick={() => { setAgency(k); setAgSearch(""); setPage(0); }}
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
