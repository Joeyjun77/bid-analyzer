// 고양 집중(goyang-focus P4): 기관 마스터 기준 목록 필터와 표시용 라벨.
// 정의는 DB goyang_org_master(include=true) — 클라이언트는 goyang_ag_texts() 표기 목록만 받는다.

export const GOYANG_GRP_LABEL = {
  G1: "본청", G2: "구청", G3: "공사·재단", G4: "교육지원청", G5: "학교",
};

// 예측 목록에서 고양 기관 행만 남긴다. 행 객체는 그대로 돌려줘 카드 계산값이 바뀌지 않는다.
export function filterGoyang(list, agTexts) {
  if (!agTexts || !agTexts.size) return list;
  return list.filter((x) => agTexts.has((x.ag || "").trim()));
}

// 추첨 번호 1~15 균등 기댓값: 공고마다 4개 추첨
export const drawExpected = (nSets) => (nSets * 4) / 15;
