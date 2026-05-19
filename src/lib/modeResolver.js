// V2 Mode A/B 판정 RPC 래퍼 (U1에서 본격 연결)
// 근거: HANDOFF_V2_MASTER_PLAN §4 B1 + V2_UI_SPEC §4
// DB RPC: public.lookup_agency_mode(at, canonical_ag, ba)
// 3단계 fallback: AG_BA → AG → AT

import { authedFetch } from "../auth.js";

// 정적 fallback 매핑 — RPC 호출 실패 시 마지막 안전망 (HANDOFF_V2_DIAGNOSIS_RESULT §3.1 표 기준)
const AT_LEVEL_STATIC_FALLBACK = {
  "군시설":   { matched_grain: "AT", mode_recommend: "A", confidence: "high",   n: 186, median_gap: 0.0023, p90_gap: 0.7993 },
  "지자체":   { matched_grain: "AT", mode_recommend: "B", confidence: "high",   n: 349, median_gap: 0.0007, p90_gap: 0.0209 },
  "교육청":   { matched_grain: "AT", mode_recommend: "B", confidence: "high",   n: 230, median_gap: 0.0007, p90_gap: 0.0102 },
  "한전":     { matched_grain: "AT", mode_recommend: "B", confidence: "medium", n: 39,  median_gap: 0.0013, p90_gap: 0.0060 },
  "조달청":   { matched_grain: "AT", mode_recommend: "B", confidence: "medium", n: 26,  median_gap: 0.0004, p90_gap: 0.0019 },
  "LH":       { matched_grain: "AT", mode_recommend: "B", confidence: "low",    n: 11,  median_gap: 0.0012, p90_gap: 0.0060 },
};

// 본 함수는 U0 시점에 mock으로 동작하고, U1에서 실제 RPC와 연결
export async function resolveMode({ at, canonicalAg, ba }) {
  if (!at) {
    return { matched_grain: null, mode_recommend: "B", confidence: "low", n: 0, median_gap: null, p90_gap: null, source: "no_at" };
  }

  try {
    const params = new URLSearchParams({
      p_at: at,
      ...(canonicalAg ? { p_canonical_ag: canonicalAg } : {}),
      ...(ba != null ? { p_ba: String(ba) } : {}),
    });
    const res = await authedFetch(`/rest/v1/rpc/lookup_agency_mode?${params}`, { method: "POST" });
    if (!res.ok) throw new Error(`RPC ${res.status}`);
    const rows = await res.json();
    if (Array.isArray(rows) && rows.length > 0) {
      return { ...rows[0], source: "rpc" };
    }
  } catch (err) {
    // fall through to static fallback
  }

  const stat = AT_LEVEL_STATIC_FALLBACK[at];
  if (stat) return { ...stat, source: "static" };
  return { matched_grain: null, mode_recommend: "B", confidence: "low", n: 0, median_gap: null, p90_gap: null, source: "unknown" };
}

// V2_UI_SPEC §3 — 안착 모드에서 "낙찰 확률" 문자열 표시 금지 가드
// /evaluate G-모드표시 게이트와 정합 (.claude/commands/evaluate.md §9)
export function getMainMetricLabel(mode) {
  return mode === "A" ? "예상 낙찰 확률" : "하한 통과 확률";
}

export function getModeBadgeLabel(mode) {
  return mode === "A" ? "공략 모드" : "안착 모드";
}

export function getModeNotice(mode) {
  return mode === "A"
    ? "✓ 이 영역은 낙찰 가능 구간이 존재합니다."
    : "⚠ 이 발주처는 낙찰이 운에 가깝습니다. 목표는 하한 미달 탈락 방지.";
}
