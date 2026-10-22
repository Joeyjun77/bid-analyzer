// 성과 탭 — 자사 성적표 (P1). 표시 전용. bidDetails·recs는 App state를 prop으로 받으며 변형하지 않는다.
// 스펙: docs/superpowers/specs/2026-10-22-bid-ops-funnel-redesign-design.md §6.4
import React, { useMemo, useState } from "react";
import { C } from "../lib/constants.js";
import { loadKeywords, saveKeywords, SMALL_PC_MAX } from "../lib/eligibility.js";
import { aggregatePerformance, NEAR_GAP_MAX } from "../lib/performance.js";

const PASS_OK = 0.9;
const RED = "#e24b4a", GREEN = "#5dca96";
const pct = (v) => (v == null ? "—" : Math.round(v * 100) + "%");
const num4 = (v) => (v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(4));
const th = (extra) => ({ padding: "6px 8px", textAlign: "right", color: C.txd, fontWeight: 600, borderBottom: "1px solid " + C.bdr, whiteSpace: "nowrap", fontSize: 10, ...extra });
const td = (extra) => ({ padding: "6px 8px", textAlign: "right", fontFamily: "monospace", fontSize: 11, color: C.txt, whiteSpace: "nowrap", ...extra });

const CELL_COLS = [
  ["공고", (c) => c.notices],
  ["투찰", (c) => c.bids],
  ["커버리지", (c) => pct(c.coverage)],
  ["통과율", (c) => pct(c.passRate), (c) => (c.passRate == null ? C.txt : c.passRate < PASS_OK ? RED : GREEN)],
  ["하한미달", (c) => c.belowFloor],
  ["1위근접", (c) => c.nearBand],
  ["10위↓", (c) => c.top10],
  ["1위", (c) => c.rank1],
  ["간격", (c) => num4(c.medGap)],
];

const SUMMARY_CARDS = [
  ["커버리지", (s) => s.coverage, "키워드 일치 공고 중 자사가 투찰한 비율"],
  ["통과율", (s) => s.passRate, "하한가 위에 안착한 비율 — 90% 미만이면 가정 사정률을 올려야 합니다"],
  ["1위 근접률", (s) => s.nearRate, `통과 건 중 1위 투찰률과 ${NEAR_GAP_MAX}%p 이내였던 비율`],
];

export default function PerformanceTab({ recs, bidDetails }) {
  const [keywords, setKeywords] = useState(() => loadKeywords());
  const [kwInput, setKwInput] = useState(() => keywords.join(", "));
  const today = new Date().toISOString().slice(0, 10);
  const out = useMemo(() => aggregatePerformance(bidDetails || [], recs || [], keywords, today), [bidDetails, recs, keywords, today]);
  const { months, summary, totals } = out;

  const apply = () => { const kws = saveKeywords(kwInput); setKeywords(kws); setKwInput(kws.join(", ")); };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: C.txt }}>성과 — 자사 성적표</span>
        <span style={{ fontSize: 10, color: C.txd }}>자격 키워드</span>
        <input value={kwInput} onChange={(e) => setKwInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") apply(); }}
          style={{ padding: "4px 8px", fontSize: 11, background: C.bg3, color: C.txt, border: "1px solid " + C.bdr, borderRadius: 4, width: 180 }} />
        <button onClick={apply} style={{ padding: "4px 10px", fontSize: 11, background: C.bg3, color: C.gold, border: "1px solid " + C.bdr, borderRadius: 4, cursor: "pointer" }}>적용</button>
        <span style={{ fontSize: 10, color: C.txd }}>관내 = 발주처·공고명에 키워드 포함 · 소경쟁 = 참가자 {SMALL_PC_MAX}개사 미만(개찰 후 실측)</span>
      </div>

      {(!bidDetails || bidDetails.length === 0) && (
        <div style={{ padding: 20, color: C.txd, fontSize: 12, background: C.bg2, border: "1px solid " + C.bdr, borderRadius: 8, marginBottom: 12 }}>
          SUCVIEW 개찰 결과 업로드가 없습니다. 데이터를 올리면 성적표가 채워집니다.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14 }}>
        {SUMMARY_CARDS.map(([label, get, hint]) => {
          const v = get(summary);
          const color = label === "통과율" && v != null ? (v < PASS_OK ? RED : GREEN) : C.gold;
          return (
            <div key={label} style={{ background: C.bg2, border: "1px solid " + C.bdr, borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ fontSize: 10, color: C.txd }}>최근 3개월 관내·소경쟁 {label} <span style={{ color: C.txd }}>(n={summary.n})</span></div>
              <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "monospace", color, lineHeight: 1.3 }}>{pct(v)}</div>
              <div style={{ fontSize: 10, color: C.txm, lineHeight: 1.4 }}>{hint}</div>
            </div>
          );
        })}
      </div>

      <div style={{ overflowX: "auto", background: C.bg2, border: "1px solid " + C.bdr, borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
          <thead>
            <tr>
              <th style={th({ textAlign: "left" })} rowSpan={2}>월</th>
              <th style={th({ textAlign: "center", color: C.gold })} colSpan={CELL_COLS.length}>관내·소경쟁</th>
              <th style={th({ textAlign: "center", borderLeft: "1px solid " + C.bdr })} colSpan={CELL_COLS.length}>일반</th>
            </tr>
            <tr>
              {["target", "general"].map((g) => CELL_COLS.map(([h], i) => (
                <th key={g + h} style={th(g === "general" && i === 0 ? { borderLeft: "1px solid " + C.bdr } : {})}>{h}</th>
              )))}
            </tr>
          </thead>
          <tbody>
            {months.length === 0 && <tr><td colSpan={1 + CELL_COLS.length * 2} style={td({ textAlign: "center", color: C.txd, padding: 20 })}>데이터 없음</td></tr>}
            {months.map((m) => (
              <tr key={m.month} style={{ borderBottom: "1px solid " + C.bdr }}>
                <td style={td({ textAlign: "left" })}>
                  {m.month}
                  {m.noUpload && <span style={{ marginLeft: 6, fontSize: 9, padding: "1px 5px", border: "1px solid " + C.bdr, borderRadius: 4, color: C.txd }}>업로드 없음</span>}
                </td>
                {["target", "general"].map((g) => CELL_COLS.map(([h, get, colorOf], i) => {
                  const c = m[g];
                  const hide = (m.noUpload && i >= 1) || (g === "general" && h === "커버리지"); // 일반 그룹 커버리지는 정의상 무의미
                  return (
                    <td key={g + h} style={td({ color: hide ? C.txd : colorOf ? colorOf(c) : C.txt, ...(g === "general" && i === 0 ? { borderLeft: "1px solid " + C.bdr } : {}) })}>
                      {hide ? (m.noUpload ? "" : "—") : get(c)}
                    </td>
                  );
                }))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 8, fontSize: 10, color: C.txd, lineHeight: 1.6 }}>
        <div>전체 투찰 {totals.bids}건 · 하한 미달 {totals.belowFloor}건 · 키워드 일치 {totals.eligibleBids}건(그중 통과 아님 {totals.eligibleNotPassed}건)</div>
        <div>관내·소경쟁 공고 수와 커버리지는 키워드 일치 공고 기준(타지역 소경쟁 공고는 자사 자격 밖). 소경쟁 투찰은 투찰 수·통과율에만 포함. 간격 = 통과 건의 자사 투찰률 − 1위 투찰률 중앙값(%p).</div>
      </div>
    </div>
  );
}
