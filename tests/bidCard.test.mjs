import { recOfPred, agencyRecentHistory, attackOfPred, KEPCO_ATTACK_AGENCIES, agencyTrend, capSigmaOfSrc, isLargeTender, distOfSrc, binomTwoSidedP, candidateBacktest, refDateOf } from "../src/lib/bidCard.js";

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
// 군시설 메인 추천 안착안 전환(.scratch/military-anchor/spec.md): 메인 src가 modeB(…)면 b_pred_mode A여도 안착 모드
eq(recOfPred({ ...up, at: "군시설", b_pred_mode: "A", bid1st_v2_src: "modeB(24건 · μ=0.1000 · σ=0.5500)" }, deps).mode, "B", "군시설 안착안 메인은 B");
eq(recOfPred({ ...up, at: "군시설", b_pred_mode: "A", bid1st_v2_src: "제1보병사단 S1(84건)" }, deps).mode, "A", "옛 군시설 메인은 A 유지");
eq(recOfPred({ ...auto, at: "군시설", b_pred_mode: "A", bid1st_v2_src: "modeB(24건 · μ=0.1000 · σ=0.5500)" }, deps).mode, "A", "자동 예측은 저장 모드 그대로");
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

// 1군 표시 수정(스펙 .scratch/group1-display/spec.md)
{
  eq(capSigmaOfSrc("modeB(5건 · μ=-0.2729 · σ=1.0307)"), 1.0307, "σ>0.9119 → 상한 걸림 σ 반환");
  eq(capSigmaOfSrc("modeB(27건 · μ=-0.2854 · σ=0.9120)"), 0.912, "경계 0.9120은 상한");
  eq(capSigmaOfSrc("modeB(27건 · μ=-0.2854 · σ=0.9119)"), null, "경계 0.9119는 95% 도달");
  eq(capSigmaOfSrc("modeB(57건 · μ=0.1507 · σ=0.6447)"), null, "보통 σ는 null");
  eq(capSigmaOfSrc("한국전력공사 경기본부 S3(230건)"), null, "10/21 이전 형식은 null");
  eq(capSigmaOfSrc(null), null, "null 입력");
  eq(isLargeTender({ ep: "30000000000", ba: "1" }), true, "추정가격 300억 = 경고");
  eq(isLargeTender({ ep: "29999999999", ba: "99999999999" }), false, "추정가격 있으면 ep 기준");
  eq(isLargeTender({ ep: "0", ba: "33100000000" }), true, "ep 0이면 기초금액/1.1(≥300억)");
  eq(isLargeTender({ ep: null, ba: "32999999999" }), false, "ba/1.1 < 300억");
  eq(isLargeTender(null), false, "null 입력");
  eq(isLargeTender({ ep: null, ba: "33000000000" }), true, "기초금액 정확히 330억(=추정 300억) 경계 포함");
  eq(capSigmaOfSrc("modeB(0건 · μ=? · σ=?)"), null, "분포 없음 형식은 null");
  const AG2 = "기관X";
  const H = [{ od: "2026-10-20", br1: 99.9, ar1: 99.8, canonical_ag: AG2, pn: "a" }, { od: "2026-10-23", br1: 101.5, ar1: 101.4, canonical_ag: AG2, pn: "b" }, { od: "2026-10-25", br1: 100.5, ar1: 100.4, canonical_ag: AG2, pn: "c" }];
  eq(agencyRecentHistory(H, AG2, 20).count, 3, "asOf 생략 시 기존 동작");
  const hc = agencyRecentHistory(H, AG2, 20, "2026-10-23");
  eq(hc.count, 2, "asOf 포함 이전만"); eq(hc.rows[0].od, "2026-10-23", "경계일 포함");
  eq(agencyRecentHistory(H, AG2, 20, "2026-10-19").count, 0, "기준일 이전 기록 없음");
  eq(agencyRecentHistory([{ ...H[1], od: "2026-10-23T09:00:00+09:00" }], AG2, 20, "2026-10-23").count, 1, "타임스탬프 od도 날짜로 비교");
}

// 후보 비교표(스펙 .scratch/candidate-compare/spec.md)
{
  const d = distOfSrc("modeB(23건 · μ=-0.2862 · σ=0.9218)");
  eq(d?.n, 23, "src 건수"); eq(d?.mu, -0.2862, "src μ(음수)"); eq(d?.sigma, 0.9218, "src σ");
  eq(distOfSrc("한국전력공사 경기본부 S3(230건)"), null, "옛 형식 null"); eq(distOfSrc("modeB(0건 · μ=? · σ=?)"), null, "값 없음 null"); eq(distOfSrc(null), null, "null");
  eq(refDateOf("2026-10-23", "2026-10-26"), "2026-10-22", "개찰 지난 카드 = 개찰 전날"); eq(refDateOf(null, "2026-10-26"), "2026-10-26", "개찰일 없음 = 오늘");
  eq(refDateOf("2026-11-05", "2026-10-26"), "2026-10-26", "미래 개찰 = 오늘"); eq(refDateOf("2026-10-27", "2026-10-26"), "2026-10-26", "내일 개찰 = 오늘");
  near(binomTwoSidedP(65, 70), 0.731, 0.001, "이항 정확 p(65,70)"); eq(binomTwoSidedP(0, 0), 1, "엇갈린 쌍 없으면 p=1"); near(binomTwoSidedP(0, 6), 0.03125, 1e-9, "0 vs 6");

  const AG = "기관B"; let k = 0;
  // 분포 기록: br1(1위 사정률), 금액대 S2(1억~3억)
  const dist = (od, br1, ba = 2e8, extra = {}) => ({ id: ++k, pn_no: "D" + k, canonical_ag: AG, at: "지자체", od, br1, ba, co: "업체", is_excluded: false, ...extra });
  // 평가 공고: 실제 하한율 frt=90(av=0) → xp=예정가격, floor=xp*0.9, bp=1위 금액
  const ev = (od, xp, bp, ba = 2e8, extra = {}) => ({ id: ++k, pn_no: "E" + k, canonical_ag: AG, at: "지자체", od, ba, av: 0, xp, floor_price: xp * 0.9, bp, br1: 100, co: "업체", is_excluded: false, ...extra });
  const hist = ["2024-03-01", "2024-04-01", "2024-05-01", "2024-06-01", "2024-07-01"].map((od, i) => dist(od, [99.5, 100, 100.5, 100, 100][i]));
  // μ=0, sd: 값 -0.5,0,0.5,0,0 → 표본분산 0.125 → sd 0.35355 → 안전선 = 0+min(1.6449*max(0.35355,0.642),1.5)=1.05603, P75=0.23847, P50=0
  // 공고1: 예정가격 = 기초×1.002(실제 사정률 +0.2) → 자사 하한 = xp*0.9. P50 투찰 = ceil(2e8*1.0*0.9)=180000000 < 하한 → 하한 미달
  //        P75 투찰 = ceil(2e8*1.0023847*0.9)=180429246 ≥ 하한(180360000) → bp보다 낮으면 1위 가능
  //        안전선 투찰 = ceil(2e8*1.0105603*0.9)=181900854 → bp(180500000) 이상 → 1위 아님
  const e1 = ev("2025-02-01", 2e8 * 1.002, 180500000);
  const r = candidateBacktest([...hist, e1, dist("2025-02-01", 103)], { canonicalAg: AG, at: "지자체", ref: "2025-12-31", ownScore: 20 });
  eq(r.n, 1, "평가 1건(같은 날 분포 기록은 그 공고 계산에 안 씀)"); eq(r.skipped, 1, "같은 날 분포 기록(하한가 없음)은 평가 불가로 셈");
  eq(r.rows.p50.below, 1, "평균 → 하한 미달"); eq(r.rows.p75.wins, 1, "평균+0.67σ → 1위 가능"); eq(r.rows.safe.wins, 0, "안전선 → 1위 아님"); eq(r.rows.safe.below, 0, "안전선 통과");
  eq(r.pairs.p75.c, 1, "P75만 1위 1쌍"); eq(r.pairs.p75.b, 0, "안전선만 1위 0쌍");
  // 같은 날 기록이 계산에 들어갔다면 μ가 크게 올라 결과가 달라짐 → 위 기대값이 그 고정
  // 분포 부족(4건) → 평가 불가
  const r2 = candidateBacktest([...hist.slice(0, 4), e1], { canonicalAg: AG, at: "지자체", ref: "2025-12-31", ownScore: 20 });
  eq(r2.n, 0, "분포 4건이면 평가 안 함"); eq(r2.skipped, 1, "평가 불가 1");
  // 필수 값 없음 → 평가 불가, 기준일 이후·2025 이전 공고는 제외
  const r3 = candidateBacktest([...hist, ev("2025-03-01", 2e8, 1.8e8, 2e8, { bp: null }), ev("2026-01-05", 2e8, 1.8e8), ev("2024-12-31", 2e8, 1.8e8)], { canonicalAg: AG, at: "지자체", ref: "2025-12-31", ownScore: 20 });
  eq(r3.n, 0, "평가 0"); eq(r3.skipped, 1, "bp 없음은 평가 불가로 셈(기간 밖은 제외)");
  // 필터: 다른 기관·자동·유찰·제외·범위 밖·canonical 없음은 분포에 안 들어감
  const junk = [dist("2024-08-01", 100, 2e8, { canonical_ag: "다른" }), dist("2024-08-01", 100, 2e8, { _auto: true }), dist("2024-08-01", 100, 2e8, { co: "유찰" }),
    dist("2024-08-01", 100, 2e8, { is_excluded: true }), dist("2024-08-01", 94, 2e8), dist("2024-08-01", 100, 2e8, { canonical_ag: null, ag: AG }), dist("2023-12-31", 100)];
  const r4 = candidateBacktest([...hist.slice(0, 4), ...junk, e1], { canonicalAg: AG, at: "지자체", ref: "2025-12-31", ownScore: 20 });
  eq(r4.n, 0, "걸러진 기록은 분포 n에 안 셈(4건 그대로)");
  // 기관×금액대 우선: S1(1억 미만) 기록 5건이 있으면 S1 공고는 그 칸을 쓴다
  const s1 = ["2024-03-02", "2024-04-02", "2024-05-02", "2024-06-02", "2024-07-02"].map(od => dist(od, 102, 5e7));
  const e2 = ev("2025-02-02", 5e7 * 1.002, 45100000, 5e7);
  const r5 = candidateBacktest([...hist, ...s1, e2], { canonicalAg: AG, at: "지자체", ref: "2025-12-31", ownScore: 20 });
  eq(r5.rows.p50.below, 0, "S1 칸 μ=+2 → 평균 투찰이 하한 위(기관 전체 μ면 미달)");
  // 자사 점수 18점 → 유효 하한율 +0.1%p: 자사 하한도 올라 하한 미달 판정은 같고, 투찰금은 커져 1위 가능이 줄 수 있음
  const r6 = candidateBacktest([...hist, e1], { canonicalAg: AG, at: "지자체", ref: "2025-12-31", ownScore: 18 });
  eq(r6.rows.p50.below, 1, "점수와 무관하게 하한 미달 동일"); eq(r6.rows.p75.wins, 0, "18점: 유효 하한율 +0.1%p로 투찰금이 1위 금액을 넘어 1위 가능이 줄어듦");
  // 경계: 투찰금 = bp면 1위 아님
  const p75bid = Math.ceil(2e8 * (1 + 0.23847 / 100) * 0.9);
  const r7 = candidateBacktest([...hist, ev("2025-02-01", 2e8 * 1.002, p75bid)], { canonicalAg: AG, at: "지자체", ref: "2025-12-31", ownScore: 20 });
  eq(r7.rows.p75.wins, 0, "투찰금 = 1위 금액이면 1위 아님");
  eq(candidateBacktest(null, { canonicalAg: AG, at: "지자체", ref: "2025-12-31" }).n, 0, "null 입력");
  // 리뷰 반영: 평가 대상도 br1 95~105만(다른 종류 기록은 평가 불가로 세지 않음)
  const rb = candidateBacktest([...hist, e1, ev("2025-03-01", null, null, 2e8, { br1: 88, xp: null, floor_price: null })], { canonicalAg: AG, at: "지자체", ref: "2025-12-31", ownScore: 20 });
  eq(rb.skipped, 0, "br1 범위 밖 기록은 평가 불가로 세지 않음");
  // A값(av>0) 공고: 투찰금 = ceil(av + (xp후보 − av)·eff/100)
  const avR = { av: 1e7 }, xpA = 2e8 * 1.002, flA = 1e7 + (xpA - 1e7) * 0.9;
  const rA = candidateBacktest([...hist, ev("2025-02-01", xpA, 182000000, 2e8, { av: 1e7, floor_price: flA })], { canonicalAg: AG, at: "지자체", ref: "2025-12-31", ownScore: 20 });
  const bidA = (x) => Math.ceil(1e7 + (2e8 * (1 + x / 100) - 1e7) * 0.9);
  eq(rA.rows.p75.wins, bidA(0.23847) >= flA && bidA(0.23847) < 182000000 ? 1 : 0, "A값 공고 P75 판정"); eq(rA.rows.p50.below, bidA(0) < flA ? 1 : 0, "A값 공고 평균 판정");
  void avR;
  // LH: σ 바닥 0.50 → 안전선 0.82245, 예정가격 천원 절상. 실제 사정률 +0.9 → LH 안전선은 하한 미달, 지자체 바닥(0.642→1.056)이면 통과
  const xpL = 201800000, eL = ev("2025-02-01", xpL, 190000000);
  eq(candidateBacktest([...hist, eL], { canonicalAg: AG, at: "LH", ref: "2025-12-31", ownScore: 20 }).rows.safe.below, 1, "LH 바닥 0.50 안전선은 +0.9에서 미달");
  eq(candidateBacktest([...hist, eL], { canonicalAg: AG, at: "지자체", ref: "2025-12-31", ownScore: 20 }).rows.safe.below, 0, "지자체 바닥 0.642 안전선은 +0.9에서 통과");
  // σ가 커서 상한 1.5: 값 −1.5,−1.5,0,1.5,1.5(σ=1.5) → 안전선 = 1.5. 실제 +1.6 → 미달
  const wide = ["2024-03-01", "2024-04-01", "2024-05-01", "2024-06-01", "2024-07-01"].map((od, i) => dist(od, 100 + [-1.5, -1.5, 0, 1.5, 1.5][i]));
  eq(candidateBacktest([...wide, ev("2025-02-01", 2e8 * 1.016, 190000000)], { canonicalAg: AG, at: "지자체", ref: "2025-12-31", ownScore: 20 }).rows.safe.below, 1, "상한 1.5가 걸리면 +1.6에서 미달");
  // 경계: 투찰금 = 자사 하한이면 미달 아님(1위 금액 미만이면 1위 가능)
  const rEq = candidateBacktest([...hist, ev("2025-02-01", 2e8, 1.9e8, 2e8, { floor_price: 1.8e8 })], { canonicalAg: AG, at: "지자체", ref: "2025-12-31", ownScore: 20 });
  eq(rEq.rows.p50.below, 0, "투찰금 = 하한가면 미달 아님"); eq(rEq.rows.p50.wins, 1, "그리고 1위 금액 미만이면 1위 가능");
  // 이상값 가드: 하한율 70% 미만·1위 금액 < 하한가는 평가 불가
  const rBad = candidateBacktest([...hist, ev("2025-02-01", 2e8, 1.9e8, 2e8, { floor_price: 1.2e8 }), ev("2025-02-02", 2e8, 1.7e8)], { canonicalAg: AG, at: "지자체", ref: "2025-12-31", ownScore: 20 });
  eq(rBad.n, 0, "이상값 평가 안 함"); eq(rBad.skipped, 2, "이상값 2건 평가 불가");
  // 같은 공고번호 중복 평가 1회
  const dupE = ev("2025-02-01", 2e8 * 1.002, 180500000);
  eq(candidateBacktest([...hist, dupE, { ...dupE, id: 999 }], { canonicalAg: AG, at: "지자체", ref: "2025-12-31", ownScore: 20 }).n, 1, "같은 공고번호는 1번만 평가");
}

console.log(bad === 0 ? "OK bidCard" : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
