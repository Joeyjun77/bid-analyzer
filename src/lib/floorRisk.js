// Mode 분기·실격위험 색상 등 표시 보조 (표시 전용 — Evaluator)
// 실격위험%·하한 통과 확률·안전투찰선의 계산은 passProb.js로 옮겼다(2026-10, 과거 발주처 사정율 기록 기반).
// 이전 방식(floor_rate_distribution 금액대별 하한 분포 조회·보간)은 3억 이상의 57%에서 표본 부족으로 표시되지 않아 제거.
// DB 테이블 floor_rate_distribution과 일배치(m38/m50)는 남아 있으나 화면에서는 쓰지 않는다.
// 문구 규정: 안전투찰선은 "탈락 회피 하한선" — 추천 투찰가 아님 (상향 투찰 유도 금지, 추첨 천장)

export function floorBaSeg(ba) {
  const b = Number(ba);
  if (!isFinite(b) || b <= 0) return null;
  if (b < 1e8) return "S1";
  if (b < 3e8) return "S2";
  if (b < 1e9) return "S3";
  if (b < 3e9) return "S4";
  return "S5";
}

// 모드 분기 (V2 규칙: 군시설=A WIN-zone 노림, 그 외=B 하한 안착)
export function floorModeOf(at) {
  return at === "군시설" ? "A" : "B";
}

export function riskColor(risk) {
  if (risk == null) return null;
  if (risk >= 25) return "#e24b4a";
  if (risk >= 10) return "#d4a834";
  return "#5dca96";
}

// 표기 쌍(실격위험↔하한통과)은 floorLabels.js 단일 정의 — 합=100 불변식이 node 테스트로 고정됨
export { riskLabel } from "./floorLabels.js";
