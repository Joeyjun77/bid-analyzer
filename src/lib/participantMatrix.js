// 참여업체 사정율 분포 매트릭스 — get_participant_distribution RPC JSON → 공유축 매트릭스 구조 순수 변환.
// standalone(import 체인 없음) → node 단위테스트 가능. g2bFrequency.js / predConfidence.js 와 동일 정책.
//
// 입력 dist = { ag, bucket(=p_bucket), columns:[{pn_no,od,pn,n,win_rate}], cells:[{pn_no,bucket,cnt,is_win}] }.
// 세로축 = 사정율 버킷(내림차순, 데이터 있는 버킷만), 가로축 = 최근 N건(od desc, RPC 순서 유지).

// 버킷 라벨 자리수 — p_bucket 그래뉼래러티에 맞춤. 0.1→1, 0.05·0.01→2, 0.001→3, 0.0001→4.
export function bucketDecimals(pBucket){
  const b = Number(pBucket) || 0.01;
  if (b >= 0.1) return 1;
  if (b >= 0.01) return 2;
  if (b >= 0.001) return 3;
  return 4;
}

// 사정율 → 버킷(절삭). Postgres floor(adj/p)*p 와 동일.
// 정수 스케일(1e4)로 절삭 — adj·p 모두 ≤4자리라 부동소수 오차 없이 RPC numeric 결과와 정확히 일치.
// (0.0001 단위에서 Math.floor(adj/p)*p 직접 계산은 998611→998610 류 오차로 셀-오버레이 버킷이 어긋남)
export function cellBucket(adj, pBucket){
  if (adj == null || !isFinite(Number(adj))) return null;
  const p = Number(pBucket) || 0.01;
  const scale = 1e4;
  const pi = Math.round(p * scale);
  if (pi <= 0) return null;
  const ai = Math.round(Number(adj) * scale);
  const bi = Math.floor(ai / pi) * pi;
  return Number((bi / scale).toFixed(4));
}

// 버킷 키 정규화(부동소수 중복 방지) — 4자리 문자열.
const bkey = (b) => Number(b).toFixed(4);

// 셀 카운트 → 강조 단계 0(최강)~7(약). 컬럼별 최대값 대비 비율로 산출(컬럼마다 참여수 규모가 달라
// 자기정규화해야 각 건의 최빈대가 드러남). INTENSITY_STYLE(g2bFrequency) 인덱스와 1:1.
export const MATRIX_RATIO_THRESHOLDS = [0.85, 0.65, 0.45, 0.30, 0.18, 0.10, 0.04];
export function matrixLevel(cnt, colMax){
  if (!cnt || !colMax) return 7;
  const ratio = cnt / colMax;
  const t = MATRIX_RATIO_THRESHOLDS;
  for (let i = 0; i < t.length; i++){ if (ratio >= t[i]) return i; }
  return 7;
}

// dist JSON → 매트릭스 구조. 셀 조회·강조·★·참여합·경쟁사 하이라이트의 단일 소스.
export function buildMatrix(dist){
  const pBucket = Number(dist && dist.bucket) || 0.01;
  const columns = Array.isArray(dist && dist.columns) ? dist.columns : [];
  const cells = Array.isArray(dist && dist.cells) ? dist.cells : [];

  const cellOf = new Map();      // `${pn_no}|${bkey}` -> { cnt, is_win }
  const colMax = new Map();      // pn_no -> 최대 셀 카운트 (강조 분모)
  const colTotal = new Map();    // pn_no -> 셀 합(참여합)
  const winBucketKey = new Map();// pn_no -> ★ 버킷 키(is_win 셀)
  const bucketSet = new Map();   // bkey -> numeric (데이터 있는 버킷 union)
  const bucketTotal = new Map(); // bkey -> 전 컬럼 합(세밀 버킷 과다 시 밀집 상위 선별용)

  for (const c of cells){
    if (!c || c.pn_no == null || c.bucket == null) continue;
    const b = Number(c.bucket);
    const k = bkey(b);
    const cnt = Number(c.cnt) || 0;
    cellOf.set(c.pn_no + "|" + k, { cnt, is_win: !!c.is_win });
    bucketSet.set(k, b);
    bucketTotal.set(k, (bucketTotal.get(k) || 0) + cnt);
    colMax.set(c.pn_no, Math.max(colMax.get(c.pn_no) || 0, cnt));
    colTotal.set(c.pn_no, (colTotal.get(c.pn_no) || 0) + cnt);
    if (c.is_win) winBucketKey.set(c.pn_no, k);
  }

  // 버킷 세로축 — 내림차순(높은 사정율 위), 데이터 있는 것만.
  const buckets = [...bucketSet.values()].sort((a, b) => b - a);

  return {
    pBucket,
    decimals: bucketDecimals(pBucket),
    columns,                       // [{pn_no,od,pn,n,win_rate}] (od desc)
    buckets,                       // [number] desc
    bkey,
    cell: (pnNo, bucket) => cellOf.get(pnNo + "|" + bkey(bucket)) || null,
    colMax: (pnNo) => colMax.get(pnNo) || 0,
    colTotal: (pnNo) => colTotal.get(pnNo) || 0,
    bucketTotalOf: (bucket) => bucketTotal.get(bkey(bucket)) || 0,
    winBucketKey: (pnNo) => winBucketKey.get(pnNo) || null,
    isWinCell: (pnNo, bucket) => winBucketKey.get(pnNo) === bkey(bucket),
  };
}

// 경쟁사 trace([{pn_no,adj_rate,...}]) → pn_no -> { adj_rate, bucketKey } 맵 (셀 하이라이트·추이용).
export function buildCompanyOverlay(trace, pBucket){
  const m = new Map();
  for (const t of (trace || [])){
    if (!t || t.pn_no == null || t.adj_rate == null) continue;
    const adj = Number(t.adj_rate);
    const b = cellBucket(adj, pBucket);
    m.set(t.pn_no, { adj_rate: adj, bucketKey: b == null ? null : bkey(b) });
  }
  return m;
}
