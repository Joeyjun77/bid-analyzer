# Codex Round 16 검증 의뢰문 — R16-pre 후속 (B+C+D) + A Step 1 (WIN_OPT_GAP 동적화 1차) 통합

> 작성일: 2026-05-23 (사전 준비) · **보강: 2026-05-26** (canonical 첫 weekly gate 5/25 적재 확인 — §4.5·§4.7·§6·§10·Q5 갱신)
> 직전 라운드: 15 (composite 8.9/10, "메타 점검 진입 자체가 옳았다" 인용)
> 평가 대상: **R15 → R16 사이 19 commit** — R15+ 메타 응답 §4.1(A 권고) 실행 + R16-pre 검증(B+C+D 적용) + 데이터 무결성 m31~m34 + A Step 1(첫 Generator 변경)
> 본 의뢰문은 **두 트랙 통합 평가**:
>   - 트랙 1 — R16-pre Evaluator 묶음 (관측·진단·리포트 강화, 코드 변경 0)
>   - 트랙 2 — A Step 1 Generator 변경 (WIN_OPT_GAP 동적화 1차, 5대 게이트 통과)

---

## 1. 평가 의뢰 핵심 질문 (R16 본질)

1. **A Step 1 변경 폭이 적절했는가?** — 한전 0.367 / LH 0.088 LOCK + 지자체·교육청·군시설 0 clamp의 conservative 정책이 코덱스 §9.1·§9.2 권고를 정확히 반영했는가? 더 보수적/공격적이어야 했는가?
2. **A Step 1 효과 판정 윈도우(7~14일) 지정이 타당한가** (코덱스 §9.7) — 현재 push 후 1일 시점. matched_with_actual 1,385건·30일 818건·7일 190건 속도로 7일 windowed 표본 충분성 확인 가능한가?
3. **R16-pre 트랙 발견 (`v_shadow_bias_goyang` 90일 -0.3857)이 30일 +1.0491과 부호 반전** — 어느 윈도우를 production 보정 판단 입력으로 채택할지 정책 가이드 필요. n=8 90일은 promotion_status=insufficient_or_low_bias로 자동 차단되었지만, 30일 +1.05를 단독 신호로 사용했다면 정반대 방향 보정 위험.
4. **R15 코덱스 권고 m31/m32 잔여 vs A Step 1 우선 진입의 trade-off** — m31(legacy 2,578건 중복 정정) + m32(partial UNIQUE 인덱스)를 미완 상태로 두고 A Step 1 Generator 변경에 진입한 판단이 옳았는가? FORWARD_DIRECTION §6.5 권고 순서(m33→m34→m32)와 충돌하지 않는가?
5. **canonical 4주 PASS 카운터 진척 (5/26 확정)** — `mode_gate_report`에 **week=2026-05-25 canonical _overall_ B PASS 적재 확인**(0.9704, n=135). weekly gate cron jobid가 사전본의 11/13에서 **17(modeA)·18(modeB)로 재생성**됨(stale 정정) — 5/25 01:00~01:15 UTC 둘 다 succeeded(18=INSERT 6, 17=INSERT 1). 첫 canonical 적재일=첫 PASS일=5/25로 일치 → 카운터 시작 정의를 "첫 canonical weekly_gate 적재일"로 명문화하는 것이 타당한가? (추가 발견: `v_cron_health` view가 17/18을 미포함 — §4.7 참조)
6. **A Step 1 baseline hit01 측정값과 메모리 표기 불일치** — 메모리 `project_next_session_m33.md`에 "한전 LOCK baseline 30d hit01 16% / 지자체 10.9%" 표기. 실측 60일 한전 2.56% / 지자체 2.43%, 30일 한전 0.00%(n=16) / 지자체 1.15%. 메모리 baseline의 측정 정의를 어떤 메트릭으로 정정해야 하는가? (자사 1위 hit vs MAE-window hit vs 사정률 차이 hit)
7. **다음 세션 우선순위** — Step 2(지자체×ba 2D) 진입 조건 충족 시점 vs m31/m32 잔여 처리 vs Phase 17 신뢰구간 41.67% 재조정 vs L1 Phase 3 #2(ba_seg→ep) 중 어느 트랙이 라운드 17 진입 가치가 가장 큰가?

---

## 2. 라운드 15 → 16 사이 commit 시퀀스 (19 commit)

| commit | 종류 | 핵심 |
|---|---|---|
| `4a25fef` | docs | R15 BRIEF 의뢰 (메타 점검 통합 평가) |
| `2eb2ece` | docs | R15 Major #3 + Minor #1 정정 (UI_SPEC §3.1 + HANDOFF §9.8) |
| `0452286` | fix | **v2-codex-meta 즉시 가치 3건** — outlier 정정 + cron 진단 + 고양시 bias 진단 |
| `a8e989a` | fix | v8-fetch limit=10000 — V8 dual-run 결손 차단 |
| `ae18713` | fix | **v8-fetch chunk 페이징** — Supabase max-rows 1000 hard cap 우회 |
| `4e05adb` | docs | FORWARD_DIRECTION — 단·중·장기 로드맵 (단일 진실) |
| `564092f` | docs | FORWARD_DIRECTION §6 — 코덱스 의견 수렴 영구 기록 (Q1~Q6 응답) |
| `b47e226` | fix | **match-automation** — ar1 단위 자동 감지 + matched-but-actual-null 재매칭 + 서버 cron 신설 (jobid 14) |
| `d724019` | fix | toRecord 사정률/낙찰가율 단위 자동 감지 — 0% 기준 → 100% 기준 자동 보정 |
| `0dd028a` | docs | **m33 false positive 진단** — weekly_quality_report cron 누락은 UX 오해, helper backfill로 해결 |
| `37d2365` | fix | **m34 canonical_ag 정규화 + at 표준화** — bid_records 11,447건 백필 + 비표준 at 45건 |
| `fefd8a8` | docs | m32 false positive 종결 — 군부대 pn_no 연도별 재사용 패턴 (자연 동작) |
| `d939cbd` | docs | z-detail 종결 — 인포21c API 사정률 자동 수집 불가 확인 |
| `d432350` | docs | m30 113건 dedup_key 우회 패턴 종결 — 인포21c 빈 record |
| `0f79fe6` | feat | UI 매칭 지연 안내 — 데이터대기 분리 + tooltip |
| `5fcc1ab` | feat | **o3 빈 record 중복 자동 마킹** — mark_empty_duplicates() + cron jobid 16 |
| `e730f62` | feat | **R16-pre B+C+D 후속** — v_shadow_bias_goyang + v_cron_health + /accuracy 12체크 확장 |
| `2a8735a` | docs | A Step 1 설계 (predict-architect 검토 완료) |
| `0c3a3ff` | docs | A Step 1 — 코덱스 R16-pre 검증 §9 추가 + 호출부 정정 |
| `926a547` | **feat** | **A Step 1 push** — WIN_OPT_GAP 동적화 1차 (한전/LH LOCK + 지자체/교육청/군시설 0 clamp) |

19 commit 중 docs 11 / fix 6 / feat 3. **Generator 변경은 단 1건 (A Step 1).**

---

## 3. R16 진입 트리거 — 두 트랙 통합

### 3.1 트랙 1 — R16-pre Evaluator 묶음 (코드 변경 0, 게이트 면제)

R15+ 코덱스 평가 4종(§1~§4) + 추가 맹점(§5) 중 **Evaluator 분류 3건(B/C/D)** 일괄 적용 (`CODEX_R16_PRE_FOLLOWUP_2026-05-22.md`):
- **D — `v_cron_health` view**: jobid 12종 통합 7일 success_pct + duration + last_run_at
- **C — `v_shadow_bias_goyang` view**: canonical_ag 4개 90일 + overall GROUPING SETS + promotion_status (eligible/watch/insufficient_or_low_bias)
- **B — `/accuracy` 12체크 확장**: §10 at×route 분해 + §11 shadow bias + §12 cron health

### 3.2 트랙 2 — A Step 1 Generator 변경 (5대 게이트 통과)

`A_WIN_OPT_GAP_DESIGN_2026-05-22.md` §4.1 Step 1 한정판 적용 (`src/lib/constants-tables.js:16-37`):

| at | Before | After | 근거 | 정책 |
|---|---|---|---|---|
| 한전 | 0.367 | **0.367** | pct_above 68.4% + 60일 hit 양호 | **LOCK** |
| LH | 0.088 | **0.088** | pct_above 80.0% | **LOCK** |
| 지자체 | 0.493 | **0** | n=238 p50=-0.068 pct_above 47.1% 대칭 | 0 clamp |
| 군시설 | 0.05 | **0** | n=81 p50≈0 pct_above 50.0% 완전대칭 | 0 clamp |
| 교육청 | 0.533 | **0** | n=186 p50=-0.155 pct_above 39.8% 음수일관 | 0 clamp (conservative) |
| 조달청 | 0.676 | 0.676 | n=20 부족 (코덱스 §9.1 정정) | 유지 (보류) |
| 수자원공사 | 0.003 | 0.003 | n 부족 | 유지 |

**게이트 결과**:
- ✅ predict-architect 재호출 PASS (HOLD/부분 GO 사유 정정 후 통과)
- ✅ /evaluate 5대 PASS (G-단위/G-A안/G-bias/G-모드표시/G-도메인)
- ✅ deploy-gate PASS (전체 MAE Δ=0, 핵심 영역 Δ=0)

**즉시 영향**: 0건 (매칭된 `bid_predictions.opt_adj` UPDATE 금지 — A안 INSERT-only). **신규 추천부터 효과 발생.**

---

## 4. 정량 영향 — push 직후 baseline (2026-05-23 13:00 KST)

### 4.1 A Step 1 baseline (push 직전 기준, 60일 윈도우 — 효과 판정용)

> **hit = 사정률적중** (`|opt_adj − actual_adj_rate| ≤ k`, k=0.01/0.02 — adj_rate 공간). **자사1위적중**(`top1_win`, §10 참조)과 다른 메트릭. 용어 분리 정의: `V2_MEASUREMENT_SPEC.md §4.5`.

| at | n | MAE | 사정률적중±0.01 | 사정률적중±0.02 | A Step 1 변경 |
|---|---|---|---|---|---|
| 지자체 | 740 | 0.5812 | **2.43%** | 4.46% | 0.493 → 0 |
| 군시설 | 231 | 0.4793 | **2.16%** | 3.46% | 0.05 → 0 |
| 교육청 | 187 | 0.6039 | **2.14%** | 3.21% | 0.533 → 0 |
| 한전 | 117 | 0.4224 | **2.56%** | 3.42% | LOCK |
| 조달청 | 45 | 0.4837 | 4.44% | 4.44% | 유지 |
| LH | 44 | 0.6243 | **4.55%** | 4.55% | LOCK |
| 수자원공사 | 21 | 0.6669 | 0.00% | 0.00% | 유지 |

### 4.2 A Step 1 baseline — 30일 윈도우 (push 직전, 효과 1차 판정용)

| at | n_30d | MAE | 사정률적중±0.01 | 사정률적중±0.02 |
|---|---|---|---|---|
| 지자체 | 87 | 0.7013 | **1.15%** | 2.30% |
| 군시설 | 46 | 0.5562 | 2.17% | 2.17% |
| 한전 | 16 | 0.4173 | **0.00%** | 0.00% |
| 교육청 | 4 | 0.5906 | 0.00% | 0.00% |
| LH | 3 | 0.6850 | 0.00% | 0.00% |

> ⚠ **메모리 baseline 표기와 실측 불일치 (§1 Q6)**: 메모리 `project_next_session_m33.md`에 "한전 LOCK baseline 30d hit01 16%, 지자체 10.9%" 적혀 있으나 위 실측은 한전 0%(n=16) / 지자체 1.15%. **다른 hit 정의(자사 1위 적중 `top1_win` vs 사정률 ±0.01 적중 `rate_hit@±0.01`)이거나 측정 식 오기**. → **R16 확정**: 두 메트릭 영구 분리(`V2_MEASUREMENT_SPEC.md §4.5`), 메모리 "16% / 10.9%"는 출처·정의 불명으로 **폐기**. 본 표의 hit은 전부 사정률적중.

### 4.3 V2 Mode A 군시설 WIN-zone (현재 측정값)

| measured_on | n | pct_in_win_zone | 목표 | gap |
|---|---|---|---|---|
| 2026-05-23 | 30 | **13.33%** | 15.00% | **-1.67pp** WARN |
| 2026-05-22 | 30 | 13.33% | 15.00% | -1.67pp WARN |
| 2026-05-21 | 30 | 13.33% | 15.00% | -1.67pp WARN |
| 2026-05-20 | 60 | 10.00% | 15.00% | -5.00pp WARN |
| 2026-05-19 (mixed) | 153 | 12.42% | 15.00% | -2.58pp WARN |

→ canonical 5/21 이후 13.33% 고정 (n=30 plateau), 5/19 mixed 대비 +0.91pp. **목표 도달 가능성 본질 의문 (코덱스 R15 §6.4 #4 재인용)**.

### 4.4 V2 Mode B floor_pass_daily _overall_ (canonical 추이)

| measured_on | model_version | n | actual_floor_pass_rate | calibration_gap | 판정 |
|---|---|---|---|---|---|
| 2026-05-23 | v2_modeB_canonical | 137 | 0.9708 | 0.0210 | ✅ PASS |
| 2026-05-22 | v2_modeB_canonical | 141 | 0.9716 | 0.0218 | ✅ PASS |
| 2026-05-21 | v2_modeB_canonical | 135 | 0.9704 | 0.0206 | ✅ PASS |

3일 연속 PASS — `mode_gate_report`에 canonical 적재는 5/25 cron 첫 실행 후 시작 예정.

### 4.5 mode_gate_report 적재 현황 (canonical 카운터) — 2026-05-26 갱신 ✅

5/25(월) weekly gate cron **첫 canonical 적재 확인** (jobid 18 modeB INSERT 6 + jobid 17 modeA INSERT 1, 5/25 01:00~01:15 UTC 모두 succeeded):

| report_week | mode | n_records | _overall_ B 판정 | created_at | canonical 카운터 |
|---|---|---|---|---|---|
| 2026-05-18 | A+B | 8 | PASS 0.9704 (n=135) | 5/24 06:19 (backfill) | 0주 (mixed/backfill) |
| 2026-05-19 | B | 7 | PASS 0.9600 (n=300) | 5/19 14:39 (backfill) | 0주 (mixed/backfill) |
| **2026-05-25** | **A+B** | **7** | **PASS 0.9704 (n=135)** | **5/25 01:00 (canonical weekly_gate)** | **1주 ✅** |

5/25 적재 7행: `_overall_` B PASS · 한전 B PASS(1.0, n=25) · 지자체 B PASS(0.9579, n=95) · 교육청 B PASS(1.0, n=6) · LH B PASS(1.0, n=6) · 조달청 B insufficient_sample(n=3) · **군시설 A WARN(pct_in_win_zone 0.1333 < 0.15, n=30)**.

**V6 retire 4주 PASS 카운터: 0주 → 1주 전환 완료** (첫 canonical weekly_gate 적재일=첫 PASS일=5/25). 다음 적재 6/1·6/8·6/15(월) — 4주 연속 PASS 시 6/15 충족 ETA. 단 **Mode A 군시설 WARN 잔존**으로 종료조건 완전 충족은 별도(§6).

### 4.6 v_shadow_bias_goyang 현재 상태 (R16-pre C 마이그)

| canonical_ag | n_90d | bias | mae | sd | promotion_status |
|---|---|---|---|---|---|
| `_overall_` | 8 | **-0.3857** | 0.7278 | 0.7822 | insufficient_or_low_bias |
| 경기도 고양시 | 6 | **-0.7423** | 0.7423 | 0.4012 | insufficient_or_low_bias |
| 경기도 고양시 덕양구 | 2 | +0.6841 | 0.6841 | 0.6528 | insufficient_or_low_bias |

→ **30일 +1.0491 → 90일 -0.3857 부호 반전** (R16-pre §3.2 발견 그대로 영구 확정). promotion_status로 자동 차단 — production 보정 금지.

### 4.7 v_cron_health (R16-pre D 마이그) — 2026-05-26 갱신

| jobid | jobname | n_runs_7d | success_pct | avg_dur_s | last_run (UTC) |
|---|---|---|---|---|---|
| 1 | collect_notices_every_30min | 336 | 100% | 0.14 | 5/26 10:00 |
| 2 | collect_results_daily_06kst | 7 | 100% | 0.13 | 5/25 21:00 |
| 4 | auto-predict-every-30min | 336 | 100% | 0.28 | 5/26 10:03 |
| 7 | refresh-analysis-assets-daily | 7 | 100% | 19.02 | 5/25 18:00 |
| 8 | prediction-quality-daily | 7 | 100% | 0.36 | 5/25 19:00 |
| 10 | v2_modeB_daily_calibration | 7 | 100% | 0.53 | 5/26 00:00 |
| 12 | v2_modeA_daily_winzone | 7 | 100% | 0.55 | 5/26 00:15 |
| **14** | match-pending-predictions-hourly | 95 | 100% | 43.07 | 5/26 10:15 |
| 15 | weekly-quality-report | 1 | 100% | 0.20 | 5/24 20:00 |
| **16** | mark-empty-duplicates-daily | 4 | 100% | 6.07 | 5/25 19:30 |

view 적재 job 전부 **success 100%**.

⚠ **신규 발견 (5/26, 트랙1 검증 산물)**: weekly gate job이 사전본의 jobid **11/13 → 17(modeA)·18(modeB)로 재생성**됨. 두 job 모두 5/25 01:00~01:15 UTC **succeeded**(`cron.job_run_details`: 18=INSERT 6, 17=INSERT 1) 했으나 **`v_cron_health` view에는 17·18(및 3)이 미포함** — view 필터가 구 jobid 기준 하드코딩이라 **weekly gate가 모니터링 view 사각지대**. canonical 적재 자체는 정상 작동(§4.5)이나, view는 `cron.job` 전체 동적 참조 또는 17/18 포함으로 갱신 권고.

### 4.8 매칭 진척 (n≥500 충족 + cron jobid 14 신설 효과)

| 지표 | 값 |
|---|---|
| total_pred | 2,278 |
| matched | **1,693** (74.3%) |
| matched_with_actual | **1,385** ✅ (n≥500 충족) |
| pred_30d | 818 |
| pred_7d | 190 (≈ 27건/일 신규) |

### 4.9 자사 1위 적중 예측 영향 (Generator 변경 1건만)

- A Step 1: **신규 추천부터 적용** — push 직후 13시간 동안 신규 예측 약 15건 (`pred_7d=190` 기준 1일 27건 × 0.5일)
- 매칭된 `bid_predictions.opt_adj`·`bid1st_v2_*` UPDATE 금지 정책 준수 (A안)
- 기타 18 commit (R16-pre + m31~m34 + match-automation + o3): **자사 1위 적중 영향 0** — 측정 인프라/데이터 무결성/매칭 자동화에만 작용

---

## 5. 항목별 점수 변화 예상 (R15 8.9/10 대비)

| 항목 (가중치) | R15 | R16 변화 예상 | 근거 |
|---|---|---|---|
| 도메인 정확성 (30%) | 9.0 | **상승 약함** | A Step 1 conservative 적용으로 산식-도메인 정합 1차 진전, m34 canonical_ag 11,447건 + at 45건 정합 회복. 단 효과 판정 미수신 |
| 안전성 (25%) | 8.8 | **상승** | A Step 1 5대 게이트 통과 (predict-architect + /evaluate + deploy-gate) + match-automation 단위 자동 감지 + o3 빈 record 자동 마킹 + shadow promotion_status 자동 차단 |
| 측정 일관성 (20%) | 9.1 | **유지/소폭** | canonical 정합 유지, weekly_gate 5/25 첫 적재 대기 (실제 4주 PASS 시작점) |
| 코드-문서 정합성 (15%) | 8.5 | **상승 강함** | A Step 1 설계 문서 §9·§10 코덱스 검증 영구 기록 + R16-pre §3·§4 + m33/m34 결과 + FORWARD_DIRECTION §6 의견 수렴 + commit 코드 주석 정합 |
| KPI 신뢰도 (10%) | 8.7 | **상승** | v_shadow_bias_goyang promotion_status로 부호 반전 자동 차단 사례 + v_cron_health로 전 cron 가시화 + A Step 1 baseline 정량 명문화 (효과 판정 가능) |

→ composite **8.9 → 9.1~9.3 추정**. 단 **A Step 1 효과 판정은 7~14일 후** 별도 라운드(R17 가능)에서 평가.

---

## 6. V2 마스터플랜 §9 종료 조건 진척

| 조건 | R15 (5/21) | R16 (5/23) | 5/26 보강 |
|---|---|---|---|
| n≥500 | ✅ matched 1,360 | ✅ matched 1,385 | ✅ 충족 유지 |
| **4주 연속 PASS** | ❌ canonical 0주 | ❌ canonical 0주 | ✅ **canonical 1주 (5/25)** |
| Mode B 통과율 ≥90% | ✅ 0.9704 (n=135) | ✅ 0.9708 (n=137) | ✅ **0.9704** (n=135, 5/25 weekly) |
| calibration gap ≤5pp | ✅ 0.0206 | ✅ 0.0210 | ✅ 안정 |
| Mode A WIN-zone ≥15% | ❌ WARN 10~13.33% | ❌ 13.33% (n=30) | ❌ **13.33% WARN** (5/25, plateau 유지) |

**V6 retire ETA**: ~2026-06-15 (canonical 1주=5/25 + 6/1·6/8·6/15 연속 PASS 시 4주 충족). 단 **Mode A 15% 미충족(13.33% WARN) 잔존** → Mode B 4주 카운터 충족해도 종료조건 완전 충족 불가. Mode A 본질 해결은 m33 단계 4(V2 Mode A WIN-zone 결합)에서만 가능.

---

## 7. 평가 항목 (라운드 15 동일 가중치)

1. 도메인 정확성 — 30%
2. 안전성 — 25%
3. 측정 일관성 — 20%
4. 코드-문서 정합성 — 15%
5. KPI 신뢰도 — 10%

추가 권고 받을 항목:
- **A Step 1 (첫 Generator 변경) 게이트 통과 결정의 5대 게이트 충분성** — predict-architect + /evaluate 5대(G-단위/G-A안/G-bias/G-모드표시/G-도메인) + deploy-gate가 conservative 0 clamp 변경에 over/under-engineering인가?
- **A Step 2 진입 조건 (지자체×ba 2D 테이블) 정량 트리거** — 코덱스 §9.7 권고 "7일 누적 + 핵심 at 회귀 없음 + 지자체 개선 방향 확인" 중 "지자체 개선 방향"의 정량 정의 (자사1위적중 `top1_win` +XX pp? 사정률적중±0.01 +XX pp? floor_pass_rate +YY pp?)
- **메모리 baseline 표기 불일치 (Q6)** — 정의 명확화 + 향후 라운드 의뢰문에 측정 정의 inline 권고
- **R16-pre `v_shadow_bias_goyang` 30/90일 부호 반전 사례를 다른 영역에도 표준 적용** — 한전/지자체/군시설 모두 90일 vs 30일 bias 비교 view 신설 권고
- canonical 4주 PASS 카운터 시작 정의 (첫 적재일 vs 첫 PASS일)
- A Step 1 효과 판정 7~14일 후 라운드 17 진입 vs 즉시 Step 2 진입 vs m31/m32 잔여 처리 우선순위

---

## 8. 단일 진실 문서 (본 라운드 평가 입력)

### 8.1 본 세션 신규 작성
- `docs/v2/CODEX_R16_PRE_FOLLOWUP_2026-05-22.md` — R16-pre B+C+D 적용 + 코덱스 평가 5건
- `docs/v2/A_WIN_OPT_GAP_DESIGN_2026-05-22.md` — A Step 1 설계 + 코덱스 §9·§10 검증
- `docs/v2/M33_DIAGNOSIS_2026-05-22.md` — false positive + cron UX 개선
- `docs/v2/M34_APPLY_RESULT_2026-05-22.md` — canonical_ag 11,447 + at 45 정합
- `docs/v2/FORWARD_DIRECTION_2026-05-21.md` — §6 코덱스 의견 수렴 영구 기록
- `docs/v2/CODEX_ROUND_16_BRIEF.md` (본 문서)

### 8.2 정책 문서 갱신
- `src/lib/constants-tables.js:13-37` — WIN_OPT_GAP A Step 1 적용 + 주석 7줄 (LOCK 사유 + 0 clamp 정책)
- `.claude/commands/accuracy.md` — 6체크 → 12체크 확장 (§10 at×route, §11 shadow bias, §12 cron health)

### 8.3 신규 마이그레이션
- `o3_mark_empty_duplicates_function` — 빈 record 중복 자동 마킹
- `o3_cron_mark_empty_duplicates_daily` — jobid 16 신설
- `d_cron_health_view` — v_cron_health 신설
- `c_goyang_shadow_bias_view` — v_shadow_bias_goyang 신설
- `m33_refresh_weekly_quality_recent` + `m33_cron_weekly_report_4w_backfill` (jobid 9 → 15)
- `m34_s2_canonical_ag_trigger_records` + `m34_s2_canonical_ag_backfill` + `m34_s3_at_standardize`

### 8.4 신규 cron (3건)
- jobid 14 — match-pending-predictions-hourly (5/22 신설, 7일 success 100%)
- jobid 15 — weekly-quality-report 4w backfill (5/22 jobid 9 갱신, 5/25 첫 실행)
- jobid 16 — mark-empty-duplicates-daily (5/22 신설, 1회 성공)

---

## 9. R16의 시스템적 가치

본 라운드는 R15 메타 점검 응답을 두 트랙으로 분리 실행한 분기점:

1. **Evaluator 우선 트랙 (B+C+D + m31~m34)** — 측정 인프라/데이터 무결성/cron 가시화/매칭 자동화로 **A Step 1 게이트 환경을 사전 정비**
2. **Generator 신중 트랙 (A Step 1)** — Phase 23-3 5단계 하네스 첫 완주 케이스 (1.설계 → 2.구축 → 3.검증 → 4.운영). predict-architect + /evaluate 5대 + deploy-gate 통과 → push
3. **검증 가능성 회복** — v_shadow_bias_goyang 30/90일 부호 반전 발견 + promotion_status 자동 차단으로 **production 보정 잘못된 방향 적용 사전 차단**
4. **메모리 baseline 정의 불일치 발견** — 향후 라운드 의뢰문에 측정 정의 inline 표기 필요성 노출
5. **자사 1위 적중 직접 영향 — A Step 1만** (신규 추천부터, 효과 판정은 7~14일 후 별도 라운드)

코덱스 평가 결과는 다음 트랙 진입 결정에 사용:
- **PASS·강한 호평** → A Step 2 (지자체×ba 2D) 7일 후 진입
- **WARN·보완 권고** → m31/m32 잔여 처리 우선 → Step 2 진입 지연
- **A Step 1 게이트 over-engineering 평가** → 5대 게이트 정책 조정 (장기 Generator 변경 빈도 ↑)

---

## 10. BRIEF 보강 결과 (2026-05-26 완료)

사전 준비본의 placeholder 항목 전부 실측 보강 완료:

- ✅ **§4.5** — week=2026-05-25 canonical row **7행 적재 확인** (weekly gate jobid 18 INSERT 6 + 17 INSERT 1, 5/25 01:00 UTC). _overall_ B PASS 0.9704.
- ✅ **§6** — V6 retire canonical 카운터 **0주 → 1주 전환 완료**. ETA ~6/15 (Mode A WARN 잔존으로 완전 충족 별도).
- ✅ **§1 Q5** — 첫 canonical 적재일=첫 PASS일=5/25 일치. weekly gate jobid **11/13 → 17/18 재생성** 확정.
- ✅ **§4.7 신규 발견** — `v_cron_health` view가 weekly gate(17/18) 미포함 = 모니터링 사각지대. view 필터 갱신 권고.
- ✅ **§1 Q6 hit 메트릭 정의 분리 확정** — `hit01` 약어가 **사정률적중**(`rate_hit@±0.01` = `|opt_adj−actual_adj_rate|≤0.01`, 한전 60d ≈1.7%)과 **자사1위적중**(`top1_win` = `top1_hit_*`, 한전 60d ≈74%)에 혼용됨. 두 메트릭 영구 분리, 정식 정의는 `V2_MEASUREMENT_SPEC.md §4.5`. 메모리 "한전 16% / 지자체 10.9%"는 폐기.
- ⏳ **A Step 1 7일 windowed 효과 측정 (Q2 입력)** — 5/26 `/accuracy` 재측정: **최신 스코어링이 5/22까지**(5/22 push 신규추천 아직 미매칭) → 효과 판정 데이터 미생성. **7~14일 누적 후(≥6/1) 재측정 필요**. **한전 LOCK 회귀 없음 확인**(60d **자사1위적중** ≈74% via 체크8 = `top1_hit` / 30d 핵심영역 MAE 0.4173·bias +0.1331). 군부대 bias +0.2448(⚠)·**자사1위적중≈0%**는 구조적, A Step 1 무관.

---

_의뢰자: Claude Opus 4.7 / 사전 준비본 2026-05-23 (A Step 1 push +13h) · **보강 완료 2026-05-26**_
_본 라운드는 단순 정정/fix 평가가 아닌 **Evaluator 묶음 + 첫 Generator 변경(A Step 1) 통합 평가**_
_2026-05-26 §4.5·§4.7·§6·§10·Q5 실측 보강 완료 → 코덱스 의뢰 발송 준비 (A Step 1 효과 판정은 ≥6/1 누적 후 별도 라운드)_
