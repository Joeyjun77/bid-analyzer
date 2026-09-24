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
