// 투찰 카드·오늘의 공고 공용 — 순수 함수(의존성은 인자). node --test 가능.
// 스펙: docs/superpowers/specs/2026-10-22-bid-ops-funnel-redesign-design.md §6.3

// 행 하나의 추천값. 업로드 예측(file_upload)만 getFinal(=App의 getFinalRecommendation)에 넣는다.
// 자동 예측(g2b_auto·g2b_manual)은 서버 보정이 이미 들어 있어 넣으면 보정이 2겹이 된다 — 저장된 안착안(b_pred_*, mode B)만 읽는다.
// matched 행도 계산한다(예측 기록에서 카드를 열 수 있어야 한다). 거르는 것은 호출자 몫.
export function recOfPred(p, deps) {
  if (!p) return null;
  let adj = null, bid = null, jongsim = false, estimated = false, floorSafe = null;
  if (p.source === "file_upload") {
    const r = deps.getFinal(p) || {};
    adj = r.adj ?? null; bid = r.bid1st || r.bid || null; jongsim = !!r.jongsim; floorSafe = r.floorSafe ?? null;
  } else if (p.b_pred_mode === "B" && p.b_pred_adj != null && p.b_pred_bid_amount != null) {
    adj = Number(p.b_pred_adj); bid = Number(p.b_pred_bid_amount); estimated = true;
  }
  let passPct = null, distN = null, distGrain = null;
  if (!jongsim && bid && p.ba) {
    const dist = deps.resolveAdjHistory(deps.adjHist, deps.passKeyOf(p));
    if (dist) {
      distN = dist.n ?? null; distGrain = dist.grain ?? null; // resolveAdjHistory는 {grain, n, arr}를 반환
      passPct = deps.passProbPct(dist, deps.impliedAdjOfBid({ bid: Number(bid), ba: Number(p.ba), av: Number(p.av) || 0, effFr: deps.passEffFrOf(p, deps.ownScore) }));
    }
  }
  const mode = p.b_pred_mode || (p.at === "군시설" ? "A" : "B");
  return { adj, bid, passPct, jongsim, estimated, floorSafe, source: p.source, mode, distN, distGrain };
}

// 한전 보조 공격안(참고, 표시 전용·저장 안 함) — 스펙 .scratch/kepco-aggressive/spec.md
// 2025~ 워크포워드에서 1위 분포 평균 투찰이 1위 가능을 늘린 후보 본부(같은 구간에서 골라 검증된 목록 아님, 대가: 하한 미달 급증).
export const KEPCO_ATTACK_AGENCIES = ["한국전력공사 경기본부", "한국전력공사 경기북부본부"];
// 업로드·개찰 전 행만(자동 예측은 서버값·A값 누락 가능, 개찰 후는 분포에 결과가 섞임). 분포는 백테스트와 같은 발주기관 단위(AG).
// modeResolution을 넘기지 않아 recommendV2는 항상 안착 분기 — 목표만 0.5라 사정률 ≈ 1위 분포 평균.
// mainBid = 메인 추천 투찰금 — 메인이 없거나 공격안이 더 낮지 않으면 보이지 않는다(보조 줄이 메인 없이 서거나 더 보수적이 되지 않게).
export function attackOfPred(p, deps, mainBid) {
  if (!p || p.at !== "한전" || p.source !== "file_upload" || p.match_status !== "pending" || !mainBid) return null;
  const ag = p.canonical_ag || p.ag, ba = Number(p.ba), fr = Number(p.pred_floor_rate);
  const dist = deps.distMap?.ag?.[ag];
  if (!KEPCO_ATTACK_AGENCIES.includes(ag) || !ba || !fr || !dist) return null;
  const v = deps.recommendV2({ at: p.at, agName: ag, ba, ep: Number(p.ep) || ba, av: Number(p.av) || 0, fr },
    { agencyDist: dist, ownScore: deps.ownScore }, { targetProb: 0.5 });
  if (!v || v.adj == null || v.floor_safe === false || !(v.bid < mainBid)) return null;
  const h = deps.resolveAdjHistory(deps.adjHist, deps.passKeyOf(p));
  const passPct = h ? deps.passProbPct(h, deps.impliedAdjOfBid({ bid: v.bid, ba, av: Number(p.av) || 0, effFr: deps.passEffFrOf(p, deps.ownScore) })) : null;
  return { adj: v.adj, bid: v.bid, passPct };
}

const num = (v) => { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const quantile = (s, q) => { if (!s.length) return null; const i = q * (s.length - 1), lo = Math.floor(i), hi = Math.ceil(i); return Math.round((s[lo] + (s[hi] - s[lo]) * (i - lo)) * 1e4) / 1e4; };

// 발주처 최근 1위 이력(br1=1위 사정률, ar1=발주처 사정률, 100 기준 %). 원본 불변.
// 발주처 사정률(ar1)이 있는 완전한 기록만 — ar1이 빈 행은 br1에 1위 투찰률(약 90%)이 들어 있어 사정률과 섞이면 분위수가 망가진다(G2B 양식 탭과 같은 기준).
export function agencyRecentHistory(recs, canonicalAg, n = 20) {
  const rows = (recs || [])
    .filter(r => r && r.is_excluded !== true && r.od && num(r.br1) != null && num(r.ar1) != null && (r.canonical_ag || r.ag) === canonicalAg)
    .map(r => ({ od: String(r.od).slice(0, 10), br1: num(r.br1), ar1: num(r.ar1), pn: r.pn, auto: r._auto === true }))
    .sort((a, b) => (a.od < b.od ? 1 : a.od > b.od ? -1 : 0))
    .slice(0, n);
  const s = rows.map(r => r.br1).sort((a, b) => a - b);
  return { rows, p25: quantile(s, 0.25), p50: quantile(s, 0.5), p75: quantile(s, 0.75), count: rows.length, autoCount: rows.filter(r => r.auto).length };
}
