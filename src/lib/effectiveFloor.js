// V2_DOMAIN_RULES_CHECK #1 — 자사 유효 낙찰하한율
// 산식: baseFloor + (20 - score) × 0.05%p (도메인 표준)
// score: 비가격 점수 합계 (0~20), 시공경험 5 + 경영상태 15
// baseFloor: eraFR()/getFloorRate() 반환값 (87.745 등 % 단위)
// at: 발주유형 (현재 산식은 at 무관, 향후 발주유형별 정밀화 여지)
export function calcEffectiveFloorRate(at, baseFloor, score = 20) {
  const base = Number(baseFloor);
  if (!Number.isFinite(base)) return baseFloor;
  const raw = Number(score);
  const s = Number.isFinite(raw) ? Math.max(0, Math.min(20, raw)) : 20;
  const shortfall = 20 - s;
  return base + shortfall * 0.05;
}

// 표준/자사 듀얼 표기 — score=20 시 표준만, 부족 시 화살표 표기
export function formatFloorDual(baseFloor, effFloor, decimals = 3) {
  const b = Number(baseFloor);
  if (!Number.isFinite(b)) return "-";
  const e = Number(effFloor);
  if (!Number.isFinite(e) || Math.abs(b - e) < 1e-6) return b.toFixed(decimals) + "%";
  return `${b.toFixed(decimals)}% → 자사 ${e.toFixed(decimals)}%`;
}
