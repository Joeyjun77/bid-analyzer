// G2B 양식 탭 — 발주처별 사정율(1위사정율 br1·발주처사정율 ar1) 재현 빈도 순수 계산 모듈.
// standalone(import.meta.env 체인 없음) → node 단위테스트 가능. predConfidence.js와 동일 정책.

// 금액대 세그먼트 — utils.js getBiasArrow와 동일 경계.
export function baSegment(ba){
  const n = Number(ba) || 0;
  return n < 1e8 ? 'S1' : n < 3e8 ? 'S2' : n < 1e9 ? 'S3' : n < 3e9 ? 'S4' : 'S5';
}

// 사정율 0.1% 버킷 키 — br1/ar1 모두 복수예비가 추첨 결과(연속값)라 0.1% 구간으로 묶어 빈도 관찰.
export function rateBucket(v){
  if (v == null || !isFinite(Number(v))) return null;
  return (Math.round(Number(v) * 10) / 10).toFixed(1);
}

// 점유율(count/total) → 강조 단계. n<=2는 점유율 무관 희귀.
export function intensityLevel(count, total){
  if (!count || count <= 2 || !total) return 'rare';
  const share = count / total;
  if (share >= 0.40) return 'top';
  if (share >= 0.15) return 'high';
  if (share >= 0.05) return 'mid';
  return 'rare';
}

// 강조 단계 → 스타일 (글씨크기 + 색). 색은 C 팔레트 값과 정렬. 출현 多 → 大·진한색.
export const INTENSITY_STYLE = {
  top:  { fontWeight: 700, fontSize: 15, color: '#d4a834' },
  high: { fontWeight: 600, fontSize: 13, color: '#5dca96' },
  mid:  { fontWeight: 400, fontSize: 12, color: '#e8e8ef' },
  rare: { fontWeight: 400, fontSize: 12, color: '#666680' },
};

const stat = (n, sum, sumSq) => {
  const mean = n ? sum / n : null;
  const sd = n >= 2 ? Math.sqrt(Math.max(0, (sumSq - n * mean * mean) / (n - 1))) : null;
  return { mean, sd, n };
};

// 선택 발주처 행 추출 + br1/ar1 0.1% 버킷 빈도맵 + 각 평균/표준편차.
// recs: 전체 bid_records 배열. opts: { agencyKey, cat?, era?, seg? }
// 표시행(rows)은 제외행 포함, 빈도/통계 집계만 is_excluded 제외.
export function buildG2BFrequency(recs, opts){
  const { agencyKey, cat = null, era = null, seg = null } = opts || {};
  const rows = [];
  const freqBr1 = new Map();
  const freqAr1 = new Map();
  let sB = 0, sqB = 0, nB = 0;
  let sA = 0, sqA = 0, nA = 0;
  for (const r of (recs || [])){
    const key = r.canonical_ag || r.ag;
    if (key !== agencyKey) continue;
    if (cat && r.cat !== cat) continue;
    if (era && (r.era_v2 || r.era) !== era) continue;
    if (seg && baSegment(r.ba) !== seg) continue;
    rows.push(r);
    if (r.is_excluded === true) continue; // 비정상 건(is_excluded) 빈도/통계 제외
    const bk = rateBucket(r.br1);
    if (bk != null){
      freqBr1.set(bk, (freqBr1.get(bk) || 0) + 1);
      const v = Number(r.br1); sB += v; sqB += v * v; nB++;
    }
    const ak = rateBucket(r.ar1);
    if (ak != null){
      freqAr1.set(ak, (freqAr1.get(ak) || 0) + 1);
      const v = Number(r.ar1); sA += v; sqA += v * v; nA++;
    }
  }
  const totalBr1 = [...freqBr1.values()].reduce((a, b) => a + b, 0);
  const totalAr1 = [...freqAr1.values()].reduce((a, b) => a + b, 0);
  return {
    rows,
    freqBr1, freqAr1,
    totalBr1, totalAr1,
    br1Stats: stat(nB, sB, sqB),
    ar1Stats: stat(nA, sA, sqA),
  };
}

// 빈도맵 → 상위 N개 [value, count] (count desc).
export function topN(freqMap, n = 3){
  return [...freqMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}
