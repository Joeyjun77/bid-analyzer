// 하한 통과 확률 — 발주기관의 과거 발주처 사정율 기록 기반 (표시 전용 — Evaluator). 순수 모듈, node 테스트 가능.
// 스펙: .scratch/main-rec-passprob/spec.md §5
// 정의: 통과 확률(투찰금 b) = 기준 기록 중 (ar1 − 100) ≤ a(b) 인 비율
//   a(b) = 투찰금 b가 낙찰하한가와 같아지는 사정률. utils.js _invertBidCToAdj와 같은 식이다
//   (utils.js는 auth import 체인 때문에 node에서 불러올 수 없어 여기 따로 두고 tests/passProb.test.mjs의 왕복 테스트로 고정).
// 기준 기록: 같은 발주기관 최근 1,095일 → 30건 미만이면 같은 기관유형. 사정률은 복수예비가 추첨 결과라 금액대·요율 시기로 나누지 않는다.
// 전제: effFr(낙찰하한율 + 자사 점수 가산)이 실제와 맞아야 한다. 요율이 틀린 행에서는 확률도 틀린다(워크포워드: 추정 54% vs 실제 23%).
// 검증(2026-10-13, 812건 워크포워드 — 현재 요율표로 계산한 메인 추천에서 기초금액의 ±%p만큼 옮긴 투찰금, 추정/실제 %):
//   −0.5 21.7/24.6 · 0 51.5/54.8 · +0.5 80.7/83.1 · +1.0 95.5/96.4 · +1.5 99.4/99.4. 전 구간 추정이 실제보다 0~3.3%p 낮다(조심스러운 방향).

export const PASS_PROB_WINDOW_DAYS = 1095;
export const PASS_PROB_MIN_N = 30;
export const SAFE_LINE_MIN_N = 100;   // 꼬리 분위(95%)는 표본 요건이 더 높다
export const SAFE_LINE_Q = 0.95;

const EPS = 1e-9;                     // 사정률은 4자리 값 — 부동소수 오차로 "같은 값"이 빠지지 않게

function isoDaysBefore(todayIso, days) {
  const d = new Date(todayIso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// records → { ag: {발주기관: 오름차순 사정률[]}, at: {유형: 오름차순 사정률[]} }
export function buildAdjHistory(records, todayIso) {
  const from = isoDaysBefore(todayIso, PASS_PROB_WINDOW_DAYS);
  const ag = {}, at = {};
  for (const r of records || []) {
    if (!r || r.is_excluded === true || r.ar1 == null || r.ar1 === "") continue;
    const od = r.od ? String(r.od).slice(0, 10) : null;
    if (!od || od < from || od > todayIso) continue;
    const ar1 = Number(r.ar1);
    if (!isFinite(ar1) || ar1 < 95 || ar1 > 105) continue;
    const adj = Math.round((ar1 - 100) * 1e4) / 1e4;
    const k = r.canonical_ag || r.ag;
    if (k) (ag[k] || (ag[k] = [])).push(adj);
    if (r.at) (at[r.at] || (at[r.at] = [])).push(adj);
  }
  const asc = (a, b) => a - b;
  for (const k in ag) ag[k].sort(asc);
  for (const k in at) at[k].sort(asc);
  return { ag, at };
}

// 발주기관(minN 이상) → 기관유형(minN 이상) → null
export function resolveAdjHistory(hist, { at, canonicalAg }, minN = PASS_PROB_MIN_N) {
  if (!hist) return null;
  const a = canonicalAg ? hist.ag[canonicalAg] : null;
  if (a && a.length >= minN) return { grain: "AG", n: a.length, arr: a };
  const t = at ? hist.at[at] : null;
  if (t && t.length >= minN) return { grain: "AT", n: t.length, arr: t };
  return null;
}

// 오름차순 배열에서 x 이하인 원소 수 (이분 탐색)
function countLE(arr, x) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] <= x) lo = mid + 1; else hi = mid; }
  return lo;
}

// 투찰금이 낙찰하한가와 같아지는 사정률
export function impliedAdjOfBid({ bid, ba, av, effFr }) {
  const b = Number(bid), B = Number(ba), A = Number(av) || 0, f = Number(effFr);
  if (!(b > 0) || !(B > 0) || !(f > 0)) return null;
  const xp = A > 0 ? A + (b - A) * 100 / f : b * 100 / f;
  return (xp / B - 1) * 100;
}

// 통과 확률 0~100. 표기는 floorLabels.js가 맡는다.
export function passProbPct(dist, impliedAdj) {
  if (!dist || !dist.arr || !dist.arr.length || impliedAdj == null || !isFinite(Number(impliedAdj))) return null;
  return 100 * countLE(dist.arr, Number(impliedAdj) + EPS) / dist.arr.length;
}

// 통과 확률이 q가 되는 투찰금(원). 기준 기록의 q 분위 사정률을 bidC(utils.js)와 같은 식으로 금액화한다.
export function bidAtPassProb(dist, q, { ba, av, effFr }) {
  const B = Number(ba), A = Number(av) || 0, f = Number(effFr);
  if (!dist || !dist.arr || !dist.arr.length || !(B > 0) || !(f > 0)) return null;
  const n = dist.arr.length;
  const adj = dist.arr[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))];
  const xp = B * (1 + adj / 100);
  return A > 0 ? Math.ceil(A + (xp - A) * (f / 100)) : Math.ceil(xp * (f / 100));
}

// bid_predictions INSERT용 스냅샷 4필드. floor_risk_grain 'AG'|'AT' = 이 방식(이전 방식은 'AG_BA'|'AT_BA').
export function passRiskSnapshot(hist, { at, canonicalAg, ba, av, effFr, bid, jongsim, withSafeLine }) {
  const none = { disq_risk_pct: null, safe_bid: null, floor_risk_n: null, floor_risk_grain: null };
  if (jongsim) return none;
  const dist = resolveAdjHistory(hist, { at, canonicalAg });
  if (!dist) return none;
  const pass = passProbPct(dist, impliedAdjOfBid({ bid, ba, av, effFr }));
  const safeDist = withSafeLine ? resolveAdjHistory(hist, { at, canonicalAg }, SAFE_LINE_MIN_N) : null;
  return {
    disq_risk_pct: pass == null ? null : Number((100 - pass).toFixed(2)),
    safe_bid: safeDist ? bidAtPassProb(safeDist, SAFE_LINE_Q, { ba, av, effFr }) : null,
    floor_risk_n: dist.n,
    floor_risk_grain: dist.grain,
  };
}
