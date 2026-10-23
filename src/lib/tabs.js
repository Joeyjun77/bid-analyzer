// 탭 구성 — 스펙 docs/superpowers/specs/2026-10-22-bid-ops-funnel-redesign-design.md §6.1 + 사용자 결정(2026-10-23):
// 예측 기록·G2B 양식은 상단 유지, 분석·AI 상담은 보조, 대시보드·V2 미리보기 삭제.
export const TOP_TABS = [
  { id: "notices", ch: "오늘의 공고" },
  { id: "predict", ch: "예측 기록" },
  { id: "performance", ch: "성과" },
  { id: "g2b_sheet", ch: "G2B 양식" },
  { id: "data", ch: "데이터" },
];

export const SUB_TABS = [
  { id: "analysis", ch: "📊 분석" },
  { id: "chat", ch: "💬 AI 상담" },
  { id: "feedback", ch: "📈 피드백" },
  { id: "quality", ch: "🔬 검증" },
  { id: "agency_predict_v6", ch: "💎 발주처 예측 V6" },
  { id: "agency_floor", ch: "🎯 발주사 하한" },
];

export const DEFAULT_TAB = "notices";

// 공식 추천은 오늘의 공고·투찰 카드뿐 — 다른 엔진 화면에는 참고용임을 밝힌다(스펙 §6.1 공식 추천 단일화)
export const REF_ONLY_TABS = new Set(["agency_predict_v6", "agency_floor", "chat"]);
export const REF_ONLY_BANNER = "참고용 — 공식 추천 아님 (공식 추천은 오늘의 공고·투찰 카드)";
