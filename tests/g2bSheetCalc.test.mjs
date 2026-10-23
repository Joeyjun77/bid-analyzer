import { sumAValue, computeSheet, classifyTrade, parseOpengCorpInfo } from "../supabase/functions/fn-collect-g2b-sheet/calc.js";

let bad = 0;
const eq = (got, exp, msg) => { if (got !== exp) { console.error(`XX ${msg}: got ${got} expect ${exp}`); bad++; } };
const near = (got, exp, tol, msg) => { if (got == null || Math.abs(got - exp) > tol) { console.error(`XX ${msg}: got ${got} expect ${exp}±${tol}`); bad++; } };

// sumAValue — 기초금액 API 항목 합. 기대값은 2026-10-23 API 응답과 엑셀 A값(원 단위 일치)
const a1 = sumAValue({ sftyMngcst: "4614958", sftyChckMngcst: "0", rtrfundNon: "1632474", mrfnHealthInsrprm: "0", npnInsrprm: "0", odsnLngtrmrcprInsrprm: "0", qltyMngcst: "0", qltyMngcstAObjYn: "Y", bidPrceCalclAYn: "Y" });
eq(a1.av, 6247432, "A값 합 1 (R26BK01766907)"); eq(a1.aApplies, true, "A 적용");
const a2 = sumAValue({ sftyMngcst: "1002713", sftyChckMngcst: "11151050", rtrfundNon: "891455", mrfnHealthInsrprm: "1393384", npnInsrprm: "1841049", odsnLngtrmrcprInsrprm: "183090", qltyMngcst: "0", qltyMngcstAObjYn: "Y", bidPrceCalclAYn: "Y" });
eq(a2.av, 16462741, "A값 합 2 (R26BK01779419)");
eq(sumAValue({ sftyMngcst: "5", bidPrceCalclAYn: "N" }).av, 0, "A 미적용은 0");
eq(sumAValue({ sftyMngcst: "5", bidPrceCalclAYn: "N" }).aApplies, false, "A 미적용 표시");
eq(sumAValue({ qltyMngcst: "7", qltyMngcstAObjYn: "N", bidPrceCalclAYn: "Y" }).av, 0, "품질관리비 대상 아님");
eq(sumAValue({ qltyMngcst: "7", qltyMngcstAObjYn: "Y", bidPrceCalclAYn: "Y" }).av, 7, "품질관리비 대상");
eq(sumAValue({ envCnsrvcst: "9", sftyMngcst: "", bidPrceCalclAYn: "Y" }).av, 0, "환경보전비는 합에 미포함·빈 문자열 0");
eq(sumAValue({ envCnsrvcst: "9", bidPrceCalclAYn: "Y" }).items.envCnsrvcst, 9, "대조용 항목 보존");

// computeSheet — 엑셀 정답값(R26BK01766907·R26BK01779419)
const s1 = computeSheet({ ba: 232628000, av: 6247432, xp: 232673400, fr: 89.745, bp: 209456310 });
eq(s1.ar1, 100.0195, "ar1"); eq(s1.br1, 100.0209, "br1 절사"); eq(s1.floor_price, 209453417, "하한가 올림 1"); eq(s1.missing.length, 0, "완성");
const s2 = computeSheet({ ba: 96200000, av: 16462741, xp: 96730375, fr: 89.745, bp: 88518497 });
eq(s2.floor_price, 88498930, "하한가 올림 2"); eq(s2.ar1, 100.5513, "ar1 2"); eq(s2.br1, 100.5739, "br1 2 절사(100.57399)");
const s3 = computeSheet({ ba: 96200000, av: 0, xp: 96730375, fr: 89.745, bp: null });
eq(s3.br1, null, "bp 없으면 br1 없음"); eq(s3.ar1, 100.5513, "ar1은 계산"); eq(s3.missing.join(), "bp", "missing bp");
const s4 = computeSheet({ ba: null, av: 0, xp: 1, fr: 89.745, bp: 1 });
eq(s4.ar1, null, "ba 없음"); eq(s4.br1, null, "ba 없으면 br1도 없음"); eq(s4.missing.join(), "ba", "missing ba");
const s5 = computeSheet({ ba: 100, av: null, xp: 101, fr: 89.745, bp: 95 });
eq(s5.floor_price, null, "A값 없으면 하한가 없음"); eq(s5.ar1, 101, "ar1은 계산"); eq(s5.missing.join(), "av", "missing av");
eq(computeSheet({ ba: 100, av: 0, xp: 101, fr: null, bp: 95 }).missing.join(), "fr", "missing fr");

// classifyTrade — 공고명 추정 금지, 전부 공백이면 모름(null)
eq(classifyTrade({ cat: "", mainCnsttyNm: "전기공사업" }).elec, true, "주공종");
eq(classifyTrade({ cat: "", mainCnsttyNm: "전기공사업" }).source, "mainCnsttyNm", "출처");
eq(classifyTrade({ cat: "정보통신공사업,전기공사업" }).elec, true, "복수 면허");
eq(classifyTrade({ licenseNames: ["전기공사업/0001"] }).elec, true, "면허 제한");
eq(classifyTrade({ cat: "건축공사업", mainCnsttyNm: "" }).elec, false, "다른 업종");
eq(classifyTrade({ cat: null, mainCnsttyNm: null, licenseNames: [] }).elec, null, "전부 공백은 모름");
eq(classifyTrade({}).source, null, "출처 없음");

// parseOpengCorpInfo — 개찰결과 opengCorpInfo '업체^사업자번호^대표^투찰금액^투찰률' (2026-10-23 실측 R26BK01764713)
const oc = parseOpengCorpInfo("주식회사 성은이엔씨^8778102412^한헌석^113452950^90.025");
eq(oc.co, "주식회사 성은이엔씨", "1순위 업체"); eq(oc.co_no, "8778102412", "사업자번호"); eq(oc.bp, 113452950, "1순위 금액"); eq(oc.rate, 90.025, "투찰률");
eq(parseOpengCorpInfo("").bp, null, "빈 값"); eq(parseOpengCorpInfo(null).co, null, "null");
eq(parseOpengCorpInfo("업체^123").bp, null, "필드 부족");

console.log(bad === 0 ? "OK g2bSheetCalc" : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
