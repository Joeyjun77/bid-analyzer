import { baSegment, rateBucket, intensityLevel, INTENSITY_STYLE, COUNT_THRESHOLDS, buildG2BFrequency, buildGlobalRateFreq, buildYearRateFreq, dedupExactRecords } from "../src/lib/g2bFrequency.js";

let bad = 0;
const eq = (got, exp, msg) => { if (got !== exp) { console.error(`XX ${msg}: got ${JSON.stringify(got)} expect ${JSON.stringify(exp)}`); bad++; } };
const near = (got, exp, msg, tol=1e-6) => { if (got==null || Math.abs(got-exp)>tol) { console.error(`XX ${msg}: got ${got} expect ~${exp}`); bad++; } };

// 1. baSegment 경계 (utils.js getBiasArrow와 동일)
eq(baSegment(5e7), 'S1', 'baSegment <1억');
eq(baSegment(1e8), 'S2', 'baSegment 1억 경계');
eq(baSegment(3e8), 'S3', 'baSegment 3억 경계');
eq(baSegment(1e9), 'S4', 'baSegment 10억 경계');
eq(baSegment(3e9), 'S5', 'baSegment 30억 경계');

// 2. rateBucket — 소수점 d자리(기본 4) 절삭 동일조건 키 (br1/ar1 공용)
eq(rateBucket(100.33124), '100.3312', 'rateBucket 기본4 100.33124 → 100.3312');
eq(rateBucket(99.71), '99.7100', 'rateBucket 기본4 99.71 → 99.7100(4자리 패딩)');
eq(rateBucket(100.3389, 3), '100.338', 'rateBucket 3자리 절삭(반올림X) → 100.338');
eq(rateBucket(100.3389, 2), '100.33', 'rateBucket 2자리 절삭 → 100.33');
eq(rateBucket(100.3, 2), '100.30', 'rateBucket 2자리 절삭 패딩 → 100.30');
eq(rateBucket(100.339, 4), '100.3390', 'rateBucket 4자리 → 100.3390');
eq(rateBucket(null, 2), null, 'rateBucket null');

// 3. intensityLevel — 동일조건 일치 횟수 기반, count<=2 override 제거(임계값이 단계 결정)
{
  const T = COUNT_THRESHOLDS[4].all; // [12,9,7,5,4,3,2]
  eq(intensityLevel(12, T), 0, '>=12 → 0');
  eq(intensityLevel(14, T), 0, '최대치 → 0');
  eq(intensityLevel(11, T), 1, '11(>=9) → 1');
  eq(intensityLevel(7, T), 2, '>=7 → 2');
  eq(intensityLevel(5, T), 3, '>=5 → 3');
  eq(intensityLevel(4, T), 4, '>=4 → 4');
  eq(intensityLevel(3, T), 5, '>=3 → 5');
  eq(intensityLevel(2, T), 6, '>=2 → 6');
  eq(intensityLevel(1, T), 7, '1 < t[6]=2 → 7');
  eq(intensityLevel(0, T), 7, 'count 0 → 7');
  eq(intensityLevel(12), 0, 'thresholds 생략 → [4].all 기본값으로 0');
  // d=4 agency [5,4,3,2]
  eq(intensityLevel(5, COUNT_THRESHOLDS[4].agency), 0, 'd4 agency 5 → 0');
  eq(intensityLevel(2, COUNT_THRESHOLDS[4].agency), 3, 'd4 agency 2 → 3');
  eq(intensityLevel(1, COUNT_THRESHOLDS[4].agency), 7, 'd4 agency 1 → 7');
  // d=2 all [240,160,90,35,14,6,3] — 자리수 작으면 카운트 큼
  eq(intensityLevel(240, COUNT_THRESHOLDS[2].all), 0, 'd2 all 240 → 0');
  eq(intensityLevel(5, COUNT_THRESHOLDS[2].all), 6, 'd2 all 5(>=3) → 6');
  eq(intensityLevel(2, COUNT_THRESHOLDS[2].all), 7, 'd2 all 2 → 7');
}
// COUNT_THRESHOLDS — 자리수(2·3·4) × 기준 중첩, 각 배열 길이 ≥3, 강한 내림차순
for (const d of [2, 3, 4]){
  for (const k of ['all', 'year', 'yearAg', 'agency']){
    const t = COUNT_THRESHOLDS[d][k];
    eq(Array.isArray(t) && t.length >= 3, true, `d${d} ${k} 임계값 배열(길이≥3)`);
    let mono = true; for (let i = 1; i < t.length; i++){ if (t[i] >= t[i-1]) mono = false; }
    eq(mono, true, `d${d} ${k} 임계값 강한 내림차순`);
  }
}
eq(INTENSITY_STYLE.length, 8, 'INTENSITY_STYLE 8단계 배열');
eq(typeof INTENSITY_STYLE[0].color, 'string', 'INTENSITY_STYLE[0] 스타일 객체');

// 4. buildG2BFrequency — 발주처 필터 + br1/ar1 빈도 집계(소수4자리 동일) + 제외행 처리
const recs = [
  { canonical_ag:'한전', ag:'한전 경기', cat:'전기', ba:2e8, br1:100.3312, ar1:100.3210 },
  { canonical_ag:'한전', ag:'한전 경기', cat:'전기', ba:2e8, br1:100.3312, ar1:100.3210 }, // 4자리 동일 → 같은 버킷
  { canonical_ag:'한전', ag:'한전 경기', cat:'통신', ba:2e8, br1:99.7100,  ar1:99.7100 },
  { canonical_ag:'한전', ag:'한전 경기', cat:'전기', ba:2e8, br1:100.9000, ar1:100.9100, is_excluded:true }, // 표시O 빈도X
  { canonical_ag:'한전', ag:'한전 경기', cat:'전기', ba:null, av:0, br1:90.5000, ar1:null }, // ar1 없는 불완전 건 → 표시·빈도 모두 제외
  { canonical_ag:'고양시', ag:'고양시', cat:'전기', ba:2e8, br1:100.1000, ar1:100.1000 }, // 다른 발주처
];
const f = buildG2BFrequency(recs, { agencyKey:'한전' });
eq(f.rows.length, 4, '한전 표시행 4(is_excluded 포함, ar1 없는 불완전 건 제외)');
eq(f.freqBr1.get('90.5000'), undefined, 'ar1 없는 행의 br1(90.5000) 빈도 미집계');
eq(f.freqBr1.get('100.3312'), 2, 'br1 100.3312 동일 2(제외행 미집계)');
eq(f.freqBr1.get('99.7100'), 1, 'br1 99.7100 동일 1');
eq(f.totalBr1, 3, 'br1 총 집계 3');
eq(f.maxBr1, 2, 'br1 최다 동일값 카운트 2');
eq(f.freqAr1.get('100.3210'), 2, 'ar1 100.3210 동일 2');
eq(f.freqAr1.get('99.7100'), 1, 'ar1 99.7100 동일 1');
eq(f.totalAr1, 3, 'ar1 총 집계 3');
eq(f.maxAr1, 2, 'ar1 최다 동일값 카운트 2');
eq(f.br1Stats.n, 3, 'br1 통계 n=3(제외행 미집계)');
eq(f.ar1Stats.n, 3, 'ar1 통계 n=3(제외행 미집계)');
near(f.br1Stats.mean, (100.3312+100.3312+99.7100)/3, 'br1 평균');
near(f.ar1Stats.mean, (100.3210+100.3210+99.7100)/3, 'ar1 평균');

// 5. buildG2BFrequency — cat 필터
const fc = buildG2BFrequency(recs, { agencyKey:'한전', cat:'통신' });
eq(fc.rows.length, 1, 'cat=통신 표시행 1');
eq(fc.freqBr1.get('99.7100'), 1, 'cat 필터 후 br1 99.7100');
eq(fc.freqAr1.get('99.7100'), 1, 'cat 필터 후 ar1 99.7100');

// 6. br1Stats.sd / ar1Stats.sd — 샘플표준편차(n-1) 검증
{
  const sampleSd = (vals) => {
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    return Math.sqrt(vals.reduce((s, x) => s + (x - m) ** 2, 0) / (vals.length - 1));
  };
  near(f.br1Stats.sd, sampleSd([100.3312, 100.3312, 99.7100]), 'br1 sd 샘플표준편차(n-1)');
  near(f.ar1Stats.sd, sampleSd([100.3210, 100.3210, 99.7100]), 'ar1 sd 샘플표준편차(n-1)');
}

// 7. n<2 → sd null, mean 존재 (0으로 나누기 가드)
{
  const f1 = buildG2BFrequency([{ canonical_ag:'X', ag:'X', ba:2e8, br1:100.4, ar1:100.5 }], { agencyKey:'X' });
  eq(f1.br1Stats.n, 1, 'n=1');
  eq(f1.br1Stats.sd, null, 'br1 n<2 → sd null');
  eq(f1.ar1Stats.sd, null, 'ar1 n<2 → sd null');
  near(f1.br1Stats.mean, 100.4, 'n=1 br1 mean');
  near(f1.ar1Stats.mean, 100.5, 'n=1 ar1 mean');
}

// 8. buildGlobalRateFreq — 전체 데이터(발주사 무관) 기준, ar1 없는·제외 건 제거
{
  const g = buildGlobalRateFreq(recs);
  eq(g.freqBr1.get('100.3312'), 2, '전역 br1 100.3312 = 2 (한전 2건)');
  eq(g.freqBr1.get('100.1000'), 1, '전역 br1 100.1000 = 1 (고양시 포함)');
  eq(g.freqAr1.get('100.1000'), 1, '전역 ar1 100.1000 = 1');
  eq(g.maxBr1, 2, '전역 br1 최다 카운트 2');
  eq(g.maxAr1, 2, '전역 ar1 최다 카운트 2');
  eq(g.freqBr1.get('90.5000'), undefined, '전역도 ar1 없는 행 미집계');
  eq(g.br1Stats.n, 4, '전역 br1 통계 n=4(한전3·고양시1, ar1없는·제외 제거)');
  eq(g.ar1Stats.n, 4, '전역 ar1 통계 n=4');
}

// 9. buildYearRateFreq — 전체 발주처 기준 년도(od 앞 4자리)별 빈도(소수4자리 동일). ar1 없는·제외·od 결측 제거.
{
  const yrecs = [
    { canonical_ag:'한전', ag:'한전', od:'2024-03-01', br1:100.3312, ar1:100.3210 },
    { canonical_ag:'고양시', ag:'고양시', od:'2024-09-10', br1:100.3312, ar1:100.1000 }, // 같은 2024, br1 100.3312 동일
    { canonical_ag:'LH', ag:'LH', od:'2025-01-20', br1:99.7100, ar1:99.7100 },           // 2025
    { canonical_ag:'한전', ag:'한전', od:'2025-06-06', br1:100.3300, ar1:100.3100, is_excluded:true }, // 제외
    { canonical_ag:'한전', ag:'한전', od:null, br1:100.3300, ar1:100.3000 },              // od 결측 제외
    { canonical_ag:'한전', ag:'한전', od:'2025-08-08', br1:88.0000, ar1:null },          // ar1 없음 제외
  ];
  const ym = buildYearRateFreq(yrecs);
  eq(ym.size, 2, '년도 2개(2024·2025)');
  eq(ym.get('2024').freqBr1.get('100.3312'), 2, '2024 br1 100.3312 = 2 (발주처 무관 합산)');
  eq(ym.get('2024').maxBr1, 2, '2024 br1 최다 카운트 2');
  eq(ym.get('2024').freqAr1.get('100.3210'), 1, '2024 ar1 100.3210 = 1 (한전)');
  eq(ym.get('2024').freqAr1.get('100.1000'), 1, '2024 ar1 100.1000 = 1 (고양시)');
  eq(ym.get('2025').freqBr1.get('99.7100'), 1, '2025 br1 99.7100 = 1');
  eq(ym.get('2025').freqBr1.get('100.3300'), undefined, '2025 제외행 br1 미집계');
  eq(ym.get('2024').br1Stats.n, 2, '2024 br1 통계 n=2');
  near(ym.get('2024').br1Stats.mean, (100.3312+100.3312)/2, '2024 br1 평균');
}

// 10. dedupExactRecords — 완전중복 제거(최소 id 유지), 다중차수 보존
{
  const rs = [
    { id: 10, pn_no: 'A-1', od: '2026-05-14', ba: 99000000, bp: 87751000 }, // 정본(최소 id)
    { id: 20, pn_no: 'A-1', od: '2026-05-14', ba: 99000000, bp: 87751000 }, // 완전중복 → 제거
    { id: 30, pn_no: 'A-1', od: '2026-05-14', ba: 88000000, bp: 80000000 }, // 같은 pn_no·다른 ba → 보존(다중차수)
    { id: 40, pn_no: '', pn: '공고X', od: '2026-01-01', ba: 5e7, bp: 4e7 },   // pn_no 없음 → 공고명 fallback
  ];
  const out = dedupExactRecords(rs);
  eq(out.length, 3, '완전중복 1건 제거 → 3건');
  eq(out.some(r => r.id === 10), true, '정본(id10) 유지');
  eq(out.some(r => r.id === 20), false, '중복(id20) 제거');
  eq(out.some(r => r.id === 30), true, '다중차수(id30) 보존');
  eq(out.some(r => r.id === 40), true, 'pn_no 없는 행 보존');
  eq(dedupExactRecords([]).length, 0, '빈 배열 안전');
}

console.log(bad===0 ? 'OK g2bFrequency (모든 케이스 통과)' : `FAIL: ${bad}건`);
process.exit(bad===0 ? 0 : 1);
