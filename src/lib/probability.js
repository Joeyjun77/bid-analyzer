// ============================================================
// src/lib/probability.js — Phase 6-A 경쟁 강도 지표 (v4 경험적)
// ============================================================
// 철학: 복잡한 확률 계산 대신, 과거 유사 공고의 낙찰자 분포에서
// 자사 투찰금액의 위치를 직접 측정하여 추천 등급 부여
//
// v4 백테스트 결과 (140건):
// - strong_bid (67건) 낙찰률 9.0%
// - bid        (23건) 낙찰률 17.4% 🏆
// - caution    (23건) 낙찰률 0%  ✅ 완벽 필터
// - skip       (23건) 낙찰률 0%  ✅ 완벽 필터
//
// 전체 전략:
// 현재 (전체 투찰): 140건 → 낙찰 11건 (7.9%)
// 필터링 후:       90건 → 낙찰 10건 (11.1%)  <- 권장
// 집중 전략:       23건 → 낙찰 4건 (17.4%)

import { SB_URL, SB_KEY, getHdrs } from "./constants.js";

// ─── 경쟁 강도 계산 (DB 함수 호출) ──────────────────
export async function calcCompetitiveIntensity(pred) {
  if (!pred || !pred.ba || pred.opt_adj == null || !pred.pred_floor_rate) {
    return null;
  }
  
  const { ba, at, pred_floor_rate: fr, opt_adj } = pred;
  const av = pred.av || 0;
  
  // 투찰금액 계산 (공격 전략: opt_adj 그대로)
  const frRatio = fr / 100;
  const xp = ba * (1 + opt_adj / 100);
  const sysBid = av > 0 
    ? Math.ceil(av + (xp - av) * frRatio)
    : Math.ceil(xp * frRatio);
  
  // 기초금액 대비 투찰률 (모델 입력)
  const myBr = (sysBid / ba) * 100;
  
  // DB 함수 호출
  const url = `${SB_URL}/rest/v1/rpc/calc_competitive_intensity_v4`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...getHdrs() },
    body: JSON.stringify({
      p_at: at,
      p_ba: ba,
      p_my_br: myBr,
      p_fr: fr,
      p_days: 180
    })
  });
  
  if (!res.ok) return null;
  const data = await res.json();
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return null;
  
  return {
    sampleCount: parseInt(row.sample_count) || 0,
    expectedPc: parseFloat(row.expected_pc) || 0,
    winCount: parseInt(row.win_count) || 0,
    winRate: parseFloat(row.win_rate) || 0,
    brP10: parseFloat(row.br_p10),
    brP25: parseFloat(row.br_p25),
    brP50: parseFloat(row.br_p50),
    brP75: parseFloat(row.br_p75),
    myBr: myBr,
    myBidAmount: sysBid,
    myBrInZone: row.my_br_in_zone,
    recommendation: row.recommendation,
    confidence: row.confidence,
    label: getRecommendationLabel(row.recommendation),
    color: getRecommendationColor(row.recommendation),
    description: getRecommendationDescription(row.recommendation, row.confidence, row.sample_count, row.win_rate),
  };
}

// ─── 추천 라벨/색상/설명 ────────────────────────────
function getRecommendationLabel(rec) {
  switch (rec) {
    case "strong_bid": return "🔥 적극 투찰";
    case "bid":         return "✅ 투찰";
    case "caution":     return "⚠️ 재검토";
    case "skip":        return "❌ 스킵";
    case "insufficient_data": return "❓ 데이터 부족";
    default: return "";
  }
}

function getRecommendationColor(rec) {
  switch (rec) {
    case "strong_bid": return "#5dca96";
    case "bid":         return "#85b7eb";
    case "caution":     return "#d4a834";
    case "skip":        return "#e24b4a";
    case "insufficient_data": return "#a0a0b8";
    default: return "#a0a0b8";
  }
}

function getRecommendationDescription(rec, conf, sc, wr) {
  const confText = conf === "high" ? "높은 신뢰도" : conf === "medium" ? "중간 신뢰도" : "낮은 신뢰도";
  switch (rec) {
    case "strong_bid":
      return `유사 공고 ${sc}건 중 ${wr}% 승률. 공격적 투찰 권장. (${confText})`;
    case "bid":
      return `유사 공고 ${sc}건 중 ${wr}% 승률. 투찰 적정. (${confText})`;
    case "caution":
      return `유사 공고 ${sc}건 중 ${wr}% 승률. 낙찰 가능성 낮음, 재검토 필요. (${confText})`;
    case "skip":
      return `유사 공고 ${sc}건에서 자사 투찰 수준으로 낙찰 거의 불가. 스킵 권장. (${confText})`;
    case "insufficient_data":
      return `유사 공고 샘플 ${sc}건 부족. 신중히 판단 필요.`;
    default: return "";
  }
}

// ─── 여러 공고 일괄 처리 ────────────────────────────
export async function enrichPredictionsWithIntensity(preds, onProgress) {
  const results = [];
  for (let i = 0; i < preds.length; i++) {
    try {
      const intensity = await calcCompetitiveIntensity(preds[i]);
      results.push({ ...preds[i], intensity });
    } catch (e) {
      results.push({ ...preds[i], intensity: null });
    }
    if (onProgress) onProgress(i + 1, preds.length);
  }
  return results;
}

// ─── DB 저장 ────────────────────────────────────────
export async function saveIntensity(predictionId, intensity) {
  if (!intensity) return null;
  
  const row = {
    prediction_id: predictionId,
    xp_mean: null,
    xp_std: null,
    expected_participants: Math.round(intensity.expectedPc),
    similar_bids_count: intensity.sampleCount,
    winner_br_median: intensity.brP50,
    winner_br_std: null,
    aggressive_adj: null,
    aggressive_bid: intensity.myBidAmount,
    aggressive_p_valid: null,
    aggressive_p_win: intensity.winRate / 100,
    aggressive_expected_profit: Math.round(intensity.myBidAmount * 0.08 * intensity.winRate / 100),
    default_adj: null,
    default_bid: null,
    default_p_valid: null,
    default_p_win: null,
    default_expected_profit: null,
    safe_adj: null,
    safe_bid: null,
    safe_p_valid: null,
    safe_p_win: null,
    safe_expected_profit: null,
    recommended_strategy: intensity.recommendation,
    skip_recommendation: intensity.recommendation === "skip" || intensity.recommendation === "caution",
    skip_reason: intensity.recommendation === "skip" 
      ? "유사 공고 승률 5% 미만"
      : intensity.recommendation === "caution" 
        ? "유사 공고 승률 15% 미만"
        : null,
    model_version: "v4_empirical",
  };
  
  const res = await fetch(
    `${SB_URL}/rest/v1/bid_win_probability?on_conflict=prediction_id`,
    {
      method: "POST",
      headers: {
        ...hdrs,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(row),
    }
  );
  
  return res.ok;
}

// ─── 조회 ──────────────────────────────────────────
export async function fetchIntensity(predictionId) {
  const res = await fetch(
    `${SB_URL}/rest/v1/bid_win_probability?prediction_id=eq.${predictionId}&select=*`,
    { headers: hdrs }
  );
  const data = await res.json();
  return Array.isArray(data) && data.length > 0 ? data[0] : null;
}
