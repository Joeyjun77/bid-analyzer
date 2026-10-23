// 표·엑셀의 ✓/✗는 화면·카드가 보여 주는 추천 투찰금(bid1st||bid)을 판정해야 한다(P4 최종 리뷰 Important 1).
// App.jsx 인라인 식이라 소스 단언으로 고정한다.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
let bad = 0;
const eq = (got, exp, msg) => { if (got !== exp) { console.error(`XX ${msg}: got ${got} expect ${exp}`); bad++; } };

eq(/bidVerdict\(finalBid,/.test(src), false, "판정이 bid1st 없는 finalBid를 쓰지 않음");
eq((src.match(/bidVerdict\(finalBid1st\|\|finalBid,/g) || []).length, 2, "표·엑셀 둘 다 표시 금액으로 판정");
eq(/"추천 투찰금액":finalBid\|\|""/.test(src), false, "엑셀 금액 열도 표시 금액");

console.log(bad === 0 ? "OK verdictAmount" : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
