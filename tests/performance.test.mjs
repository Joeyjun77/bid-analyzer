import {
  NEAR_GAP_MAX, GAP_SANE_MAX, dedupeByPnNo, classifyDetail, classifyRecord, aggregatePerformance,
} from "../src/lib/performance.js";

let bad = 0;
const eq = (got, exp, msg) => { if (got !== exp) { console.error(`XX ${msg}: got ${got} expect ${exp}`); bad++; } };
const near = (got, exp, tol, msg) => { if (got == null || Math.abs(got - exp) > tol) { console.error(`XX ${msg}: got ${got} expect ${exp}±${tol}`); bad++; } };

eq(NEAR_GAP_MAX, 0.5, "1위 근접 경계"); eq(GAP_SANE_MAX, 5, "간격 이상치 경계");

const KW = ["고양"];
const D = [
  { pn_no: "A", od: "2026-01-15", ag: "경기도 고양시 일산동구", participant_count: "224", my_rank: 1, my_bid_rate: "89.7661", floor_rate: "89.745", win_bid_rate: "89.7661" },
  { pn_no: "B", od: "2026-01-20", ag: "경기도 고양시", participant_count: "3340", my_rank: null, my_bid_rate: "89.10", floor_rate: "89.745", win_bid_rate: "89.75" },
  { pn_no: "C", od: "2026-01-22", ag: "서울교통공사", participant_count: "13", my_rank: 0, my_bid_rate: null, floor_rate: "89.745", win_bid_rate: "89.77" },
  { pn_no: "D", od: "2026-02-03", ag: "경기도 성남시 분당구", participant_count: "3434", my_rank: "381", my_bid_rate: "89.9643", floor_rate: "89.745", win_bid_rate: "89.7451" },
  { pn_no: "E", od: null, ag: "경기도 고양시", participant_count: "230", my_rank: 5, my_bid_rate: "89.80", floor_rate: "89.745", win_bid_rate: "89.75" },
  { pn_no: "A", od: "2026-01-15", ag: "경기도 고양시 일산동구", participant_count: "224", my_rank: 50, my_bid_rate: "90.5", floor_rate: "89.745", win_bid_rate: "89.7661" },
];
const R = [
  { pn_no: "r1", od: "2026-01-10", ag: "경기도 고양시", pn: "x", pc: "230", co: "갑사" },
  { pn_no: "r2", od: "2026-01-11", ag: "경기도 고양시", pn: "y", pc: "3300", co: "을사" },
  { pn_no: "r3", od: "2026-01-12", ag: "경기도 김포시", pn: "[(김포시)] z", pc: "3311", co: "병사" },
  { pn_no: "r4", od: "2026-02-01", ag: "경기도 고양시 덕양구", pn: "w", pc: "228", co: "정사" },
  { pn_no: "r5", od: "2026-03-05", ag: "경기도 고양시", pn: "v", pc: "231", co: "무사" },
  { pn_no: "r6", od: "2026-01-13", ag: "경기도 고양시", pn: "excluded", pc: "200", co: "기사", is_excluded: true },
  { pn_no: "r7", od: "2026-01-14", ag: "경기도 고양시", pn: "유찰", pc: "0", co: "" },
  { pn_no: "r1", od: "2026-01-10", ag: "경기도 고양시", pn: "x-dup", pc: "230", co: "갑사" },
  { pn_no: "r8", od: "2026-01-16", ag: "전라남도 해남군", pn: "[(해남군)] 관내 전기", pc: "50", co: "경사" },
];

// dedupeByPnNo
eq(dedupeByPnNo(D).length, 5, "pn_no 중복 1건 제거, 첫 행 유지");
eq(dedupeByPnNo(D)[0].my_rank, 1, "첫 행(rank 1) 유지");
eq(dedupeByPnNo([{ x: 1 }, { x: 2 }]).length, 2, "pn_no 없는 행은 그대로");

// classifyDetail 단건
const c0 = classifyDetail(D[0], KW);
eq(c0.month, "2026-01", "월"); eq(c0.group, "target", "그룹"); eq(c0.passed, true, "통과"); eq(c0.rank1, true, "1위"); eq(c0.nearBand, true, "근접 gap 0");
eq(classifyDetail(D[2], KW).passed, false, "rank 0 통과 아님");
eq(classifyDetail({ ...D[0], my_rank: -3 }, KW).passed, false, "음수 rank 통과 아님");
eq(classifyDetail(D[4], KW), null, "od 없음 → null");
eq(classifyDetail({ ...D[0], win_bid_rate: "66.4" }, KW).gapToWin, null, "이상치 간격 → null");
eq(classifyDetail({ ...D[0], win_bid_rate: "66.4" }, KW).nearBand, false, "이상치 간격 → 근접 아님");
eq(classifyDetail({ ...D[0], participant_count: "0", ag: "서울교통공사" }, KW).group, "general", "pc 0 → 소경쟁 아님");

// classifyRecord
eq(classifyRecord(R[5], KW), null, "is_excluded → null");
eq(classifyRecord(R[6], KW), null, "co 없음(유찰) → null");
eq(classifyRecord(R[2], KW).group, "general", "김포 → 일반");
eq(classifyRecord(R[0], KW).group, "target", "고양 → 대상");
eq(classifyRecord(R[8], KW).group, "general", "타지역 소경쟁 공고는 자사 자격 밖 → 일반");

// aggregatePerformance
const dCopy = JSON.stringify(D), rCopy = JSON.stringify(R);
const out = aggregatePerformance(D, R, KW, "2026-03-20");
eq(JSON.stringify(D), dCopy, "details 원본 불변"); eq(JSON.stringify(R), rCopy, "records 원본 불변");
eq(out.months.map(m => m.month).join(","), "2026-03,2026-02,2026-01", "월 범위: details 최소월~오늘, 최신 먼저");
const jan = out.months[2];
eq(jan.target.notices, 2, "1월 관내 공고(키워드만, 제외·유찰·중복 제거)"); eq(jan.general.notices, 2, "1월 일반 공고(타지역 소경쟁 포함)");
eq(jan.target.bids, 3, "1월 관내 투찰(고양 2 + 소경쟁 1, 중복 A 제거)"); eq(jan.target.eligibleBids, 2, "1월 키워드 일치 투찰 2"); eq(jan.target.passed, 1, "rank 0/null 통과 아님");
eq(jan.target.belowFloor, 1, "하한 미달 1"); eq(jan.target.nearBand, 1, "1위 근접 1 (gap 0)");
eq(jan.target.rank1, 1, "1위 1"); eq(jan.target.top10, 1, "10위 이내 1");
near(jan.target.coverage, 1, 1e-9, "커버리지 = 키워드 투찰 2 / 키워드 공고 2"); near(jan.target.passRate, 1 / 3, 1e-9, "통과율 1/3"); near(jan.target.medGap, 0, 1e-9, "간격 중앙값 0");
eq(jan.noUpload, false, "1월 업로드 있음");
const feb = out.months[1];
eq(feb.general.bids, 1, "2월 일반 투찰 1"); near(feb.general.medGap, 0.2192, 1e-4, "간격 0.2192");
eq(feb.general.nearBand, 1, "2월 일반 1위 근접 1 (gap 0.2192)");
eq(feb.target.notices, 1, "2월 관내 공고 1"); eq(feb.target.bids, 0, "2월 관내 투찰 0"); near(feb.target.coverage, 0, 1e-9, "2월 관내 커버리지 0");
eq(feb.target.passRate, null, "투찰 0 → 통과율 null");
const mar = out.months[0];
eq(mar.noUpload, true, "3월: 공고 있음·투찰 0 → 업로드 없음"); near(mar.target.coverage, 0, 1e-9, "커버리지 0/1");
eq(out.totals.bids, 4, "od 없는 행·중복 제외"); eq(out.totals.belowFloor, 1, "하한 미달 합");
eq(out.totals.eligibleBids, 2, "키워드 일치 투찰"); eq(out.totals.eligibleNotPassed, 1, "키워드 일치 중 통과 아님");
near(out.summary.passRate, 1 / 3, 1e-9, "요약 통과율 1/3 (target만 합산)"); eq(out.summary.n, 3, "요약 n = 1·2월 target bids");
near(out.summary.coverage, 2 / 3, 1e-9, "요약 커버리지 = 키워드 투찰 2 / 키워드 공고 3"); near(out.summary.nearRate, 1 / 3, 1e-9, "요약 1위 근접률");
eq(aggregatePerformance([], R, KW, "2026-03-20").months.length, 0, "details 없으면 빈 months");
eq(aggregatePerformance([], R, KW, "2026-03-20").summary.passRate, null, "details 없으면 요약 null");
// 연도 넘김
const y = aggregatePerformance([{ ...D[0], od: "2025-11-03" }], [], KW, "2026-01-05");
eq(y.months.map(m => m.month).join(","), "2026-01,2025-12,2025-11", "12월→다음해 1월 연속");

console.log(bad === 0 ? "OK performance" : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
