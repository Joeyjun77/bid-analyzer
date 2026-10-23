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

// RPC 인자는 JSON body로 보낸다. POST에 붙인 URL 쿼리는 PostgREST가 결과 필터로 해석해 400(PGRST100)을 낸다.
// 값이 없는 인자는 키를 빼서 DB DEFAULT를 쓴다 — null을 명시하면 DEFAULT 대신 NULL이 들어간다(p_era NULL → 0행).
function rpcArgs({ at, canonicalAg, ba }) {
  const args = { p_at: at };
  if (canonicalAg) args.p_canonical_ag = canonicalAg;
  if (ba != null) args.p_ba = ba;
  return args;
}

// 호출부는 실패 시 정적 fallback/null로 넘어가므로, 실패 흔적은 여기서 남긴다 (400이 5개월간 묻혔던 원인)
async function postRpc(fn, args) {
  try {
    const res = await authedFetch(`/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!res.ok) console.warn(`[modeResolver] ${fn} RPC ${res.status}`);
    return res;
  } catch (err) {
    console.warn(`[modeResolver] ${fn} RPC 실패:`, err?.message);
    throw err;
  }
}

export async function resolveMode({ at, canonicalAg, ba }) {
  if (!at) {
    return { matched_grain: null, mode_recommend: "B", confidence: "low", n: 0, median_gap: null, p90_gap: null, source: "no_at" };
  }

  try {
    const res = await postRpc("lookup_agency_mode", rpcArgs({ at, canonicalAg, ba }));
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

// V2 Mode A (군시설) gap 분포 lookup — B3.5
// 근거: docs/v2/HANDOFF_V2_MASTER_PLAN §4 B3
// lookup_gap_distribution RPC 래퍼. 3단계 fallback (AG_BA → AG → AT).
// Mode A 영역(군시설)에서만 호출, 다른 영역은 빈 결과
export async function resolveGapDist({ at, canonicalAg, ba }) {
  if (!at) return null;
  try {
    const res = await postRpc("lookup_gap_distribution", rpcArgs({ at, canonicalAg, ba }));
    if (!res.ok) return null;
    const rows = await res.json();
    if (Array.isArray(rows) && rows.length > 0) return rows[0];
  } catch (err) {
    // 조용히 실패 — Mode A는 fallback 가능 (recommendV2 종형 분기)
  }
  return null;
}

// V2 Mode A (군시설) floorErr 분포 lookup — Phase 2a 소스(m37)
// 근거: docs/superpowers/plans/2026-05-23-mode-a-phase2a-recommendmodeA-floorerr.md
// lookup_floorerr_distribution RPC 래퍼. 3단계 fallback (AG_BA → AG → AT). p_era 기본 current(라이브 소비).
// 반환: { matched_grain, era_v2, n, confidence, floorerr_mean, floorerr_std, floorerr_p50, floorerr_p85, floorerr_p95, ... } | null
// 현재 호출부 없음 — floorErr 경로 재활성(요율 정합·자사 점수 반영) 과제에서 다시 쓴다
export async function resolveFloorErrDist({ at, canonicalAg, ba, era = "current" }) {
  if (!at) return null;
  try {
    const res = await postRpc("lookup_floorerr_distribution", { ...rpcArgs({ at, canonicalAg, ba }), p_era: era });
    if (!res.ok) return null;
    const rows = await res.json();
    if (Array.isArray(rows) && rows.length > 0) return rows[0];
  } catch (err) {
    // 조용히 실패 — Mode A는 종형 fallback 가능
  }
  return null;
}
