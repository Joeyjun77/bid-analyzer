import { baSegment, rateBucket, intensityLevel, INTENSITY_STYLE, COUNT_THRESHOLDS, buildG2BFrequency, buildGlobalRateFreq, buildYearRateFreq } from "../src/lib/g2bFrequency.js";

let bad = 0;
const eq = (got, exp, msg) => { if (got !== exp) { console.error(`XX ${msg}: got ${JSON.stringify(got)} expect ${JSON.stringify(exp)}`); bad++; } };
const near = (got, exp, msg, tol=1e-6) => { if (got==null || Math.abs(got-exp)>tol) { console.error(`XX ${msg}: got ${got} expect ~${exp}`); bad++; } };

// 1. baSegment 경계 (utils.js getBiasArrow와 동일)
eq(baSegment(5e7), 'S1', 'baSegment <1억');
eq(baSegment(1e8), 'S2', 'baSegment 1억 경계');
eq(baSegment(3e8), 'S3', 'baSegment 3억 경계');
eq(baSegment(1e9), 'S4', 'baSegment 10억 경계');
eq(baSegment(3e9), 'S5', 'baSegment 30억 경계');

// 2. rateBucket — 0.1% 버킷 (br1/ar1 공용)
eq(rateBucket(100.324), '100.3', 'rateBucket 100.324');
eq(rateBucket(99.671), '99.7', 'rateBucket 반올림 99.7');
eq(rateBucket(100.349), '100.3', 'rateBucket 100.349');
eq(rateBucket(null), null, 'rateBucket null');

// 3. intensityLevel — 절대 횟수 기반 8단계(0 최다~7 희귀) + count<=2 최하 override
{
  const T = [1000, 500, 200, 80, 30, 12, 4]; // all 기준 임계값
  eq(intensityLevel(1000, T), 0, '>=1000 → 0');
  eq(intensityLevel(2794, T), 0, '최대치 → 0');
  eq(intensityLevel(999, T), 1, '999 → 1');
  eq(intensityLevel(500, T), 1, '>=500 → 1');
  eq(intensityLevel(200, T), 2, '>=200 → 2');
  eq(intensityLevel(80, T), 3, '>=80 → 3');
  eq(intensityLevel(30, T), 4, '>=30 → 4');
  eq(intensityLevel(12, T), 5, '>=12 → 5');
  eq(intensityLevel(4, T), 6, '>=4 → 6');
  eq(intensityLevel(3, T), 7, '3 < t[6]=4 → 7');
  eq(intensityLevel(2, T), 7, 'count<=2 override → 7');
  eq(intensityLevel(0, T), 7, 'count 0 → 7');
  // thresholds 미지정 시 all 기본값 사용
  eq(intensityLevel(1000), 0, 'thresholds 생략 → all 기본값으로 0');
  eq(intensityLevel(36, COUNT_THRESHOLDS.agency), 0, 'agency 36 → 0');
  eq(intensityLevel(13, COUNT_THRESHOLDS.agency), 2, 'agency 13(>=12) → 2');
}
// COUNT_THRESHOLDS — 3개 기준, 각 7경계, 내림차순
for (const k of ['all', 'year', 'agency']){
  eq(COUNT_THRESHOLDS[k].length, 7, `${k} 임계값 7개`);
  const t = COUNT_THRESHOLDS[k];
  let mono = true; for (let i = 1; i < t.length; i++){ if (t[i] >= t[i-1]) mono = false; }
  eq(mono, true, `${k} 임계값 내림차순`);
}
eq(INTENSITY_STYLE.length, 8, 'INTENSITY_STYLE 8단계 배열');
eq(typeof INTENSITY_STYLE[0].color, 'string', 'INTENSITY_STYLE[0] 스타일 객체');

// 4. buildG2BFrequency — 발주처 필터 + br1/ar1 빈도 집계 + 제외행 처리
const recs = [
  { canonical_ag:'한전', ag:'한전 경기', cat:'전기', ba:2e8, br1:100.33, ar1:100.32 },
  { canonical_ag:'한전', ag:'한전 경기', cat:'전기', ba:2e8, br1:100.34, ar1:100.34 }, // br1·ar1 둘 다 100.3 버킷
  { canonical_ag:'한전', ag:'한전 경기', cat:'통신', ba:2e8, br1:99.71,  ar1:99.71 },
  { canonical_ag:'한전', ag:'한전 경기', cat:'전기', ba:2e8, br1:100.90, ar1:100.91, is_excluded:true }, // 표시O 빈도X
  { canonical_ag:'한전', ag:'한전 경기', cat:'전기', ba:null, av:0, br1:90.5, ar1:null }, // ar1 없는 불완전 건 → 표시·빈도 모두 제외
  { canonical_ag:'고양시', ag:'고양시', cat:'전기', ba:2e8, br1:100.10, ar1:100.10 }, // 다른 발주처
];
const f = buildG2BFrequency(recs, { agencyKey:'한전' });
eq(f.rows.length, 4, '한전 표시행 4(is_excluded 포함, ar1 없는 불완전 건 제외)');
eq(f.freqBr1.get('90.5'), undefined, 'ar1 없는 행의 br1(90.5) 빈도 미집계');
eq(f.freqBr1.get('100.3'), 2, 'br1 100.3 버킷 2(제외행 미집계)');
eq(f.freqBr1.get('99.7'), 1, 'br1 99.7 버킷 1');
eq(f.totalBr1, 3, 'br1 총 집계 3');
eq(f.maxBr1, 2, 'br1 최빈 버킷 카운트 2');
eq(f.freqAr1.get('100.3'), 2, 'ar1 100.3 버킷 2');
eq(f.freqAr1.get('99.7'), 1, 'ar1 99.7 버킷 1');
eq(f.totalAr1, 3, 'ar1 총 집계 3');
eq(f.maxAr1, 2, 'ar1 최빈 버킷 카운트 2');
eq(f.br1Stats.n, 3, 'br1 통계 n=3(제외행 미집계)');
eq(f.ar1Stats.n, 3, 'ar1 통계 n=3(제외행 미집계)');
near(f.br1Stats.mean, (100.33+100.34+99.71)/3, 'br1 평균');
near(f.ar1Stats.mean, (100.32+100.34+99.71)/3, 'ar1 평균');

// 5. buildG2BFrequency — cat 필터
const fc = buildG2BFrequency(recs, { agencyKey:'한전', cat:'통신' });
eq(fc.rows.length, 1, 'cat=통신 표시행 1');
eq(fc.freqBr1.get('99.7'), 1, 'cat 필터 후 br1 99.7');
eq(fc.freqAr1.get('99.7'), 1, 'cat 필터 후 ar1 99.7');

// 6. br1Stats.sd / ar1Stats.sd — 샘플표준편차(n-1) 검증
{
  const sampleSd = (vals) => {
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    return Math.sqrt(vals.reduce((s, x) => s + (x - m) ** 2, 0) / (vals.length - 1));
  };
  near(f.br1Stats.sd, sampleSd([100.33, 100.34, 99.71]), 'br1 sd 샘플표준편차(n-1)');
  near(f.ar1Stats.sd, sampleSd([100.32, 100.34, 99.71]), 'ar1 sd 샘플표준편차(n-1)');
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
  eq(g.freqBr1.get('100.3'), 2, '전역 br1 100.3 = 2 (한전 2건)');
  eq(g.freqBr1.get('100.1'), 1, '전역 br1 100.1 = 1 (고양시 포함)');
  eq(g.freqAr1.get('100.1'), 1, '전역 ar1 100.1 = 1');
  eq(g.maxBr1, 2, '전역 br1 최빈 카운트 2');
  eq(g.maxAr1, 2, '전역 ar1 최빈 카운트 2');
  eq(g.freqBr1.get('90.5'), undefined, '전역도 ar1 없는 행 미집계');
}

// 9. buildYearRateFreq — 전체 발주처 기준 년도(od 앞 4자리)별 빈도. ar1 없는·제외·od 결측 제거.
{
  const yrecs = [
    { canonical_ag:'한전', ag:'한전', od:'2024-03-01', br1:100.33, ar1:100.32 },
    { canonical_ag:'고양시', ag:'고양시', od:'2024-09-10', br1:100.34, ar1:100.10 }, // 같은 2024, br1 100.3 버킷
    { canonical_ag:'LH', ag:'LH', od:'2025-01-20', br1:99.71, ar1:99.71 },           // 2025
    { canonical_ag:'한전', ag:'한전', od:'2025-06-06', br1:100.30, ar1:100.31, is_excluded:true }, // 제외
    { canonical_ag:'한전', ag:'한전', od:null, br1:100.30, ar1:100.30 },              // od 결측 제외
    { canonical_ag:'한전', ag:'한전', od:'2025-08-08', br1:88.0, ar1:null },          // ar1 없음 제외
  ];
  const ym = buildYearRateFreq(yrecs);
  eq(ym.size, 2, '년도 2개(2024·2025)');
  eq(ym.get('2024').freqBr1.get('100.3'), 2, '2024 br1 100.3 = 2 (발주처 무관 합산)');
  eq(ym.get('2024').maxBr1, 2, '2024 br1 최빈 카운트 2');
  eq(ym.get('2024').freqAr1.get('100.3'), 1, '2024 ar1 100.3 = 1 (한전)');
  eq(ym.get('2024').freqAr1.get('100.1'), 1, '2024 ar1 100.1 = 1 (고양시)');
  eq(ym.get('2025').freqBr1.get('99.7'), 1, '2025 br1 99.7 = 1');
  eq(ym.get('2025').freqBr1.get('100.3'), undefined, '2025 제외행 br1 미집계');
  eq(ym.get('2024').br1Stats.n, 2, '2024 br1 통계 n=2');
  near(ym.get('2024').br1Stats.mean, (100.33+100.34)/2, '2024 br1 평균');
}

// 10. buildGlobalRateFreq 통계 보강 — stats 동반 반환 검증
{
  const g = buildGlobalRateFreq(recs);
  eq(g.br1Stats.n, 4, '전역 br1 통계 n=4(한전3·고양시1, ar1없는·제외 제거)');
  eq(g.ar1Stats.n, 4, '전역 ar1 통계 n=4');
}

console.log(bad===0 ? 'OK g2bFrequency (모든 케이스 통과)' : `FAIL: ${bad}건`);
process.exit(bad===0 ? 0 : 1);
