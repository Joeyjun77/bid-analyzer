// 고양 집중(goyang-focus P4): 기관 마스터 기준 목록 필터와 표시용 라벨.
// 정의는 DB goyang_org_master(include=true) — 클라이언트는 goyang_ag_texts() 표기 목록만 받는다.
import { bidAtPassProb } from "./passProb.js";

export const GOYANG_GRP_LABEL = {
  G1: "본청", G2: "구청", G3: "공사·재단", G4: "교육지원청", G5: "학교",
};

// 예측 목록에서 고양 기관 행만 남긴다. 행 객체는 그대로 돌려줘 카드 계산값이 바뀌지 않는다.
export function filterGoyang(list, agTexts) {
  if (!agTexts || !agTexts.size) return list;
  return list.filter((x) => agTexts.has((x.ag || "").trim()));
}

// 공고 카드 '고양 기준' 띠(issue 06): 예정가격이 이 분포의 p10~p90일 때 낙찰하한선이 움직이는 범위와 투찰금 위치.
// dist는 카드의 '하한 통과 확률'과 같은 분포(resolveAdjHistory), effFr도 같은 유효 하한율 — 막대와 숫자가 어긋나지 않게. 새 확률은 만들지 않는다.
// 경계는 passProb.js bidAtPassProb(통과 확률이 q가 되는 투찰금)를 그대로 쓴다 — 같은 분위 인덱스·같은 하한선 식이라
// '탈락 가능성 큼' ⇔ 통과 확률 10% 미만, '대부분 통과' ⇔ 90% 이상이 맞물린다(tests/goyangBand.test.mjs).
export function goyangBand(dist, { bid, ba, av, effFr }) {
  const b = Number(bid);
  if (!(b > 0)) return null;
  const lo = bidAtPassProb(dist, 0.1, { ba, av, effFr }), hi = bidAtPassProb(dist, 0.9, { ba, av, effFr });
  if (lo == null || hi == null) return null;
  const tier = b < lo ? "low" : b >= hi ? "high" : "mid";
  const pos = hi > lo ? Math.min(1, Math.max(0, (b - lo) / (hi - lo))) : tier === "low" ? 0 : 1;
  return { lo, hi, bid: b, tier, pos, n: dist.n ?? dist.arr.length, grain: dist.grain ?? null };
}

// 추첨 번호 1~15 균등 기댓값: 공고마다 4개 추첨
export const drawExpected = (nSets) => (nSets * 4) / 15;

// 0.1 단위 히스토그램 [[구간 하한, 건수], …]을 step(0.1 단위 개수) 폭으로 묶는다. 빈 구간은 0으로 채운다.
// 부동소수 오차를 피하려고 0.1 단위 정수로 계산한다.
export function rebin(hist, step) {
  if (!hist || !hist.length) return [];
  const m = new Map();
  for (const [b, c] of hist) {
    const k = Math.floor(Math.round(b * 10) / step) * step;
    m.set(k, (m.get(k) || 0) + c);
  }
  const ks = [...m.keys()];
  const out = [];
  for (let k = Math.min(...ks); k <= Math.max(...ks); k += step) out.push({ lo: k / 10, n: m.get(k) || 0 });
  return out;
}

// 구간마다 비율(%)과 누적 비율(%)을 붙인다. 그래프 범위 밖 건수가 있으면 before(범위 아래 건수)·total(전체 건수)을 준다.
export function withShare(bins, before = 0, total = null) {
  const tot = total ?? bins.reduce((s, b) => s + b.n, 0);
  let acc = before;
  return bins.map((b) => { acc += b.n; return { ...b, pct: tot ? (b.n / tot) * 100 : 0, cum: tot ? (acc / tot) * 100 : 0 }; });
}

// 숫자 목록 요약(빈 값 제외): 건수·중앙·최소·최대·100 미만 건수
export function summarize(vals) {
  const v = vals.filter((x) => x != null && isFinite(x)).map(Number).sort((a, b) => a - b);
  if (!v.length) return { n: 0 };
  const h = v.length >> 1;
  return { n: v.length, med: v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2, min: v[0], max: v[v.length - 1], lt100: v.filter((x) => x < 100).length };
}

// 값 목록을 u(0.0001 단위 개수: 1=0.0001, 10=0.001, 100=0.01, 1000=0.1, 2000=0.2) 폭 구간으로 묶는다(절삭).
// 0.0001 단위 정수로 계산해 부동소수 오차를 피한다. fill이면 빈 구간도 0으로 채운다(구간이 적은 큰 단위에서만 쓴다).
export function binVals(vals, u, fill = false) {
  const m = new Map();
  for (const v of vals || []) {
    if (v == null || !isFinite(v)) continue;
    const k = Math.floor(Math.round(v * 1e4) / u) * u;
    m.set(k, (m.get(k) || 0) + 1);
  }
  if (!m.size) return [];
  const ks = [...m.keys()].sort((a, b) => a - b);
  const out = [];
  if (fill) for (let k = ks[0]; k <= ks[ks.length - 1]; k += u) out.push({ lo: k / 1e4, n: m.get(k) || 0 });
  else for (const k of ks) out.push({ lo: k / 1e4, n: m.get(k) });
  return out;
}
