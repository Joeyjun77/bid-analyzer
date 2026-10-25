// G2B 양식 자동 수집 행(g2b_auto_sheet)을 G2B 양식 탭·투찰 카드 1위 이력 전용 목록에 합친다. 순수 함수.
// 예측 엔진 입력(recs → refreshStats·adjHist·pcDistMap·recOf)에는 절대 넘기지 않는다 — 스펙 §8, predict-architect 2026-10-23 조건.
// 스펙: docs/superpowers/specs/2026-10-23-g2b-auto-collect-design.md

// 2026-10-25 엑셀 대조 합격(ar1·floor 100%, br1 98.26%, 업종 재현율 98.42%)·사용자 승인으로 켬. 집계에 포함되고 화면에 '자동' 배지·"자동 N건 포함"이 붙는다.
export const G2B_AUTO_SHOW = true;

const base = (pnNo) => String(pnNo || "").replace(/-\d{3}$/, "");

// 같은 공고의 엑셀 행(차수 접미사 -NNN + 발주처사정율)이 있거나, 서버가 엑셀 행을 찾은(excel_record_id·compare) 자동 행은 뺀다.
export function mergeAutoRows(recs, autoRows) {
  if (!autoRows || !autoRows.length) return recs;
  const excel = new Set((recs || []).filter(r => r && /-\d{3}$/.test(r.pn_no || "") && r.ar1 != null).map(r => base(r.pn_no)));
  const add = autoRows
    .filter(a => a && a.status === "complete" && a.excel_record_id == null && a.purpose !== "compare" && !excel.has(a.bid_ntce_no))
    .map(a => ({
      id: -a.id, pn_no: a.bid_ntce_no + "-" + (a.bid_ntce_ord || "000"), pn: a.pn, ag: a.ag, canonical_ag: a.canonical_ag, at: a.at, od: a.od,
      ba: a.ba, av: a.av, xp: a.xp, fr: a.fr, bp: a.bp, co: a.co, co_no: a.co_no, pc: a.pc,
      ar1: a.ar1, br1: a.br1, floor_price: a.floor_price, cat: a.trade_elec ? "전기" : null, is_excluded: false, _auto: true, // 참여 공고는 업종 무관하게 계산됨
    }));
  return add.length ? [...(recs || []), ...add] : recs;
}
