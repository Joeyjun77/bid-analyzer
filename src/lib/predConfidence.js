// 예측 리스트 신뢰도 분류 — 순수 로직(의존 없음, node 단위테스트 가능)
// utils.js에서 re-export해 App.jsx 호환 유지. bidCacheLogic.js와 동일하게 standalone 분리.
// 설계: docs/superpowers/specs/2026-05-26-confidence-accuracy-based-design.md

// ba → 금액대 세그먼트(utils.baSegOf와 동일 경계, 의존 제거 위해 inline)
function _baSeg(ba){ const n=Number(ba)||0; return n<1e8?'S1':n<3e8?'S2':n<1e9?'S3':n<3e9?'S4':'S5'; }

// ── predConfidence(N 기반, 레거시) ──
// g2b_auto 기계형식: "d:0.50|s:0.25|c:0.20|bc*0.0" (가중치 기반)
// file_upload 사람형식: "한국전력공사 경기본부(531건) + 상세13건 보정" (발주사통계 표본수 기반)
// 임계값(file_upload): N≥200 높음 / N≥50 보통. 주의: 표본 규모 기준이며 실측 정확도(MAE)와 별개.
// predConfidenceV2(실측 정확도 기반)의 fallback으로만 사용(전 grain 미스 시, 최대 med cap).
export function predConfidence(predSource){
  const src=predSource||"";
  // g2b_auto 형식 (가중치)
  const dm=src.match(/d:([\d.]+)/),sm=src.match(/s:([\d.]+)/),cm=src.match(/c:([\d.]+)/);
  if(dm||sm||cm){
    const dw=dm?Math.round(Number(dm[1])*100):0,sw=sm?Math.round(Number(sm[1])*100):0,cw=cm?Math.round(Number(cm[1])*100):0;
    const level=dw>=50?"high":dw>=30?"med":sw>=40?"med":"low";
    const srcLabel=[dw>0&&`발주사통계 ${dw}%`,sw>0&&`유사사례 ${sw}%`,cw>0&&`업체패턴 ${cw}%`].filter(Boolean).join(" + ");
    return {level,srcLabel,n:null};
  }
  // file_upload 형식: 첫 "(N건)" = 그 예측이 사용한 발주사통계 풀 크기
  const nm=src.match(/\((\d+)건\)/);
  if(nm){
    const n=Number(nm[1]);
    const level=n>=200?"high":n>=50?"med":"low";
    return {level,srcLabel:`발주사 표본 ${n}건`,n};
  }
  return {level:"low",srcLabel:"",n:null};
}

// ── 신뢰도 V2: 실측 정확도(agency_accuracy_map) 기반 ──
// 코덱스 2라운드 검증 반영(2026-05-26). 표시 전용 — opt_adj/추천값 무영향(Evaluator, predict-architect go).
export const CONF_TIER_MIN_N = 30;          // tier-reliable 최소 표본(미만 grain은 '높음' 금지)
export const CONF_HIGH = { mae:0.55, absBias:0.20, sd:0.65 };
export const CONF_MED  = { mae:0.85, absBias:0.45 };
export const WIN_ZONE_AREAS = ['군시설'];   // gap_p90≥0.10 — 사정률 양호해도 낙찰은 WIN-zone 변수(MEASUREMENT_SPEC §6.1)

// stats {n,bias,mae,sd} → 'high'|'med'|'low'. allowHigh=false면 high 금지(thin grain).
function _confTier(st, allowHigh){
  const mae=Number(st.mae), ab=Math.abs(Number(st.bias)), sd=st.sd==null?null:Number(st.sd);
  if(allowHigh && mae<=CONF_HIGH.mae && ab<=CONF_HIGH.absBias && sd!=null && sd<=CONF_HIGH.sd) return 'high';
  if(mae<=CONF_MED.mae && ab<=CONF_MED.absBias) return 'med';
  return 'low';
}

// predConfidenceV2(predSource, accMap, {at,ag,ba}) — accMap: {agBa,ag,atBa,at}, 각 값 {n,bias,mae,sd}
// grain fallback AG×BA→AG→AT×BA→AT 중 n≥30인 가장 fine grain으로 tier(P0-1).
// n≥30 grain 없으면 thin → 최대 med. 전 grain 미스면 predConfidence(N기반) fallback, 단 최대 med(P0-2).
export function predConfidenceV2(predSource, accMap, {at, ag, ba}={}){
  const base = predConfidence(predSource); // srcLabel·표본 N + fallback용
  const winZoneArea = WIN_ZONE_AREAS.includes(at);
  const cap = (lvl)=> (winZoneArea && lvl==='high') ? 'med' : lvl; // WIN-zone 영역 high→med
  if(accMap && (accMap.agBa||accMap.ag||accMap.atBa||accMap.at)){
    const seg = _baSeg(ba);
    const chain = [
      ['AG×금액대', ag && accMap.agBa && accMap.agBa[ag+'|'+seg]],
      ['AG',        ag && accMap.ag   && accMap.ag[ag]],
      ['AT×금액대', at && accMap.atBa && accMap.atBa[at+'|'+seg]],
      ['AT',        at && accMap.at   && accMap.at[at]],
    ].filter(x=>x[1]); // present grains
    if(chain.length){
      const reliable = chain.find(x=>Number(x[1].n)>=CONF_TIER_MIN_N); // P0-1: n≥30인 가장 fine
      const [grainSrc, st] = reliable || chain[0];                     // 없으면 가장 fine present(thin)
      const level = cap(_confTier(st, !!reliable));                    // thin이면 high 금지
      let srcLabel=`실측 정확도 MAE ${Number(st.mae).toFixed(2)}%p·편향 ${Number(st.bias).toFixed(2)}%p (표본 ${st.n}건, ${grainSrc} 기준)`;
      if(winZoneArea) srcLabel+=` · 사정률 정확도는 양호할 수 있으나 낙찰은 WIN-zone 변수(자사1위적중 별도)`;
      return { level, srcLabel, n:st.n, mae:st.mae, bias:st.bias, sd:st.sd, grainSrc, basis:'accuracy', winZoneArea };
    }
  }
  const fbLevel = base.level==='high' ? 'med' : base.level; // P0-2: 정확도 데이터 없으면 높음 금지
  return { level:cap(fbLevel), srcLabel:base.srcLabel, n:base.n, mae:null, bias:null, sd:null,
           grainSrc:null, basis:'sample', winZoneArea };
}
