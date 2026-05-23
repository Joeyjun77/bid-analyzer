import { clsAg, isMilitaryAgency } from "../src/lib/agencyClass.js";

const cases = [
  ["수도방위사령부", "군시설"], ["육군항공사령부", "군시설"], ["제7862부대", "군시설"],
  ["제8기동사단", "군시설"], ["제1보병사단", "군시설"], ["수도기계화보병사단", "군시설"],
  ["제5군단사령부", "군시설"], ["국군재정관리단", "군시설"], ["공군제10전투비행단", "군시설"],
  ["국방부", "군시설"], ["해군본부", "군시설"], ["방위사업청", "군시설"],
  ["경기도 가평군", "지자체"], ["경기도 연천군", "지자체"], ["경기도 군포시", "지자체"],
  ["전라남도 해남군", "지자체"], ["전북특별자치도 군산시", "지자체"], ["가평군청", "지자체"],
  ["사단법인 한국석면안전협회", "지자체"], ["사단법인경기도새마을회", "지자체"],
  ["경기도교육청", "교육청"], ["한국전력공사", "한전"], ["조달청", "조달청"],
  ["한국토지주택공사", "LH"], ["한국수자원공사", "수자원공사"], ["고양시", "지자체"],
  ["제2136부대", "군시설"], ["4284부대", "군시설"], ["드론작전사령부", "군시설"], ["제2기갑여단", "군시설"],
  ["중부대학교", "지자체"],   // 대학교 — [0-9]부대 앵커링이 '부대' 단독 매칭 차단
];
let bad = 0;
for (const [n, exp] of cases) {
  const got = clsAg(n);
  if (got !== exp) { console.error(`XX ${n} -> ${got} (expect ${exp})`); bad++; }
}
if (isMilitaryAgency("수도방위사령부") !== true) { console.error("XX isMilitaryAgency(수도방위사령부) !== true"); bad++; }
if (isMilitaryAgency("고양시") !== false) { console.error("XX isMilitaryAgency(고양시) !== false"); bad++; }
console.log(bad === 0 ? `OK all ${cases.length} cases + isMilitaryAgency` : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
