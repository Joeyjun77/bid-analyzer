// SUCVIEW 참여업체·투찰결과 행 파싱 — standalone(외부 import 0)이라 node 단위테스트 가능.
// utils.js parseSucview가 import해 사용. predConfidence.js / g2bFrequency.js와 동일 정책.

const toNum = (v) => { if (v == null || v === "") return 0; if (typeof v === "number") return v; return parseFloat(String(v).replace(/,/g, "").trim()) || 0; };
const cell = (rows, r, c) => String(rows[r]?.[c] ?? "").trim();

// 투찰결과 헤더(순위/등록번호) 첫 등장 행 인덱스. 없으면 -1.
export function findResultHeader(rows){
  for (let i = 15; i < Math.min(rows.length, 22); i++){
    if (String(rows[i]?.[0]).trim() === "순위" && String(rows[i]?.[1] || "").includes("등록번호")) return i;
  }
  return -1;
}

// 참여업체리스트 헤더(순위/등록번호 두 번째 등장) 행 인덱스. 없으면 -1.
export function findParticipantHeader(rows){
  for (let i = 20; i < Math.min(rows.length, 25); i++){
    if (String(rows[i]?.[0]).trim() === "순위" && String(rows[i]?.[1] || "").includes("등록번호")) return i;
  }
  return -1;
}

// 투찰결과 블록(자회사/나의업체/1순위)에서 나의업체·1순위 행을 라벨로 스캔.
// 절대 행번호(17/19) 하드코딩 버그 수정 — 자회사 행이 끼어도 정확히 매칭.
export function parseBidResultRows(rows){
  const out = { my_rank: null, my_bid_rate: null, my_adj_rate: null, win_bid_rate: null, win_adj_rate: null };
  const hdr = findResultHeader(rows);
  if (hdr < 0) return out;
  for (let i = hdr + 1; i < Math.min(rows.length, hdr + 8); i++){
    const label = cell(rows, i, 0);
    if (!label || label.includes("참 여") || label.includes("참여업체")) break; // 참여리스트 시작 → 종료
    const bidR = parseFloat(cell(rows, i, 8)), adjR = parseFloat(cell(rows, i, 11));
    if (label.includes("나의업체")){
      out.my_bid_rate = isNaN(bidR) ? null : bidR;
      out.my_adj_rate = isNaN(adjR) ? null : adjR;
      const m = label.match(/\(\s*(-?\d+)\s*\)/); if (m) out.my_rank = parseInt(m[1]);
    } else if (label.includes("1순위")){
      out.win_bid_rate = isNaN(bidR) ? null : bidR;
      out.win_adj_rate = isNaN(adjR) ? null : adjR;
    } // 자회사 행은 의도적으로 건너뜀
  }
  return out;
}

// 참여업체리스트 → participants[]. rank 숫자가 끊기면 종료.
// adj_rate = 업체별사정율(= 가정사정율) 100기준 절대값(col 10).
export function parseParticipants(rows){
  const start = findParticipantHeader(rows);
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < rows.length; i++){
    const rank = parseInt(String(rows[i]?.[0]));
    if (isNaN(rank)) break;
    const br = parseFloat(cell(rows, i, 8)), baseR = parseFloat(cell(rows, i, 9)), adj = parseFloat(cell(rows, i, 10));
    out.push({
      rank,
      co_no: cell(rows, i, 1),
      co_name: cell(rows, i, 3),
      rep: cell(rows, i, 5),
      bid_amount: toNum(cell(rows, i, 6)),
      bid_rate: isNaN(br) ? null : br,
      base_rate: isNaN(baseR) ? null : baseR,
      adj_rate: isNaN(adj) ? null : adj,
    });
  }
  return out;
}
