import { riskLabel, floorPassPct, floorPassLabel } from "../src/lib/floorLabels.js";

let bad = 0;
const eq = (got, exp, msg) => { if (got !== exp) { console.error(`XX ${msg}: got ${got} expect ${exp}`); bad++; } };

// 1. riskLabel — floorRisk.js에서 이동한 기존 동작 그대로
eq(riskLabel(null), "—", "risk null");
eq(riskLabel(97.5), "≥95%", "risk 97.5");
eq(riskLabel(95), "≥95%", "risk 95 경계");
eq(riskLabel(0.5), "<1%", "risk 0.5");
eq(riskLabel(7.25), "7.3%", "risk 7.25 소수1");
eq(riskLabel(23.6), "24%", "risk 23.6 정수");

// 2. floorPassLabel — 극단·결측
eq(floorPassLabel(null), "—", "pass null");
eq(floorPassLabel(undefined), "—", "pass undefined");
eq(floorPassLabel(NaN), "—", "pass NaN");
eq(floorPassLabel(97.5), "≤5%", "pass: risk 97.5");
eq(floorPassLabel(95), "≤5%", "pass: risk 95 경계");
eq(floorPassLabel(0.5), ">99%", "pass: risk 0.5");
eq(floorPassLabel(0.99), ">99%", "pass: risk 0.99");

// 3. floorPassLabel — 일반값 (riskLabel과 같은 자릿수)
eq(floorPassLabel(7.3), "92.7%", "pass: risk 7.3");
eq(floorPassLabel(9.96), "90.0%", "pass: risk 9.96 → risk 표기 10.0 → 90.0");
eq(floorPassLabel(23.5), "76%", "pass: risk 23.5 → risk 표기 24 → 76");
eq(floorPassLabel(1), "99.0%", "pass: risk 1");

// 4. floorPassPct — 막대 너비
eq(floorPassPct(null), null, "pct null");
eq(floorPassPct(12.5), 87.5, "pct 12.5");

// 5. 불변식: 1 ≤ r < 95 전 구간(0.01 간격)에서 표기 숫자 합 = 100
for (let i = 100; i < 9500; i++) {
  const r = i / 100;
  const a = parseFloat(riskLabel(r)), b = parseFloat(floorPassLabel(r));
  if (Math.abs(a + b - 100) > 1e-9) { console.error(`XX 합≠100 at r=${r}: ${riskLabel(r)} + ${floorPassLabel(r)}`); bad++; break; }
}

console.log(bad === 0 ? "OK floorLabels all cases" : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
