// 자사 성적표 월별 집계 — 순수 함수. bid_rate 공간 지표만(adj_rate 공간 WIN-zone KPI 금지).
// 입력 배열(bidDetails·recs)은 예측 엔진과 공유되므로 절대 제자리 변형하지 않는다.
// 스펙: docs/superpowers/specs/2026-10-22-bid-ops-funnel-redesign-design.md §6.4
import { isEligible, isSmallField } from "./eligibility.js";

export const NEAR_GAP_MAX = 0.5;   // 1위 근접: 통과 건 중 my_bid_rate − win_bid_rate ≤ 0.5%p
export const GAP_SANE_MAX = 5;     // 입력 오류 방어(win_bid_rate 66.4 같은 값)

const num = (v) => { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

export function dedupeByPnNo(rows) {
  const seen = new Set(); const out = [];
  for (const r of rows || []) {
    const k = r?.pn_no;
    if (k == null || k === "") { out.push(r); continue; }
    if (seen.has(k)) continue;
    seen.add(k); out.push(r);
  }
  return out;
}

export function classifyDetail(d, keywords) {
  if (!d?.od) return null;
  const rank = num(d.my_rank);
  const passed = rank != null && rank >= 1;
  const myBid = num(d.my_bid_rate), floor = num(d.floor_rate), winBid = num(d.win_bid_rate);
  const belowFloor = myBid != null && floor != null && myBid < floor;
  let gapToWin = passed && myBid != null && winBid != null ? myBid - winBid : null;
  if (gapToWin != null && Math.abs(gapToWin) > GAP_SANE_MAX) gapToWin = null;
  const eligible = isEligible({ ag: d.ag, pn: d.pn }, keywords);
  const small = isSmallField(d.participant_count);
  return {
    month: String(d.od).slice(0, 7),
    group: eligible || small ? "target" : "general",
    eligible, small, passed, belowFloor,
    nearBand: gapToWin != null && gapToWin <= NEAR_GAP_MAX,
    top10: passed && rank <= 10,
    rank1: passed && rank === 1,
    gapToWin,
  };
}

// 공고 모수(분모)는 키워드 일치만 — 타지역 소경쟁 공고는 자사 자격 밖이라 "관내·소경쟁"에 넣지 않는다.
export function classifyRecord(r, keywords) {
  if (!r?.od || r.is_excluded === true || !r.co || !String(r.co).trim()) return null;
  return { month: String(r.od).slice(0, 7), group: isEligible({ ag: r.ag, pn: r.pn }, keywords) ? "target" : "general" };
}

const newCell = () => ({ notices: 0, bids: 0, eligibleBids: 0, coverage: null, passed: 0, passRate: null, belowFloor: 0, nearBand: 0, top10: 0, rank1: 0, medGap: null, _gaps: [] });

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1;
  const v = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  return Math.round(v * 1e4) / 1e4;
}

function finishCell(c) {
  c.coverage = c.notices > 0 ? c.eligibleBids / c.notices : null;   // 분자·분모 모두 키워드 기준
  c.passRate = c.bids > 0 ? c.passed / c.bids : null;
  c.medGap = median(c._gaps);
  delete c._gaps;
  return c;
}

function monthRange(fromYm, toYm) {
  const out = [];
  let [y, m] = fromYm.split("-").map(Number);
  const [ty, tm] = toYm.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

export function aggregatePerformance(details, records, keywords, todayIso) {
  const ds = dedupeByPnNo(details).map(d => classifyDetail(d, keywords)).filter(Boolean);
  const rs = dedupeByPnNo(records).map(r => classifyRecord(r, keywords)).filter(Boolean);
  const totals = { bids: ds.length, belowFloor: 0, eligibleBids: 0, eligibleNotPassed: 0 };
  const empty = { coverage: null, passRate: null, nearRate: null, n: 0, passed: 0, notices: 0, months: [] };
  if (!ds.length) return { months: [], summary: empty, totals };

  const minMonth = ds.reduce((a, d) => (d.month < a ? d.month : a), ds[0].month);
  const toMonth = String(todayIso).slice(0, 7);
  const byMonth = new Map(monthRange(minMonth, toMonth > minMonth ? toMonth : minMonth).map(m => [m, { month: m, target: newCell(), general: newCell(), noUpload: true }]));

  for (const r of rs) { const row = byMonth.get(r.month); if (row) row[r.group].notices++; }
  for (const d of ds) {
    if (d.belowFloor) totals.belowFloor++;
    if (d.eligible) { totals.eligibleBids++; if (!d.passed) totals.eligibleNotPassed++; }
    const row = byMonth.get(d.month); if (!row) continue;
    const c = row[d.group];
    c.bids++; if (d.eligible) c.eligibleBids++; if (d.passed) c.passed++; if (d.belowFloor) c.belowFloor++; if (d.nearBand) c.nearBand++;
    if (d.top10) c.top10++; if (d.rank1) c.rank1++; if (d.gapToWin != null) c._gaps.push(d.gapToWin);
  }

  const months = [...byMonth.values()].reverse().map(row => {
    row.noUpload = row.target.bids + row.general.bids === 0;
    finishCell(row.target); finishCell(row.general);
    return row;
  });

  // 요약: 업로드 있는 최근 3개월의 target 합산
  const recent = months.filter(m => !m.noUpload).slice(0, 3);
  const sum = recent.reduce((a, m) => ({ notices: a.notices + m.target.notices, bids: a.bids + m.target.bids, eligibleBids: a.eligibleBids + m.target.eligibleBids, passed: a.passed + m.target.passed, nearBand: a.nearBand + m.target.nearBand }), { notices: 0, bids: 0, eligibleBids: 0, passed: 0, nearBand: 0 });
  const summary = recent.length ? {
    coverage: sum.notices > 0 ? sum.eligibleBids / sum.notices : null,
    passRate: sum.bids > 0 ? sum.passed / sum.bids : null,
    nearRate: sum.passed > 0 ? sum.nearBand / sum.passed : null,   // 분모 = 통과 건 (카드 설명문과 일치)
    n: sum.bids, passed: sum.passed, notices: sum.notices,
    months: recent.map(m => m.month),
  } : empty;
  return { months, summary, totals };
}
