// src/lib/constants-tables.js
// 도메인 지식 상수 테이블 모음 — 엔진 코드(utils.js)와 분리해 리뷰·수정 용이.
// 수치는 모두 백테스트·실측 검증을 거쳐 고정된 값이며, 변경 시 Phase 23-3
// Generator/Evaluator 규칙에 따라 /evaluate 회귀 검증 필요.

// ─── Phase 17-A: 1위 목표 투찰금 보정 gap ──────────────────
// 근거: bid_details 315건 자사 입찰 분석 — 자사 투찰률이 1위보다 기관유형별
// 중앙값만큼 높음. bid1st = opt_bid × fr / (fr + gap) 로 1위 수준 하향.
// 2026-04-28: 군시설 0.150 → 0.25 (60일 n=40 aggressive Top-1 hit=0% 해소 목적,
// /accuracy 체크8 결과. opt_adj 산출과 무관하므로 핵심 영역 MAE/bias 무영향).
// 2026-05-10: 군시설 0.25 → 0.05 (방향 오류 수정).
// bid_details 180일 n=179 실측 my_adj-win_adj p50=+0.0141, avg=-0.0599
// (자사가 1위보다 평균 0.06%p '낮음' — 한전 +0.23과 정반대 분포).
// 0.25 적용 시 추천이 1위보다 -0.35 아래로 과도하게 내려가 hit 3.28% 회귀.
// 0.05로 축소하여 180일 중앙값 근접 + 양수 유지(보수). predict-architect Neutral 분류.
//
// 2026-05-22 A Step 1 한정판 (WIN_OPT_GAP 동적화 1차):
// — 설계 문서: docs/v2/A_WIN_OPT_GAP_DESIGN_2026-05-22.md
// — predict-architect 재검토 commit `0c3a3ff` + 본 작업 시점 재호출 PASS
// — 코덱스 §9 검증 반영 (CODEX_R16_PRE_FOLLOWUP_2026-05-22.md §4.1)
//
// 산식 가정 (자사 사정률 > 1위)이 at별로 다름 — `my_adj - win_adj` 180일 분포:
//   한전 pct_above 68.4% / LH 80.0%   → 산식 성립, LOCK
//   지자체 48.7% / 군시설 50.0%       → 대칭, 단일 상수 부적합 → 0 clamp
//   교육청 전체 n=186 p50=-0.155       → 음수 일관 → 0 clamp (conservative)
//
// !! 한전 0.367 LOCK 미적용 시 60일 hit01 72.7% 회귀 가능. 변경 금지 !!
// !! 지자체/교육청/군시설 0 적용은 conservative 정책 (코덱스 §9.2). !!
// !! 군시설 hit 5~15% 한계는 산식 자체 결함 — V2 Mode A 결합 필요 (Step 3).
export const WIN_OPT_GAP={
  "지자체":    0,      // 2026-05-22 0.493→0: n=238 p50=-0.068, pct_above 47.1% 대칭
  "군시설":    0,      // 2026-05-22 0.05→0:  n=81  p50≈0,      pct_above 50.0% 완전대칭 (V2 Mode A 필요)
  "교육청":    0,      // 2026-05-22 0.533→0: n=186 p50=-0.155, pct_above 39.8% 음수일관 → conservative 0
  "한전":      0.367,  // LOCK (2026-05-22): 60일 hit01=10.3%/hit02=27.6%, pct_above 68.4%
  "조달청":    0.676,  // 유지: n=20 부족 (코덱스 §9.1 정정 — 보류)
  "LH":        0.088,  // LOCK (2026-05-22): pct_above 80.0%, n=11 부족하나 lock 안전
  "수자원공사": 0.003,  // 유지: n 부족
};

// ─── 낙찰하한율 (2026 기관별 개정 반영) ──────────────────────
// 구기준 vs 신기준. 시행일은 기관별 상이 (cutoff 필드 참조).
// 한전: ~2026-02-09까지 old(~88%), 2026-02-10 개정으로 new(~90%)로 상승 — bid_records floor_price 역산 검증.
// (이전 "87.745% 유지" 주석은 stale: 2026-Q2 실측 floorErr +1.85%p로 신규율 누락 확인, 2026-06-05 정정.)
export const RATE_TABLE={
  "조달청":{cutoff:"2026-01-30",
    old:[{min:5e9,max:1e11,rate:85.495},{min:1e9,max:5e9,rate:86.745},{min:3e8,max:1e9,rate:87.745},{min:0,max:3e8,rate:88.25}],
    new:[{min:5e9,max:1e11,rate:87.495},{min:1e9,max:5e9,rate:88.745},{min:3e8,max:1e9,rate:89.745},{min:0,max:3e8,rate:90.25}]},
  "지자체":{cutoff:"2025-07-01",
    old:[{min:1e10,max:3e11,rate:79.995},{min:5e9,max:1e10,rate:85.495},{min:3e9,max:5e9,rate:86.745},{min:1e9,max:3e9,rate:86.745},{min:4e8,max:1e9,rate:87.745},{min:3e8,max:4e8,rate:87.745},{min:0,max:3e8,rate:88.25}],
    new:[{min:1e10,max:3e11,rate:81.995},{min:5e9,max:1e10,rate:87.495},{min:3e9,max:5e9,rate:88.745},{min:1e9,max:3e9,rate:88.745},{min:4e8,max:1e9,rate:89.745},{min:3e8,max:4e8,rate:89.745},{min:0,max:3e8,rate:90.25}]},
  "교육청":{cutoff:"2025-07-01",
    old:[{min:5e9,max:1e11,rate:85.495},{min:3e9,max:5e9,rate:86.745},{min:1e9,max:3e9,rate:86.745},{min:4e8,max:1e9,rate:87.745},{min:3e8,max:4e8,rate:87.745},{min:0,max:3e8,rate:88.25}],
    new:[{min:5e9,max:1e11,rate:87.495},{min:3e9,max:5e9,rate:88.745},{min:1e9,max:3e9,rate:88.745},{min:4e8,max:1e9,rate:89.745},{min:3e8,max:4e8,rate:89.745},{min:0,max:3e8,rate:90.25}]},
  "한전":{cutoff:"2026-02-10",
    old:[{min:5e9,max:1e11,rate:85.495},{min:1e9,max:5e9,rate:86.745},{min:3e8,max:1e9,rate:87.745},{min:0,max:3e8,rate:88.25}],
    new:[{min:5e9,max:1e11,rate:87.495},{min:1e9,max:5e9,rate:88.745},{min:3e8,max:1e9,rate:89.745},{min:0,max:3e8,rate:90.25}]},
  "LH":{cutoff:"2026-02-01",
    old:[{min:5e9,max:1e11,rate:85.495},{min:1e9,max:5e9,rate:86.745},{min:3e8,max:1e9,rate:87.745},{min:0,max:3e8,rate:88.25}],
    new:[{min:5e9,max:1e11,rate:87.495},{min:1e9,max:5e9,rate:88.745},{min:3e8,max:1e9,rate:89.745},{min:0,max:3e8,rate:90.25}]},
  "군시설":{cutoff:"2026-01-19",
    old:[{min:5e9,max:1e11,rate:83.495},{min:1e9,max:5e9,rate:84.745},{min:3e8,max:1e9,rate:85.745},{min:0,max:3e8,rate:86.25}],
    new:[{min:5e9,max:1e11,rate:87.495},{min:1e9,max:5e9,rate:88.745},{min:3e8,max:1e9,rate:89.745},{min:0,max:3e8,rate:90.25}]},
  "수자원공사":{cutoff:"2026-02-27",
    old:[{min:5e9,max:1e11,rate:85.495},{min:1e9,max:5e9,rate:86.745},{min:3e8,max:1e9,rate:87.745},{min:0,max:3e8,rate:88.25}],
    new:[{min:5e9,max:1e11,rate:87.495},{min:1e9,max:5e9,rate:88.745},{min:3e8,max:1e9,rate:89.745},{min:0,max:3e8,rate:90.25}]}
};

// ─── Phase 12-F: 기관유형별 고정 오프셋 (legacy) ────────────
// 근거: 1,091건 백테스트. 교육청은 Phase 21에서 -0.20 → -0.45로 재조정.
// predictV5의 최종 공식: optAdj = ref.med + TYPE_OFF[at] + agencyOff
// 2026-04-28: 지자체 -0.15 → -0.10 (60일 n=145 actual−pred 분포 +0.166,
// bias -0.171 → -0.121 개선 목적, /accuracy 체크3·8 결과).
export const TYPE_OFF={
  "지자체":   -0.10,
  "군시설":    0.0,
  "교육청":   -0.45,
  "한전":      0.10,
  "LH":       -0.10,
  "조달청":   -0.10,
  "수자원공사":-0.10
};

// ─── 가정 사정률 p25/p50/p75 (recommendAssumedAdj) ──────────
// V5.1: ag_assumed_stats 4,456건 가중평균 교정 (2026-04-06)
// under300M / over300M 2구간 — 실전 낙찰 가능성 약 2배 향상.
export const ASSUMED_ADJ_TABLE={
  "지자체":  {under300M:{p25:-0.22,p50:0.37,p75:1.07},over300M:{p25:0.00,p50:0.53,p75:1.05}},
  "교육청":  {under300M:{p25:0.03,p50:0.57,p75:1.19},over300M:{p25:0.21,p50:0.68,p75:1.19}},
  "군시설":  {under300M:{p25:-0.10,p50:0.45,p75:0.85},over300M:{p25:0.59,p50:1.00,p75:1.38}},
  "한전":    {under300M:{p25:0.26,p50:0.67,p75:1.07},over300M:{p25:0.35,p50:0.83,p75:1.12}},
  "조달청":  {under300M:{p25:-1.42,p50:-0.21,p75:0.66},over300M:{p25:0.58,p50:1.29,p75:2.47}},
  "LH":     {under300M:{p25:0.08,p50:0.40,p75:1.01},over300M:{p25:1.09,p50:1.56,p75:2.67}},
  "수자원공사":{under300M:{p25:-0.27,p50:0.04,p75:0.38},over300M:{p25:0.47,p50:1.01,p75:1.09}}
};

// 기관유형별 균형전략 탈락률 참고값
export const FAIL_RATES={"지자체":25.0,"교육청":24.5,"군시설":25.0,"한전":25.0,"조달청":25.0,"LH":25.0,"수자원공사":25.0};

// ─── Phase 5.3: ROI 통합 점수 매트릭스 ───────────────────────
// 1,128건 검증 데이터 기반 (2026-04-10). shrinkage K=5 적용으로 표본
// 적은 셀은 GLOBAL_MEAN(5.44%)으로 수렴.
export const WIN_PROB_MATRIX={
  "LH":       {S:{p:0.1818,n:11}, M:{p:0.0000,n:3},  L:{p:0.3182,n:22}},
  "한전":     {S:{p:0.0476,n:42}, M:{p:0.2121,n:33}, L:{p:0.5000,n:2}},
  "군시설":   {S:{p:0.0135,n:148},M:{p:0.1875,n:16}, L:{p:0.0000,n:1}},
  "지자체":   {S:{p:0.0445,n:449},M:{p:0.0606,n:99}, L:{p:0.0952,n:21}},
  "교육청":   {S:{p:0.0217,n:138},M:{p:0.0800,n:25}, L:{p:0.0000,n:12}},
  "조달청":   {S:{p:0.0000,n:10}, M:{p:0.0833,n:12}, L:{p:0.0500,n:20}},
  "수자원공사":{S:{p:0.0000,n:18}, M:{p:0.0000,n:0},  L:{p:0.0000,n:2}}
};

// Phase 5.2 shrinkage 상수
export const SHRINKAGE_K=5;
export const GLOBAL_MEAN=0.0544;

// 무효 공고 키워드 (공고명에 포함 시 D등급 강제)
export const INVALID_KEYWORDS=["취소","중지","재공고","정정","연기"];

// ─── Phase 23-X: at별 평균 참가자 수 (분산 권고 트리거) ─────
// 근거: bid_details 479건 자사 투찰 분석 (2025-11~2026-04). 평균 참가자 ≥3,000명
// at에서 단일 사정률 1위 적중률은 C(15,4) 추첨 특성상 통계적 한계.
// 이 임계 이상 at에 대해 추천 카드에서 분산 투찰 강력 권고 안내 노출.
export const AT_AVG_PARTICIPANTS={
  "지자체":   3059,
  "교육청":   2462,
  "군시설":   3458,
  "한전":     1264,
  "조달청":   3293,
  "LH":       3150,
  "수자원공사":1999
};
export const PARTICIPANT_THRESHOLD_HIGH=2000;

// 금액대 3구간 분류 (WIN_PROB_MATRIX·ROI 용)
export const tierOf=(amt)=>{const a=Number(amt)||0;return a<3e8?"S":a<1e9?"M":"L"};
