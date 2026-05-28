import React, { useState, useMemo } from "react";
import { C, PAGE } from "../lib/constants.js";
import { buildG2BFrequency, intensityLevel, INTENSITY_STYLE, rateBucket, baSegment, topN } from "../lib/g2bFrequency.js";

const fmtNum  = (v) => (v == null || v === "") ? "—" : Number(v).toLocaleString("ko-KR");
const fmtRate = (v, d = 3) => (v == null || !isFinite(Number(v))) ? "—" : Number(v).toFixed(d);
const RATE_CAVEAT = "추첨 결과 관측값(복수예비가 C(15,4)) — 발주처의 의도적 선택 아님";

// 발주처 검색 약칭 → 정식명 부분문자열. 입력이 정식명에 직접 포함되지 않아도 약칭으로 매칭. 키는 normAg(소문자·공백제거) 기준.
const AGENCY_ALIASES = {
  "한전": ["한국전력"],
  "엘에이치": ["한국토지주택공사"], "lh": ["한국토지주택공사"], "토지주택": ["한국토지주택공사"],
  "농어촌": ["한국농어촌공사"],
  "코레일": ["한국철도공사"], "철도공사": ["한국철도공사"],
  "수공": ["한국수자원공사"], "수자원": ["한국수자원공사"],
  "도로공사": ["한국도로공사"],
  "군부대": ["육군", "해군", "공군", "국군", "군단", "사령부", "비행단", "함대", "해병"],
  "군시설": ["육군", "해군", "공군", "국군", "군단", "사령부", "비행단", "함대", "해병"],
};
const normAg = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");
// name이 query(또는 약칭 확장)에 매칭되는지. 빈 query는 전부 매칭.
const matchAgency = (name, query) => {
  const q = normAg(query);
  if (!q) return true;
  const n = normAg(name);
  if (n.includes(q)) return true;
  const exps = AGENCY_ALIASES[q];
  return exps ? exps.some(e => n.includes(normAg(e))) : false;
};

// 빈도 강조 8단계 점유율 구간 (INTENSITY_STYLE 인덱스와 1:1 대응). 정보 모달용.
const LEGEND_ROWS = [
  { name: "최빈", range: "최빈 대비 ≥ 40%" },
  { name: "",     range: "30 ~ 40%" },
  { name: "",     range: "22 ~ 30%" },
  { name: "",     range: "15 ~ 22%" },
  { name: "중간", range: "10 ~ 15%" },
  { name: "",     range: "6 ~ 10%" },
  { name: "",     range: "3 ~ 6%" },
  { name: "희귀", range: "< 3% (또는 2회 이하)" },
];

// 리스트 표시 컬럼 (가로 스크롤 최소화). 개찰일 첫 컬럼, 1위사정율·발주처사정율은 A값과 1순위업체 사이. hl=빈도 강조.
const LIST_COLS = [
  { label: "개찰일",      get: r => r.od,    fmt: v => v || "—" },
  { label: "입찰공고번호", get: r => r.pn_no, fmt: v => v || "—" },
  { label: "공고명",      get: r => r.pn,    fmt: v => v || "—", ellipsis: 260 },
  { label: "발주처",      get: r => r.ag,    fmt: v => v || "—", ellipsis: 160 },
  { label: "예비기초금액", get: r => r.ba,    fmt: fmtNum, num: true },
  { label: "A값",         get: r => r.av,    fmt: fmtNum, num: true },
  { label: "1위사정율",   get: r => r.br1,   fmt: v => fmtRate(v, 4), num: true, hl: "br1" },
  { label: "발주처사정율", get: r => r.ar1,   fmt: v => fmtRate(v, 4), num: true, hl: "ar1" },
  { label: "1순위업체",   get: r => r.co,    fmt: v => v || "—", ellipsis: 140 },
  { label: "1순위업체 사업자번호", get: r => r.co_no, fmt: v => v || "—" },
];

// 상세 모달용 전체 G2B 항목 (순서 유지). hl: 'br1'·'ar1' 만 빈도 강조. 없는 값은 "—".
const DETAIL_COLS = [
  { label: "입찰공고번호", get: r => r.pn_no, fmt: v => v || "—" },
  { label: "공고명",      get: r => r.pn,    fmt: v => v || "—" },
  { label: "발주처",      get: r => r.ag,    fmt: v => v || "—" },
  { label: "업종",        get: r => r.cat,   fmt: v => v || "—" },
  { label: "개찰일",      get: r => r.od,    fmt: v => v || "—" },
  { label: "예비기초금액", get: r => r.ba,    fmt: fmtNum },
  { label: "A값",         get: r => r.av,    fmt: fmtNum },
  { label: "예정가격",    get: r => r.xp,    fmt: fmtNum },
  { label: "1위사정율",   get: r => r.br1,   fmt: v => fmtRate(v, 4), hl: "br1" },
  { label: "발주처사정율", get: r => r.ar1,   fmt: v => fmtRate(v, 4), hl: "ar1" },
  { label: "투찰율",      get: r => (r.bp && r.ba) ? r.bp / r.ba * 100 : null, fmt: v => fmtRate(v, 3) },
  { label: "1순위금액",   get: r => r.bp,    fmt: fmtNum },
  { label: "1순위금액차", get: r => (r.bp != null && r.floor_price != null) ? r.bp - r.floor_price : null, fmt: v => v == null ? "—" : fmtNum(v) },
  { label: "낙찰하한가",  get: r => r.floor_price, fmt: fmtNum },
  { label: "낙찰하한금액차", get: r => (r.floor_price != null && r.bp != null) ? r.floor_price - r.bp : null, fmt: v => v == null ? "—" : fmtNum(v) },
  { label: "낙찰하한율",  get: r => r.fr,    fmt: v => fmtRate(v, 3) },
  { label: "1순위업체",   get: r => r.co,    fmt: v => v || "—" },
  { label: "1순위업체 사업자번호", get: r => r.co_no, fmt: v => v || "—" },
];

export default function G2BSheetTab({ recs }){
  const [agency, setAgency] = useState("");
  const [agSearch, setAgSearch] = useState("");
  const [cat, setCat] = useState("");
  const [seg, setSeg] = useState("");
  const [listShow, setListShow] = useState(PAGE || 50); // 더보기 표시 건수
  const [sortChain, setSortChain] = useState([{ key: "od", dir: "desc" }]); // 다중 정렬(활성화 순=우선순위). key: od·ar1·br1, dir: desc·asc
  const [detailRow, setDetailRow] = useState(null);
  const [showLegend, setShowLegend] = useState(false);

  // 발주처 목록 (canonical_ag, 건수 desc)
  const agencyList = useMemo(() => {
    const m = new Map();
    for (const r of (recs || [])){
      if (r.ar1 == null) continue; // 발주처사정율 있는 완전 건만 집계 (리스트 표시와 일치)
      const k = r.canonical_ag || r.ag;
      if (!k) continue;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [recs]);

  // 선택 발주처 기준 필터 옵션 (distinct)
  const filterOpts = useMemo(() => {
    if (!agency) return { cats: [], segs: [] };
    const cats = new Set(), segs = new Set();
    for (const r of (recs || [])){
      if ((r.canonical_ag || r.ag) !== agency) continue;
      if (r.ar1 == null) continue; // 완전 건만 (리스트 표시와 일치)
      if (r.cat) cats.add(r.cat);
      segs.add(baSegment(r.ba));
    }
    return { cats: [...cats].sort(), segs: [...segs].sort() };
  }, [recs, agency]);

  const freq = useMemo(() => {
    if (!agency) return null;
    return buildG2BFrequency(recs, { agencyKey: agency, cat: cat || null, seg: seg || null });
  }, [recs, agency, cat, seg]);

  const sortedRows = useMemo(() => {
    if (!freq) return [];
    const cnt = (map, v) => { const k = rateBucket(v); return k != null ? (map.get(k) || 0) : -1; };
    const cmp = (a, b, key, dir) => {
      let d = 0;
      if (key === "od") { const x = a.od || "", y = b.od || ""; d = x < y ? -1 : x > y ? 1 : 0; }
      else if (key === "br1") d = cnt(freq.freqBr1, a.br1) - cnt(freq.freqBr1, b.br1);
      else if (key === "ar1") d = cnt(freq.freqAr1, a.ar1) - cnt(freq.freqAr1, b.ar1);
      return dir === "desc" ? -d : d;
    };
    const chain = sortChain.length ? sortChain : [{ key: "od", dir: "desc" }];
    const rs = [...freq.rows];
    rs.sort((a, b) => {
      for (const { key, dir } of chain){ const d = cmp(a, b, key, dir); if (d !== 0) return d; }
      return (b.id || 0) - (a.id || 0); // 최종 tiebreaker (동일 개찰일·동일 빈도)
    });
    return rs;
  }, [freq, sortChain]);

  const step = PAGE || 50;
  const shownRows = useMemo(() => sortedRows.slice(0, listShow), [sortedRows, listShow]);

  // 사정율 셀 빈도 강조 정보 (count + style). raw 없거나 freq 없으면 null.
  const rateInfo = (hl, raw) => {
    if (raw == null || !freq) return null;
    const key = rateBucket(raw);
    const count = (hl === "br1" ? freq.freqBr1 : freq.freqAr1).get(key) || 0;
    const denom = hl === "br1" ? freq.maxBr1 : freq.maxAr1; // 그 발주처 최빈 버킷 카운트 대비
    return { count, st: INTENSITY_STYLE[intensityLevel(count, denom)] };
  };

  const listCell = (col, r) => {
    const raw = col.get(r);
    const text = col.fmt(raw, r);
    const base = { padding: "4px 8px", textAlign: col.num ? "right" : "left", whiteSpace: "nowrap" };
    if (col.ellipsis){ base.maxWidth = col.ellipsis; base.overflow = "hidden"; base.textOverflow = "ellipsis"; }
    if (col.hl){
      const info = rateInfo(col.hl, raw);
      if (info){
        const tip = RATE_CAVEAT + " · " + `이 발주처에서 ${info.count}회 출현`;
        return <td key={col.label} title={tip} style={{ ...base, ...info.st }}>{text} <span style={{ fontSize: 10, color: C.txd, fontWeight: 400 }}>({info.count})</span></td>;
      }
    }
    return <td key={col.label} title={col.ellipsis ? String(raw ?? "") : undefined} style={{ ...base, color: C.txt, fontSize: 12 }}>{text}</td>;
  };

  // 다중 정렬 컨트롤 — 각 키 독립 on/off·방향, 활성화 순서대로 우선순위 누적.
  const dirOf = (key) => { const s = sortChain.find(x => x.key === key); return s ? s.dir : "off"; };
  const prioOf = (key) => { const i = sortChain.findIndex(x => x.key === key); return i < 0 ? 0 : i + 1; };
  const setSortFor = (key, dir) => {
    setSortChain(prev => {
      if (dir === "off") return prev.filter(s => s.key !== key);
      if (prev.some(s => s.key === key)) return prev.map(s => s.key === key ? { key, dir } : s);
      return [...prev, { key, dir }];
    });
    setListShow(step);
  };

  const selectStyle = { padding: "4px 8px", fontSize: 12, background: C.bg3, color: C.txt, border: "1px solid " + C.bdr, borderRadius: 5 };
  const btnStyle = { ...selectStyle, cursor: "pointer" };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, color: C.gold, fontSize: 13 }}>G2B 양식 — 발주처별 빈도</span>
        <span style={{ color: C.bdr }}>|</span>
        <input value={agSearch} onChange={e => setAgSearch(e.target.value)} placeholder="발주처 검색" style={{ ...selectStyle, minWidth: 220 }} />
      </div>

      {(!agency || agSearch) && (() => {
        const matches = agencyList.filter(([k]) => matchAgency(k, agSearch));
        return (
          <div style={{ padding: 16, background: C.bg2, border: "1px solid " + C.bdr, borderRadius: 8 }}>
            <div style={{ color: C.txm, fontSize: 12, marginBottom: 10 }}>
              발주처를 선택하세요. (전체 {agencyList.length.toLocaleString()}개 기관 · {agSearch ? `검색 결과 ${matches.length}개` : "빈출 상위 표시"})
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {matches.slice(0, 40).map(([k, n]) => (
                <button key={k} onClick={() => { setAgency(k); setAgSearch(""); setListShow(step); }}
                  style={{ padding: "4px 10px", fontSize: 11, background: C.bg3, color: C.txt, border: "1px solid " + C.bdr, borderRadius: 12, cursor: "pointer" }}>
                  {k} <span style={{ color: C.txd }}>({n})</span>
                </button>
              ))}
            </div>
            {agSearch && matches.length === 0 && <div style={{ color: C.txd, fontSize: 12, marginTop: 8 }}>검색 결과 없음 — 정식명 일부 또는 약칭(예: 한전, LH, 농어촌, 코레일, 군부대)으로 검색하세요.</div>}
          </div>
        );
      })()}

      {agency && !agSearch && freq && (
        <div>
          {/* 요약 패널 */}
          <div style={{ padding: "10px 12px", background: C.bg2, border: "1px solid " + C.bdr, borderRadius: 8, marginBottom: 10, fontSize: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontWeight: 700, color: C.txt }}>{agency}</span>
              <button onClick={() => { setAgency(""); setCat(""); setSeg(""); setSortChain([{ key: "od", dir: "desc" }]); setListShow(step); }} style={{ padding: "2px 8px", fontSize: 10, background: "transparent", color: C.txd, border: "1px solid " + C.bdr, borderRadius: 5, cursor: "pointer" }}>발주처 변경</button>
              <span style={{ color: C.txm }}>표시 {freq.rows.length.toLocaleString()}행</span>
            </div>
            <div style={{ color: C.txm, marginBottom: 4 }}>
              자주 나온 1위사정율 <span title={RATE_CAVEAT} style={{ color: C.txd, cursor: "help" }}>ⓘ</span>:&nbsp;
              {topN(freq.freqBr1).map(([v, n]) => <span key={v} style={{ color: C.gold, marginRight: 10 }}>{v}% ({n})</span>)}
              {freq.br1Stats.mean != null && (
                <span style={{ color: C.txd, marginLeft: 8 }}>· 평균 {freq.br1Stats.mean.toFixed(3)}% ±σ {freq.br1Stats.sd != null ? freq.br1Stats.sd.toFixed(3) : "—"} (n={freq.br1Stats.n})</span>
              )}
            </div>
            <div style={{ color: C.txm }}>
              자주 나온 발주처사정율 <span title={RATE_CAVEAT} style={{ color: C.txd, cursor: "help" }}>ⓘ</span>:&nbsp;
              {topN(freq.freqAr1).map(([v, n]) => <span key={v} style={{ color: "#5dca96", marginRight: 10 }}>{v}% ({n})</span>)}
              {freq.ar1Stats.mean != null && (
                <span style={{ color: C.txd, marginLeft: 8 }}>· 평균 {freq.ar1Stats.mean.toFixed(3)}% ±σ {freq.ar1Stats.sd != null ? freq.ar1Stats.sd.toFixed(3) : "—"} (n={freq.ar1Stats.n})</span>
              )}
            </div>
          </div>

          {/* 필터바 */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select value={cat} onChange={e => { setCat(e.target.value); setListShow(step); }} style={selectStyle}>
              <option value="">업종 전체</option>
              {filterOpts.cats.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={seg} onChange={e => { setSeg(e.target.value); setListShow(step); }} style={selectStyle}>
              <option value="">금액대 전체</option>
              {filterOpts.segs.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <span style={{ color: C.txd, fontSize: 11, alignSelf: "center" }}>정렬(중복 적용·번호=우선순위):</span>
            {[
              { key: "od",  label: "개찰일",          desc: "최신순", asc: "오래된순" },
              { key: "ar1", label: "발주처사정율 빈도", desc: "많은순", asc: "적은순" },
              { key: "br1", label: "1위사정율 빈도",    desc: "많은순", asc: "적은순" },
            ].map(c => (
              <span key={c.key} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: C.txm }}>
                {prioOf(c.key) > 0 && <span style={{ display: "inline-flex", width: 16, height: 16, alignItems: "center", justifyContent: "center", borderRadius: 8, background: C.gold, color: C.bg, fontSize: 10, fontWeight: 700 }}>{prioOf(c.key)}</span>}
                {c.label}
                <select value={dirOf(c.key)} onChange={e => setSortFor(c.key, e.target.value)} style={selectStyle}>
                  <option value="off">끄기</option>
                  <option value="desc">{c.desc}</option>
                  <option value="asc">{c.asc}</option>
                </select>
              </span>
            ))}
            <button onClick={() => setShowLegend(true)} title="사정율 빈도 강조 단계 설명" style={{ marginLeft: "auto", width: 22, height: 22, borderRadius: 11, background: C.bg3, color: C.gold, border: "1px solid " + C.bdr, cursor: "pointer", fontSize: 13, fontWeight: 700, padding: 0, lineHeight: 1 }}>?</button>
          </div>

          {/* 테이블 */}
          <div style={{ overflowX: "auto", border: "1px solid " + C.bdr, borderRadius: 6 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
              <thead>
                <tr style={{ background: C.bg3, color: C.txd }}>
                  {LIST_COLS.map(c => <th key={c.label} style={{ padding: "6px 8px", textAlign: c.num ? "right" : "left", whiteSpace: "nowrap", borderBottom: "1px solid " + C.bdr, fontWeight: 600 }}>{c.label}</th>)}
                  <th style={{ padding: "6px 8px", textAlign: "center", borderBottom: "1px solid " + C.bdr, fontWeight: 600 }}>상세</th>
                </tr>
              </thead>
              <tbody>
                {shownRows.map((r, i) => (
                  <tr key={r.id || i} style={{ borderTop: "1px solid " + C.bdr, background: i % 2 ? C.bg2 : "transparent" }}>
                    {LIST_COLS.map(c => listCell(c, r))}
                    <td style={{ padding: "4px 8px", textAlign: "center" }}>
                      <button onClick={() => setDetailRow(r)} style={{ padding: "2px 8px", fontSize: 11, background: C.bg3, color: C.gold, border: "1px solid " + C.bdr, borderRadius: 5, cursor: "pointer", whiteSpace: "nowrap" }}>상세</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 더보기 + 건수 표시 */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", fontSize: 11 }}>
            <span style={{ color: C.txd }}>{Math.min(listShow, sortedRows.length).toLocaleString()} / {sortedRows.length.toLocaleString()}건 표시</span>
            {listShow < sortedRows.length
              ? <button onClick={() => setListShow(n => n + step)} style={{ padding: "6px 20px", fontSize: 11, background: C.bg3, border: "1px solid " + C.bdr, borderRadius: 6, color: C.gold, cursor: "pointer", fontWeight: 500 }}>더보기 (+{step}건)</button>
              : <span style={{ color: C.txd }}>전체 표시 완료</span>}
          </div>
        </div>
      )}

      {/* 강조 단계 정보 모달 */}
      {showLegend && (
        <div onClick={() => setShowLegend(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: C.bg2, border: "1px solid " + C.bdr, borderRadius: 10, padding: 16, maxWidth: 440, width: "100%", maxHeight: "85vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontWeight: 700, color: C.gold, fontSize: 13 }}>사정율 빈도 강조 단계 (8단계)</span>
              <button onClick={() => setShowLegend(false)} style={btnStyle}>닫기 ✕</button>
            </div>
            <div style={{ fontSize: 11, color: C.txm, marginBottom: 10, lineHeight: 1.6 }}>
              1위사정율·발주처사정율 값(0.1% 버킷)을 그 발주처에서 <b style={{ color: C.txt }}>가장 많이 나온 값(최빈) 대비 출현 횟수 비율</b>로 8단계 표시합니다. 즉 그 발주처의 최빈 사정율이 가장 크고 강한 색이며, 적게 나올수록 작고 회색으로 수렴합니다. 셀 옆 (N)은 그 값의 실제 출현 횟수입니다.
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ color: C.txd }}>
                  <th style={{ textAlign: "left", padding: "4px 6px", fontWeight: 600 }}>단계</th>
                  <th style={{ textAlign: "left", padding: "4px 6px", fontWeight: 600 }}>최빈 대비</th>
                  <th style={{ textAlign: "right", padding: "4px 6px", fontWeight: 600 }}>표시 예시</th>
                </tr>
              </thead>
              <tbody>
                {INTENSITY_STYLE.map((st, i) => (
                  <tr key={i} style={{ borderTop: "1px solid " + C.bdr }}>
                    <td style={{ padding: "5px 6px", color: C.txm, whiteSpace: "nowrap" }}>{i}{LEGEND_ROWS[i].name ? ` · ${LEGEND_ROWS[i].name}` : ""}</td>
                    <td style={{ padding: "5px 6px", color: C.txm, whiteSpace: "nowrap" }}>{LEGEND_ROWS[i].range}</td>
                    <td style={{ padding: "5px 6px", textAlign: "right", ...st }}>100.3 <span style={{ fontSize: 10, color: C.txd, fontWeight: 400 }}>(예)</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 10, color: C.txd, marginTop: 10, lineHeight: 1.5 }}>{RATE_CAVEAT}</div>
          </div>
        </div>
      )}

      {/* 상세 모달 */}
      {detailRow && (
        <div onClick={() => setDetailRow(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: C.bg2, border: "1px solid " + C.bdr, borderRadius: 10, padding: 16, maxWidth: 560, width: "100%", maxHeight: "85vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontWeight: 700, color: C.gold, fontSize: 13 }}>상세 — G2B 전체 항목</span>
              <button onClick={() => setDetailRow(null)} style={btnStyle}>닫기 ✕</button>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <tbody>
                {DETAIL_COLS.map(col => {
                  const raw = col.get(detailRow);
                  const text = col.fmt(raw, detailRow);
                  let valStyle = { color: C.txt };
                  let badge = null;
                  if (col.hl){
                    const info = rateInfo(col.hl, raw);
                    if (info){ valStyle = info.st; badge = <span style={{ fontSize: 10, color: C.txd, marginLeft: 4, fontWeight: 400 }}>({info.count}회)</span>; }
                  }
                  return (
                    <tr key={col.label} style={{ borderTop: "1px solid " + C.bdr }}>
                      <td style={{ padding: "5px 8px", color: C.txm, whiteSpace: "nowrap", width: "42%" }}>{col.label}</td>
                      <td style={{ padding: "5px 8px", textAlign: "right", ...valStyle }}>{text}{badge}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
