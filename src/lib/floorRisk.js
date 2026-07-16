// Mode B 실격위험% + 안전투찰선 (Phase 1, 표시 전용 — Evaluator)
// 근거: .scratch/mode-b-disqual-risk/spec.md v2 (predict-architect 검토 반영)
// 정의: 실격위험% = P(실현 낙찰하한가 > 투찰금) — grain별 floor_price/ba 경험분포(365d, current era)와 직접 비교
// 데이터: DB floor_rate_distribution (m38, jobid 7 일배치 갱신) — 클라이언트는 조회·보간만 (단일 정의)
// 소비 규칙: 위험% n>=60, 안전투찰선(q95) n>=100. fallback AG_BA → AT_BA ("표본 부족" 배지)
// 문구 규정: 안전투찰선은 "탈락 회피 하한선" — 추천 투찰가 아님 (상향 투찰 유도 금지, 추첨 천장)

import { authedFetch } from "../auth.js";

export function floorBaSeg(ba) {
  const b = Number(ba);
  if (!isFinite(b) || b <= 0) return null;
  if (b < 1e8) return "S1";
  if (b < 3e8) return "S2";
  if (b < 1e9) return "S3";
  if (b < 3e9) return "S4";
  return "S5";
}

// floor_rate_distribution 전량 fetch → { agBa: {at|ag|seg: dist}, atBa: {at|seg: dist} }
// dist = { n, confidence, mean, std, p05..p99 (숫자) }
export async function sbFetchFloorRateDistMap() {
  try {
    const res = await authedFetch(
      "/rest/v1/floor_rate_distribution?era_v2=eq.current&select=at,canonical_ag,ba_seg,window_days,n,confidence,frac_mean,frac_std,frac_p05,frac_p10,frac_p25,frac_p50,frac_p75,frac_p80,frac_p85,frac_p90,frac_p95,frac_p97,frac_p99&limit=2000"
    );
    if (!res.ok) return null;
    const rows = await res.json();
    const m = { agBa: {}, atBa: {} };
    for (const r of rows) {
      const d = {
        n: Number(r.n), confidence: r.confidence, window: Number(r.window_days) || 365,
        mean: Number(r.frac_mean), std: Number(r.frac_std),
        p05: Number(r.frac_p05), p10: Number(r.frac_p10), p25: Number(r.frac_p25),
        p50: Number(r.frac_p50), p75: Number(r.frac_p75), p80: Number(r.frac_p80),
        p85: Number(r.frac_p85), p90: Number(r.frac_p90), p95: Number(r.frac_p95),
        p97: Number(r.frac_p97), p99: Number(r.frac_p99),
      };
      if (r.canonical_ag) m.agBa[r.at + "|" + r.canonical_ag + "|" + r.ba_seg] = d;
      else m.atBa[r.at + "|" + r.ba_seg] = d;
    }
    return m;
  } catch (e) { return null; }
}

// 2단 fallback: AG_BA(n>=minN) → AT_BA(n>=minN). 실패 시 null (표시 "—")
// minN 기본 60(위험%). 안전선(q95)은 minN=100으로 별도 resolve — AG_BA가 60~99일 때
// 안전선만 AT_BA로 내려가도록 (꼬리 분위수 표본 요건이 더 높음)
export function resolveFloorDist(map, { at, canonicalAg, ba }, minN = 60) {
  if (!map || !at) return null;
  const seg = floorBaSeg(ba);
  if (!seg) return null;
  if (canonicalAg) {
    const d = map.agBa[at + "|" + canonicalAg + "|" + seg];
    if (d && d.n >= minN) return { grain: "AG_BA", ...d };
  }
  const d = map.atBa[at + "|" + seg];
  if (d && d.n >= minN) return { grain: "AT_BA", ...d };
  return null;
}

const GRID = [
  [5, "p05"], [10, "p10"], [25, "p25"], [50, "p50"], [75, "p75"],
  [80, "p80"], [85, "p85"], [90, "p90"], [95, "p95"], [97, "p97"], [99, "p99"],
];

// 실격위험% = 100 − CDF(투찰금/ba), percentile grid 선형 보간.
// grid 밖: p05 미만 → 97.5 (표시 "≥95%"), p99 이상 → 0.5 (표시 "<1%")
export function floorRiskPct(dist, bid, ba) {
  if (!dist || !bid || !ba) return null;
  const f = Number(bid) / Number(ba);
  if (!isFinite(f) || f <= 0) return null;
  if (f < dist.p05) return 97.5;
  if (f >= dist.p99) return 0.5;
  for (let i = 0; i < GRID.length - 1; i++) {
    const [q0, k0] = GRID[i], [q1, k1] = GRID[i + 1];
    const v0 = dist[k0], v1 = dist[k1];
    if (f >= v0 && f < v1) {
      const q = v1 > v0 ? q0 + (q1 - q0) * (f - v0) / (v1 - v0) : q1;
      return Math.max(0.5, Math.min(97.5, 100 - q));
    }
  }
  return 0.5;
}

// 안전투찰선(탈락 회피 하한선) = p95 × ba. q95 꼬리 안정성 위해 n>=100 분포에서만.
// 호출자는 resolveFloorDist(map, keys, 100)으로 resolve한 dist를 넘길 것.
export function floorSafeBid(dist, ba) {
  if (!dist || dist.n < 100 || !ba) return null;
  const v = dist.p95 * Number(ba);
  return isFinite(v) && v > 0 ? Math.ceil(v) : null;
}

// 모드 분기 (V2 규칙: 군시설=A WIN-zone 노림, 그 외=B 하한 안착)
export function floorModeOf(at) {
  return at === "군시설" ? "A" : "B";
}

export function riskColor(risk) {
  if (risk == null) return null;
  if (risk >= 25) return "#e24b4a";
  if (risk >= 10) return "#d4a834";
  return "#5dca96";
}

export function riskLabel(risk) {
  if (risk == null) return "—";
  if (risk >= 95) return "≥95%";
  if (risk < 1) return "<1%";
  return risk.toFixed(risk < 10 ? 1 : 0) + "%";
}

// 저장 스냅샷 필드 4개 (bid_predictions INSERT payload용, UPDATE 금지)
export function floorRiskSnapshot(map, { at, canonicalAg, ba, bid, jongsim }) {
  if (jongsim) return { disq_risk_pct: null, safe_bid: null, floor_risk_n: null, floor_risk_grain: null };
  const dist = resolveFloorDist(map, { at, canonicalAg, ba });
  if (!dist) return { disq_risk_pct: null, safe_bid: null, floor_risk_n: null, floor_risk_grain: null };
  const risk = floorRiskPct(dist, bid, ba);
  const safeDist = resolveFloorDist(map, { at, canonicalAg, ba }, 100);
  const safe = floorModeOf(at) === "B" ? floorSafeBid(safeDist, ba) : null;
  return {
    disq_risk_pct: risk == null ? null : Number(risk.toFixed(2)),
    safe_bid: safe,
    floor_risk_n: dist.n,
    floor_risk_grain: dist.grain,
  };
}
