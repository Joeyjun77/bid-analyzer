import {
  DEFAULT_KEYWORDS, SMALL_PC_MAX, ELIG_KEY,
  normalizeKeywords, isEligible, isSmallField, isTarget, loadKeywords, saveKeywords,
} from "../src/lib/eligibility.js";

let bad = 0;
const eq = (got, exp, msg) => { if (got !== exp) { console.error(`XX ${msg}: got ${got} expect ${exp}`); bad++; } };

eq(DEFAULT_KEYWORDS.join("|"), "고양", "기본 키워드");
eq(SMALL_PC_MAX, 300, "소경쟁 경계 상수");

// isEligible — ag/pn 부분 일치, 빈 키워드 함정
eq(isEligible({ ag: "경기도교육청 경기도고양교육지원청" }, ["고양"]), true, "ag 부분 일치");
eq(isEligible({ ag: "경기도 성남시 분당구", pn: "[(고양시)] 전기공사" }, ["고양"]), true, "pn 일치");
eq(isEligible({ ag: "경기도 성남시 분당구", pn: "[관내] 전기공사" }, ["고양"]), false, "미일치");
eq(isEligible({ ag: "경기도 고양시" }, []), false, "키워드 없음 → false");
eq(isEligible({ ag: "경기도 고양시" }, [""]), false, "빈 키워드는 전부 일치 함정 → false");
eq(isEligible({ ag: null, pn: undefined }, ["고양"]), false, "ag/pn 없음 → false");

// normalizeKeywords
eq(normalizeKeywords(" 고양 , ,파주 ,고양").join("|"), "고양|파주", "trim·빈값·중복 제거 (문자열)");
eq(normalizeKeywords(["고양", " ", "파주", "고양"]).join("|"), "고양|파주", "trim·빈값·중복 제거 (배열)");
eq(normalizeKeywords(null).length, 0, "null → 빈 배열");

// isSmallField
eq(isSmallField("224"), true, "문자열 224");
eq(isSmallField(300), false, "경계 300은 아님");
eq(isSmallField(299), true, "299는 소경쟁");
eq(isSmallField(null), false, "null");
eq(isSmallField(0), false, "0");
eq(isSmallField("abc"), false, "NaN");

// isTarget
eq(isTarget({ ag: "서울교통공사", pc: 13 }, ["고양"]), true, "소경쟁만으로 대상");
eq(isTarget({ ag: "경기도 고양시", pc: 3300 }, ["고양"]), true, "키워드만으로 대상");
eq(isTarget({ ag: "경기도 김포시", pc: 3311 }, ["고양"]), false, "둘 다 아님");

// load/save — 메모리 storage
const mem = { s: {}, getItem(k) { return this.s[k] ?? null; }, setItem(k, v) { this.s[k] = String(v); } };
eq(loadKeywords(mem).join("|"), "고양", "기본값");
eq(loadKeywords(mem) !== DEFAULT_KEYWORDS, true, "기본값은 복사본");
saveKeywords("고양, 파주", mem);
eq(loadKeywords(mem).join("|"), "고양|파주", "저장 후 로드");
mem.setItem(ELIG_KEY, "{bad json");
eq(loadKeywords(mem).join("|"), "고양", "파싱 실패 → 기본값");
mem.setItem(ELIG_KEY, "[]");
eq(loadKeywords(mem).join("|"), "고양", "빈 배열 → 기본값");
eq(saveKeywords("파주", null).join("|"), "파주", "storage 없음 → 저장 생략, 정규화 결과 반환");
eq(loadKeywords(null).join("|"), "고양", "storage 없음 → 기본값");

console.log(bad === 0 ? "OK eligibility" : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
