// V2_UI_SPEC §2 — "왜 이 추천인가" 사이드 패널 (PC 환경 상시 노출)
// 모드 판정 근거 + 유사 사례 표본 수 + gap 통계 표시

const C = {
  fg: "#222",
  fgMuted: "#666",
  bg: "#fafbfc",
  border: "#e0e5eb",
};

const S = {
  card: {
    background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6,
    padding: 14, fontFamily: "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
    fontSize: 12,
  },
  title: { fontWeight: 700, fontSize: 13, color: C.fg, marginBottom: 10 },
  row: { display: "flex", justifyContent: "space-between", padding: "4px 0" },
  label: { color: C.fgMuted },
  value: { color: C.fg, fontFamily: "monospace" },
  divider: { borderTop: `1px solid ${C.border}`, margin: "8px 0" },
  modeJudge: { marginTop: 8, padding: "6px 8px", background: "#fff", borderRadius: 4, color: C.fgMuted, fontSize: 11, lineHeight: 1.4 },
};

const GRAIN_LABEL = {
  AG_BA: "발주사 × 금액대",
  AG:    "발주사 단위",
  AT:    "발주유형 (fallback)",
};

export default function WhyPanel({ resolution, agencyName }) {
  if (!resolution) {
    return (
      <div style={S.card}>
        <div style={S.title}>▸ 왜 이 추천인가</div>
        <div style={{ color: C.fgMuted }}>표본 부족 또는 미조회 상태</div>
      </div>
    );
  }

  const { matched_grain, mode_recommend, confidence, n, median_gap, p90_gap, source } = resolution;
  const grainLabel = GRAIN_LABEL[matched_grain] || matched_grain || "—";
  const modeReason = mode_recommend === "A"
    ? (matched_grain === "AT" && agencyName ? "군시설 영역 또는 gap p90 ≥ 0.10" : `gap p90 ${p90_gap?.toFixed?.(4) ?? "—"} ≥ 0.10`)
    : `gap p90 ${p90_gap?.toFixed?.(4) ?? "—"} < 0.10 → 하한 안착 우선`;

  return (
    <div style={S.card}>
      <div style={S.title}>▸ 왜 이 추천인가</div>
      <div style={S.row}>
        <span style={S.label}>매칭 grain</span>
        <span style={S.value}>{grainLabel}</span>
      </div>
      <div style={S.row}>
        <span style={S.label}>유사사례 n</span>
        <span style={S.value}>{n ?? "—"}건</span>
      </div>
      <div style={S.row}>
        <span style={S.label}>gap median</span>
        <span style={S.value}>{median_gap != null ? median_gap.toFixed(4) : "—"}</span>
      </div>
      <div style={S.row}>
        <span style={S.label}>gap p90</span>
        <span style={S.value}>{p90_gap != null ? p90_gap.toFixed(4) : "—"}</span>
      </div>
      <div style={S.row}>
        <span style={S.label}>신뢰도</span>
        <span style={S.value}>{confidence ?? "—"}</span>
      </div>
      <div style={S.divider} />
      <div style={S.modeJudge}>
        모드 판정: {mode_recommend === "A" ? "공략" : "안착"} ({modeReason})
        {source === "static" && <div style={{ marginTop: 4, color: "#a36b00" }}>※ 정적 fallback (RPC 호출 실패)</div>}
      </div>
    </div>
  );
}
