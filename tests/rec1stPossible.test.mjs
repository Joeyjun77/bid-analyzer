import { rec1stPossible, bidVerdict, isNoopRematch } from "../src/lib/rec1stPossible.js";

let bad = 0;
const eq = (got, exp, msg) => {
  const g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g !== e) { console.error(`XX ${msg}: got ${g} expect ${e}`); bad++; }
};
const P = (e, a, b, c) => ({ pred_bid_amount: e, rec_bid_p25: a, rec_bid_p50: b, rec_bid_p75: c });

// 1. 판정 불가 — 서버(match_pending_predictions)도 bp·floor_price 중 하나라도 NULL이면 NULL
eq(rec1stPossible(P(100, 100, 100, 100), { bp: null, floor_price: 90 }), null, "bp null → null");
eq(rec1stPossible(P(100, 100, 100, 100), { bp: 110, floor_price: null }), null, "floor null → null");
eq(rec1stPossible(P(100, 100, 100, 100), null), null, "record 없음 → null");

// 2. 경계 — 서버 정의: bid < bp (동액=추첨이라 제외) AND bid >= floor_price
eq(rec1stPossible(P(110, 90, 89.99, 100), { bp: 110, floor_price: 90 }),
   { existing: false, aggressive: true, balanced: false, conservative: true },
   "bid==bp는 false, bid==floor는 true, floor 미만은 false");

// 3. 전략 bid 결측 → false (서버: bid IS NOT NULL AND ...)
eq(rec1stPossible(P(null, undefined, "", 100), { bp: 110, floor_price: 90 }),
   { existing: false, aggressive: false, balanced: false, conservative: true },
   "null/undefined/빈문자 bid는 false");

// 4. 숫자 문자열 (PostgREST numeric은 문자열로 올 수 있음)
eq(rec1stPossible(P("100", "95", "111", "89"), { bp: "110", floor_price: "90" }),
   { existing: true, aggressive: true, balanced: false, conservative: false },
   "문자열 숫자 처리");

// 5. 실데이터 동치 — 서버 cron이 기록한 행(저장값이 서버 정의와 일치, 2026-09-24 추출)
//    diverge: 옛 클라이언트 식(xp*fr/100, A값 누락)이면 balanced=true였으나 실제 하한 미달 → false
const real = [
  { id: 13144, p: P(190585348, 189540830, 190945188, 192314164), r: { bp: 191055352, floor_price: 191055245 },
    exp: { existing: false, aggressive: false, balanced: false, conservative: false } },
  { id: 12712, p: P(312996711, 312194176, 313382016, 314551239), r: { bp: 313855000, floor_price: 313844978 },
    exp: { existing: false, aggressive: false, balanced: false, conservative: false } },
  { id: 12032, p: P(4847666134, 4867361716, 4884393849, 4896690426), r: { bp: 4897634160, floor_price: 4895791584 },
    exp: { existing: false, aggressive: false, balanced: false, conservative: true } },
  { id: 16412, p: P(87591961, 87161876, 87670658, 88198809), r: { bp: 87174040, floor_price: 87104232 },
    exp: { existing: false, aggressive: true, balanced: false, conservative: false } },
  { id: 15358, p: P(48303257, 48170621, 48362821, 48646387), r: { bp: 48186920, floor_price: 48164305 },
    exp: { existing: false, aggressive: true, balanced: false, conservative: false } },
  { id: 15269, p: P(63576451, 63359463, 63623571, 63884799), r: { bp: 63789380, floor_price: 63461237 },
    exp: { existing: true, aggressive: false, balanced: true, conservative: false } },
];
for (const c of real) eq(rec1stPossible(c.p, c.r), c.exp, `실데이터 id=${c.id}`);

// bidVerdict — 투찰금 하나의 개찰 판정(표·엑셀·카드 공용). 정의는 rec1stPossible과 같다(동액은 1위 아님).
const RV = { bp: 1000, floor_price: 900 };
eq(bidVerdict(950, RV), "possible", "하한~1위 사이"); eq(bidVerdict(1000, RV), "above", "동액은 1위 아님");
eq(bidVerdict(1001, RV), "above", "1위 이상"); eq(bidVerdict(899, RV), "below_floor", "하한 미달");
eq(bidVerdict(900, RV), "possible", "하한과 같으면 통과"); eq(bidVerdict(950, null), null, "기록 없음");
eq(bidVerdict(950, { bp: 1000, floor_price: null }), null, "하한가 없음"); eq(bidVerdict(null, RV), null, "투찰금 없음");
eq(bidVerdict("950", { bp: "1000", floor_price: "900" }), "possible", "문자열 숫자");

// isNoopRematch — 이미 매칭된 행을 같은 값으로 다시 저장하는지(저장 생략 판정). matched_at은 비교하지 않는다.
const SP = { match_status: "matched", matched_record_id: 7, actual_adj_rate: null, actual_expected_price: null, actual_bid_amount: 1000, actual_winner: "A사", actual_participant_count: 50, adj_rate_error: null, bid_amount_error: -50, rec_1st_possible: null };
const SU = { match_status: "matched", matched_record_id: 7, actual_adj_rate: null, actual_expected_price: null, actual_bid_amount: 1000, actual_winner: "A사", actual_participant_count: 50, adj_rate_error: null, bid_amount_error: -50, matched_at: "2026-11-05T00:00:00Z" };
eq(isNoopRematch(SP, SU), true, "값이 모두 같으면 생략");
eq(isNoopRematch({ ...SP, actual_bid_amount: "1000", matched_record_id: "7" }, SU), true, "문자열 숫자도 같은 값");
eq(isNoopRematch({ ...SP, actual_bid_amount: 1000.0 }, { ...SU, actual_bid_amount: "1000.00" }), true, "숫자 표기 차이는 같은 값");
eq(isNoopRematch({ ...SP, match_status: "pending" }, SU), false, "대기 행은 항상 저장");
eq(isNoopRematch(SP, { ...SU, actual_adj_rate: 0.1234 }), false, "결과(ar1)가 도착하면 저장");
eq(isNoopRematch(SP, { ...SU, actual_bid_amount: 1100 }), false, "1위 금액이 바뀌면 저장");
eq(isNoopRematch({ ...SP, actual_bid_amount: null }, SU), false, "비어 있던 1위 금액이 오면 저장");
eq(isNoopRematch(SP, { ...SU, matched_record_id: 8 }), false, "다른 레코드로 바뀌면 저장");
eq(isNoopRematch(SP, { ...SU, actual_winner: "B사" }), false, "낙찰자가 바뀌면 저장");
eq(isNoopRematch(SP, { ...SU, bid_amount_error: -60 }), false, "오차 값이 다르면 저장");
const R1 = { existing: false, aggressive: true, balanced: false, conservative: false };
eq(isNoopRematch({ ...SP, rec_1st_possible: JSON.stringify(R1) }, { ...SU, rec_1st_possible: JSON.stringify(R1) }), true, "1위 가능 판정이 같으면 생략");
eq(isNoopRematch({ ...SP, rec_1st_possible: '{"balanced":false,"existing":false,"aggressive":true,"conservative":false}' }, { ...SU, rec_1st_possible: JSON.stringify(R1) }), true, "키 순서만 다르면 같은 값");
eq(isNoopRematch({ ...SP, rec_1st_possible: JSON.stringify({ ...R1, balanced: true }) }, { ...SU, rec_1st_possible: JSON.stringify(R1) }), false, "1위 가능 판정이 바뀌면 저장");
eq(isNoopRematch(SP, { ...SU, rec_1st_possible: JSON.stringify(R1) }), false, "하한가 도착으로 판정이 새로 생기면 저장");
eq(isNoopRematch({ ...SP, rec_1st_possible: "깨진값" }, { ...SU, rec_1st_possible: JSON.stringify(R1) }), false, "저장값을 못 읽으면 저장");
eq(isNoopRematch({ ...SP, rec_1st_possible: JSON.stringify(R1) }, SU), true, "이번에 판정을 안 쓰면 비교 안 함(기존 값 유지)");
eq(isNoopRematch(null, SU), false, "null 입력");

console.log(bad === 0 ? "OK rec1stPossible all cases" : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
