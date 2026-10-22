// 나라장터 공고 조회 쿼리 조립 — 순수 함수(node --test 가능).
// 배경(2026-10-22): 기존 조회가 order=od.asc&limit=1000이라 70k건 중 가장 오래된 1,000건만 가져와
// 공고 탭에 개찰 예정이 0건으로 표시됐다. 서버 필터: 개찰일 ≥ 지금 AND (지역제한 OR 자격 키워드).
export const NOTICE_REGIONS = ["경기"];
export const NOTICE_COLS = "id,pn,pn_no,ag,at,ep,ba,av,od,bid_close_dt,participated,status,is_target,prediction_id,api_fetched_at";

export function buildNoticesQuery(nowIso, regions = NOTICE_REGIONS, keywords = []) {
  const e = encodeURIComponent;
  const ors = [
    ...(regions || []).map(r => `reg.ilike.*${e(r)}*`),
    ...(keywords || []).flatMap(k => [`ag.ilike.*${e(k)}*`, `pn.ilike.*${e(k)}*`]),
  ];
  const orClause = ors.length ? `&or=(${ors.join(",")})` : "";
  return `/rest/v1/bid_notices?select=${NOTICE_COLS}&od=gte.${nowIso}${orClause}&order=od.asc&limit=1000`;
}
