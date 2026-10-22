import { basePnNo, pickPrediction, STATUS, statusOf, buildTodayRows, filterRows } from "../src/lib/todayNotices.js";

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
eq(r1.amountEstimated, true, "공고 ba 없음 → 추정"); near(r1.amount, 776015455 * 1.1, 1, "금액 = ep×1.1");
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

// statusOf
eq(statusOf({ openAt: "2026-10-21 11:00:00+00", closeAt: "2026-10-21 10:00:00+00" }, NOW), STATUS.OPENED, "개찰 지남 우선");
eq(statusOf({ openAt: "2026-10-23 11:00:00+00", closeAt: "2026-10-22 08:00:00+00", participated: true }, NOW), STATUS.CLOSED, "마감 지남 > 투찰 기록");
eq(statusOf({ openAt: "2026-10-23", closeAt: null, predId: 7, source: "g2b_auto" }, NOW), STATUS.PRED_AUTO, "자동 예측");

console.log(bad === 0 ? "OK todayNotices" : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
