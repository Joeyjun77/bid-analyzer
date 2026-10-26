// 투찰 카드·오늘의 공고 공용 — 순수 함수(의존성은 인자). node --test 가능.
// 스펙: docs/superpowers/specs/2026-10-22-bid-ops-funnel-redesign-design.md §6.3

import { calcEffectiveFloorRate } from "./effectiveFloor.js";
import { roundExpectedPrice } from "./fmtAdj.js";
import { modeBSigmaFloor } from "./floorRisk.js";

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
// asOf(YYYY-MM-DD, 선택): 그날까지의 기록만 — 개찰 후 카드에 개찰 이후 결과가 섞이지 않게(agencyTrend의 ref를 넘긴다).
export function agencyRecentHistory(recs, canonicalAg, n = 20, asOf = null) {
  const rows = (recs || [])
    .filter(r => r && r.is_excluded !== true && r.od && num(r.br1) != null && num(r.ar1) != null && (r.canonical_ag || r.ag) === canonicalAg && (!asOf || String(r.od).slice(0, 10) <= asOf))
    .map(r => ({ od: String(r.od).slice(0, 10), br1: num(r.br1), ar1: num(r.ar1), pn: r.pn, auto: r._auto === true }))
    .sort((a, b) => (a.od < b.od ? 1 : a.od > b.od ? -1 : 0))
    .slice(0, n);
  const s = rows.map(r => r.br1).sort((a, b) => a - b);
  return { rows, p25: quantile(s, 0.25), p50: quantile(s, 0.5), p75: quantile(s, 0.75), count: rows.length, autoCount: rows.filter(r => r.auto).length };
}

// 발주기관 최근 90일 동향(표시 전용, 스펙 .scratch/agency-trend/spec.md) — 추첨 잡음과 구분되는 변화만 "다름"으로 보인다(|z|≥3).
// 줄 1: 발주처 사정률(ar1, 추첨 결과) 평균 이동 — Welch z. 줄 2: 1위 여유(금액 공간 (bp−하한가)/기초×100) ≥0.05%p 공고 비율 — 두 비율 z.
// 기준일 ref = 개찰일 전날(개찰일이 오늘 이전일 때) 또는 오늘 — 개찰 당일 자기 결과·사후 정보 제외. 오늘은 호출자가 로컬 날짜로 준다.
const TREND_MIN_RECENT = 10, TREND_MIN_PRIOR = 20, TREND_Z = 3, GAP_CUT = 0.05;
const shiftDay = (iso, k) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
const meanVar = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return [m, a.length > 1 ? a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1) : 0]; };
// 카드 기준일 — 개찰일이 오늘이거나 지났으면 개찰 전날, 미래·없음이면 오늘(동향·1위 이력·후보 비교표 공통)
export function refDateOf(openDate, today) {
  const dayBefore = openDate ? shiftDay(String(openDate).slice(0, 10), -1) : null;
  return dayBefore && dayBefore < today ? dayBefore : today;
}
export function agencyTrend(recs, canonicalAg, { openDate, today } = {}) {
  const dayBefore = openDate ? shiftDay(String(openDate).slice(0, 10), -1) : null;
  const ref = refDateOf(openDate, today);
  const recentFrom = shiftDay(ref, -90), priorFrom = shiftDay(ref, -365);
  const seen = new Set(); let autoExcluded = 0;
  const rows = [];
  for (const r of recs || []) {
    if (!r || (r.canonical_ag || r.ag) !== canonicalAg || r.is_excluded === true || /유찰/.test(r.co || "")) continue;
    const od = r.od ? String(r.od).slice(0, 10) : null, ar = num(r.ar1);
    if (!od || od > ref || od <= priorFrom || ar == null || ar < 95 || ar > 105) continue;
    if (r._auto === true) { autoExcluded++; continue; }
    if (r.pn_no) { if (seen.has(r.pn_no)) continue; seen.add(r.pn_no); }
    const bp = num(r.bp), fl = num(r.floor_price), ba = num(r.ba);
    const gap = bp != null && fl != null && ba > 0 ? (bp - fl) / ba * 100 : null;
    rows.push({ od, ar: ar - 100, gap: gap != null && gap >= 0 ? gap : null, recent: od > recentFrom });
  }
  const R = rows.filter(x => x.recent), P = rows.filter(x => !x.recent);
  const enough = (nr, np) => nr >= TREND_MIN_RECENT && np >= TREND_MIN_PRIOR;
  let ar = { status: "insufficient", nRecent: R.length, nPrior: P.length };
  if (enough(R.length, P.length)) {
    const [mr, vr] = meanVar(R.map(x => x.ar)), [mp, vp] = meanVar(P.map(x => x.ar));
    const se = Math.sqrt(vr / R.length + vp / P.length), delta = mr - mp, z = se > 0 ? delta / se : null;
    ar = { ...ar, status: "ok", meanRecent: mr, meanPrior: mp, delta, z, detect: TREND_Z * se, shift: z == null || Math.abs(z) < TREND_Z ? "none" : z > 0 ? "up" : "down" };
  }
  const gR = R.filter(x => x.gap != null), gP = P.filter(x => x.gap != null);
  let gap = { status: "insufficient", nRecent: gR.length, nPrior: gP.length };
  if (enough(gR.length, gP.length)) {
    const kR = gR.filter(x => x.gap >= GAP_CUT).length, kP = gP.filter(x => x.gap >= GAP_CUT).length;
    const pR = kR / gR.length, pP = kP / gP.length, pool = (kR + kP) / (gR.length + gP.length);
    const se = Math.sqrt(pool * (1 - pool) * (1 / gR.length + 1 / gP.length)), z = se > 0 ? (pR - pP) / se : null;
    gap = { ...gap, status: "ok", pctRecent: pR * 100, pctPrior: pP * 100, z, shift: z == null || Math.abs(z) < TREND_Z ? "none" : z > 0 ? "wider" : "narrower" };
  }
  const lastOd = R.reduce((m, x) => (m == null || x.od > m ? x.od : m), null);
  return { status: ar.status === "ok" || gap.status === "ok" ? "ok" : "insufficient", ref, refFromOpen: ref === dayBefore, autoExcluded, lastOd, ar, gap };
}

// 안착안이 상한(평균+1.5%p)에 걸렸는지 — 저장 src "modeB(N건 · μ=… · σ=…)"의 σ로 판정(스펙 .scratch/group1-display/spec.md).
// recommendModeB는 effStd=max(σ, 바닥 0.642 또는 한전·LH 0.50)로 95%를 찾고 상한 1.5에 막히므로, 걸리는 조건은 1.6449·σ > 1.5 (σ > 0.9119) 하나다(바닥은 0.9119보다 작아 무관).
// src의 σ는 소수 4자리라 실제 σ가 0.911935~0.91195이면 안내가 빠진다(통과율 차이 0.0001%p 미만, 무시).
export function capSigmaOfSrc(src) {
  const m = /^modeB\(.*σ=(-?[0-9.]+)\)/.exec(src || "");
  const s = m ? Number(m[1]) : null;
  return s != null && s > 0.9119 ? s : null;
}

// 추정가격 300억 이상 — 종합심사·종합평가 낙찰제 대상일 수 있어 적격심사 하한율 기반 추천이 맞지 않을 수 있다. 추정가격이 없거나 0이면 기초금액/1.1.
export function isLargeTender(p) {
  if (!p) return false;
  return Number(p.ep) > 0 ? Number(p.ep) >= 3e10 : (Number(p.ba) || 0) >= 3.3e10; // 기초금액 비교(÷1.1 부동소수 경계 회피)
}

// 저장 src "modeB(N건 · μ=… · σ=…)"의 분포 — 후보 비교표 값 열이 메인 추천과 같은 분포를 쓰게 한다.
export function distOfSrc(src) {
  const m = /^modeB\((\d+)건 · μ=(-?[0-9.]+) · σ=([0-9.]+)\)/.exec(src || "");
  return m ? { n: Number(m[1]), mu: Number(m[2]), sigma: Number(m[3]) } : null;
}

// 짝지은 비교의 이항 정확 검정(양측) — 엇갈린 쌍 b(기준만 1위)·c(후보만 1위)
export function binomTwoSidedP(b, c) {
  const n = b + c, k = Math.min(b, c);
  if (!n) return 1;
  let p = 0, comb = 1;
  for (let i = 0; i <= k; i++) { if (i > 0) comb = comb * (n - i + 1) / i; p += comb; }
  return Math.min(1, 2 * p / 2 ** n);
}

// 후보별 과거 성적(스펙 .scratch/candidate-compare/spec.md) — 이 기관의 2025~ 공고마다 개찰 전날까지의 1위 기록으로
// 안전선·평균+0.67σ·평균 투찰금을 만들고 실제 결과로 판정한다. 분포는 운영 win1st_dist_map과 같은 필터·기관×금액대→기관(n≥5).
// 자사 점수 반영: 공고별 실제 하한율에 calcEffectiveFloorRate. 같은 날 기록은 그날 평가를 마친 뒤 누적(자기 결과 누수 차단).
const segOf = (ba) => ba < 1e8 ? 0 : ba < 3e8 ? 1 : ba < 1e9 ? 2 : ba < 3e9 ? 3 : 4;
export function candidateBacktest(recs, { canonicalAg, at, ref, from = "2025-01-01", ownScore = 20 } = {}) {
  const floor = modeBSigmaFloor(at);
  const ag = { n: 0, s: 0, q: 0 }, seg = [0, 1, 2, 3, 4].map(() => ({ n: 0, s: 0, q: 0 }));
  const rows = { safe: { wins: 0, below: 0 }, p75: { wins: 0, below: 0 }, p50: { wins: 0, below: 0 } };
  const pairs = { p75: { b: 0, c: 0 }, p50: { b: 0, c: 0 } };
  let n = 0, skipped = 0;
  const seenEval = new Set(); // 같은 공고번호 중복 행은 한 번만 평가(분포 쪽은 뷰와 같게 중복 제거 안 함)
  const list = (recs || []).filter(r => r && r.canonical_ag === canonicalAg && r._auto !== true && r.is_excluded !== true && r.co != null && !/유찰/.test(r.co) && r.od)
    .map(r => ({ r, od: String(r.od).slice(0, 10) })).sort((a, b) => (a.od < b.od ? -1 : a.od > b.od ? 1 : 0));
  const add = (c, v) => { c.n++; c.s += v; c.q += v * v; };
  const stat = (c) => ({ mu: c.s / c.n, sd: Math.sqrt(Math.max((c.q - c.s * c.s / c.n) / (c.n - 1), 0)) });
  for (let i = 0; i < list.length;) {
    let j = i; while (j < list.length && list[j].od === list[i].od) j++;
    for (let t = i; t < j; t++) { // 그날 평가
      const { r, od } = list[t];
      const b1 = num(r.br1);
      if (od < from || od > ref || b1 == null || b1 < 95 || b1 > 105) continue; // 평가 대상도 분포와 같은 필터(다른 종류 기록은 셈에서 뺀다)
      if (r.pn_no) { if (seenEval.has(r.pn_no)) continue; seenEval.add(r.pn_no); }
      const ba = num(r.ba), av = num(r.av) || 0, xp = num(r.xp), fl = num(r.floor_price), bp = num(r.bp);
      if (!(ba > 0) || !(xp > av) || !(fl > 0) || !(bp > 0)) { skipped++; continue; }
      const frt = (fl - av) / (xp - av) * 100;
      if (!(frt > 70 && frt < 100) || bp < fl) { skipped++; continue; } // 하한율·1위 금액 이상값
      const c = seg[segOf(ba)].n >= 5 ? seg[segOf(ba)] : ag.n >= 5 ? ag : null;
      if (!c) { skipped++; continue; }
      const { mu, sd } = stat(c);
      const eff = calcEffectiveFloorRate(at, frt, ownScore);
      const ownFloor = av + (xp - av) * eff / 100 - 1e-6; // 부동소수 오차로 하한가와 같은 투찰금이 미달로 읽히지 않게
      const judge = (x) => { const bid = Math.ceil(av + (roundExpectedPrice(at, ba * (1 + x / 100)) - av) * eff / 100); return { win: bid >= ownFloor && bid < bp, below: bid < ownFloor }; };
      const v = { safe: judge(mu + Math.min(1.6449 * Math.max(sd, floor), 1.5)), p75: judge(mu + 0.6745 * sd), p50: judge(mu) };
      n++;
      for (const key of ["safe", "p75", "p50"]) { if (v[key].win) rows[key].wins++; if (v[key].below) rows[key].below++; }
      for (const key of ["p75", "p50"]) { if (v.safe.win && !v[key].win) pairs[key].b++; if (!v.safe.win && v[key].win) pairs[key].c++; }
    }
    for (let t = i; t < j; t++) { // 그날 기록 누적(평가 뒤)
      const { r, od } = list[t]; const br1 = num(r.br1), ba = num(r.ba);
      if (od < "2024-01-01" || br1 == null || br1 < 95 || br1 > 105 || !(ba > 0)) continue;
      add(ag, br1 - 100); add(seg[segOf(ba)], br1 - 100);
    }
    i = j;
  }
  for (const key of ["p75", "p50"]) pairs[key].p = binomTwoSidedP(pairs[key].b, pairs[key].c);
  return { n, skipped, rows, pairs };
}
