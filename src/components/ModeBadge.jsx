// V2_UI_SPEC §2 — 안착/공략 모드 배지 (필수, 거짓 약속 방지 안전장치)
// /evaluate G-모드표시 게이트와 정합

import { getModeBadgeLabel } from "../lib/modeResolver.js";

const STYLE = {
  base: {
    display: "inline-block",
    padding: "3px 10px",
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.02em",
  },
  modeA: { background: "#fff3cd", color: "#8a6d3b", border: "1px solid #f0d27a" },
  modeB: { background: "#e6f4ec", color: "#236b3f", border: "1px solid #b6e0c5" },
  unknown: { background: "#eee", color: "#666", border: "1px solid #ccc" },
};

export default function ModeBadge({ mode, confidence }) {
  const label = getModeBadgeLabel(mode);
  const style = mode === "A" ? { ...STYLE.base, ...STYLE.modeA }
                : mode === "B" ? { ...STYLE.base, ...STYLE.modeB }
                : { ...STYLE.base, ...STYLE.unknown };
  return (
    <span style={style} title={confidence ? `신뢰도: ${confidence}` : undefined}>
      {label}
      {confidence === "low" && <span style={{ marginLeft: 6, opacity: 0.7 }}>· 표본 적음</span>}
      {confidence === "medium" && <span style={{ marginLeft: 6, opacity: 0.7 }}>· 보통</span>}
    </span>
  );
}
