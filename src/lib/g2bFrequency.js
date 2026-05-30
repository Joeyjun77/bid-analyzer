// G2B 양식 탭 — 발주처별 사정율(1위사정율 br1·발주처사정율 ar1) 재현 빈도 순수 계산 모듈.
// standalone(import.meta.env 체인 없음) → node 단위테스트 가능. predConfidence.js와 동일 정책.

// 금액대 세그먼트 — utils.js getBiasArrow와 동일 경계.
export function baSegment(ba){
  const n = Number(ba) || 0;
  return n < 1e8 ? 'S1' : n < 3e8 ? 'S2' : n < 1e9 ? 'S3' : n < 3e9 ? 'S4' : 'S5';
}

// 사정율 동일조건 키 — 소수점 d자리(기본 4)까지 동일하면 같은 값으로 간주. 절삭(반올림 아님)이라 화면 표기(fmtRateTrunc)와 키가 일치.
// d는 사용자가 2·3·4로 선택(2026-05-30): 자리수가 작아질수록 더 많은 낙찰이 "동일 사정율"로 묶임. 저장 정밀도 4자리 기준으로 잘라냄.
export function rateBucket(v, d = 4){
  if (v == null || !isFinite(Number(v))) return null;
  const s = Number(v).toFixed(4);
  if (d >= 4) return s;
  const dot = s.indexOf(".");
  return s.slice(0, dot + 1 + d);
}

// 동일조건 일치 횟수(count) → 강조 단계 인덱스 0(최강)~7(약). thresholds=내림차순 경계(count>=t[i] → i).
// count 0/없음은 최하(7). 그 외는 (자리수·기준)별 임계값으로 단계 결정 — 보통 1회(단발)는 thresholds가 회색(5~7)으로 보냄.
export function intensityLevel(count, thresholds){
  if (!count) return 7;
  const t = thresholds || COUNT_THRESHOLDS[4].all;
  for (let i = 0; i < t.length; i++){ if (count >= t[i]) return i; }
  return 7;
}

// (표기 자리수 d) × (기준)별 동일조건 일치 횟수 임계값 (단계 경계, 내림차순). 단계 7 = 마지막 경계 미만.
// 자리수가 작을수록 더 많이 묶여 카운트가 커지므로 자리수별로 분리. 2026-05-30 실측(절삭 그룹크기):
//   d=2 전체 max312·p90 212 / 년도 max41·p90 22 / 발주사 max30·p99 8 / 발주처×년도 max9·p99 3
//   d=3 전체 max48·p90 26  / 년도 max9·p99 6   / 발주사 max8·p99 3   / 발주처×년도 max4·p99 2
//   d=4 전체 max14·p90 4   / 년도 max5·p99 2   / 발주사 max5·p99 2   / 발주처×년도 max4·p99 1
// 데이터 누적에 따라 튜닝 가능한 단일 소스. (자리수가 작을수록 강조가 풍부, 4자리는 정확 반복만 부각)
export const COUNT_THRESHOLDS = {
  2: { all: [240, 160, 90, 35, 14, 6, 3], year: [33, 26, 18, 11, 6, 4, 2], agency: [16, 10, 6, 4, 3, 2, 1], yearAg: [7, 5, 3, 2] },
  3: { all: [36, 28, 20, 12, 7, 4, 2],    year: [9, 7, 5, 4, 3, 2],        agency: [7, 5, 3, 2],            yearAg: [4, 3, 2] },
  4: { all: [12, 9, 7, 5, 4, 3, 2],       year: [5, 4, 3, 2],              agency: [5, 4, 3, 2],            yearAg: [4, 3, 2] },
};

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
  const { agencyKey, cat = null, era = null, seg = null, decimals = 4 } = opts || {};
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
    const bk = rateBucket(r.br1, decimals);
    if (bk != null){
      freqBr1.set(bk, (freqBr1.get(bk) || 0) + 1);
      const v = Number(r.br1); sB += v; sqB += v * v; nB++;
    }
    const ak = rateBucket(r.ar1, decimals);
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
export function buildGlobalRateFreq(recs, decimals = 4){
  const freqBr1 = new Map(), freqAr1 = new Map();
  let sB = 0, sqB = 0, nB = 0, sA = 0, sqA = 0, nA = 0;
  for (const r of (recs || [])){
    if (r.ar1 == null || r.is_excluded === true) continue;
    const bk = rateBucket(r.br1, decimals); if (bk != null){ freqBr1.set(bk, (freqBr1.get(bk) || 0) + 1); const v = Number(r.br1); sB += v; sqB += v * v; nB++; }
    const ak = rateBucket(r.ar1, decimals); if (ak != null){ freqAr1.set(ak, (freqAr1.get(ak) || 0) + 1); const v = Number(r.ar1); sA += v; sqA += v * v; nA++; }
  }
  const maxBr1 = freqBr1.size ? Math.max(...freqBr1.values()) : 0;
  const maxAr1 = freqAr1.size ? Math.max(...freqAr1.values()) : 0;
  return { freqBr1, freqAr1, maxBr1, maxAr1, br1Stats: stat(nB, sB, sqB), ar1Stats: stat(nA, sA, sqA) };
}

// 년도(od 앞 4자리)별 br1/ar1 0.1% 버킷 빈도 — 빈도 기준 토글 '년도별' 모드의 소스.
// 사용자 결정(2026-05-30): 년도별 강조 모집단 = 전체 발주처 + 같은 년도(발주처 무관).
// 반환: Map<year, { freqBr1, freqAr1, maxBr1, maxAr1, br1Stats, ar1Stats }>. ar1 없는 불완전 건·is_excluded·od 결측 제외.
export function buildYearRateFreq(recs, decimals = 4){
  const acc = new Map(); // year -> 누적 상태
  for (const r of (recs || [])){
    if (r.ar1 == null || r.is_excluded === true) continue;
    const od = r.od ? String(r.od) : "";
    if (od.length < 4) continue;
    const y = od.slice(0, 4);
    let e = acc.get(y);
    if (!e){ e = { freqBr1: new Map(), freqAr1: new Map(), sB: 0, sqB: 0, nB: 0, sA: 0, sqA: 0, nA: 0 }; acc.set(y, e); }
    const bk = rateBucket(r.br1, decimals); if (bk != null){ e.freqBr1.set(bk, (e.freqBr1.get(bk) || 0) + 1); const v = Number(r.br1); e.sB += v; e.sqB += v * v; e.nB++; }
    const ak = rateBucket(r.ar1, decimals); if (ak != null){ e.freqAr1.set(ak, (e.freqAr1.get(ak) || 0) + 1); const v = Number(r.ar1); e.sA += v; e.sqA += v * v; e.nA++; }
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

// 완전중복(공고번호|개찰일|기초|낙찰가 동일) 제거 — DB 정리 후에도 화면 안전망. 키당 최소 id 1건만 유지, 원본 순서 보존.
// 키는 toRecord dedup_key 공식과 동일 의미(pn_no 없으면 공고명 fallback). 다중차수(같은 pn_no·다른 ba/bp)는 보존.
export function dedupExactRecords(recs){
  const arr = recs || [];
  const keyOf = (r) => (r.pn_no || r.pn || "") + "|" + (r.od || "") + "|" + (r.ba != null ? r.ba : "") + "|" + (r.bp != null ? r.bp : "");
  const best = new Map(); // key -> 최소 id
  for (const r of arr){
    const k = keyOf(r), prev = best.get(k);
    if (prev == null || (r.id || 0) < prev) best.set(k, (r.id || 0));
  }
  const keep = new Set([...best.values()]);
  return arr.filter(r => keep.has(r.id || 0));
}
