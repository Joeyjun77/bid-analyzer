// V2_UI_SPEC §1 원칙 4 — 듀얼표기 보존
// 사정률 0-base (±값) + 100-base 동시 표기, 예: "-0.21% (99.79%)"
// 단일 진실: 본 모듈. App.jsx 인라인 fmtAdj (line 1566) 및 WinStrategyDashboard.jsx (line 28) 추후 폐기 대상.

export function toP100(adj) {
  return adj == null ? null : 100 + Number(adj);
}

// 단일 100-base 표기 (예: "99.79%")
export function fmtP100(adj, decimals = 3) {
  const v = toP100(adj);
  if (v == null || isNaN(v)) return "—";
  return v.toFixed(decimals) + "%";
}

// 사정률 단일 표기 (예: "-0.210%", "+0.305%", "0.000%")
export function fmtAdjOnly(adj, decimals = 3) {
  if (adj == null || isNaN(Number(adj))) return "—";
  const n = Number(adj);
  const sign = n > 0 ? "+" : "";
  return sign + n.toFixed(decimals) + "%";
}

// V2 권장 듀얼표기 (예: "-0.210% (99.790%)")
export function fmtAdj(adj, decimals = 3) {
  if (adj == null || isNaN(Number(adj))) return "—";
  return `${fmtAdjOnly(adj, decimals)} (${fmtP100(adj, decimals)})`;
}

// 확률 표기 (예: "87%", "24.3%")
export function fmtPct(p, decimals = 0) {
  if (p == null || isNaN(Number(p))) return "—";
  return (Number(p) * 100).toFixed(decimals) + "%";
}

// 금액 표기 (예: "₩ 418,773,294")
export function fmtKRW(amount) {
  if (amount == null || isNaN(Number(amount))) return "—";
  return "₩ " + Math.round(Number(amount)).toLocaleString("ko-KR");
}
