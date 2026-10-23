import { recOfPred, agencyRecentHistory } from "../src/lib/bidCard.js";

let bad = 0;
const eq = (got, exp, msg) => { if (got !== exp) { console.error(`XX ${msg}: got ${got} expect ${exp}`); bad++; } };
const near = (got, exp, tol, msg) => { if (got == null || Math.abs(got - exp) > tol) { console.error(`XX ${msg}: got ${got} expect ${exp}±${tol}`); bad++; } };

// recOfPred — 의존성 주입, 자동 예측은 getFinal에 절대 들어가지 않는다(보정 2겹 금지)
let calls = 0;
const deps = {
  getFinal: () => { calls++; return { adj: 0.5, bid: 900, bid1st: 950, jongsim: false, floorSafe: true }; },
  adjHist: { ok: true }, ownScore: 20,
  passKeyOf: (p) => p.at, passEffFrOf: () => 89.745,
  resolveAdjHistory: (h, k) => k === "지자체" ? { grain: "AG", n: 3, arr: [1, 2, 3] } : null, // passProb.js 실제 반환 모양
  passProbPct: () => 96.4, impliedAdjOfBid: () => 0.1,
};
const up = { id: 1, source: "file_upload", at: "지자체", ba: "1000", match_status: "pending" };
const auto = { id: 2, source: "g2b_auto", at: "지자체", ba: "1000", match_status: "pending", b_pred_mode: "B", b_pred_adj: "1.1357", b_pred_bid_amount: "905" };
const autoA = { ...auto, id: 3, b_pred_mode: "A" };
const matched = { ...up, id: 4, match_status: "matched" };

const r1 = recOfPred(up, deps);
eq(calls, 1, "업로드 예측은 getFinal 1회"); eq(r1.bid, 950, "bid1st 우선"); eq(r1.adj, 0.5, "사정률");
eq(r1.passPct, 96.4, "통과 확률"); eq(r1.distN, 3, "표본 수"); eq(r1.distGrain, "AG", "표본 단위");
eq(r1.mode, "B", "기본 모드"); eq(r1.estimated, false, "업로드는 확정"); eq(r1.floorSafe, true, "자격 판정 전달");
const r2 = recOfPred(auto, deps);
eq(calls, 1, "자동 예측은 getFinal 미호출(보정 2겹 금지)"); eq(r2.adj, 1.1357, "저장 안착안"); eq(r2.bid, 905, "저장 투찰금");
eq(r2.estimated, true, "추정"); eq(r2.passPct, 96.4, "자동 예측도 같은 통과 확률 경로");
eq(recOfPred(autoA, deps).adj, null, "자동 예측 mode A는 비움"); eq(calls, 1, "여전히 미호출");
eq(recOfPred({ ...auto, source: "g2b_manual" }, deps).adj, 1.1357, "수동 등록도 저장값만"); eq(calls, 1, "g2b_manual도 미호출");
eq(recOfPred(matched, deps).bid, 950, "matched도 계산(예측 기록 카드)");
eq(recOfPred({ ...up, at: "군시설" }, deps).mode, "A", "군시설 정적 모드 A");
eq(recOfPred({ ...up, b_pred_mode: "B", at: "군시설" }, deps).mode, "B", "저장 모드 우선");
eq(recOfPred({ ...up, at: "LH" }, deps).passPct, null, "분포 없으면 통과 확률 null");
eq(recOfPred({ ...up, ba: null }, deps).passPct, null, "기초금액 없으면 통과 확률 null");
const jong = recOfPred(up, { ...deps, getFinal: () => ({ adj: null, bid: null, jongsim: true }) });
eq(jong.jongsim, true, "종심제 전달"); eq(jong.passPct, null, "종심제는 통과 확률 없음");
eq(recOfPred(null, deps), null, "null 입력");

// agencyRecentHistory — 메모리의 recs에서 발주처 최근 1위 이력
const R = [
  { canonical_ag: "고양시", od: "2026-01-02", br1: "100.10", ar1: "100.05", pn: "a" },
  { canonical_ag: "고양시", od: "2026-03-02", br1: "99.80", ar1: "99.70", pn: "b" },
  { canonical_ag: "고양시", od: "2026-02-02", br1: "100.30", ar1: "100.20", pn: "c" },
  { canonical_ag: "고양시", od: "2026-04-02", br1: null, ar1: "99.90", pn: "br1 없음" },
  { canonical_ag: "고양시", od: "2026-05-02", br1: "101", ar1: "101", pn: "제외", is_excluded: true },
  { ag: "고양시", od: "2025-12-02", br1: "100.00", ar1: "100.00", pn: "canonical 없음" },
  { canonical_ag: "파주시", od: "2026-03-03", br1: "98.0", ar1: "98.0", pn: "다른 기관" },
  { canonical_ag: "고양시", od: "2026-06-02", br1: "89.7410", ar1: null, pn: "발주처 사정률 없음(br1에 투찰률이 들어온 불완전 기록)" },
];
const copy = JSON.stringify(R);
const h = agencyRecentHistory(R, "고양시", 3);
eq(JSON.stringify(R), copy, "원본 불변");
eq(h.rows.map(r => r.pn).join(","), "b,c,a", "최신순 상위 3 (발주처 사정률 없는 6월 행 제외)");
eq(h.count, 3, "건수"); near(h.p50, 100.10, 1e-9, "중앙값"); near(h.p25, 99.95, 1e-9, "P25 선형 보간"); near(h.p75, 100.20, 1e-9, "P75");
eq(h.rows[0].br1, 99.8, "숫자로 변환"); eq(h.rows[0].ar1, 99.7, "발주처 사정률");
eq(agencyRecentHistory(R, "고양시").count, 4, "canonical 없으면 ag로");
eq(agencyRecentHistory(R, "없는기관").rows.length, 0, "기록 없음");
eq(agencyRecentHistory([], "x").p50, null, "빈 입력"); eq(agencyRecentHistory(null, "x").count, 0, "null 입력");

console.log(bad === 0 ? "OK bidCard" : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
