// 예상 참가자수 표시·선별 (Neutral — 예측 산식 무접촉, 표시 전용). 순수 모듈, node 테스트 가능 (tests/participantCount.test.mjs).
// 2026-10-21 교체: 정의 = 같은 발주기관 × 금액대(floorBaSeg)의 직전 365일 bid_records.pc 중앙값.
//   워크포워드(지자체 2024-01~2026-10, n≈4,400): 중앙 오차 4.6%, '100명 미만' 분류 정밀 86.9%·재현 81.6%.
//   이전 정의(participant_count_distribution m41, AG_BA/AT_BA n>=30)는 중앙 오차 66%, 100명 미만 169건 중 1건만 잡았다.
//   근거: 지역제한으로 발주처별 참가 풀이 고정돼 참가자수가 안정적 — 1순위 구간 폭(∝1/참가자수)을 공고 시점에 알 수 있다.
// fallback: AG_BA(n>=3) → AG 전 금액대(n>=3) → AT_BA(n>=3). 실패 시 null (표시 "—").
// 문구 규정: 팩트 표시만 — "낙찰확률" 문구 금지 (G-모드표시). 참가자 적음 = 추첨 모수 작음일 뿐 낙찰 보장 아님

import { floorBaSeg } from "./floorRisk.js";

export const PC_WINDOW_DAYS = 365;
export const PC_MIN_N = 3;

function quantile(sorted, q) {
  const n = sorted.length;
  return sorted[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))];
}

function isoDaysBefore(todayIso, days) {
  const d = new Date(todayIso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// records(bid_records) → { agBa: {at|ag|seg: dist}, ag: {at|ag: dist}, atBa: {at|seg: dist} }, dist = {n,p25,p50,p75}
export function buildPcDistMap(records, todayIso) {
  const from = isoDaysBefore(todayIso, PC_WINDOW_DAYS);
  const acc = { agBa: {}, ag: {}, atBa: {} };
  const push = (bucket, key, pc) => (acc[bucket][key] || (acc[bucket][key] = [])).push(pc);
  for (const r of records || []) {
    if (!r || r.is_excluded === true || !r.at) continue;
    const pc = Number(r.pc);
    if (!(pc > 0)) continue;
    const od = r.od ? String(r.od).slice(0, 10) : null;
    if (!od || od < from || od > todayIso) continue;
    const seg = floorBaSeg(r.ba);
    const ag = r.canonical_ag || r.ag;
    if (ag && seg) push("agBa", r.at + "|" + ag + "|" + seg, pc);
    if (ag) push("ag", r.at + "|" + ag, pc);
    if (seg) push("atBa", r.at + "|" + seg, pc);
  }
  const out = { agBa: {}, ag: {}, atBa: {} };
  for (const bucket of Object.keys(acc)) {
    for (const key in acc[bucket]) {
      const s = acc[bucket][key].sort((a, b) => a - b);
      out[bucket][key] = { n: s.length, p25: quantile(s, 0.25), p50: quantile(s, 0.5), p75: quantile(s, 0.75) };
    }
  }
  return out;
}

// 3단 fallback: AG_BA → AG → AT_BA (각 n>=minN). 실패 시 null
export function resolvePcDist(map, { at, canonicalAg, ba }, minN = PC_MIN_N) {
  if (!map || !at) return null;
  const seg = floorBaSeg(ba);
  if (canonicalAg && seg) {
    const d = map.agBa[at + "|" + canonicalAg + "|" + seg];
    if (d && d.n >= minN) return { grain: "AG_BA", ...d };
  }
  if (canonicalAg) {
    const d = map.ag[at + "|" + canonicalAg];
    if (d && d.n >= minN) return { grain: "AG", ...d };
  }
  if (seg) {
    const d = map.atBa[at + "|" + seg];
    if (d && d.n >= minN) return { grain: "AT_BA", ...d };
  }
  return null;
}

export const PC_GRAIN_LABELS = { AG_BA: "발주기관×금액대", AG: "발주기관(전 금액대)", AT_BA: "기관유형×금액대" };

// 3버킷 (p50 기준): 소(<100) / 중(100~399) / 대(>=400)
// 2026-10-21 경계 100/400 — 사전 선별 후 실측 1순위 확률(지자체 2024~26): 예측<100 1.2~2.9%, 100~399 약 0.6~0.7%, 400+ 약 0.6%
export function pcBucketOf(p50) {
  if (p50 == null || !isFinite(p50)) return null;
  if (p50 < 100) return "small";
  if (p50 < 400) return "mid";
  return "large";
}

export const PC_BUCKET_LABELS = { small: "<100", mid: "100~400", large: "≥400" };

// 소규모만 초록 강조 (추첨 모수 작음 — 낙찰 보장 아님), 그 외 기본색
export function pcColor(p50) {
  return pcBucketOf(p50) === "small" ? "#5dca96" : null;
}

// 저장 스냅샷 필드 3개 (bid_predictions INSERT payload용, UPDATE 금지 — G-A안)
// 종심제(jongsim)는 예측 미지원이라 스냅샷도 null (passRiskSnapshot 선례, spec §2-3)
export function pcSnapshot(map, { at, canonicalAg, ba, jongsim }) {
  if (jongsim) return { exp_participants: null, exp_participants_n: null, exp_participants_grain: null };
  const d = resolvePcDist(map, { at, canonicalAg, ba });
  if (!d) return { exp_participants: null, exp_participants_n: null, exp_participants_grain: null };
  return { exp_participants: Math.round(d.p50), exp_participants_n: d.n, exp_participants_grain: d.grain };
}
