import { readBssamt } from "../supabase/functions/fn-collect-bssamt/bssamt.js";

let bad = 0;
const eq = (got, exp, msg) => { if (got !== exp) { console.error(`XX ${msg}: got ${got} expect ${exp}`); bad++; } };

// 2026-11-07 실측 응답(R26BK01796411, 개찰 2일 전) — A값 = 국민연금+건강+장기요양+퇴직공제+안전관리비(+품질관리비 대상이면)
const item = { bidNtceNo: "R26BK01796411", bidNtceOrd: "000", bssamt: "263285000", bssamtOpenDt: "2026-10-29 09:49:06",
  sftyMngcst: "5602731", sftyChckMngcst: "0", rtrfundNon: "2162934", mrfnHealthInsrprm: "3380760", npnInsrprm: "4466929",
  odsnLngtrmrcprInsrprm: "444231", qltyMngcst: "0", qltyMngcstAObjYn: "Y", bidPrceCalclAYn: "Y" };
const r = readBssamt([item], "000");
eq(r.found, true, "기초금액 있음"); eq(r.ba, 263285000, "기초금액"); eq(r.av, 16057585, "A값 합");
eq(r.aApplies, true, "A 적용"); eq(r.openDt, "2026-10-29 09:49:06", "공개 시각"); eq(r.ord, "000", "차수");

// 차수: 요청 차수가 없으면 최신 차수
const r2 = readBssamt([{ ...item, bidNtceOrd: "000", bssamt: "100" }, { ...item, bidNtceOrd: "001", bssamt: "200" }], "002");
eq(r2.ba, 200, "없는 차수면 최신 차수"); eq(r2.ord, "001", "최신 차수 번호");
eq(readBssamt([{ ...item, bidNtceOrd: "000", bssamt: "100" }, { ...item, bidNtceOrd: "001", bssamt: "200" }], "000").ba, 100, "요청 차수 우선");

// 아직 공개 전: 항목 없음·기초금액 0/빈 값은 found=false (값을 지우지 않게 null)
eq(readBssamt([], "000").found, false, "응답 없음");
const r3 = readBssamt([{ ...item, bssamt: "" }], "000"); eq(r3.found, false, "빈 기초금액"); eq(r3.ba, null, "빈 기초금액 null"); eq(r3.av, null, "A값도 null");
eq(readBssamt([{ ...item, bssamt: "0" }], "000").found, false, "0원은 미공개");

// A 미적용 공고는 기초금액 확정·A값 0
const r4 = readBssamt([{ ...item, bidPrceCalclAYn: "N" }], "000");
eq(r4.found, true, "A 미적용도 기초금액 확정"); eq(r4.av, 0, "A 미적용 A값 0"); eq(r4.aApplies, false, "A 미적용 표시");

console.log(bad === 0 ? "OK bssamt" : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
