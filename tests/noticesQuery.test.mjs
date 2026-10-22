import { buildNoticesQuery, NOTICE_REGIONS, NOTICE_COLS } from "../src/lib/noticesQuery.js";

let bad = 0;
const eq = (got, exp, msg) => { if (got !== exp) { console.error(`XX ${msg}: got ${got} expect ${exp}`); bad++; } };
const has = (s, sub, msg) => { if (!s.includes(sub)) { console.error(`XX ${msg}: '${sub}' not in ${s}`); bad++; } };

eq(NOTICE_REGIONS.join("|"), "경기", "기본 지역 필터");
has(NOTICE_COLS, "bid_close_dt", "투찰 마감일시 컬럼 포함");
has(NOTICE_COLS, "participated", "참여 여부 컬럼 포함");

const q = buildNoticesQuery("2026-10-22T09:00:00.000Z", ["경기"], ["고양"]);
has(q, "od=gte.2026-10-22T09:00:00.000Z", "개찰일 하한 = 지금");
has(q, "order=od.asc", "임박순 정렬");
has(q, "limit=1000", "상한 유지");
has(q, "or=(reg.ilike.*" + encodeURIComponent("경기") + "*,ag.ilike.*" + encodeURIComponent("고양") + "*,pn.ilike.*" + encodeURIComponent("고양") + "*)", "지역 OR 키워드(발주처·공고명)");
eq(q.startsWith("/rest/v1/bid_notices?select="), true, "경로");

const q2 = buildNoticesQuery("2026-10-22T09:00:00.000Z", ["경기", "서울"], []);
has(q2, "or=(reg.ilike.*" + encodeURIComponent("경기") + "*,reg.ilike.*" + encodeURIComponent("서울") + "*)", "키워드 없으면 지역만");

const q3 = buildNoticesQuery("2026-10-22T09:00:00.000Z", [], []);
eq(q3.includes("or=("), false, "지역·키워드 둘 다 없으면 OR 절 생략(개찰 예정 전체)");

const q4 = buildNoticesQuery("2026-10-22T09:00:00.000Z", ["경기"], ["고양,파주"]);
eq((q4.match(/ag\.ilike/g) || []).length, 1, "쉼표 포함 키워드는 그대로 1개(정규화는 호출자 책임)");

console.log(bad === 0 ? "OK noticesQuery" : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
