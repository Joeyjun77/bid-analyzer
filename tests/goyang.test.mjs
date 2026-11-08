import { filterGoyang, drawExpected, GOYANG_GRP_LABEL } from "../src/lib/goyang.js";

let bad = 0;
const eq = (got, exp, msg) => { if (got !== exp) { console.error(`XX ${msg}: got ${got} expect ${exp}`); bad++; } };

const a = { ag: "경기도 고양시", opt_adj: 0.123, bid1st_v2_rate: 87.9 };
const b = { ag: "경기도 고양시 덕양구 ", opt_adj: -0.2 };
const c = { ag: "경기도 파주시", opt_adj: 0.5 };
const d = { ag: null };
const list = [a, b, c, d];
const set = new Set(["경기도 고양시", "경기도 고양시 덕양구"]);

const out = filterGoyang(list, set);
eq(out.length, 2, "고양 2건만");
eq(out[0], a, "행 객체 그대로(같은 참조)");
eq(out[1], b, "앞뒤 공백 무시");
eq(a.opt_adj, 0.123, "원본 값 불변");
eq(list.length, 4, "원본 배열 불변");
eq(filterGoyang(list, null), list, "목록 미수신이면 필터 없음");
eq(filterGoyang(list, new Set()), list, "빈 목록이면 필터 없음");
eq(drawExpected(15), 4, "추첨 기댓값 n×4/15");
eq(GOYANG_GRP_LABEL.G5, "학교", "그룹 라벨");

console.log(bad === 0 ? "OK goyang" : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
