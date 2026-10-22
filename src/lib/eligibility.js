// 자격(관내)·소경쟁 판정 — 성과 탭(P1)·오늘의 공고 배지(P2) 공용. import 없는 독립 모듈(node --test).
// 스펙: docs/superpowers/specs/2026-10-22-bid-ops-funnel-redesign-design.md §6.2·§6.4
export const DEFAULT_KEYWORDS = ["고양"];
export const SMALL_PC_MAX = 300;
export const ELIG_KEY = "eligibilityKeywords.v1";

export function normalizeKeywords(list) {
  const arr = Array.isArray(list) ? list : typeof list === "string" ? list.split(",") : [];
  const out = [];
  for (const k of arr) {
    const s = String(k ?? "").trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

export function isEligible(row, keywords) {
  const kws = normalizeKeywords(keywords);
  if (!kws.length) return false;
  const hay = [row?.ag, row?.pn].filter(v => v != null).map(v => String(v).toLowerCase());
  return kws.some(k => { const kl = k.toLowerCase(); return hay.some(h => h.includes(kl)); });
}

export function isSmallField(pc) {
  const n = Number(pc);
  return Number.isFinite(n) && n >= 1 && n < SMALL_PC_MAX;
}

export function isTarget(row, keywords) {
  return isEligible(row, keywords) || isSmallField(row?.pc);
}

export function loadKeywords(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(ELIG_KEY);
    if (raw) {
      const parsed = normalizeKeywords(JSON.parse(raw));
      if (parsed.length) return parsed;
    }
  } catch (e) { /* 파싱 실패 → 기본값 */ }
  return [...DEFAULT_KEYWORDS];
}

export function saveKeywords(list, storage = globalThis.localStorage) {
  const kws = normalizeKeywords(list);
  try { storage?.setItem?.(ELIG_KEY, JSON.stringify(kws)); } catch (e) { /* 저장 불가 환경 */ }
  return kws;
}
