# 군부대 Mode A — Phase 2a: recommendModeA를 floorErr m_star로 교체 (인터페이스 무변경) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans 또는 subagent-driven-development. 체크박스(`- [ ]`)로 추적.

**Goal:** `recommendModeA`(군시설 Mode A 추천)를 경쟁자 gap 분위수 → floorErr current 분포 기반 `m_star`(α=0.15=p85, clamp [p50,p95])로 교체. 반환은 기존 `{mode,adj,bid,...}` 스키마 유지(adj는 bidC 무손실 역산). 라이브 효과를 /evaluate G-hit으로 단독 측정.

**Architecture:** floorErr는 Phase 1의 `lookup_floorerr_distribution('군시설',NULL,NULL,'current')` RPC에서 페치. 추천 투찰금 = `predicted_floor_amount + ba×m_star` (amount 공간). predicted_floor_amount = `pred_expected_price × pred_floor_rate/100` (★floorErr 캘리브레이션과 동일 정의 — `ep`/`bidC` 아님). b_pred_adj는 bidC 역산으로 채워 컬럼 의미 보존. Mode B/한전/고양시 경로 무변경.

**Tech Stack:** React+Vite, src/lib/utils.js / modeResolver.js, src/App.jsx. DB는 Phase 1 객체 재사용(신규 마이그레이션 없음).

---

## 확정 스펙 (predict-architect Phase 2 검토 + Codex consult + 데이터 검증)

### m_star 산식 (α=0.15 LOCK)
```
floorErrDist = lookup_floorerr_distribution('군시설', canonical_ag, ba, 'current')   // 현재 AT-level만 적재
m_star = clamp(floorerr_p85, lo, hi),  lo = max(0, floorerr_p50),  hi = floorerr_p95
predicted_floor_amount = pred_expected_price × pred_floor_rate / 100        // ★캘리브레이션 일치 (ep/bidC 금지)
recommended_bid_amount = ceil(predicted_floor_amount + ba × m_star)
recommended_bid_rate   = recommended_bid_amount / ba
floor_pass_prob ≈ Φ((m_star − floorerr_mean)/floorerr_std)   (≈ 1−α = 0.85)
```
현재 실측(current n=86): p50=+0.000507, p85=+0.007448, p95=+0.011504, mean=+0.000696, std=0.006511 → m_star=+0.007448, floor_pass_prob≈0.85, sample_status='insufficient_sample'.

### 불변식/가드 (predict-architect 9개 — 코드에 반드시 반영)
1. **α≤0.15 LOCK** — p90/p95 분위수 직접 m_star 사용 금지(꼬리 불안정). n≥300 전 α 0.10 금지.
2. **clamp 하드가드** — m_star ∈ [max(0,p50), p95]. floorErrDist 미조회/표본부족(n<5) 시 기존 종형 fallback(recommendV2 1099행) 유지, null 추천 공백 금지.
3. **floor-pass 1차 제약** — lo=max(0,p50)≥0 → recommended_bid ≥ predicted_floor (m_star<0 추천 금지).
4. **era=current 단독** — resolveFloorErrDist 기본 p_era='current'. legacy 라이브 소비 금지.
5. **predicted_floor 캘리브레이션 일치** — `pred_expected_price × pred_floor_rate/100`. `ep`(평균 9.3% 상이)·bidC(av/effFr 적용) 사용 금지.
6. **반환 스키마 호환** — recommendV2 Mode A가 기존 키(mode,adj,bid,floor_pass_prob,win_prob,grain,src,floor_safe) 모두 유지. 신규 키(m_star,sample_status,alpha_used,recommended_bid_rate)는 추가만.
7. **Mode B/한전/고양시 불변** — recommendV2 Mode B 분기(1048~1075)·calcWin1stBid·WIN_OPT_GAP 무수정. 회귀 diff=0 검증.
8. **insufficient_sample 노출** — sample_status 반환. (UI 배지는 2c)
9. **A안 INSERT-only** — App.jsx:1168 가드(pending만 재계산) 유지. 기존 군시설 매칭 213건 UPDATE 금지.

---

## File Structure
| 파일 | 변경 |
|---|---|
| `src/lib/modeResolver.js` | `resolveFloorErrDist({at,canonicalAg,ba,era})` 추가 (lookup_floorerr_distribution RPC 래퍼) |
| `src/lib/utils.js` | (a) `_invertBidCToAdj` 헬퍼 추가 (b) `recommendModeA` 시그니처/로직 교체 (c) `recommendV2` Mode A 분기(1077~1097) 교체 |
| `src/App.jsx` | b_pred 적재부(1178~1184): Mode A row에 `resolveFloorErrDist` 페치 + 컨텍스트에 `floorErrDist`,`predExpectedPrice` 추가 |

---

## Task 1: modeResolver에 floorErr 페치 추가

**Files:** Modify `src/lib/modeResolver.js` (resolveGapDist 아래, 65행 근처)

- [ ] **Step 1: resolveFloorErrDist 추가**

`resolveGapDist` 함수 정의 끝(`return null; }` 다음, getMainMetricLabel 위) 에 추가:
```js
// V2 Mode A (군시설) floorErr 분포 lookup — Phase 1 소스(m37)
// lookup_floorerr_distribution RPC 래퍼. 3단 fallback (AG_BA → AG → AT). p_era 기본 current(라이브 소비).
export async function resolveFloorErrDist({ at, canonicalAg, ba, era = "current" }) {
  if (!at) return null;
  try {
    const params = new URLSearchParams({
      p_at: at,
      ...(canonicalAg ? { p_canonical_ag: canonicalAg } : {}),
      ...(ba != null ? { p_ba: String(ba) } : {}),
      p_era: era,
    });
    const res = await authedFetch(`/rest/v1/rpc/lookup_floorerr_distribution?${params}`, { method: "POST" });
    if (!res.ok) return null;
    const rows = await res.json();
    if (Array.isArray(rows) && rows.length > 0) return rows[0];
  } catch (err) {
    // 조용히 실패 — Mode A는 종형 fallback 가능
  }
  return null;
}
```

- [ ] **Step 2: 빌드 통과 확인**

Run: `npx vite build`
Expected: 빌드 OK (no syntax error).

- [ ] **Step 3: 커밋**
```bash
git add src/lib/modeResolver.js
git commit -m "feat(a-phase2a): resolveFloorErrDist RPC 래퍼 추가

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: utils.js — bidC 역산 헬퍼 + recommendModeA 교체

**Files:** Modify `src/lib/utils.js` (recommendModeA 807~831)

- [ ] **Step 1: recommendModeA를 floorErr 기반으로 교체**

기존 `export function recommendModeA(gapDist, options){...}`(807~831) 전체를 아래로 교체. 상단 주석도 갱신:
```js
// V2 Mode A 추천 (Phase 2a) — 군시설 floorErr 분포 기반 m_star
// 근거: docs/v2/A_MODE_A_MILITARY_WIN_DESIGN_2026-05-23 §3~§6, predict-architect Phase2 검토, Codex consult 2026-05-23
// floorErr = (actual_floor − predicted_floor)/base [분수], predicted_floor = pred_expected_price×pred_floor_rate/100
// m_star = clamp(p85(α=0.15), lo=max(0,p50), hi=p95)  — floor-pass 1차, 1위는 보너스
// 입력:
//   floorErrDist: lookup_floorerr_distribution 결과 { n, confidence, floorerr_mean, floorerr_std, floorerr_p50, floorerr_p85, floorerr_p95, ... }
//   options: { predExpectedPrice, predFloorRate, ba, alpha=0.15 }
// 반환: { m_star, recommended_bid_amount, recommended_bid_rate, predicted_floor_amount, floor_pass_prob, sample_status, alpha_used, src_n } | null
export function recommendModeA(floorErrDist, options) {
  const opt = Object.assign({ alpha: 0.15 }, options || {});
  if (!floorErrDist || floorErrDist.n == null || floorErrDist.n < 5) return null;
  const predEp = Number(opt.predExpectedPrice);
  const predFr = Number(opt.predFloorRate);
  const ba = Number(opt.ba);
  if (!(predEp > 0) || !(predFr > 0) || !(ba > 0)) return null;

  // α=0.15 LOCK → p85 (p90/p95 직접 사용 금지: n<300 꼬리 불안정)
  const p50 = Number(floorErrDist.floorerr_p50);
  const p85 = Number(floorErrDist.floorerr_p85);
  const p95 = Number(floorErrDist.floorerr_p95);
  if (isNaN(p85)) return null;
  const lo = isNaN(p50) ? 0 : Math.max(0, p50);   // floor-pass 1차: m_star ≥ 0
  const hi = isNaN(p95) ? p85 : p95;
  let mStar = Math.min(Math.max(p85, lo), hi);
  if (isNaN(mStar)) return null;

  const predictedFloorAmount = predEp * predFr / 100;
  const recommendedBidAmount = Math.ceil(predictedFloorAmount + ba * mStar);
  const recommendedBidRate = recommendedBidAmount / ba;

  // floor_pass_prob ≈ P(floorErr ≤ m_star) = Φ((m_star−mean)/std) ≈ 1−α
  const mean = Number(floorErrDist.floorerr_mean);
  const std = Number(floorErrDist.floorerr_std);
  let floorPassProb = 1 - opt.alpha;
  if (!isNaN(mean) && std > 0) {
    const p = _phi((mStar - mean) / std);
    if (p != null && !isNaN(p)) floorPassProb = p;
  }

  return {
    m_star: mStar,
    recommended_bid_amount: recommendedBidAmount,
    recommended_bid_rate: recommendedBidRate,
    predicted_floor_amount: predictedFloorAmount,
    floor_pass_prob: floorPassProb,
    sample_status: floorErrDist.confidence || null,
    alpha_used: opt.alpha,
    src_n: floorErrDist.n,
  };
}
```
(주의: `_phi`는 이미 utils.js에 정의됨 — calcFloorPassProb에서 사용 중. 별도 import 불필요.)

- [ ] **Step 2: 빌드 통과 확인**

Run: `npx vite build`
Expected: 빌드 OK.

---

## Task 3: utils.js — recommendV2 Mode A 분기 교체 (bidC 역산 포함)

**Files:** Modify `src/lib/utils.js` (recommendV2 Mode A 분기 1077~1097)

- [ ] **Step 1: Mode A 분기 교체**

기존 1077~1097 블록(주석 "Mode A: 군시설 공략…" + `const gapDist=...` ~ 첫 `}` 닫힘 직전)을 아래로 교체:
```js
  // Mode A: 군시설 공략 — Phase 2a floorErr m_star 기반 (recommendModeA)
  // floorErrDist는 context에서 전달 (App.jsx의 lookup_floorerr_distribution RPC 결과, era=current)
  // 표본 부족(n<5)·미전달·predExpectedPrice 부재 시 기존 종형 fallback
  const floorErrDist = context?.floorErrDist;
  const predEp = Number(context?.predExpectedPrice);
  const predFr = Number(fr); // recommendV2 입력 fr = pred_floor_rate (App.jsx에서 전달)
  if (floorErrDist && floorErrDist.n >= 5 && predEp > 0 && predFr > 0) {
    const result = recommendModeA(floorErrDist, { predExpectedPrice: predEp, predFloorRate: predFr, ba, alpha: opt.alpha || 0.15 });
    if (result && result.recommended_bid_amount != null) {
      const bidAmt = result.recommended_bid_amount;
      // b_pred_adj 컬럼 의미 보존: bidC 역산으로 사정률 환산 (무손실 — 컬럼 표시용)
      const adj = _invertBidCToAdj(bidAmt, ba, av, effFr);
      return {
        mode: 'A',
        adj,
        bid: bidAmt,
        floor_pass_prob: result.floor_pass_prob,
        win_prob: null, // Mode A 1위는 보너스 — 과신 약속 금지 (insufficient_sample)
        grain,
        src: `modeA_floorErr(n=${result.src_n} · m*=${result.m_star?.toFixed?.(5) ?? '?'} · α=${result.alpha_used} · ${result.sample_status || '?'})`,
        source: 'modeA_floorerr',
        floor_safe: bidAmt >= result.predicted_floor_amount,
        m_star: result.m_star,
        sample_status: result.sample_status,
        recommended_bid_rate: result.recommended_bid_rate,
      };
    }
  }
```
(다음 줄 `// Fallback: 기존 종형` 이하 1099~는 그대로 유지 — gapDist 미전달/표본부족 시 종형 fallback.)

- [ ] **Step 2: _invertBidCToAdj 헬퍼 추가**

`recommendV2` 함수 정의 위(약 1011행, recommendV2 export 직전)에 추가:
```js
// bidC 무손실 역산: 주어진 bid_amount를 만드는 사정률 adj 산출 (b_pred_adj 컬럼 표시용)
// bidC(adj) = ceil(av + (ba*(1+adj/100) − av)*(effFr/100))  (av>0)
//           = ceil(ba*(1+adj/100)*(effFr/100))               (av≤0)
// → adj = ((av + (bid−av)*100/effFr)/ba − 1)*100   (av>0)
//        = ((bid*100/effFr)/ba − 1)*100             (av≤0)
function _invertBidCToAdj(bid, ba, av, effFr) {
  if (!(ba > 0) || !(effFr > 0)) return 0;
  const xp = (av && av > 0)
    ? av + (bid - av) * 100 / effFr
    : bid * 100 / effFr;
  return (xp / ba - 1) * 100;
}
```

- [ ] **Step 3: 빌드 통과 확인**

Run: `npx vite build`
Expected: 빌드 OK.

- [ ] **Step 4: 단위 자기검증 (역산 무손실 확인)**

임시 node 스니펫으로 bidC↔invert 왕복 확인(브라우저 콘솔 또는 임시 테스트):
```
ba=43000000, av=0, effFr=89.745, predEp=39000000, predFr=90.25, mStar=0.007448
predicted_floor = 39000000*90.25/100 = 35197500
bid = ceil(35197500 + 43000000*0.007448) = ceil(35197500+320264)=35517764
adj = _invertBidCToAdj(35517764,43000000,0,89.745) = ((35517764*100/89.745)/43000000-1)*100 ≈ -7.99 (사정률, 음수 정상)
재검: bidC(adj) = ceil(43000000*(1+adj/100)*(89.745/100)) ≈ 35517764 (±1 반올림)
```
Expected: bidC(invert(bid)) == bid (±1원 반올림 오차 허용).

- [ ] **Step 5: 커밋 (Task2+3 함께)**
```bash
git add src/lib/utils.js
git commit -m "feat(a-phase2a): recommendModeA floorErr m_star 교체 + bidC 역산 (인터페이스 유지)

m_star=clamp(p85(α=0.15),max(0,p50),p95), predicted_floor=pred_ep×pred_floor_rate/100.
반환 adj는 bidC 무손실 역산(컬럼 의미 보존). Mode B/한전 경로 무변경.
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: App.jsx — floorErr 페치 + 컨텍스트 전달

**Files:** Modify `src/App.jsx` (import + b_pred 적재부 1176~1184)

- [ ] **Step 1: import에 resolveFloorErrDist 추가**

`modeResolver`에서 resolveGapDist를 import하는 줄을 찾아 resolveFloorErrDist 추가:
```js
// 예: import { resolveMode, resolveGapDist, getMainMetricLabel, ... } from "./lib/modeResolver.js";
//  → resolveFloorErrDist 추가
```
(정확한 기존 import 줄을 Grep으로 확인 후 resolveFloorErrDist 항목만 추가.)

- [ ] **Step 2: Mode A row에 floorErr 페치 + 컨텍스트 전달**

1176~1184 블록을 아래로 교체:
```js
          const modeRes=await resolveMode({at:p.at,canonicalAg:p.ag,ba:Number(p.ba)});
          // Phase 2a: Mode A (군시설) row만 floorErr 분포 추가 조회 (era=current)
          const floorErrDist=(modeRes?.mode_recommend==='A')
            ?await resolveFloorErrDist({at:p.at,canonicalAg:p.ag,ba:Number(p.ba),era:'current'})
            :null;
          const v2=recommendV2(
            {at:p.at,agName:p.ag,ba:Number(p.ba),ep:Number(p.ep)||Number(p.ba),av:Number(p.av)||0,fr:Number(p.pred_floor_rate)},
            {distMap:win1stDistMap,modeResolution:modeRes,floorErrDist,predExpectedPrice:Number(p.pred_expected_price)||null,ownScore}
          );
```
(주의: 기존 `gapDist` 페치 제거 — Phase 2a는 floorErr 사용. recommendV2 Mode A 분기도 gapDist 미참조로 교체됨.)

- [ ] **Step 3: 빌드 통과 확인**

Run: `npx vite build`
Expected: 빌드 OK.

- [ ] **Step 4: 커밋**
```bash
git add src/App.jsx
git commit -m "feat(a-phase2a): App b_pred 적재부 floorErr 페치 + predExpectedPrice 전달

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 검증 — /evaluate (G-hit) + Mode B 회귀 diff=0

- [ ] **Step 1: Mode B 회귀 스냅샷 (변경 전후 동일성)**

변경 전 이미 push됨 → DB의 기존 b_pred 값은 INSERT-only 보호로 불변. 신규 적재가 Mode B(한전/고양시) 행을 바꾸지 않는지 확인:
```sql
-- 한전/고양시 Mode B 행은 floorErr 경로 미진입 — b_pred_mode='B' 분포 불변 확인
SELECT b_pred_mode, count(*) FROM bid_predictions WHERE b_pred_mode IS NOT NULL GROUP BY b_pred_mode;
```
Expected: 변경 후 'B' 카운트·값 불변 (Mode A 신규만 'modeA_floorErr' src).

- [ ] **Step 2: /evaluate 슬래시 커맨드 실행 (G-단위/G-A안/G-bias/G-모드표시 + G-hit)**

`/evaluate` 실행. 핵심:
- G-단위: Mode A가 bid_amount 직접 계산(predicted_floor+ba×m_star), b_pred_adj는 역산 — bid_rate 공간 일관성 확인
- G-hit(군시설 floor-pass): `b_pred_bid_amount >= floor_price`(matched_record_id 조인) 비율 측정
- Mode B 회귀: 한전/고양시 b_pred diff=0
판정 PASS/WARN/FAIL.

- [ ] **Step 3: FAIL 시 롤백, PASS/WARN 시 deploy-gate 후 push (사용자 확인)**

FAIL → 커밋 되돌림(`git revert`) 또는 수정 후 재검증. PASS/WARN → deploy-gate 서브에이전트 → 사용자 push 발화 시 `git pull --rebase` 후 push.

- [ ] **Step 4: 설계 문서 §14 Phase 2a 완료 표기 + 메모리 갱신**

---

## 검증 게이트 메모
- **Generator / 회귀 中.** 라이브 영향은 **미래/pending 예측만**(기존 213건 INSERT-only 보호). V2 Mode A KPI = floor-pass/G-hit(bid_rate), MAE 아님.
- α=0.15 LOCK, insufficient_sample(n=86) — 자동확정 UI 금지(2c). 실험적 노출.
- 2b(bid_rate 직접 반환 인터페이스 전환)·2c(UI 배지)는 2a PASS 확인 후 별도.

## Self-Review
1. **Spec coverage**: 산식(§3~5)→Task2 / floor-pass 1차(§6)→clamp lo / era current→Task1,4 / 캘리브레이션 일치→predExpectedPrice(Task4) / 인터페이스 유지→adj 역산(Task3) / Mode B 불변→Task5 Step1.
2. **Placeholder scan**: 전 코드 기재. Task4 Step1 import는 기존 줄 확인 후 추가(정확 경로는 Grep) — 유일한 "확인 후" 항목, 나머지 전부 완전 코드.
3. **Type consistency**: recommendModeA 반환 키(m_star/recommended_bid_amount/recommended_bid_rate/predicted_floor_amount/floor_pass_prob/sample_status/alpha_used/src_n) ↔ recommendV2 Task3 소비 일치. resolveFloorErrDist 반환(floorerr_p50/p85/p95/mean/std/n/confidence) ↔ recommendModeA 소비 일치(RPC m37 RETURNS와 일치). _invertBidCToAdj 시그니처(bid,ba,av,effFr) ↔ 호출 일치.
