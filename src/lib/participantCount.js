// 예상 참가자수 표시 (Phase ①, Neutral — 예측 산식 무접촉, 표시 전용)
// 근거: .scratch/pwin-participants/spec.md v1 (predict-architect 검토 반영)
// 정의: grain별 bid_records.pc(개찰 실측 참가자수) 경험분포 — era_v2 current · 365d · 비공동수급 · pc>0 (m41)
// 소비 규칙: n>=30. fallback AG_BA → AT_BA. 실패 시 null (표시 "—")
// 문구 규정: 팩트 표시만 — "낙찰확률" 문구 금지 (G-모드표시). 참가자 적음 = 추첨 모수 작음일 뿐 낙찰 보장 아님

import { authedFetch } from "../auth.js";
import { floorBaSeg } from "./floorRisk.js";

// participant_count_distribution 전량 fetch → { agBa: {at|ag|seg: dist}, atBa: {at|seg: dist} }
export async function sbFetchPcDistMap() {
  try {
    const res = await authedFetch(
      "/rest/v1/participant_count_distribution?era_v2=eq.current&select=at,canonical_ag,ba_seg,n,pc_mean,pc_p25,pc_p50,pc_p75,pc_p90&limit=2000"
    );
    if (!res.ok) return null;
    const rows = await res.json();
    const m = { agBa: {}, atBa: {} };
    for (const r of rows) {
      const d = {
        n: Number(r.n), mean: Number(r.pc_mean),
        p25: Number(r.pc_p25), p50: Number(r.pc_p50), p75: Number(r.pc_p75), p90: Number(r.pc_p90),
      };
      if (r.canonical_ag) m.agBa[r.at + "|" + r.canonical_ag + "|" + r.ba_seg] = d;
      else m.atBa[r.at + "|" + r.ba_seg] = d;
    }
    return m;
  } catch (e) { return null; }
}

// 2단 fallback: AG_BA(n>=minN) → AT_BA(n>=minN). 실패 시 null
export function resolvePcDist(map, { at, canonicalAg, ba }, minN = 30) {
  if (!map || !at) return null;
  const seg = floorBaSeg(ba);
  if (!seg) return null;
  if (canonicalAg) {
    const d = map.agBa[at + "|" + canonicalAg + "|" + seg];
    if (d && d.n >= minN) return { grain: "AG_BA", ...d };
  }
  const d = map.atBa[at + "|" + seg];
  if (d && d.n >= minN) return { grain: "AT_BA", ...d };
  return null;
}

// 3버킷 (p50 기준): 소(<1000) / 중(1000~2999) / 대(>=3000)
export function pcBucketOf(p50) {
  if (p50 == null || !isFinite(p50)) return null;
  if (p50 < 1000) return "small";
  if (p50 < 3000) return "mid";
  return "large";
}

export const PC_BUCKET_LABELS = { small: "<1,000", mid: "1,000~3,000", large: "≥3,000" };

// 소규모만 초록 강조 (추첨 모수 작음 — 낙찰 보장 아님), 그 외 기본색
export function pcColor(p50) {
  return pcBucketOf(p50) === "small" ? "#5dca96" : null;
}

// 저장 스냅샷 필드 3개 (bid_predictions INSERT payload용, UPDATE 금지 — G-A안)
export function pcSnapshot(map, { at, canonicalAg, ba }) {
  const d = resolvePcDist(map, { at, canonicalAg, ba });
  if (!d) return { exp_participants: null, exp_participants_n: null, exp_participants_grain: null };
  return { exp_participants: Math.round(d.p50), exp_participants_n: d.n, exp_participants_grain: d.grain };
}
