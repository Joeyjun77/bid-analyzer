import { RATE_TABLE } from "../src/lib/constants-tables.js";

let bad = 0;
const eq = (got, exp, msg) => { if (got !== exp) { console.error(`XX ${msg}: got ${got} expect ${exp}`); bad++; } };

// utils.js getFloorRate와 같은 조회 규칙 (utils.js는 import 체인 때문에 node에서 불러올 수 없어 표를 직접 읽는다)
const rateOf = (rules, ep) => { for (const r of rules) { if (ep >= r.min && ep < r.max) return r.rate; } return rules[rules.length - 1].rate; };

const AGENCIES = ["조달청", "지자체", "교육청", "한전", "LH", "군시설", "수자원공사"];

// 1. 3억 미만 = 같은 표의 3~10억 값 (2026-10-12 정정. 실측: 표본 30건 이상 10개 칸 모두 일치, 이전 값 88.25/90.25 일치 0%)
for (const at of AGENCIES) {
  const t = RATE_TABLE[at];
  eq(rateOf(t.new, 2e8), 89.745, `${at} 신 2억`);
  eq(rateOf(t.old, 2e8), 87.745, `${at} 구 2억`);
  eq(rateOf(t.new, 2e8), rateOf(t.new, 5e8), `${at} 신 3억 미만 = 3~10억`);
  eq(rateOf(t.old, 2e8), rateOf(t.old, 5e8), `${at} 구 3억 미만 = 3~10억`);
  // 추정가격이 없어 0으로 들어오는 경우도 같은 구간
  eq(rateOf(t.new, 0), 89.745, `${at} 신 ep=0`);
  eq(rateOf(t.old, 0), 87.745, `${at} 구 ep=0`);
  // 경계: 3억 정각은 3~10억 구간, 바로 아래는 3억 미만 — 두 값이 같아야 한다
  eq(rateOf(t.new, 3e8), rateOf(t.new, 3e8 - 1), `${at} 신 3억 경계`);
  eq(rateOf(t.old, 3e8), rateOf(t.old, 3e8 - 1), `${at} 구 3억 경계`);
}

// 2. 바꾸지 않은 구간은 그대로 (회귀 고정)
eq(rateOf(RATE_TABLE["지자체"].new, 2e9), 88.745, "지자체 신 20억");
eq(rateOf(RATE_TABLE["지자체"].new, 7e9), 87.495, "지자체 신 70억");
eq(rateOf(RATE_TABLE["지자체"].new, 2e10), 81.995, "지자체 신 200억");
eq(rateOf(RATE_TABLE["지자체"].old, 2e10), 79.995, "지자체 구 200억");
eq(rateOf(RATE_TABLE["한전"].new, 2e9), 88.745, "한전 신 20억");
eq(rateOf(RATE_TABLE["한전"].old, 7e9), 85.495, "한전 구 70억");
eq(rateOf(RATE_TABLE["군시설"].old, 2e9), 84.745, "군시설 구 20억 (미검증 구간, 불변)");
eq(rateOf(RATE_TABLE["군시설"].old, 7e9), 83.495, "군시설 구 70억 (미검증 구간, 불변)");
eq(rateOf(RATE_TABLE["군시설"].new, 2e9), 88.745, "군시설 신 20억");

// 2-b. 표 전체 스냅샷 — 의도하지 않은 칸이 바뀌면 여기서 잡힌다 (predict-architect 권고)
const flat = (t) => ["old", "new"].map(e => t[e].map(r => `${r.min}-${r.max}:${r.rate}`).join(",")).join(" | ");
const STD_OLD = "5000000000-100000000000:85.495,1000000000-5000000000:86.745,300000000-1000000000:87.745,0-300000000:87.745";
const STD_NEW = "5000000000-100000000000:87.495,1000000000-5000000000:88.745,300000000-1000000000:89.745,0-300000000:89.745";
for (const at of ["조달청", "한전", "LH", "수자원공사"]) eq(flat(RATE_TABLE[at]), `${STD_OLD} | ${STD_NEW}`, `${at} 표 전체`);
eq(flat(RATE_TABLE["군시설"]), `5000000000-100000000000:83.495,1000000000-5000000000:84.745,300000000-1000000000:87.745,0-300000000:87.745 | ${STD_NEW}`, "군시설 표 전체");
eq(flat(RATE_TABLE["지자체"]), "10000000000-300000000000:79.995,5000000000-10000000000:85.495,3000000000-5000000000:86.745,1000000000-3000000000:86.745,400000000-1000000000:87.745,300000000-400000000:87.745,0-300000000:87.745 | 10000000000-300000000000:81.995,5000000000-10000000000:87.495,3000000000-5000000000:88.745,1000000000-3000000000:88.745,400000000-1000000000:89.745,300000000-400000000:89.745,0-300000000:89.745", "지자체 표 전체");
eq(flat(RATE_TABLE["교육청"]), "5000000000-100000000000:85.495,3000000000-5000000000:86.745,1000000000-3000000000:86.745,400000000-1000000000:87.745,300000000-400000000:87.745,0-300000000:87.745 | 5000000000-100000000000:87.495,3000000000-5000000000:88.745,1000000000-3000000000:88.745,400000000-1000000000:89.745,300000000-400000000:89.745,0-300000000:89.745", "교육청 표 전체");
eq(Object.keys(RATE_TABLE).length, 7, "기관 7곳");

// 3. 시행일은 바꾸지 않는다
eq(RATE_TABLE["지자체"].cutoff, "2025-07-01", "지자체 cutoff");
eq(RATE_TABLE["교육청"].cutoff, "2025-07-01", "교육청 cutoff");
eq(RATE_TABLE["조달청"].cutoff, "2026-01-30", "조달청 cutoff");
eq(RATE_TABLE["한전"].cutoff, "2026-02-10", "한전 cutoff");
eq(RATE_TABLE["LH"].cutoff, "2026-02-01", "LH cutoff");
eq(RATE_TABLE["군시설"].cutoff, "2026-01-19", "군시설 cutoff");
eq(RATE_TABLE["수자원공사"].cutoff, "2026-02-27", "수자원공사 cutoff");

console.log(bad === 0 ? "OK rateTable all cases" : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
