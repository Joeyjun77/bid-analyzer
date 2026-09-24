import { rec1stPossible } from "../src/lib/rec1stPossible.js";

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

console.log(bad === 0 ? "OK rec1stPossible all cases" : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
