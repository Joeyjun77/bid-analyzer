import { basePnNo, pickPrediction, STATUS, statusOf, buildTodayRows, filterRows, tradesOf } from "../src/lib/todayNotices.js";

let bad = 0;
const eq = (got, exp, msg) => { if (got !== exp) { console.error(`XX ${msg}: got ${got} expect ${exp}`); bad++; } };
const near = (got, exp, tol, msg) => { if (got == null || Math.abs(got - exp) > tol) { console.error(`XX ${msg}: got ${got} expect ${exp}±${tol}`); bad++; } };

// basePnNo
eq(basePnNo("R26BK01771900-000"), "R26BK01771900", "접미사 제거");
eq(basePnNo(" R26BK01771900 "), "R26BK01771900", "trim");
eq(basePnNo("2026-01-000143-00"), "2026-01-000143-00", "두 자리 접미사는 그대로");
eq(basePnNo(null), null, "null"); eq(basePnNo(""), null, "빈 값");

const N = [
  { id: 1, pn_no: "R26BK01771900", pn: "고양시 가로등", ag: "경기도 고양시", at: "지자체", ep: "776015455", ba: null, od: "2026-10-23 11:00:00+00", bid_close_dt: "2026-10-23 10:00:00+00", participated: false, prediction_id: 18102 },
  { id: 2, pn_no: "R26BK01773039", pn: "성남 천장공사", ag: "경기도 성남시 분당구", at: "지자체", ep: "187000000", ba: null, od: "2026-10-22 11:00:00+00", bid_close_dt: "2026-10-22 10:00:00+00", participated: true, prediction_id: null },
  { id: 3, pn_no: null, pn: "번호없음", ag: "경기도 고양시", at: "지자체", ep: "1000000", ba: null, od: "2026-10-24 11:00:00+00", bid_close_dt: null, participated: false, prediction_id: null },
  { id: 4, pn_no: "R26BK01700000", pn: "김포 마감된 공고", ag: "경기도 김포시", at: "지자체", ep: "5000000", ba: null, od: "2026-10-22 11:00:00+00", bid_close_dt: "2026-10-22 08:00:00+00", participated: true, prediction_id: null },
];
const P = [
  { id: 18102, pn_no: "R26BK01771900", source: "g2b_auto", match_status: "pending", open_date: "2026-10-23", created_at: "2026-10-20T01:00:00Z", ba: "853617001", b_pred_mode: "B", b_pred_adj: "1.1357", b_pred_bid_amount: "765690942" },
  { id: 500, pn_no: "R26BK01771900-000", source: "file_upload", match_status: "pending", open_date: "2026-10-23", created_at: "2026-10-21T01:00:00Z", ba: "850000000" },
  { id: 501, pn_no: "R26BK01771900-001", source: "file_upload", match_status: "pending", open_date: "2026-10-30", created_at: "2026-10-22T01:00:00Z", ba: "850000000" },
  { id: 600, pn_no: "UMM0410-1", source: "file_upload", match_status: "pending", open_date: "2026-10-25", created_at: "2026-10-21T01:00:00Z", ba: "178889000", ag: "제9911부대", at: "군시설", pn: "부대 전기공사" },
  { id: 601, pn_no: "UMM0400-1", source: "file_upload", match_status: "matched", open_date: "2026-10-01", created_at: "2026-09-21T01:00:00Z", ba: "1", ag: "제1부대", at: "군시설", pn: "끝난 건" },
  { id: 602, pn_no: null, source: "file_upload", match_status: "pending", open_date: "2026-10-26", created_at: "2026-10-21T01:00:00Z", ba: "5", ag: "민간", at: "지자체", pn: "번호없는 예측" },
];
const pcOf = ({ ag }) => ag.includes("고양") ? { p50: 224, grain: "AG_BA" } : ag.includes("성남") ? { p50: 50, grain: "AT_BA" } : null;
const NOW = "2026-10-22T09:00:00.000Z";

// pickPrediction
eq(pickPrediction([P[0], P[1], P[2]], "2026-10-23").id, 500, "file_upload 우선 + 개찰일 일치 우선");
eq(pickPrediction([P[1], P[2]], null).id, 501, "개찰일 기준 없으면 created_at 최신");
eq(pickPrediction([P[0]], "2026-10-23").id, 18102, "자동만 있으면 자동");
eq(pickPrediction([], "2026-10-23"), null, "후보 없음");

// buildTodayRows
const nCopy = JSON.stringify(N), pCopy = JSON.stringify(P);
const rows = buildTodayRows({ notices: N, predictions: P, keywords: ["고양"], pcOf, nowIso: NOW });
eq(JSON.stringify(N), nCopy, "notices 불변"); eq(JSON.stringify(P), pCopy, "predictions 불변");
eq(rows.map(r => r.key).join(","), "n:4,n:2,n:1,n:3,p:600,p:602", "정렬: 마감/개찰 임박순, 단독 예측은 개찰일");
eq(rows.find(r => r.key === "n:4").status, STATUS.CLOSED, "마감 지남(투찰 기록보다 우선)");
const r1 = rows.find(r => r.key === "n:1");
eq(r1.predId, 500, "공고1은 file_upload 500 선택(자동 18102 아님)"); eq(r1.source, "file_upload", "출처");
eq(r1.amountEstimated, false, "업로드 예측이 붙으면 그 기초금액이 확정값"); near(r1.amount, 850000000, 1, "금액 = 업로드 예측 ba");
const rAuto = buildTodayRows({ notices: [N[0]], predictions: [P[0]], keywords: ["고양"], pcOf, nowIso: NOW }).find(r => r.key === "n:1");
eq(rAuto.amountEstimated, true, "자동 예측만 있으면 추정"); near(rAuto.amount, 776015455 * 1.1, 1, "추정 금액 = ep×1.1");
eq(r1.group, "target", "고양 키워드 → 관내"); eq(r1.status, STATUS.PRED_FILE, "상태 예측(엑셀)");
eq(r1.p50, 224, "예상 참가자수"); eq(r1.closeAt, "2026-10-23 10:00:00+00", "마감일시 보존");
const r2 = rows.find(r => r.key === "n:2");
eq(r2.predId, null, "성남은 예측 없음"); eq(r2.group, "general", "AT_BA grain p50은 소경쟁 판정 제외"); eq(r2.status, STATUS.BID, "participated → 투찰 기록");
const r3 = rows.find(r => r.key === "n:3");
eq(r3.predId, null, "pn_no null 공고는 pn_no null 예측과 합치지 않음"); eq(r3.status, STATUS.NONE, "예측 없음");
const r600 = rows.find(r => r.key === "p:600");
eq(r600.closeAt, null, "단독 예측 마감 없음"); eq(r600.openAt, "2026-10-25", "개찰일"); eq(r600.status, STATUS.PRED_FILE, "상태"); eq(r600.amountEstimated, false, "업로드 금액은 확정");
eq(r600.noticeId, null, "공고 없음"); eq(r600.predId, 600, "예측 id"); eq(r600.group, "general", "군부대는 키워드 밖·pcOf null → 일반");
eq(rows.some(r => r.key === "p:601"), false, "matched 예측은 제외");
eq(rows.some(r => r.key === "p:501"), false, "같은 공고의 후보였던 -001은 단독 행으로 남지 않음");
eq(rows.some(r => r.key === "p:18102"), false, "자동 예측은 단독 행이 되지 않음");

// filterRows
eq(filterRows(rows, "target", false).map(r => r.key).join(","), "n:1,n:3", "기본 필터: 관내·소경쟁, 마감·개찰 지난 것 제외");
eq(filterRows(rows, "all", false).length, 5, "전체: 마감된 n:4만 제외(n:2는 마감 전 투찰 기록)");
eq(filterRows(rows, "all", true).length, 6, "마감 포함");

// 로컬 날짜(today)를 따로 받는다 — KST 아침(UTC 전날)에 오늘 개찰 단독 예측이 사라지면 안 된다
const morning = buildTodayRows({ notices: [], predictions: [{ id: 700, pn_no: "UMM0500-1", source: "file_upload", match_status: "pending", open_date: "2026-10-22", created_at: "2026-10-20T01:00:00Z", ba: "100", ag: "제2부대", at: "군시설", pn: "오늘 개찰" }], keywords: [], pcOf: () => null, nowIso: "2026-10-21T23:30:00.000Z", today: "2026-10-22" });
eq(morning.length, 1, "KST 08:30(UTC 전날 23:30)에도 오늘 개찰 단독 예측 유지");

// 업종 판정 — 업종(cat)이 비어 있는 공고가 절반이라 공고명 단어로 보완
eq(tradesOf({ cat: "전기공사업", pn: "동탄12고 신축 전기공사" }).join(","), "elec", "업종 전기");
eq(tradesOf({ cat: "정보통신공사업", pn: "신축 통신공사" }).join(","), "comm", "업종 통신");
eq(tradesOf({ cat: "전문소방시설공사업", pn: "신축 소방공사" }).join(","), "fire", "업종 소방(전문)");
eq(tradesOf({ cat: "일반소방시설공사업(기계)", pn: "소방공사" }).join(","), "fire", "업종 소방(일반)");
eq(tradesOf({ cat: null, pn: "심학초 교사동 냉난방기 전기공사" }).join(","), "elec", "업종 없음 + 공고명 전기");
eq(tradesOf({ cat: null, pn: "2026년 보안등 연간단가 보수공사" }).join(","), "elec", "공고명 보안등");
eq(tradesOf({ cat: null, pn: "교사동 CCTV 설치공사" }).join(","), "comm", "공고명 CCTV");
eq(tradesOf({ cat: "철근ㆍ콘크리트공사업", pn: "대성터널 제연설비 보강공사(전기)" }).join(","), "elec,fire", "다른 업종이어도 공고명에 전기(제연설비는 소방도 해당)");
eq(tradesOf({ cat: "건축공사업", pn: "새빛학교 신축공사" }).length, 0, "건축은 해당 없음");
eq(tradesOf({ cat: null, pn: "운동장 조성공사" }).length, 0, "업종 없음 + 무관 공고명");
eq(tradesOf({ cat: null, pn: "본관 변압기 교체공사" }).join(","), "elec", "변압기");
eq(tradesOf({ cat: null, pn: "수전설비 개선" }).join(","), "elec", "수전설비");
eq(tradesOf({ cat: null, pn: "분전반 교체" }).join(","), "elec", "분전반");
eq(tradesOf({ cat: null, pn: "비상발전기 설치" }).join(","), "elec", "발전기");
eq(tradesOf({ cat: null, pn: "피뢰설비 보수" }).join(","), "elec", "피뢰");
eq(tradesOf({ cat: null, pn: "하천변 경관녹지 조성" }).length, 0, "경관녹지(조경)는 전기 아님");

const TR = [
  { key: "a", group: "target", status: STATUS.NONE, trades: ["elec"] },
  { key: "b", group: "target", status: STATUS.NONE, trades: ["comm"] },
  { key: "c", group: "target", status: STATUS.NONE, trades: ["fire"] },
  { key: "d", group: "target", status: STATUS.NONE, trades: [] },
  { key: "e", group: "target", status: STATUS.PRED_FILE, trades: [], source: "file_upload", predId: 5 },
  { key: "f", group: "target", status: STATUS.PRED_FILE, trades: null },
];
eq(filterRows(TR, "target", false, ["elec"]).map(r => r.key).join(","), "a,e,f", "전기만: 엑셀 예측 행은 업종 무관 표시");
eq(filterRows(TR, "target", false, ["elec", "comm"]).map(r => r.key).join(","), "a,b,e,f", "전기+통신");
eq(filterRows(TR, "target", false, ["elec", "comm", "fire"]).map(r => r.key).join(","), "a,b,c,e,f", "전기+통신+소방");
eq(filterRows(TR, "target", false).length, 6, "업종 인자 없으면 거르지 않음");
// 사용자 신호(투찰 기록·예측 등록·엑셀 업로드)가 있는 공고는 업종과 무관하게 남긴다 — 상태가 바뀌어도
const SIG = [
  { key: "bid", group: "target", status: STATUS.BID, trades: [], participated: true, predId: null, source: null },
  { key: "auto", group: "target", status: STATUS.PRED_AUTO, trades: [], participated: false, predId: 7, source: "g2b_auto" },
  { key: "fileClosed", group: "target", status: STATUS.CLOSED, trades: [], participated: false, predId: 8, source: "file_upload" },
  { key: "none", group: "target", status: STATUS.NONE, trades: [], participated: false, predId: null, source: null },
];
// 자동 예측(g2b_auto)은 서버 cron이 공고 대부분에 만들어 '사용자 신호'가 아니다(2026-10-23 실측: 예정 공고 예측 195건 전부 g2b_auto) — 업종 필터 대상
eq(filterRows(SIG, "target", true, ["elec"]).map(r => r.key).join(","), "bid,fileClosed", "투찰 기록·엑셀 예측만 업종 무관 유지, 자동 예측·미분류는 숨김");
eq(buildTodayRows({ notices: [{ id: 9, pn_no: "X1", pn: "가로등 정비", ag: "a", at: "지자체", ep: "1", od: "2026-10-30", cat: null }], predictions: [], keywords: [], pcOf: () => null, nowIso: NOW })[0].trades.join(","), "elec", "공고 행에 업종 부여");
eq(r600.trades, null, "단독 엑셀 예측 행은 업종 판정 안 함(null)");

// statusOf
eq(statusOf({ openAt: "2026-10-21 11:00:00+00", closeAt: "2026-10-21 10:00:00+00" }, NOW), STATUS.OPENED, "개찰 지남 우선");
eq(statusOf({ openAt: "2026-10-23 11:00:00+00", closeAt: "2026-10-22 08:00:00+00", participated: true }, NOW), STATUS.CLOSED, "마감 지남 > 투찰 기록");
eq(statusOf({ openAt: "2026-10-23", closeAt: null, predId: 7, source: "g2b_auto" }, NOW), STATUS.PRED_AUTO, "자동 예측");

console.log(bad === 0 ? "OK todayNotices" : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
