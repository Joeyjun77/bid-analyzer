// V2_DOMAIN_RULES_CHECK #1 — 자사 유효 낙찰하한율
// 산식: baseFloor + (20 - score) × 0.05%p (도메인 표준)
// score: 비가격 점수 합계 (0~20), 시공경험 5 + 경영상태 15
// baseFloor: eraFR()/getFloorRate() 반환값 (87.745 등 % 단위)
// at: 발주유형 (현재 산식은 at 무관, 향후 발주유형별 정밀화 여지)
export function calcEffectiveFloorRate(at, baseFloor, score = 20) {
  const base = Number(baseFloor);
  if (!Number.isFinite(base)) return baseFloor;
  const shortfall = 20 - parseOwnScore(score, 20);
  return base + shortfall * 0.05;
}

// 자사 비가격 점수 해석 (0~20 정수). 값이 없거나(null·빈칸) 음수·비수치면 fallback.
// Number(null)·Number('')는 0이라 "값 없음"이 0점(하한율 +1.0%p)으로 계산된다 —
// 2026-05-20~10-12 localStorage 키 부재로 업로드 예측 788건이 0점 처리된 결함의 재발 방지.
export function parseOwnScore(raw, fallback) {
  if (raw == null || (typeof raw === "string" && raw.trim() === "")) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(20, Math.round(n));
}

// 표준/자사 듀얼 표기 — score=20 시 표준만, 부족 시 화살표 표기
export function formatFloorDual(baseFloor, effFloor, decimals = 3) {
  const b = Number(baseFloor);
  if (!Number.isFinite(b)) return "-";
  const e = Number(effFloor);
  if (!Number.isFinite(e) || Math.abs(b - e) < 1e-6) return b.toFixed(decimals) + "%";
  return `${b.toFixed(decimals)}% → 자사 ${e.toFixed(decimals)}%`;
}
