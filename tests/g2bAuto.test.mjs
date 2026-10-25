import { mergeAutoRows, G2B_AUTO_SHOW } from "../src/lib/g2bAuto.js";
import { dedupExactRecords } from "../src/lib/g2bFrequency.js";

let bad = 0;
const eq = (got, exp, msg) => { if (got !== exp) { console.error(`XX ${msg}: got ${got} expect ${exp}`); bad++; } };

const recs = [{ id: 1, pn_no: "R26BK1-000", ar1: 100.1, br1: 100.2, canonical_ag: "고양시", od: "2026-09-01", ba: 100, bp: 90 },
              { id: 2, pn_no: "R26BK2", ar1: null, br1: 90.3 }];               // API 불완전 행
const auto = [{ id: 7, bid_ntce_no: "R26BK1", bid_ntce_ord: "000", status: "complete", ar1: 100.1, od: "2026-09-01", ba: 100, bp: 90 },  // 엑셀 있음 → 제외
              { id: 8, bid_ntce_no: "R26BK2", bid_ntce_ord: "000", status: "complete", ar1: 100.3, br1: 100.4, canonical_ag: "고양시", od: "2026-09-02", trade_elec: true },
              { id: 9, bid_ntce_no: "R26BK3", bid_ntce_ord: "000", status: "pending" },                                               // 미완성 → 제외
              { id: 10, bid_ntce_no: "R26BK4", bid_ntce_ord: "000", status: "complete", ar1: 99.9, excel_record_id: 55 },             // 서버가 엑셀을 찾음 → 제외
              { id: 11, bid_ntce_no: "R26BK5", bid_ntce_ord: "001", status: "complete", ar1: 99.8, purpose: "compare" }];             // 대조용 → 제외
const copy = JSON.stringify(recs);
const m = mergeAutoRows(recs, auto);
eq(JSON.stringify(recs), copy, "원본 불변");
eq(m.length, 3, "자동 1건만 추가");
eq(m[2].id, -8, "음수 id"); eq(m[2].pn_no, "R26BK2-000", "차수 붙임"); eq(m[2]._auto, true, "자동 표시");
eq(m[2].cat, "전기", "업종은 엑셀 표기('전기')"); eq(m[2].is_excluded, false, "제외 아님"); eq(m[2].canonical_ag, "고양시", "발주처");
eq(mergeAutoRows(recs, []), recs, "빈 자동 → 같은 참조");
// 참여 공고는 업종과 무관하게 계산되므로, 전기가 아닌 행에 '전기'를 붙이지 않는다
const other = mergeAutoRows([], [{ id: 12, bid_ntce_no: "R26BK6", status: "complete", ar1: 100, trade_elec: false }]);
eq(other[0].cat, null, "비전기 참여 공고는 업종 비움");
eq(mergeAutoRows([], [{ id: 13, bid_ntce_no: "R26BK7", status: "complete", ar1: 100, trade_elec: true }])[0].cat, "전기", "전기 공고");
eq(mergeAutoRows(recs, null), recs, "null 자동 → 같은 참조");
eq(G2B_AUTO_SHOW, true, "대조 합격 후 켬(2026-10-25)");

// 엑셀 행과 겹치는 자동 행이 섞여도 dedup 뒤 엑셀 행이 남는다(음수 id가 최소 id로 이기는 사고 방지)
const d = dedupExactRecords(mergeAutoRows(recs, auto));
eq(d.some(r => r.id === 1), true, "엑셀 행 유지"); eq(d.some(r => r.id === -7), false, "겹친 자동 행 없음");

console.log(bad === 0 ? "OK g2bAuto" : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
