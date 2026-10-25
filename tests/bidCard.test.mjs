import { recOfPred, agencyRecentHistory, attackOfPred, KEPCO_ATTACK_AGENCIES, agencyTrend } from "../src/lib/bidCard.js";

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
const ha = agencyRecentHistory([...R, { canonical_ag: "고양시", od: "2026-07-02", br1: 100.5, ar1: 100.4, pn: "자동", _auto: true }], "고양시", 3);
eq(ha.autoCount, 1, "자동 행 수"); eq(ha.rows[0].auto, true, "자동 행 표시"); eq(ha.rows[1].auto, false, "엑셀 행은 false");
eq(h.autoCount, 0, "자동 없으면 0");

// attackOfPred — 한전 두 본부 보조 공격안(표시 전용, 스펙 .scratch/kepco-aggressive/spec.md)
// utils.js는 constants→auth(import.meta.env)를 불러 node에서 못 읽는다 — recommendV2는 대역으로 넘기는 값만 고정(산식은 브라우저에서 확인)
{
  const GG = "한국전력공사 경기본부";
  eq(KEPCO_ATTACK_AGENCIES.length, 2, "허용 목록 2개 본부"); eq(KEPCO_ATTACK_AGENCIES.includes("한국전력공사 남서울본부"), false, "남서울 제외");
  const agCell = { n: 601, mean: -0.0135, std: 0.5242 };
  const distMap = { agBa: { [GG + "|S3"]: { n: 6, mean: 0.9, std: 0.4 } }, ag: { [GG]: agCell }, atBa: {}, at: { 한전: { n: 1220, mean: -0.0086, std: 0.52 } } };
  let seen = null, v2ret = { mode: "B", adj: -0.0135, bid: 92000000, floor_safe: true, win_prob: null };
  const stubV2 = (b, c, o) => { seen = { b, c, o }; return v2ret; };
  let implied = null;
  const ad = { recommendV2: stubV2, distMap, ownScore: 17, adjHist: { ok: true }, passKeyOf: (p) => p.at, passEffFrOf: () => 87.745,
    resolveAdjHistory: () => ({ grain: "AG", n: 601, arr: [0] }), passProbPct: () => 52.3, impliedAdjOfBid: (x) => { implied = x; return 0; } };
  const kp = { id: 9, source: "file_upload", match_status: "pending", at: "한전", ag: GG, canonical_ag: GG, ba: "100000000", ep: "99000000", av: "5000000", pred_floor_rate: "87.745" };
  const a = attackOfPred(kp, ad, 95000000);
  eq(a?.adj, -0.0135, "사정률 전달"); eq(a?.bid, 92000000, "투찰금 전달"); eq(a?.passPct, 52.3, "하한 통과 = 메인과 같은 경험적 경로");
  eq(seen.o.targetProb, 0.5, "목표 0.5(사정률 ≈ 분포 평균)");
  eq(seen.c.agencyDist, agCell, "분포 = AG 칸(금액대 칸 아님)"); eq("modeResolution" in seen.c, false, "modeResolution 미전달(Mode A 진입 불가)");
  eq(seen.c.ownScore, 17, "자사 점수 전달");
  eq(seen.b.ba, 1e8, "ba 숫자"); eq(seen.b.ep, 99000000, "ep"); eq(seen.b.av, 5000000, "A값"); eq(seen.b.fr, 87.745, "하한율 = pred_floor_rate"); eq(seen.b.agName, GG, "기관명");
  eq(implied.bid, 92000000, "통과 확률은 공격안 투찰금으로"); eq(implied.effFr, 87.745, "통과 확률 요율 = passEffFrOf(메인과 같음)");
  eq(attackOfPred({ ...kp, ag: "한국전력공사 인천본부", canonical_ag: "한국전력공사 인천본부" }, ad, 95000000), null, "허용 목록 밖 본부 null");
  eq(attackOfPred({ ...kp, ag: "한국전력공사 남서울본부", canonical_ag: "한국전력공사 남서울본부" }, ad, 95000000), null, "남서울 null");
  eq(attackOfPred({ ...kp, at: "지자체" }, ad, 95000000), null, "한전 외 null");
  eq(attackOfPred({ ...kp, source: "g2b_auto" }, ad, 95000000), null, "자동 예측 null");
  eq(attackOfPred({ ...kp, match_status: "matched" }, ad, 95000000), null, "개찰 후 null");
  eq(attackOfPred({ ...kp, ba: null }, ad, 95000000), null, "기초금액 없음 null");
  eq(attackOfPred({ ...kp, pred_floor_rate: null }, ad, 95000000), null, "하한율 없음 null");
  eq(attackOfPred(kp, { ...ad, distMap: { agBa: {}, ag: {}, atBa: {}, at: distMap.at } }, 95000000), null, "AG 분포 없으면 null(유형 평균으로 대체 안 함)");
  eq(attackOfPred({ ...kp, canonical_ag: null }, ad, 95000000)?.bid, 92000000, "canonical 없으면 ag로 판정");
  v2ret = { ...v2ret, floor_safe: false }; eq(attackOfPred(kp, ad, 95000000), null, "자격 미달 null");
  v2ret = null; eq(attackOfPred(kp, ad, 95000000), null, "계산 실패 null");
  v2ret = { mode: "B", adj: -0.0135, bid: 92000000, floor_safe: true };
  eq(attackOfPred(kp, { ...ad, resolveAdjHistory: () => null }, 95000000).passPct, null, "통과 확률 분포 없으면 null");
  eq(attackOfPred({ ...kp, match_status: "expired" }, ad, 95000000), null, "개찰 후 미매칭(expired) null");
  eq(attackOfPred(kp, ad, null), null, "메인 추천 없으면 null");
  eq(attackOfPred(kp, ad, 92000000), null, "공격안이 메인보다 낮지 않으면 null");
  eq(attackOfPred(null, ad, 95000000), null, "null 입력");
}

// agencyTrend — 최근 90일 vs 직전 9개월 동향(표시 전용, 스펙 .scratch/agency-trend/spec.md)
{
  const AG = "경기도 테스트시";
  const day = (ref, k) => { const d = new Date(ref + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - k); return d.toISOString().slice(0, 10); };
  let seq = 0;
  const row = (od, ar, extra = {}) => ({ id: ++seq, pn_no: "P" + seq, canonical_ag: AG, od, ar1: 100 + ar, br1: 100 + ar + 0.01, ba: 1e8, bp: null, floor_price: null, is_excluded: false, co: "업체", ...extra });
  const REF = "2026-10-22";
  const rec = (vals, k0) => vals.map((v, i) => row(day(REF, k0 + i), v));
  const recentV = [0.9, 1.1, 0.95, 1.05, 1.0, 0.9, 1.1, 0.95, 1.05, 1.0];           // n10, 평균 1.0
  const priorV = Array.from({ length: 20 }, (_, i) => (i % 2 ? 0.1 : -0.1));         // n20, 평균 0
  const base = [...rec(recentV, 0), ...rec(priorV, 100)];
  const opt = { openDate: "2026-10-23", today: "2026-10-26" };
  const t1 = agencyTrend(base, AG, opt);
  eq(t1.ref, REF, "기준일 = 개찰일 전날"); eq(t1.refFromOpen, true, "개찰 전날 기준 표시");
  eq(t1.ar.nRecent, 10, "최근 n"); eq(t1.ar.nPrior, 20, "직전 n");
  near(t1.ar.meanRecent, 1.0, 1e-9, "최근 평균"); near(t1.ar.meanPrior, 0, 1e-9, "직전 평균"); near(t1.ar.delta, 1.0, 1e-9, "Δ");
  const sv = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1); };
  const se = Math.sqrt(sv(recentV) / 10 + sv(priorV) / 20);
  near(t1.ar.z, 1.0 / se, 1e-9, "Welch z"); near(t1.ar.detect, 3 * se, 1e-9, "구분 가능 폭 = 3·se");
  eq(t1.ar.shift, "up", "|z|≥3 상승"); eq(t1.ar.status, "ok", "표본 충분");
  eq(t1.lastOd, REF, "최근 창 마지막 개찰일");
  eq(agencyTrend([...rec(recentV.map(v => -v), 0), ...rec(priorV, 100)], AG, opt).ar.shift, "down", "하락");
  const noisy = [...rec([1, -1, 1, -1, 1, -1, 1, -1, 1, -0.6], 0), ...rec(priorV, 100)];
  eq(agencyTrend(noisy, AG, opt).ar.shift, "none", "|z|<3 변화 없음");
  // 기준일 규칙
  eq(agencyTrend(base, AG, { today: "2026-10-26" }).ref, "2026-10-26", "개찰일 없으면 오늘");
  eq(agencyTrend(base, AG, { today: "2026-10-26" }).refFromOpen, false, "오늘 기준");
  eq(agencyTrend(base, AG, { openDate: "2026-11-05", today: "2026-10-26" }).ref, "2026-10-26", "개찰일이 미래면 오늘");
  // 창 경계: ref−89 최근, ref−90 직전, ref−364 직전, ref−365 제외, ref+1(개찰 당일) 제외
  const edge = [row(day(REF, 89), 0), row(day(REF, 90), 0), row(day(REF, 364), 0), row(day(REF, 365), 0), row("2026-10-23", 0)];
  const te = agencyTrend(edge, AG, opt);
  eq(te.ar.nRecent, 1, "경계: 89일 전은 최근"); eq(te.ar.nPrior, 2, "경계: 90·364일 전은 직전, 365일 전·개찰 당일 제외");
  eq(te.ar.status, "insufficient", "표본 부족"); eq(te.status, "insufficient", "두 줄 모두 부족이면 전체 부족");
  // 필터
  const junk = [row(REF, 0, { canonical_ag: "다른 기관" }), row(REF, 0, { is_excluded: true }), row(REF, 0, { co: "유찰" }),
    row(REF, 0, { ar1: 94 }), row(REF, 0, { ar1: null }), row(REF, 0, { _auto: true }), row(REF, 0, { _auto: true }), { ...base[0] }];
  const tj = agencyTrend([...base, ...junk], AG, opt);
  eq(tj.ar.nRecent, 10, "다른 기관·제외·유찰·범위 밖·빈 값·자동·pn_no 중복 제외"); eq(tj.autoExcluded, 2, "자동 수집 제외 건수");
  eq(agencyTrend([...base, row(REF, 0, { canonical_ag: null, ag: AG })], AG, opt).ar.nRecent, 11, "canonical 없으면 ag");
  // 1위 여유(금액 공간): gap = (bp−floor_price)/ba×100, ≥0.05 비율
  const g = (od, gap) => row(od, 0, { floor_price: 9e7, bp: 9e7 + gap / 100 * 1e8 });
  const gRows = [...Array.from({ length: 10 }, (_, i) => g(day(REF, i), 0.1)), ...Array.from({ length: 20 }, (_, i) => g(day(REF, 100 + i), 0.01)),
    g(day(REF, 1), -0.02), row(day(REF, 2), 0)];
  const tg = agencyTrend(gRows, AG, opt);
  eq(tg.gap.nRecent, 10, "음수 여유·하한가 없는 행 제외"); eq(tg.gap.nPrior, 20, "직전 여유 n");
  near(tg.gap.pctRecent, 100, 1e-9, "최근 비율"); near(tg.gap.pctPrior, 0, 1e-9, "직전 비율");
  const pp = 10 / 30; near(tg.gap.z, 1 / Math.sqrt(pp * (1 - pp) * (1 / 10 + 1 / 20)), 1e-9, "두 비율 z");
  eq(tg.gap.shift, "wider", "덜 붙음"); eq(tg.ar.nRecent, 12, "사정률 줄은 여유 없는 행도 셈");
  const tg2 = agencyTrend([...Array.from({ length: 10 }, (_, i) => g(day(REF, i), 0.01)), ...Array.from({ length: 20 }, (_, i) => g(day(REF, 100 + i), 0.01))], AG, opt);
  eq(tg2.gap.shift, "none", "비율 같으면(0%·0%) 변화 없음"); eq(tg2.gap.z, null, "분산 0이면 z 없음");
  eq(agencyTrend(base, AG, opt).gap.status, "insufficient", "여유 표본 없으면 부족");
  eq(agencyTrend([], AG, opt).status, "insufficient", "빈 입력"); eq(agencyTrend(null, AG, opt).status, "insufficient", "null 입력");
}

console.log(bad === 0 ? "OK bidCard" : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
