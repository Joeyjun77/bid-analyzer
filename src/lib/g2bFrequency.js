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

// (count/denom) → 강조 단계 인덱스 0(최강)~7(약). denom=그 발주처 최빈 버킷 카운트 → 최빈값은 1.0=인덱스0.
// count<=2는 비율 무관 최하(7). 상위(0~3)는 임계를 촘촘히 둬 색·크기 변화 크게, 중간 이하(4~7)는 수렴.
export function intensityLevel(count, denom){
  if (!count || count <= 2 || !denom) return 7;
  const s = count / denom;
  if (s >= 0.40) return 0;
  if (s >= 0.30) return 1;
  if (s >= 0.22) return 2;
  if (s >= 0.15) return 3;
  if (s >= 0.10) return 4;
  if (s >= 0.06) return 5;
  if (s >= 0.03) return 6;
  return 7;
}

// 8단계 강조 스타일 (인덱스 0~7). 엑셀(G2B) 규칙 차용 — 빈도 높을수록 글씨 大 + 밝은 파랑.
// 엑셀은 셀 배경색으로 표현했으나 여기선 다크 테마라 글자색(color)으로 적용(배경 채움 미사용).
// 상위(0~4)는 파랑 채도 변화 크게(엑셀 95B3D7→DCE6F2 계열 차용), 중간 이하(5~7)는 회색으로 수렴.
export const INTENSITY_STYLE = [
  { fontWeight: 800, fontSize: 22, color: '#3d8bff' }, // 0 최빈 (가장 크고 선명한 파랑)
  { fontWeight: 800, fontSize: 19, color: '#5fa0fa' }, // 1
  { fontWeight: 700, fontSize: 17, color: '#84b8f2' }, // 2
  { fontWeight: 700, fontSize: 15, color: '#aacef0' }, // 3
  { fontWeight: 600, fontSize: 14, color: '#cfe0f3' }, // 4 (엑셀 DCE6F2) — 수렴 시작
  { fontWeight: 400, fontSize: 12, color: '#9298ac' }, // 5
  { fontWeight: 400, fontSize: 12, color: '#7c8194' }, // 6 (5·6·7 거의 동일)
  { fontWeight: 400, fontSize: 12, color: '#666680' }, // 7 희귀
];

const stat = (n, sum, sumSq) => {
  const mean = n ? sum / n : null;
  const sd = n >= 2 ? Math.sqrt(Math.max(0, (sumSq - n * mean * mean) / (n - 1))) : null;
  return { mean, sd, n };
};

// 선택 발주처 행 추출 + br1/ar1 0.1% 버킷 빈도맵 + 각 평균/표준편차.
// recs: 전체 bid_records 배열. opts: { agencyKey, cat?, era?, seg? }
// ar1(발주처사정율) 없는 불완전 건은 표시·빈도 모두 제외(g2b_auto 자동수집 등은 기초금액·사정율 미수집,
//   br1이 낙찰가율이라 사정율 뷰를 오염시킴). 빈도/통계 집계는 추가로 is_excluded 제외.
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
    if (r.ar1 == null) continue; // 발주처사정율 없는 불완전 건 제외 (자동수집 낙찰결과 등 — 기초금액·사정율 미수집)
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
  const maxBr1 = freqBr1.size ? Math.max(...freqBr1.values()) : 0; // 최빈 버킷 카운트 (강조 분모)
  const maxAr1 = freqAr1.size ? Math.max(...freqAr1.values()) : 0;
  return {
    rows,
    freqBr1, freqAr1,
    totalBr1, totalAr1,
    maxBr1, maxAr1,
    br1Stats: stat(nB, sB, sqB),
    ar1Stats: stat(nA, sA, sqA),
  };
}

// 전체 데이터 기준 br1/ar1 0.1% 버킷 빈도 — 엑셀(G2B)과 동일하게 강조를 "전역 빈도"로 산출.
// (검증: 글씨크기 vs 전체빈도 r=0.56 ≫ 발주사빈도 r=0.18). ar1 없는 불완전 건·is_excluded 제외.
// 빈도 기준 토글 '전체' 모드의 소스. br1Stats/ar1Stats(평균·σ)도 함께 반환(요약 패널용).
export function buildGlobalRateFreq(recs){
  const freqBr1 = new Map(), freqAr1 = new Map();
  let sB = 0, sqB = 0, nB = 0, sA = 0, sqA = 0, nA = 0;
  for (const r of (recs || [])){
    if (r.ar1 == null || r.is_excluded === true) continue;
    const bk = rateBucket(r.br1); if (bk != null){ freqBr1.set(bk, (freqBr1.get(bk) || 0) + 1); const v = Number(r.br1); sB += v; sqB += v * v; nB++; }
    const ak = rateBucket(r.ar1); if (ak != null){ freqAr1.set(ak, (freqAr1.get(ak) || 0) + 1); const v = Number(r.ar1); sA += v; sqA += v * v; nA++; }
  }
  const maxBr1 = freqBr1.size ? Math.max(...freqBr1.values()) : 0;
  const maxAr1 = freqAr1.size ? Math.max(...freqAr1.values()) : 0;
  return { freqBr1, freqAr1, maxBr1, maxAr1, br1Stats: stat(nB, sB, sqB), ar1Stats: stat(nA, sA, sqA) };
}

// 년도(od 앞 4자리)별 br1/ar1 0.1% 버킷 빈도 — 빈도 기준 토글 '년도별' 모드의 소스.
// 사용자 결정(2026-05-30): 년도별 강조 모집단 = 전체 발주처 + 같은 년도(발주처 무관).
// 반환: Map<year, { freqBr1, freqAr1, maxBr1, maxAr1, br1Stats, ar1Stats }>. ar1 없는 불완전 건·is_excluded·od 결측 제외.
export function buildYearRateFreq(recs){
  const acc = new Map(); // year -> 누적 상태
  for (const r of (recs || [])){
    if (r.ar1 == null || r.is_excluded === true) continue;
    const od = r.od ? String(r.od) : "";
    if (od.length < 4) continue;
    const y = od.slice(0, 4);
    let e = acc.get(y);
    if (!e){ e = { freqBr1: new Map(), freqAr1: new Map(), sB: 0, sqB: 0, nB: 0, sA: 0, sqA: 0, nA: 0 }; acc.set(y, e); }
    const bk = rateBucket(r.br1); if (bk != null){ e.freqBr1.set(bk, (e.freqBr1.get(bk) || 0) + 1); const v = Number(r.br1); e.sB += v; e.sqB += v * v; e.nB++; }
    const ak = rateBucket(r.ar1); if (ak != null){ e.freqAr1.set(ak, (e.freqAr1.get(ak) || 0) + 1); const v = Number(r.ar1); e.sA += v; e.sqA += v * v; e.nA++; }
  }
  const out = new Map();
  for (const [y, e] of acc){
    out.set(y, {
      freqBr1: e.freqBr1, freqAr1: e.freqAr1,
      maxBr1: e.freqBr1.size ? Math.max(...e.freqBr1.values()) : 0,
      maxAr1: e.freqAr1.size ? Math.max(...e.freqAr1.values()) : 0,
      br1Stats: stat(e.nB, e.sB, e.sqB), ar1Stats: stat(e.nA, e.sA, e.sqA),
    });
  }
  return out;
}

// 빈도맵 → 상위 N개 [value, count] (count desc).
export function topN(freqMap, n = 3){
  return [...freqMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}
