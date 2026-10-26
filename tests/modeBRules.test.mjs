// 안착안 규칙 — 한전·LH σ 바닥, LH 예정가격 천원 절상 (스펙 .scratch/kepco-lh-sigma/spec.md)
import { modeBSigmaFloor } from "../src/lib/floorRisk.js";
import { roundExpectedPrice } from "../src/lib/fmtAdj.js";

let bad = 0;
const eq = (got, exp, msg) => { if (got !== exp) { console.error(`XX ${msg}: got ${got} expect ${exp}`); bad++; } };

eq(modeBSigmaFloor("한전"), 0.5, "한전 0.50");
eq(modeBSigmaFloor("LH"), 0.5, "LH 0.50");
eq(modeBSigmaFloor("지자체"), 0.642, "지자체 0.642 유지");
eq(modeBSigmaFloor("군시설"), 0.642, "군시설 0.642 유지");
eq(modeBSigmaFloor(null), 0.642, "유형 없음 0.642(항상 숫자)");

eq(roundExpectedPrice("LH", 234948123.4), 234949000, "LH 예정가격 천원 미만 절상");
eq(roundExpectedPrice("LH", 234949000), 234949000, "LH 이미 천원 단위면 그대로");
eq(roundExpectedPrice("지자체", 234948123.4), 234948123.4, "LH 외 그대로");
eq(roundExpectedPrice("한전", 100000500), 100000500, "한전 그대로");

console.log(bad === 0 ? "OK modeBRules" : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
