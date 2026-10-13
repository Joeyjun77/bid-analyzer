import {
  PASS_PROB_MIN_N, SAFE_LINE_MIN_N, SAFE_LINE_Q,
  buildAdjHistory, resolveAdjHistory, impliedAdjOfBid, passProbPct, bidAtPassProb, passRiskSnapshot,
} from "../src/lib/passProb.js";

let bad = 0;
const eq = (got, exp, msg) => { if (got !== exp) { console.error(`XX ${msg}: got ${got} expect ${exp}`); bad++; } };
const near = (got, exp, tol, msg) => { if (got == null || Math.abs(got - exp) > tol) { console.error(`XX ${msg}: got ${got} expect ${exp}±${tol}`); bad++; } };

const TODAY = "2026-10-12";
// 발주기관 A: 사정률 −1.00 ~ +0.99 를 0.01 간격으로 200건 (균등). 유형 '지자체'.
const mk = (ag, at, n, od = "2026-01-15") => Array.from({ length: n }, (_, i) => ({ ar1: 100 + (-1 + i * 0.01), od, canonical_ag: ag, ag, at }));
const recA = mk("A시", "지자체", 200);

// 1. buildAdjHistory — 정렬·키·범위
const h = buildAdjHistory(recA, TODAY);
eq(h.ag["A시"].length, 200, "AG 200건");
eq(h.at["지자체"].length, 200, "AT 200건");
eq(h.ag["A시"][0], -1, "오름차순 최솟값");
eq(h.ag["A시"][199], 0.99, "오름차순 최댓값 (4자리 반올림으로 부동소수 오차 제거)");

// 2. 오염 입력은 조용히 제외 — null·문자열·범위 밖·제외 행·창 밖 날짜·날짜 없음
const dirty = [
  ...mk("B군", "지자체", 3),
  { ar1: null, od: "2026-01-15", canonical_ag: "B군", at: "지자체" },
  { ar1: "", od: "2026-01-15", canonical_ag: "B군", at: "지자체" },
  { ar1: "abc", od: "2026-01-15", canonical_ag: "B군", at: "지자체" },
  { ar1: 94.9, od: "2026-01-15", canonical_ag: "B군", at: "지자체" },
  { ar1: 105.1, od: "2026-01-15", canonical_ag: "B군", at: "지자체" },
  { ar1: 100.5, od: "2026-01-15", canonical_ag: "B군", at: "지자체", is_excluded: true },
  { ar1: 100.5, od: "2023-10-12", canonical_ag: "B군", at: "지자체" },   // 1,096일 전 — 창 밖
  { ar1: 100.5, od: "2023-10-13", canonical_ag: "B군", at: "지자체" },   // 1,095일 전 — 창 안
  { ar1: 100.5, od: "2026-10-13", canonical_ag: "B군", at: "지자체" },   // 미래 — 제외
  { ar1: 100.5, od: null, canonical_ag: "B군", at: "지자체" },
  { ar1: "100.25", od: "2026-01-15", canonical_ag: "B군", at: "지자체" }, // 숫자 문자열은 허용
];
const hd = buildAdjHistory(dirty, TODAY);
eq(hd.ag["B군"].length, 5, "오염 제외 후 5건 (정상 3 + 창 안 1 + 숫자 문자열 1)");
eq(buildAdjHistory([], TODAY).ag["A시"], undefined, "빈 기록");
eq(Object.keys(buildAdjHistory(null, TODAY).at).length, 0, "null 기록");
// canonical_ag가 없으면 ag로 묶는다
eq(buildAdjHistory([{ ar1: 100.1, od: "2026-01-15", ag: "C구", at: "지자체" }], TODAY).ag["C구"].length, 1, "canonical_ag 없으면 ag");

// 3. resolveAdjHistory — AG 우선, 30건 미만이면 AT, 둘 다 부족하면 null
const mixed = buildAdjHistory([...recA, ...mk("소규모군", "지자체", 29), ...mk("외딴청", "교육청", 29)], TODAY);
eq(resolveAdjHistory(mixed, { at: "지자체", canonicalAg: "A시" }).grain, "AG", "AG 200건");
eq(resolveAdjHistory(mixed, { at: "지자체", canonicalAg: "A시" }).n, 200, "AG n");
eq(resolveAdjHistory(mixed, { at: "지자체", canonicalAg: "소규모군" }).grain, "AT", "29건 → AT fallback");
eq(resolveAdjHistory(mixed, { at: "지자체", canonicalAg: "소규모군" }).n, 229, "AT n = 유형 전체");
eq(resolveAdjHistory(mixed, { at: "지자체", canonicalAg: "없는기관" }).grain, "AT", "미등록 기관 → AT");
eq(resolveAdjHistory(mixed, { at: "교육청", canonicalAg: "외딴청" }), null, "AG·AT 모두 30건 미만 → null");
eq(resolveAdjHistory(mixed, { at: "지자체", canonicalAg: "A시" }, SAFE_LINE_MIN_N).grain, "AG", "minN=100, AG 200건");
eq(resolveAdjHistory(null, { at: "지자체", canonicalAg: "A시" }), null, "hist null");
eq(PASS_PROB_MIN_N, 30, "최소 표본 30");
// 경계: 정확히 30건이면 AG
eq(resolveAdjHistory(buildAdjHistory(mk("딱서른", "지자체", 30), TODAY), { at: "지자체", canonicalAg: "딱서른" }).grain, "AG", "30건 경계");

// 4. passProbPct — ≤ 포함, 경계
const dA = resolveAdjHistory(h, { at: "지자체", canonicalAg: "A시" });
eq(passProbPct(dA, -1.01), 0, "최솟값 미만 → 0%");
eq(passProbPct(dA, -1), 0.5, "최솟값과 같음 → 1/200 (≤ 포함)");
eq(passProbPct(dA, 0), 50.5, "0.00 이하 101건/200");
eq(passProbPct(dA, 0.99), 100, "최댓값 이상 → 100%");
eq(passProbPct(dA, 5), 100, "범위 위");
eq(passProbPct(null, 0), null, "dist null");
eq(passProbPct(dA, null), null, "사정률 null");
eq(passProbPct(dA, NaN), null, "사정률 NaN");

// 5. impliedAdjOfBid — bidC의 역산. bidC(adj) = ceil(av + (ba(1+adj/100) − av) × effFr/100)
const bidC = (adj, ba, av, effFr) => { const xp = ba * (1 + adj / 100); return av > 0 ? Math.ceil(av + (xp - av) * (effFr / 100)) : Math.ceil(xp * (effFr / 100)); };
for (const [ba, av, effFr, adj] of [[2e8, 0, 89.745, 0.1234], [5e8, 12345678, 89.745, -0.4321], [3e9, 4e8, 88.745, 0.9], [1.5e8, 0, 90.745, 0]]) {
  const b = bidC(adj, ba, av, effFr);
  near(impliedAdjOfBid({ bid: b, ba, av, effFr }), adj, 1e-5, `왕복 ba=${ba} av=${av}`);
}
eq(impliedAdjOfBid({ bid: 0, ba: 2e8, av: 0, effFr: 89.745 }), null, "bid 0");
eq(impliedAdjOfBid({ bid: 1e8, ba: 0, av: 0, effFr: 89.745 }), null, "ba 0");
eq(impliedAdjOfBid({ bid: 1e8, ba: 2e8, av: 0, effFr: 0 }), null, "effFr 0");
// 자사 점수가 낮으면(effFr↑) 같은 투찰금이 전제하는 사정률이 낮아진다 → 통과 확률 하락
const bSame = bidC(0, 2e8, 0, 89.745);
const p20 = passProbPct(dA, impliedAdjOfBid({ bid: bSame, ba: 2e8, av: 0, effFr: 89.745 }));
const p14 = passProbPct(dA, impliedAdjOfBid({ bid: bSame, ba: 2e8, av: 0, effFr: 89.745 + 6 * 0.05 }));
eq(p20 > p14, true, `점수 14는 통과 확률이 더 낮다 (${p20} > ${p14})`);

// 6. bidAtPassProb — 그 투찰금의 통과 확률이 q 이상, 1원 낮추면 q 미만일 수 있음. 왕복 ±1원
for (const [ba, av, effFr] of [[2e8, 0, 89.745], [5e8, 12345678, 89.745]]) {
  const sb = bidAtPassProb(dA, SAFE_LINE_Q, { ba, av, effFr });
  const p = passProbPct(dA, impliedAdjOfBid({ bid: sb, ba, av, effFr }));
  eq(p >= 95, true, `안전선 통과 확률 ≥95 (ba=${ba}): ${p}`);
  eq(p <= 96, true, `안전선이 과하지 않다 (ba=${ba}): ${p}`);
  eq(Number.isInteger(sb), true, "안전선은 정수(원)");
}
eq(bidAtPassProb(null, 0.95, { ba: 2e8, av: 0, effFr: 89.745 }), null, "dist null");
eq(bidAtPassProb(dA, 0.95, { ba: 0, av: 0, effFr: 89.745 }), null, "ba 0");
eq(SAFE_LINE_Q, 0.95, "안전선 분위");

// 7. passRiskSnapshot — 저장 4필드
const snap = passRiskSnapshot(h, { at: "지자체", canonicalAg: "A시", ba: 2e8, av: 0, effFr: 89.745, bid: bidC(0, 2e8, 0, 89.745), jongsim: false, withSafeLine: true });
eq(snap.disq_risk_pct, 49.5, "실격위험 = 100 − 50.5");
eq(snap.floor_risk_n, 200, "n");
eq(snap.floor_risk_grain, "AG", "grain");
eq(Number.isInteger(snap.safe_bid), true, "safe_bid 정수");
const snapA = passRiskSnapshot(h, { at: "군시설", canonicalAg: "A시", ba: 2e8, av: 0, effFr: 89.745, bid: 1.8e8, jongsim: false, withSafeLine: false });
eq(snapA.safe_bid, null, "withSafeLine=false → 안전선 없음");
const snapJ = passRiskSnapshot(h, { at: "LH", canonicalAg: "A시", ba: 2e8, av: 0, effFr: 89.745, bid: 1.8e8, jongsim: true, withSafeLine: true });
eq(snapJ.disq_risk_pct, null, "종심제 → null");
eq(snapJ.floor_risk_grain, null, "종심제 grain null");
const snapN = passRiskSnapshot(buildAdjHistory([], TODAY), { at: "지자체", canonicalAg: "A시", ba: 2e8, av: 0, effFr: 89.745, bid: 1.8e8, jongsim: false, withSafeLine: true });
eq(snapN.disq_risk_pct, null, "기록 없음 → null");
eq(snapN.floor_risk_n, null, "기록 없음 n null");
// 안전선은 100건 이상에서만: AG 60건이면 위험은 나오고 안전선은 AT(100건 이상)로, AT도 부족하면 null
const h60 = buildAdjHistory(mk("육십시", "수자원공사", 60), TODAY);
const snap60 = passRiskSnapshot(h60, { at: "수자원공사", canonicalAg: "육십시", ba: 2e8, av: 0, effFr: 89.745, bid: 1.8e8, jongsim: false, withSafeLine: true });
eq(snap60.floor_risk_grain, "AG", "60건 → 위험은 AG");
eq(snap60.safe_bid, null, "60건 → 안전선 없음(100건 미만)");

console.log(bad === 0 ? "OK passProb all cases" : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
