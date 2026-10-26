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

// 투찰금액 절상 — 원 단위 (V2_DOMAIN_RULES_CHECK #5)
// 한국 공공조달 투찰금액은 원 미만 절상이 표준
export function ceilToWon(amount) {
  return Math.ceil(Number(amount));
}

// 천원 단위 절상 (V2_DOMAIN_RULES_CHECK #3)
// LH는 투찰금이 아니라 '예정가격'을 천원 미만 절상한다(입찰교육자료, 2026-10-26 실측: LH 예정가격 187/187건 천원 배수, 1위 투찰금은 25/190건).
// recommendAssumedAdj의 calcBid(utils.js)가 투찰금에 적용하는 것은 알려진 결함(1천원 미만·보수적, 옛 경로) — 안착안은 roundExpectedPrice를 쓴다.
export function ceilToThousand(amount) {
  return Math.ceil(Number(amount) / 1000) * 1000;
}

// 예정가격(사정률 적용 후) 반올림 규칙 — LH만 천원 미만 절상, 그 외 그대로
export function roundExpectedPrice(at, xp) {
  return at === "LH" ? ceilToThousand(xp) : xp;
}
