import { parseOwnScore, calcEffectiveFloorRate } from "../src/lib/effectiveFloor.js";

let bad = 0;
const eq = (got, exp, msg) => { if (got !== exp) { console.error(`XX ${msg}: got ${got} expect ${exp}`); bad++; } };

// 1. 값이 없으면 fallback — 0점으로 해석되면 하한율 +1.0%p가 붙는다
//    (2026-05-20~10-12: localStorage 키 없음 → Number(null)=0 → 업로드 예측 788건이 0점으로 계산됨)
eq(parseOwnScore(null, 20), 20, "null → fallback");
eq(parseOwnScore(undefined, 20), 20, "undefined → fallback");
eq(parseOwnScore("", 20), 20, "빈 문자열 → fallback");
eq(parseOwnScore("  ", 20), 20, "공백 → fallback");
eq(parseOwnScore("abc", 20), 20, "비수치 → fallback");
eq(parseOwnScore(NaN, 20), 20, "NaN → fallback");
eq(parseOwnScore("", null), null, "입력란 빈칸 → null (호출측이 무시)");

// 2. 명시적으로 넣은 값은 그대로 (0 포함)
eq(parseOwnScore("0", 20), 0, "'0' → 0");
eq(parseOwnScore(0, 20), 0, "0 → 0");
eq(parseOwnScore("14", 20), 14, "'14' → 14");
eq(parseOwnScore("20", 20), 20, "'20' → 20");

// 3. 범위·정수화
eq(parseOwnScore("25", 20), 20, "25 → 20 clamp");
eq(parseOwnScore("14.6", 20), 15, "14.6 → 15 반올림");
eq(parseOwnScore(" 14 ", 20), 14, "앞뒤 공백 허용");
eq(parseOwnScore(25, 20), 20, "숫자 25 → 20 clamp");
eq(parseOwnScore(-3, 20), 20, "숫자 -3 → fallback");
// 음수·무한대는 0점으로 깎지 않는다 (0점으로 가는 또 다른 경로가 됨)
eq(parseOwnScore("-3", 20), 20, "-3 → fallback");
eq(parseOwnScore("-Infinity", 20), 20, "-Infinity → fallback");
eq(parseOwnScore("Infinity", 20), 20, "Infinity → fallback");

// 4. 결함 재현: 저장값이 없을 때의 유효 하한율은 표준 그대로여야 한다
eq(calcEffectiveFloorRate("지자체", 89.745, parseOwnScore(null, 20)), 89.745, "저장값 없음 → 표준 하한율");
// calcEffectiveFloorRate 자체도 null을 0점으로 읽지 않는다 (DB own_score NULL ≡ 20)
eq(calcEffectiveFloorRate("지자체", 89.745, null), 89.745, "score null → 표준");
eq(calcEffectiveFloorRate("지자체", 89.745, undefined), 89.745, "score undefined → 표준");
eq(calcEffectiveFloorRate("지자체", 89.745, 20), 89.745, "score 20 → 표준");
// 유효 점수 0~20은 산식 base + (20−s)×0.05 와 완전히 같아야 한다 (수정 전후 투찰금 불변)
for (const base of [87.745, 89.745, 90.25]) {
  for (let s = 0; s <= 20; s++) eq(calcEffectiveFloorRate("지자체", base, s), base + (20 - s) * 0.05, `base ${base} score ${s}`);
}

console.log(bad === 0 ? "OK effectiveFloor all cases" : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
