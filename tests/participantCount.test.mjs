import { buildPcDistMap, resolvePcDist, pcSnapshot, pcBucketOf, PC_MIN_N } from "../src/lib/participantCount.js";

let bad = 0;
const eq = (got, exp, msg) => { if (got !== exp) { console.error(`XX ${msg}: got ${JSON.stringify(got)} expect ${JSON.stringify(exp)}`); bad++; } };

const TODAY = "2026-10-21";
const rec = (ag, ba, pc, od = "2026-06-01", extra = {}) => ({ at: "지자체", canonical_ag: ag, ag, ba, pc, od, ...extra });

// 발주처 A: 1억 미만(S1) 5건 — 참가자 100,120,130,140,900 → 중앙값 130. 3억 미만(S2) 2건(n<3)
const recs = [
  rec("A", 5e7, 100), rec("A", 6e7, 120), rec("A", 7e7, 130), rec("A", 8e7, 140), rec("A", 9e7, 900),
  rec("A", 2e8, 400), rec("A", 2.5e8, 450),
  // 발주처 B: 2건뿐(n<3)
  rec("B", 5e7, 50), rec("B", 6e7, 60),
  // 제외돼야 하는 행: 366일 전, pc 0, is_excluded, 미래 개찰일
  rec("A", 5e7, 9999, "2025-10-20"), rec("A", 5e7, 0), rec("A", 5e7, 9999, "2026-06-01", { is_excluded: true }), rec("A", 5e7, 9999, "2026-10-22"),
];
const map = buildPcDistMap(recs, TODAY);

// 1. AG_BA: A×S1 n=5, 중앙값 130 (제외 행 4건은 빠진다)
{
  const d = resolvePcDist(map, { at: "지자체", canonicalAg: "A", ba: 7e7 });
  eq(d?.grain, "AG_BA", "A×S1 grain"); eq(d?.n, 5, "A×S1 n"); eq(d?.p50, 130, "A×S1 p50"); eq(d?.p25, 120, "A×S1 p25"); eq(d?.p75, 140, "A×S1 p75");
}
// 2. AG fallback: A×S2는 n=2 < 3 → 발주처 전 금액대(n=7, 중앙값 140)
{
  const d = resolvePcDist(map, { at: "지자체", canonicalAg: "A", ba: 2e8 });
  eq(d?.grain, "AG", "A×S2 falls back to AG"); eq(d?.n, 7, "AG n"); eq(d?.p50, 140, "AG p50");
}
// 3. AT_BA fallback: B×S1 n=2, B 전체 n=2 → 지자체×S1 (A 5건 + B 2건 = 7건, 중앙값 120)
{
  const d = resolvePcDist(map, { at: "지자체", canonicalAg: "B", ba: 5e7 });
  eq(d?.grain, "AT_BA", "B falls back to AT_BA"); eq(d?.n, 7, "AT_BA n"); eq(d?.p50, 120, "AT_BA p50");
}
// 4. 아무 기록도 없으면 null; canonical_ag 없으면 AT_BA
{
  eq(resolvePcDist(map, { at: "교육청", canonicalAg: "C", ba: 5e7 }), null, "unknown at → null");
  eq(resolvePcDist(map, { at: "지자체", canonicalAg: null, ba: 5e7 })?.grain, "AT_BA", "no ag → AT_BA");
  eq(resolvePcDist(null, { at: "지자체", canonicalAg: "A", ba: 5e7 }), null, "null map → null");
}
// 5. 스냅샷: 종심제는 null 3필드, 아니면 p50 반올림·n·grain
{
  const s = pcSnapshot(map, { at: "지자체", canonicalAg: "A", ba: 7e7 });
  eq(s.exp_participants, 130, "snapshot p50"); eq(s.exp_participants_n, 5, "snapshot n"); eq(s.exp_participants_grain, "AG_BA", "snapshot grain");
  eq(pcSnapshot(map, { at: "LH", canonicalAg: "X", ba: 7e7, jongsim: true }).exp_participants, null, "jongsim → null");
}
eq(PC_MIN_N, 3, "min n");
// 6. 버킷 경계 100/400 (1순위 확률 실측 구간)
eq(pcBucketOf(99), "small", "99 → small"); eq(pcBucketOf(100), "mid", "100 → mid"); eq(pcBucketOf(399), "mid", "399 → mid"); eq(pcBucketOf(400), "large", "400 → large"); eq(pcBucketOf(null), null, "null bucket");

if (bad) { console.error(`${bad} failed`); process.exit(1); }
console.log("OK participantCount all cases");
