// G2B 양식 탭 — 발주처별 fr/ar1 재현 빈도 순수 계산 모듈.
// standalone(import.meta.env 체인 없음) → node 단위테스트 가능. predConfidence.js와 동일 정책.

// 금액대 세그먼트 — utils.js getBiasArrow와 동일 경계.
export function baSegment(ba){
  const n = Number(ba) || 0;
  return n < 1e8 ? 'S1' : n < 3e8 ? 'S2' : n < 1e9 ? 'S3' : n < 3e9 ? 'S4' : 'S5';
}

// fr 정확일치 키 — 부동소수 비교 회피 위해 소수 3자리 반올림 문자열.
export function frKey(fr){
  if (fr == null || !isFinite(Number(fr))) return null;
  return (Math.round(Number(fr) * 1000) / 1000).toFixed(3);
}

// ar1 0.1% 버킷 키 — 연속값(추첨 결과)을 0.1% 구간으로 묶어 빈도 관찰.
export function ar1Bucket(ar1){
  if (ar1 == null || !isFinite(Number(ar1))) return null;
  return (Math.round(Number(ar1) * 10) / 10).toFixed(1);
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

// 강조 단계 → 스타일 (글씨크기 + 색). 색은 C 팔레트 값과 정렬.
export const INTENSITY_STYLE = {
  top:  { fontWeight: 700, fontSize: 15, color: '#d4a834' },
  high: { fontWeight: 600, fontSize: 13, color: '#5dca96' },
  mid:  { fontWeight: 400, fontSize: 12, color: '#e8e8ef' },
  rare: { fontWeight: 400, fontSize: 12, color: '#666680' },
};

// 선택 발주처 행 추출 + fr/ar1 빈도맵 + ar1 평균/표준편차.
// recs: 전체 bid_records 배열. opts: { agencyKey, cat?, era?, seg? }
// 표시행(rows)은 제외행 포함, 빈도/통계 집계만 is_excluded·is_duplicate 제외.
export function buildG2BFrequency(recs, opts){
  const { agencyKey, cat = null, era = null, seg = null } = opts || {};
  const rows = [];
  const freqFr = new Map();
  const freqAr1 = new Map();
  let sum = 0, sumSq = 0, nAr1 = 0;
  for (const r of (recs || [])){
    const key = r.canonical_ag || r.ag;
    if (key !== agencyKey) continue;
    if (cat && r.cat !== cat) continue;
    if (era && (r.era_v2 || r.era) !== era) continue;
    if (seg && baSegment(r.ba) !== seg) continue;
    rows.push(r);
    if (r.is_excluded === true || r.is_duplicate === true) continue; // 빈도/통계 제외
    const fk = frKey(r.fr);
    if (fk != null) freqFr.set(fk, (freqFr.get(fk) || 0) + 1);
    const ak = ar1Bucket(r.ar1);
    if (ak != null){
      freqAr1.set(ak, (freqAr1.get(ak) || 0) + 1);
      const v = Number(r.ar1); sum += v; sumSq += v * v; nAr1++;
    }
  }
  const totalFr = [...freqFr.values()].reduce((a, b) => a + b, 0);
  const totalAr1 = [...freqAr1.values()].reduce((a, b) => a + b, 0);
  const mean = nAr1 ? sum / nAr1 : null;
  const sd = nAr1 >= 2 ? Math.sqrt(Math.max(0, (sumSq - nAr1 * mean * mean) / (nAr1 - 1))) : null;
  return { rows, freqFr, freqAr1, totalFr, totalAr1, ar1Stats: { mean, sd, n: nAr1 } };
}

// 빈도맵 → 상위 N개 [value, count] (count desc).
export function topN(freqMap, n = 3){
  return [...freqMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}
