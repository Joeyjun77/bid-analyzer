// G2B 양식 자동 수집 — 계산 순수 모듈. Deno(edge function)와 node --test 양쪽에서 import 한다(외부 의존 없음).
// 스펙: docs/superpowers/specs/2026-10-23-g2b-auto-collect-design.md §4

const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

// A값 = 아래 항목 합. 확인 표본 2건(2026-10-23). 환경보전비·하도급대금지급보증수수료는 합에 넣지 않고 대조용으로만 보존 — 포함 여부는 엑셀 대조로 확정.
const A_KEYS = ["npnInsrprm", "mrfnHealthInsrprm", "rtrfundNon", "odsnLngtrmrcprInsrprm", "sftyMngcst", "sftyChckMngcst"];
const KEEP_KEYS = [...A_KEYS, "qltyMngcst", "envCnsrvcst", "scontrctPayprcePayGrntyFee"];

export function sumAValue(item) {
  const it = item || {};
  const items = Object.fromEntries(KEEP_KEYS.map((k) => [k, n(it[k])]));
  const aApplies = it.bidPrceCalclAYn !== "N";
  if (!aApplies) return { av: 0, aApplies, items };
  const av = A_KEYS.reduce((s, k) => s + items[k], 0) + (it.qltyMngcstAObjYn === "Y" ? items.qltyMngcst : 0);
  return { av, aApplies, items };
}

const pos = (v) => v != null && Number.isFinite(Number(v)) && Number(v) > 0;
// 사정률은 소수 4자리 절사(엑셀 실측: 100.57399 → 100.5739). 1e-7은 부동소수 오차로 정확한 값이 한 칸 내려가는 것을 막는다.
const trunc4 = (x) => Math.floor(x * 1e4 + 1e-7) / 1e4;

// 하한가는 올림(엑셀 2건 실측: 209,453,416.98 → 209,453,417). 부동소수 오차로 정수가 올라가지 않게 1e-6 뺀다.
export function computeSheet({ ba, av, xp, fr, bp }) {
  const missing = [];
  if (!pos(ba)) missing.push("ba");
  if (av == null || !Number.isFinite(Number(av))) missing.push("av");
  if (!pos(xp)) missing.push("xp");
  if (!pos(fr)) missing.push("fr");
  if (!pos(bp)) missing.push("bp");
  const has = (k) => !missing.includes(k);
  const A = Number(av), F = Number(fr) / 100;
  const ar1 = has("ba") && has("xp") ? trunc4(Number(xp) / Number(ba) * 100) : null;
  const floor_price = has("av") && has("xp") && has("fr") ? Math.ceil(A + (Number(xp) - A) * F - 1e-6) : null;
  const br1 = has("ba") && has("av") && has("fr") && has("bp") ? trunc4((A + (Number(bp) - A) / F) / Number(ba) * 100) : null;
  return { ar1, br1, floor_price, missing };
}

// 업종: 공고 필드에 '전기공사'가 있으면 전기. 값이 하나라도 있는데 없으면 아님. 전부 비면 모름(null) — 공고명 추정은 하지 않는다.
export function classifyTrade({ cat, mainCnsttyNm, licenseNames } = {}) {
  const fields = [["cat", cat], ["mainCnsttyNm", mainCnsttyNm], ["licenseNames", (licenseNames || []).join(",")]];
  const filled = fields.filter(([, v]) => v != null && String(v).trim() !== "");
  const hit = filled.find(([, v]) => /전기공사/.test(String(v)));
  if (hit) return { elec: true, source: hit[0] };
  return filled.length ? { elec: false, source: filled[0][0] } : { elec: null, source: null };
}
