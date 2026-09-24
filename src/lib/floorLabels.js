// 실격위험% ↔ 하한통과% 표기 쌍. 순수 함수 — Vite/DB 의존 없음(node 테스트 가능).
// floorRisk.js는 auth.js를 import해 node에서 로드할 수 없으므로 표기 로직을 여기 분리한다.
// 불변식: 같은 riskPct에 대해 riskLabel과 floorPassLabel의 숫자 합은 정확히 100.
//   → 통과%는 실격위험을 riskLabel과 같은 자릿수로 먼저 반올림한 뒤 100에서 뺀다.
// 입력 riskPct = floorRiskPct() 결과(0.5~97.5 클램프) 또는 null.

export function riskLabel(risk) {
  if (risk == null) return "—";
  if (risk >= 95) return "≥95%";
  if (risk < 1) return "<1%";
  return risk.toFixed(risk < 10 ? 1 : 0) + "%";
}

export function floorPassPct(risk) {
  if (risk == null || !isFinite(Number(risk))) return null;
  return 100 - Number(risk);
}

export function floorPassLabel(risk) {
  if (risk == null || !isFinite(Number(risk))) return "—";
  const r = Number(risk);
  if (r >= 95) return "≤5%";
  if (r < 1) return ">99%";
  const d = r < 10 ? 1 : 0;
  return (100 - Number(r.toFixed(d))).toFixed(d) + "%";
}
