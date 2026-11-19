// 고양 카드 띠(issue 06): 예정가격 p10~p90으로 움직이는 낙찰하한선 범위와 투찰금 위치
import { goyangBand } from "../src/lib/goyang.js";
import { passProbPct, impliedAdjOfBid, bidAtPassProb } from "../src/lib/passProb.js";

let bad = 0;
const eq = (got, exp, msg) => { if (got !== exp) { console.error(`XX ${msg}: got ${got} expect ${exp}`); bad++; } };

// 사정률(100 기준 편차) 11개: p10 = -0.8, p90 = 0.8 (bidAtPassProb 분위 인덱스 ceil(q·n)−1)
const dist = { grain: "AG", n: 11, arr: [-1, -0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8, 1] };
const base = { ba: 100000000, av: 0, effFr: 89.745 };

const mid = goyangBand(dist, { ...base, bid: 90000000 });
eq(Math.abs(mid.lo - 89027040) <= 1, true, "p10 예정가격 99,200,000의 하한선(±1원 — bidAtPassProb 부동소수 올림 그대로)");
eq(Math.abs(mid.hi - 90462960) <= 1, true, "p90 예정가격 100,800,000의 하한선(±1원)");
eq(mid.lo, bidAtPassProb(dist, 0.1, base), "경계는 bidAtPassProb와 같은 값");
eq(mid.tier, "mid", "사이면 예정가격에 따라 갈림");
eq(Math.round(mid.pos * 1000), Math.round((90000000 - 89027040) / (90462960 - 89027040) * 1000), "막대 위치");
eq(mid.n, 11, "표본 수 전달");
eq(mid.grain, "AG", "분포 단위 전달");

eq(goyangBand(dist, { ...base, bid: 89000000 }).tier, "low", "p10 하한선보다 낮으면 탈락 가능성 큼");
eq(goyangBand(dist, { ...base, bid: 89000000 }).pos, 0, "범위 아래는 왼쪽 끝");
eq(goyangBand(dist, { ...base, bid: mid.hi }).tier, "high", "p90 하한선과 같으면 대부분 통과");
eq(goyangBand(dist, { ...base, bid: 91000000 }).pos, 1, "범위 위는 오른쪽 끝");

// A값 반영: 하한선 = A + (예정가격 − A) × 하한율
eq(Math.abs(goyangBand(dist, { ...base, av: 5000000, bid: 90000000 }).lo - 89539790) <= 1, true, "A값 반영 p10 하한선(±1원)");

// 띠 문구는 카드 '하한 통과 확률'과 어긋나면 안 된다: low ⇔ 통과 < 10%, high ⇔ 통과 ≥ 90%
{
  const arr = []; let s = 7;
  for (let i = 0; i < 47; i++) { s = (s * 9301 + 49297) % 233280; arr.push(Math.round((s / 233280 * 3 - 1.5) * 1e4) / 1e4); }
  arr.sort((x, y) => x - y);
  const d2 = { grain: "AG", n: arr.length, arr };
  const p = { ba: 123456789, av: 4321000, effFr: 87.745 };
  let mismatch = 0, seen = { low: 0, mid: 0, high: 0 };
  for (let bid = 104000000; bid <= 112000000; bid += 2311) {
    const g = goyangBand(d2, { ...p, bid });
    const pass = passProbPct(d2, impliedAdjOfBid({ bid, ...p }));
    seen[g.tier]++;
    if ((g.tier === "low") !== (pass < 10) || (g.tier === "high") !== (pass >= 90)) mismatch++;
  }
  eq(mismatch, 0, "띠 구간과 통과 확률 구간 일치");
  eq(seen.low > 0 && seen.mid > 0 && seen.high > 0, true, "세 구간 모두 검사됨");
}

// 계산 불가
eq(goyangBand(null, { ...base, bid: 90000000 }), null, "분포 없음");
eq(goyangBand({ arr: [] }, { ...base, bid: 90000000 }), null, "빈 분포");
eq(goyangBand(dist, { ...base, bid: null }), null, "투찰금 없음");
eq(goyangBand(dist, { ...base, ba: 0, bid: 90000000 }), null, "기초금액 없음");
eq(goyangBand(dist, { ...base, effFr: 0, bid: 90000000 }), null, "하한율 없음");

console.log(bad === 0 ? "OK goyangBand" : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
