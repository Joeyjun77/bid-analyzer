// 오늘의 공고 — 공고(bid_notices)와 예측(bid_predictions)을 공고번호로 합쳐 작업 목록 행을 만든다. 순수 함수.
// 통합 키 = 공고번호에서 차수 접미사(-NNN) 제거. 선택 규칙 = file_upload > 그 외, 같은 출처는 개찰일 일치 > created_at desc > id desc.
// 스펙: docs/superpowers/specs/2026-10-22-bid-ops-funnel-redesign-design.md §6.2·§10
import { isEligible, isSmallField } from "./eligibility.js";

export const STATUS = { OPENED: "opened", CLOSED: "closed", BID: "bid", PRED_FILE: "pred_file", PRED_AUTO: "pred_auto", NONE: "none" };

export function basePnNo(pnNo) {
  const s = pnNo == null ? "" : String(pnNo).trim().replace(/-\d{3}$/, "");
  return s || null;
}

const num = (v) => { const n = Number(v); return v == null || v === "" || !Number.isFinite(n) ? null : n; };
const ts = (v) => { const t = v ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; };

export function pickPrediction(cands, noticeOdDate) {
  if (!cands?.length) return null;
  const score = (p) => [
    p.source === "file_upload" ? 1 : 0,
    noticeOdDate && p.open_date && String(p.open_date).slice(0, 10) === noticeOdDate ? 1 : 0,
    ts(p.created_at) ?? 0,
    Number(p.id) || 0,
  ];
  return [...cands].sort((a, b) => { const x = score(a), y = score(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0; })[0];
}

export function statusOf(row, nowIso) {
  const now = ts(nowIso), open = ts(row.openAt), close = ts(row.closeAt);
  if (open != null && open < now) return STATUS.OPENED;
  if (close != null && close < now) return STATUS.CLOSED;
  if (row.participated === true) return STATUS.BID;
  if (row.source === "file_upload") return STATUS.PRED_FILE;
  if (row.predId != null && row.source) return STATUS.PRED_AUTO;
  return STATUS.NONE;
}

export function buildTodayRows({ notices, predictions, keywords, pcOf, nowIso }) {
  const today = String(nowIso).slice(0, 10);
  const pending = (predictions || []).filter(p => p && p.match_status !== "matched");
  const byKey = new Map(); const byId = new Map();
  for (const p of pending) {
    byId.set(p.id, p);
    const k = basePnNo(p.pn_no);
    if (k) { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(p); }
  }
  const consumed = new Set();
  const decorate = (row) => {
    const d = pcOf && row.at && row.amount ? pcOf({ at: row.at, ag: row.ag, amount: row.amount }) : null;
    row.p50 = d?.p50 ?? null; row.grain = d?.grain ?? null;
    const small = row.p50 != null && row.grain !== "AT_BA" && isSmallField(row.p50);
    row.group = isEligible({ ag: row.ag, pn: row.pn }, keywords) || small ? "target" : "general";
    row.status = statusOf(row, nowIso);
    row.sortAt = ts(row.closeAt) ?? ts(row.openAt);
    return row;
  };
  const rows = [];
  for (const n of notices || []) {
    const k = basePnNo(n.pn_no);
    const cands = [...(k ? byKey.get(k) || [] : [])];
    const linked = n.prediction_id != null ? byId.get(n.prediction_id) : null;
    if (linked && !cands.includes(linked)) cands.push(linked);
    const pred = pickPrediction(cands, n.od ? String(n.od).slice(0, 10) : null);
    for (const c of cands) consumed.add(c.id);
    const ba = num(n.ba), ep = num(n.ep);
    rows.push(decorate({
      key: "n:" + n.id, pnNo: k, pn: n.pn, ag: n.ag, at: n.at,
      amount: ba > 0 ? ba : ep > 0 ? ep * 1.1 : null, amountEstimated: !(ba > 0),
      closeAt: n.bid_close_dt || null, openAt: n.od || null, participated: n.participated === true,
      noticeId: n.id, predId: pred ? pred.id : null, source: pred ? pred.source : null,
    }));
  }
  for (const p of pending) {
    if (consumed.has(p.id) || p.source !== "file_upload" || !p.open_date || String(p.open_date).slice(0, 10) < today) continue;
    rows.push(decorate({
      key: "p:" + p.id, pnNo: basePnNo(p.pn_no), pn: p.pn, ag: p.ag, at: p.at,
      amount: num(p.ba), amountEstimated: false,
      closeAt: null, openAt: p.open_date, participated: false,
      noticeId: null, predId: p.id, source: p.source,
    }));
  }
  return rows.sort((a, b) => (a.sortAt ?? Infinity) - (b.sortAt ?? Infinity));
}

export function filterRows(rows, view, includeDone) {
  return (rows || []).filter(r => (view === "all" || r.group === "target") && (includeDone || (r.status !== STATUS.OPENED && r.status !== STATUS.CLOSED)));
}
