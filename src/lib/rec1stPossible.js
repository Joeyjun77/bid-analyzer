// 1순위 가능 판정 (rec_1st_possible) — 순수 함수, node 테스트 가능.
// !! 서버 cron match_pending_predictions 및 pwin(update_strategy_log_outcomes, m44)과 동일 정의 유지 필수 !!
// 정의: 전략 투찰금 bid가 실제 1위 금액(bp)보다 낮고(동액은 추첨이라 확실한 1순위가 아님 → 제외)
//       실제 낙찰하한가(floor_price, A값 반영) 이상이면 true.
// bp·floor_price 중 하나라도 없으면 판정 불가 → null (서버도 NULL, 필드 미기록).
// 2026-09-24: 이전 클라이언트 식 `bid <= bp && bid >= xp*fr/100`은 A값을 빠뜨리고 레코드의 stale fr을 써서
//   저장된 "가능" 106건 중 20건이 실제 하한 미달이었다(서버 경로는 정상). 이 모듈로 두 경로를 통일한다.
const STRATEGIES = [
  ["existing", "pred_bid_amount"],
  ["aggressive", "rec_bid_p25"],
  ["balanced", "rec_bid_p50"],
  ["conservative", "rec_bid_p75"],
];

const num = (v) => (v == null || v === "" ? NaN : Number(v));

export function rec1stPossible(pred, rec) {
  if (!rec) return null;
  const bp = num(rec.bp), floor = num(rec.floor_price);
  if (!isFinite(bp) || !isFinite(floor)) return null;
  const out = {};
  for (const [key, field] of STRATEGIES) {
    const bid = num(pred?.[field]);
    out[key] = isFinite(bid) && bid < bp && bid >= floor;
  }
  return out;
}

// 이미 매칭된 행을 같은 값으로 다시 저장하는지 — 결과 없는 매칭 행은 결과가 늦게 올 때를 대비해 매번 재시도하므로(supabase.js),
// 바뀌는 값이 없으면 PATCH를 생략한다. matched_at은 비교하지 않는다(재시도마다 새 시각이라 그것만으로 저장할 이유가 안 된다).
const REMATCH_SKIP = new Set(["id", "matched_at", "rec_1st_possible"]); // 나머지 저장 컬럼은 전부 비교 — 컬럼이 늘어도 누락 없이 저장 쪽으로 간다
const TEXT_KEYS = new Set(["match_status", "actual_winner"]); // 문자 그대로 비교("007"과 "7"은 다른 값)
const sameVal = (k, a, b) => {
  if (a == null || b == null) return a == null && b == null;
  if (TEXT_KEYS.has(k)) return a === b;
  const x = Number(a), y = Number(b);
  return isFinite(x) && isFinite(y) ? x === y : String(a) === String(b);
};
const sameR1 = (stored, next) => {
  try {
    const s = JSON.parse(stored), n = JSON.parse(next);
    return !!s && !!n && STRATEGIES.every(([k]) => s[k] === n[k]);
  } catch { return false; }
};
export function isNoopRematch(pred, update) {
  if (!pred || pred.match_status !== "matched") return false;
  if (!Object.keys(update).every((k) => REMATCH_SKIP.has(k) || sameVal(k, pred[k], update[k]))) return false;
  return update.rec_1st_possible === undefined || (pred.rec_1st_possible != null && sameR1(pred.rec_1st_possible, update.rec_1st_possible));
}

// 투찰금 하나의 개찰 판정 — 예측 기록 표·엑셀·투찰 카드 공용. 위와 같은 정의(실제 하한가 이상, 1위 금액 미만).
// "possible" = 1위 가능 금액, "above" = 1위 금액 이상(동액 포함), "below_floor" = 하한 미달, null = 판정 불가.
export function bidVerdict(bid, rec) {
  if (!rec) return null;
  const b = num(bid), bp = num(rec.bp), floor = num(rec.floor_price);
  if (!isFinite(b) || !isFinite(bp) || !isFinite(floor)) return null;
  if (b >= bp) return "above";
  return b < floor ? "below_floor" : "possible";
}
