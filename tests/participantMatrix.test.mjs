import { bucketDecimals, cellBucket, matrixLevel, MATRIX_RATIO_THRESHOLDS, buildMatrix, buildCompanyOverlay } from "../src/lib/participantMatrix.js";

let bad = 0;
const eq = (got, exp, msg) => { if (got !== exp) { console.error(`XX ${msg}: got ${JSON.stringify(got)} expect ${JSON.stringify(exp)}`); bad++; } };

// 1. bucketDecimals — p_bucket 그래뉼래러티
eq(bucketDecimals(0.1), 1, 'bucketDecimals 0.1 → 1');
eq(bucketDecimals(0.05), 2, 'bucketDecimals 0.05 → 2');
eq(bucketDecimals(0.01), 2, 'bucketDecimals 0.01 → 2');
eq(bucketDecimals(0.001), 3, 'bucketDecimals 0.001 → 3');
eq(bucketDecimals(0.0001), 4, 'bucketDecimals 0.0001 → 4');

// 2. cellBucket — 정수스케일 절삭(Postgres floor(adj/p)*p 동일, 부동소수 오차 없음)
eq(cellBucket(99.8611, 0.01), 99.86, 'cellBucket 99.8611/0.01 → 99.86');
eq(cellBucket(100.004, 0.01), 100.00, 'cellBucket 100.004/0.01 → 100.00');
eq(cellBucket(99.87, 0.05), 99.85, 'cellBucket 99.87/0.05 → 99.85');
eq(cellBucket(99.84, 0.1), 99.8, 'cellBucket 99.84/0.1 → 99.8');
eq(cellBucket(99.8611, 0.0001), 99.8611, 'cellBucket 99.8611/0.0001 → 99.8611 (부동소수 오차 없음)');
eq(cellBucket(99.8615, 0.001), 99.861, 'cellBucket 99.8615/0.001 → 99.861');
eq(cellBucket(100.0000, 0.0001), 100.00, 'cellBucket 100.0/0.0001 → 100');
eq(cellBucket(null, 0.01), null, 'cellBucket null');

// 3. matrixLevel — 컬럼 최대 대비 비율 (0 최강 ~ 7 약)
eq(matrixLevel(0, 100), 7, 'cnt 0 → 7');
eq(matrixLevel(100, 100), 0, 'ratio 1.0 → 0');
eq(matrixLevel(85, 100), 0, 'ratio 0.85 → 0');
eq(matrixLevel(65, 100), 1, 'ratio 0.65 → 1');
eq(matrixLevel(10, 100), 5, 'ratio 0.10 → 5');
eq(matrixLevel(4, 100), 6, 'ratio 0.04 → 6');
eq(matrixLevel(3, 100), 7, 'ratio 0.03 → 7');
eq(MATRIX_RATIO_THRESHOLDS.length, 7, 'thresholds 7 경계 (8단계)');

// 4. buildMatrix — 구조/셀/★/참여합/버킷 내림차순
{
  const dist = {
    ag: "테스트", bucket: 0.01,
    columns: [
      { pn_no: "A", od: "2026-06-01", pn: "공고A", n: 5, win_rate: 99.86 },
      { pn_no: "B", od: "2026-05-01", pn: "공고B", n: 3, win_rate: 100.01 },
    ],
    cells: [
      { pn_no: "A", bucket: 99.86, cnt: 3, is_win: true },
      { pn_no: "A", bucket: 99.85, cnt: 2, is_win: false },
      { pn_no: "B", bucket: 100.01, cnt: 1, is_win: true },
      { pn_no: "B", bucket: 100.00, cnt: 2, is_win: false },
    ],
  };
  const m = buildMatrix(dist);
  eq(m.pBucket, 0.01, 'pBucket');
  eq(m.decimals, 2, 'decimals 2');
  eq(m.columns.length, 2, 'columns 2');
  // 버킷 내림차순 union: 100.01,100.00,99.86,99.85
  eq(JSON.stringify(m.buckets), JSON.stringify([100.01, 100.00, 99.86, 99.85]), 'buckets desc union');
  eq(m.cell("A", 99.86).cnt, 3, 'cell A/99.86 cnt 3');
  eq(m.cell("A", 99.86).is_win, true, 'cell A/99.86 is_win');
  eq(m.cell("A", 100.00), null, 'cell A/100.00 없음 → null');
  eq(m.colMax("A"), 3, 'colMax A 3');
  eq(m.colTotal("A"), 5, 'colTotal A 5 (== n)');
  eq(m.colTotal("B"), 3, 'colTotal B 3 (== n)');
  eq(m.isWinCell("A", 99.86), true, 'isWinCell A/99.86 ★');
  eq(m.isWinCell("A", 99.85), false, 'isWinCell A/99.85 아님');
  eq(m.winBucketKey("B"), "100.0100", 'winBucketKey B');
  // bucketTotalOf — 전 컬럼 합 (세밀 버킷 선별용)
  eq(m.bucketTotalOf(99.86), 3, 'bucketTotalOf 99.86 = 3 (A만)');
  eq(m.bucketTotalOf(100.00), 2, 'bucketTotalOf 100.00 = 2 (B만)');
  eq(m.bucketTotalOf(99.85), 2, 'bucketTotalOf 99.85 = 2');
  eq(m.bucketTotalOf(123.45), 0, 'bucketTotalOf 없는 버킷 = 0');
}

// 5. buildMatrix — 빈 입력 방어
{
  const m = buildMatrix({ ag: "x", bucket: 0.01, columns: [], cells: [] });
  eq(m.buckets.length, 0, '빈 cells → buckets 0');
  eq(m.cell("X", 100), null, '빈 cell 조회 null');
  const m2 = buildMatrix(null);
  eq(m2.columns.length, 0, 'null dist → columns 0');
  eq(m2.pBucket, 0.01, 'null dist → pBucket 기본 0.01');
}

// 6. buildCompanyOverlay — pn_no → adj_rate + 버킷키
{
  const trace = [
    { pn_no: "A", adj_rate: 99.8611 },
    { pn_no: "B", adj_rate: 100.004 },
    { pn_no: "C", adj_rate: null },
  ];
  const ov = buildCompanyOverlay(trace, 0.01);
  eq(ov.get("A").bucketKey, "99.8600", 'overlay A bucketKey');
  eq(ov.get("A").adj_rate, 99.8611, 'overlay A adj_rate');
  eq(ov.get("B").bucketKey, "100.0000", 'overlay B bucketKey');
  eq(ov.has("C"), false, 'overlay C(null adj) 제외');
}

if (bad) { console.error(`\n${bad} test(s) FAILED`); process.exit(1); }
else console.log("participantMatrix: all tests passed");
