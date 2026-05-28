import { baSegment, frKey, ar1Bucket, intensityLevel, buildG2BFrequency } from "../src/lib/g2bFrequency.js";

let bad = 0;
const eq = (got, exp, msg) => { if (got !== exp) { console.error(`XX ${msg}: got ${JSON.stringify(got)} expect ${JSON.stringify(exp)}`); bad++; } };
const near = (got, exp, msg, tol=1e-6) => { if (got==null || Math.abs(got-exp)>tol) { console.error(`XX ${msg}: got ${got} expect ~${exp}`); bad++; } };

// 1. baSegment 경계 (utils.js getBiasArrow와 동일)
eq(baSegment(5e7), 'S1', 'baSegment <1억');
eq(baSegment(1e8), 'S2', 'baSegment 1억 경계');
eq(baSegment(3e8), 'S3', 'baSegment 3억 경계');
eq(baSegment(1e9), 'S4', 'baSegment 10억 경계');
eq(baSegment(3e9), 'S5', 'baSegment 30억 경계');

// 2. frKey — 소수 3자리 반올림 문자열 (부동소수 정확일치용)
eq(frKey(87.745), '87.745', 'frKey 87.745');
eq(frKey(87.7451), '87.745', 'frKey 반올림');
eq(frKey(90.25), '90.250', 'frKey 자리수 통일');
eq(frKey(null), null, 'frKey null');

// 3. ar1Bucket — 0.1% 버킷
eq(ar1Bucket(100.324), '100.3', 'ar1Bucket 100.324');
eq(ar1Bucket(99.671), '99.7', 'ar1Bucket 반올림 99.7');
eq(ar1Bucket(null), null, 'ar1Bucket null');

// 4. intensityLevel — 점유율 기반 + n<=2 희귀 override
eq(intensityLevel(50, 100), 'top', 'share 0.50 → top');
eq(intensityLevel(40, 100), 'top', 'share 0.40 → top');
eq(intensityLevel(20, 100), 'high', 'share 0.20 → high');
eq(intensityLevel(10, 100), 'mid', 'share 0.10 → mid');
eq(intensityLevel(4, 100), 'rare', 'share 0.04 → rare');
eq(intensityLevel(2, 4), 'rare', 'n<=2 override → rare');
eq(intensityLevel(0, 100), 'rare', 'count 0 → rare');

// 5. buildG2BFrequency — 발주처 필터 + 빈도 집계 + 제외행 처리
const recs = [
  { canonical_ag:'한전', ag:'한전 경기', cat:'전기', ba:2e8, fr:87.745, ar1:100.32 },
  { canonical_ag:'한전', ag:'한전 경기', cat:'전기', ba:2e8, fr:87.745, ar1:100.34 }, // ar1 다른 행, 같은 버킷 100.3
  { canonical_ag:'한전', ag:'한전 경기', cat:'통신', ba:2e8, fr:88.0,   ar1:99.71 },
  { canonical_ag:'한전', ag:'한전 경기', cat:'전기', ba:2e8, fr:87.745, ar1:100.91, is_excluded:true }, // 표시O 빈도X
  { canonical_ag:'고양시', ag:'고양시', cat:'전기', ba:2e8, fr:87.745, ar1:100.10 }, // 다른 발주처
];
const f = buildG2BFrequency(recs, { agencyKey:'한전' });
eq(f.rows.length, 4, '한전 표시행 4(제외행 포함)');
eq(f.freqFr.get('87.745'), 2, 'fr 87.745 빈도 2(제외행 미집계)');
eq(f.freqFr.get('88.000'), 1, 'fr 88.0 빈도 1');
eq(f.totalFr, 3, 'fr 총 집계 3');
eq(f.freqAr1.get('100.3'), 2, 'ar1 100.3 버킷 2');
eq(f.freqAr1.get('99.7'), 1, 'ar1 99.7 버킷 1');
eq(f.ar1Stats.n, 3, 'ar1 통계 n=3(제외행 미집계)');
near(f.ar1Stats.mean, (100.32+100.34+99.71)/3, 'ar1 평균');

// 6. buildG2BFrequency — cat 필터
const fc = buildG2BFrequency(recs, { agencyKey:'한전', cat:'통신' });
eq(fc.rows.length, 1, 'cat=통신 표시행 1');
eq(fc.freqFr.get('88.000'), 1, 'cat 필터 후 fr 88.0');

// 7. ar1Stats.sd — 샘플표준편차(n-1) 검증
{
  const vals = [100.32, 100.34, 99.71];
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  const expSd = Math.sqrt(vals.reduce((s, x) => s + (x - m) ** 2, 0) / (vals.length - 1));
  near(f.ar1Stats.sd, expSd, 'ar1 sd 샘플표준편차(n-1)');
}

// 8. n<2 → sd null, mean 존재 (0으로 나누기 가드)
{
  const f1 = buildG2BFrequency([{ canonical_ag:'X', ag:'X', ba:2e8, fr:90, ar1:100.5 }], { agencyKey:'X' });
  eq(f1.ar1Stats.n, 1, 'n=1');
  eq(f1.ar1Stats.sd, null, 'n<2 → sd null');
  near(f1.ar1Stats.mean, 100.5, 'n=1 mean');
}

console.log(bad===0 ? 'OK g2bFrequency (모든 케이스 통과)' : `FAIL: ${bad}건`);
process.exit(bad===0 ? 0 : 1);
