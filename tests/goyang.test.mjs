import { filterGoyang, drawExpected, GOYANG_GRP_LABEL, rebin, withShare, summarize } from "../src/lib/goyang.js";

let bad = 0;
const eq = (got, exp, msg) => { if (got !== exp) { console.error(`XX ${msg}: got ${got} expect ${exp}`); bad++; } };

const a = { ag: "경기도 고양시", opt_adj: 0.123, bid1st_v2_rate: 87.9 };
const b = { ag: "경기도 고양시 덕양구 ", opt_adj: -0.2 };
const c = { ag: "경기도 파주시", opt_adj: 0.5 };
const d = { ag: null };
const list = [a, b, c, d];
const set = new Set(["경기도 고양시", "경기도 고양시 덕양구"]);

const out = filterGoyang(list, set);
eq(out.length, 2, "고양 2건만");
eq(out[0], a, "행 객체 그대로(같은 참조)");
eq(out[1], b, "앞뒤 공백 무시");
eq(a.opt_adj, 0.123, "원본 값 불변");
eq(list.length, 4, "원본 배열 불변");
eq(filterGoyang(list, null), list, "목록 미수신이면 필터 없음");
eq(filterGoyang(list, new Set()), list, "빈 목록이면 필터 없음");
eq(drawExpected(15), 4, "추첨 기댓값 n×4/15");
eq(GOYANG_GRP_LABEL.G5, "학교", "그룹 라벨");

// 0.1 구간 히스토그램을 0.2 구간으로 묶기: 빈 구간은 0으로 채우고, 짝수 0.1 자리에서 시작
const h = [[99.7, 3], [99.8, 5], [100.1, 2]];
eq(JSON.stringify(rebin(h, 1)), JSON.stringify([{ lo: 99.7, n: 3 }, { lo: 99.8, n: 5 }, { lo: 99.9, n: 0 }, { lo: 100, n: 0 }, { lo: 100.1, n: 2 }]), "0.1 구간: 빈 구간 0");
eq(JSON.stringify(rebin(h, 2)), JSON.stringify([{ lo: 99.6, n: 3 }, { lo: 99.8, n: 5 }, { lo: 100, n: 2 }]), "0.2 구간: 99.7→99.6, 100.1→100.0");
eq(JSON.stringify(rebin([[-0.1, 4], [0, 6]], 1)), JSON.stringify([{ lo: -0.1, n: 4 }, { lo: 0, n: 6 }]), "음수 구간");
eq(JSON.stringify(rebin([[-0.1, 4], [0, 6]], 2)), JSON.stringify([{ lo: -0.2, n: 4 }, { lo: 0, n: 6 }]), "음수 0.2 구간은 아래로 내림");
eq(rebin(null, 2).length, 0, "히스토그램 없으면 빈 배열");

const sh = withShare([{ lo: 1, n: 1 }, { lo: 2, n: 3 }]);
eq(sh[0].pct, 25, "비율");
eq(sh[1].cum, 100, "누적 비율");
eq(withShare([{ lo: 1, n: 0 }])[0].pct, 0, "합계 0이면 0%");
const so = withShare([{ lo: 1, n: 2 }, { lo: 2, n: 3 }], 4, 10); // 범위 아래 4건, 위 1건
eq(so[0].pct, 20, "범위 밖 포함 전체 기준 비율");
eq(so[0].cum, 60, "누적은 범위 아래 건수부터 시작");
eq(so[1].cum, 90, "범위 위 건수만큼 100%에 못 미침");

const sm = summarize([100.2, null, 99.5, 99.9, undefined]);
eq(sm.n, 3, "요약: 값 있는 것만");
eq(sm.med, 99.9, "요약: 중앙값");
eq(sm.min, 99.5, "요약: 최소");
eq(sm.max, 100.2, "요약: 최대");
eq(sm.lt100, 2, "요약: 100 미만 건수");
eq(summarize([99, 100]).med, 99.5, "짝수 개 중앙값은 평균");
eq(summarize([]).n, 0, "빈 목록");

console.log(bad === 0 ? "OK goyang" : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
