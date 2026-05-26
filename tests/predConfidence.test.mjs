import { predConfidenceV2 } from "../src/lib/predConfidence.js";

let bad = 0;
const eq = (got, exp, msg) => { if (got !== exp) { console.error(`XX ${msg}: got ${got} expect ${exp}`); bad++; } };

// accMap 값 = {n,bias,mae,sd}. 키: agBa['ag|seg'], ag['ag'], atBa['at|seg'], at['at'].
const empty = { agBa:{}, ag:{}, atBa:{}, at:{} };

// 1. 한전 높음 — AT grain n=60, mae 0.44, |bias| 0.05, sd 0.58 → high
{
  const m = { ...empty, at:{ '한전':{n:60,bias:0.05,mae:0.44,sd:0.58} } };
  const r = predConfidenceV2('한국전력공사 경기본부(531건)', m, {at:'한전', ag:'한국전력공사 경기본부', ba:2e8});
  eq(r.level, 'high', '한전 높음');
  eq(r.basis, 'accuracy', '한전 basis accuracy');
  eq(r.grainSrc, 'AT', '한전 grainSrc AT');
}

// 2. 군시설 — 사정률은 높음 자격이나 WIN-zone 영역 cap → med
{
  const m = { ...empty, at:{ '군시설':{n:87,bias:0.08,mae:0.51,sd:0.62} } };
  const r = predConfidenceV2('국군 어쩌고(120건)', m, {at:'군시설', ag:'국군 X', ba:2e8});
  eq(r.level, 'med', '군시설 WIN-zone cap → med');
  eq(r.winZoneArea, true, '군시설 winZoneArea true');
}

// 3. 지자체 보통 — mae 0.64 > 0.55 → med
{
  const m = { ...empty, at:{ '지자체':{n:256,bias:0.07,mae:0.64,sd:0.81} } };
  const r = predConfidenceV2('어느 지자체(300건)', m, {at:'지자체', ag:'어느 지자체', ba:2e8});
  eq(r.level, 'med', '지자체 보통');
}

// 4. 고양시 P0-1 — AG_BA n=25(<30) 건너뛰고 AG n=38 사용, mae 0.553 → med
{
  const m = { ...empty,
    agBa:{ '경기도 고양시|S1':{n:25,bias:0.03,mae:0.61,sd:0.80} },
    ag:{ '경기도 고양시':{n:38,bias:0.15,mae:0.553,sd:0.72} },
    at:{ '지자체':{n:256,bias:0.07,mae:0.64,sd:0.81} } };
  const r = predConfidenceV2('경기도 고양시(535건)', m, {at:'지자체', ag:'경기도 고양시', ba:5e7});
  eq(r.level, 'med', '고양시 보통(현행 높음 강등)');
  eq(r.grainSrc, 'AG', '고양시 AG grain 사용(AG_BA n<30 건너뜀)');
}

// 5. P0-1 명시 — AG_BA n=5 건너뛰고 AG n=80 사용 → 그 grain이 나쁘면 low
{
  const m = { ...empty,
    agBa:{ 'X|S2':{n:5,bias:0.1,mae:0.4,sd:0.5} },
    ag:{ 'X':{n:80,bias:0.6,mae:0.9,sd:1.0} } };
  const r = predConfidenceV2('X(10건)', m, {at:'기타', ag:'X', ba:2e8});
  eq(r.grainSrc, 'AG', 'P0-1 thin AG_BA 건너뛰고 AG');
  eq(r.level, 'low', 'P0-1 AG n80 나쁨 → 주의');
}

// 6. P0-2 fallback cap — accMap 전 grain 미스 + N≥200 → 최대 med (높음 금지)
{
  const r = predConfidenceV2('한국전력공사 경기본부(531건)', empty, {at:'한전', ag:'X', ba:2e8});
  eq(r.basis, 'sample', 'fallback basis sample');
  eq(r.level, 'med', 'fallback cap → med (높음 금지)');
}

// 7. thin grain 주의 — n<30 grain만, mae>0.85 → low
{
  const m = { ...empty, agBa:{ 'Y|S2':{n:12,bias:0.5,mae:0.9,sd:1.1} } };
  const r = predConfidenceV2('Y(20건)', m, {at:'기타', ag:'Y', ba:2e8});
  eq(r.level, 'low', 'thin grain 나쁨 → 주의');
}

// 8. thin grain 보통 — n<30 grain만, 양호 → med (높음 금지)
{
  const m = { ...empty, ag:{ 'W':{n:15,bias:0.1,mae:0.6,sd:0.7} } };
  const r = predConfidenceV2('W(20건)', m, {at:'기타', ag:'W', ba:2e8});
  eq(r.level, 'med', 'thin grain 양호 → 보통(높음 금지)');
}

// 9. g2b 형식 + accMap 미스 → fallback, 높음 금지
{
  const r = predConfidenceV2('d:0.50|s:0.25|c:0.20', empty, {at:'한전', ag:'X', ba:2e8});
  eq(r.basis, 'sample', 'g2b fallback basis sample');
  if (r.level === 'high') { console.error('XX g2b fallback 높음 금지: got high'); bad++; }
}

console.log(bad === 0 ? "OK predConfidenceV2 all cases" : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
