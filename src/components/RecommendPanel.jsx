// V2_UI_SPEC §2 — 단일 패널 + 모드 스위치 (U0 mock 골격)
// 메인 숫자: Mode A=예상 낙찰 확률 / Mode B=하한 통과 확률
// 곡선·전략 3종 = UI에 없음 (백엔드는 곡선 계산하되 최적점 1개만 UI 전달)
// /evaluate G-모드표시 게이트 — Mode B 분기에 "낙찰 확률" 문구 금지

import ModeBadge from "./ModeBadge.jsx";
import { fmtAdj, fmtKRW, fmtPct } from "../lib/fmtAdj.js";
import { getMainMetricLabel, getModeNotice } from "../lib/modeResolver.js";

const C = {
  fg: "#222",
  fgMuted: "#666",
  bg: "#fff",
  bgAlt: "#f7f9fb",
  border: "#dde3ea",
  accentA: "#d28b16",
  accentB: "#1a7a4a",
};

const S = {
  card: {
    background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8,
    padding: 18, fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
  },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  agencyName: { fontSize: 15, fontWeight: 600, color: C.fg },
  divider: { borderTop: `1px solid ${C.border}`, margin: "12px 0" },
  metricRow: { display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "6px 0" },
  metricLabel: { fontSize: 13, color: C.fgMuted },
  metricValue: { fontSize: 18, fontWeight: 700, color: C.fg, fontFamily: "monospace" },
  mainMetric: {
    background: C.bgAlt, padding: "12px 14px", borderRadius: 6, marginTop: 10,
    display: "flex", justifyContent: "space-between", alignItems: "center",
  },
  mainMetricLabel: { fontSize: 13, color: C.fgMuted },
  mainMetricValue: { fontSize: 24, fontWeight: 700, fontFamily: "monospace" },
  bar: {
    flex: 1, height: 10, background: "#eee", borderRadius: 5, overflow: "hidden",
    margin: "0 12px",
  },
  barFill: { height: "100%", transition: "width 0.3s" },
  notice: {
    marginTop: 12, padding: "10px 12px", borderRadius: 4, fontSize: 13,
    background: "#fafafa", border: `1px solid ${C.border}`, color: C.fgMuted,
  },
};

export default function RecommendPanel({
  agencyName,
  workCat,
  mode,           // 'A' | 'B'
  confidence,     // 'high' | 'medium' | 'low'
  adj,            // 추천 사정률
  bidAmount,      // 추천 투찰금액
  mainMetric,     // Mode A=낙찰확률(0~1) / Mode B=하한통과확률(0~1)
}) {
  const accent = mode === "A" ? C.accentA : C.accentB;
  const metricLabel = getMainMetricLabel(mode);
  const metricPct = mainMetric != null ? Math.round(Number(mainMetric) * 100) : null;

  return (
    <div style={S.card}>
      <div style={S.header}>
        <div>
          <div style={S.agencyName}>{agencyName || "—"}{workCat ? <span style={{ color: C.fgMuted, fontWeight: 400 }}> · {workCat}</span> : null}</div>
        </div>
        <ModeBadge mode={mode} confidence={confidence} />
      </div>

      <div style={S.metricRow}>
        <span style={S.metricLabel}>추천 사정률</span>
        <span style={S.metricValue}>{fmtAdj(adj)}</span>
      </div>
      <div style={S.metricRow}>
        <span style={S.metricLabel}>추천 투찰금액</span>
        <span style={S.metricValue}>{fmtKRW(bidAmount)}</span>
      </div>

      <div style={{ ...S.mainMetric, borderLeft: `4px solid ${accent}` }}>
        <span style={S.mainMetricLabel}>{metricLabel}</span>
        <div style={S.bar}>
          {metricPct != null && (
            <div style={{ ...S.barFill, width: `${Math.min(100, metricPct)}%`, background: accent }} />
          )}
        </div>
        <span style={{ ...S.mainMetricValue, color: accent }}>
          {metricPct != null ? metricPct + "%" : "—"}
        </span>
      </div>

      <div style={S.notice}>{getModeNotice(mode)}</div>
    </div>
  );
}
