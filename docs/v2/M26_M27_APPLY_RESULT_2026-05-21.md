# m26·m27 적용 결과 보고 (2026-05-21)

> 작성자: Claude Opus 4.7
> 사전 검토: predict-architect Agent (Evaluator 분류, 핵심 영역 MAE PASS, /evaluate 면제)
> 결정 근거: 코덱스 메타 상의(2026-05-21) + Claude DB 진단 + 사용자 "m26+m27 즉시 적용" 결정
> 단일 진실: `docs/v2/SYSTEM_AUDIT_2026-05-21.md`, `docs/v2/HANDOFF_NEXT_SESSION.md` §9

---

## 1. 적용 요약

| 마이그레이션 | 함수 | 변경 | 적용 상태 |
|---|---|---|---|
| **m26** | `refresh_win_zone_daily` | `era_v2='current'` 필터 추가 + 공동도급 제외 유지 (m20) | ✅ apply_migration success |
| **m27** | `refresh_floor_pass_daily` | conditional WHERE: `p_model_version='v2_modeB_canonical'` 시 `era_v2='current'` | ✅ apply_migration success |
| cron jobid 10 (daily refresh) | `cron.alter_job` | model_version: `v2_modeB_real` → `v2_modeB_canonical` | ✅ |
| cron jobid 11 (weekly Mode B gate) | `cron.alter_job` | 조회 model_version 동일 전환 | ✅ |

cron jobid 12·13 (Mode A daily refresh + weekly gate): m26 함수 변경으로 자동 정합 (model_version 인자 없음).

---

## 2. m26 효과 — win_zone_daily 2026-05-21 (current-only)

| at | n | pct_pass_floor | pct_pass_top1 | **pct_in_win_zone** | avg_gap | p90_gap |
|---|---|---|---|---|---|---|
| _overall_ | 234 | 62.82 | 40.60 | 3.85 | 0.0273 | 0.5204 |
| LH | 6 | 66.67 | 33.33 | **0.00** | 0.0005 | 0.0013 |
| 교육청 | 12 | 66.67 | 33.33 | **0.00** | 0.0523 | 0.0059 |
| **군시설** | **60** | 70.00 | 40.00 | **10.00** | 0.3354 | **0.6070** |
| 조달청 | 7 | 28.57 | 71.43 | **0.00** | 0.0003 | 0.0006 |
| **지자체** | 126 | 60.32 | 41.27 | **2.38** | -0.1148 | **0.2345** |
| 한전 | 23 | 65.22 | 34.78 | **0.00** | 0.0037 | 0.0060 |

### 핵심 발견

#### 2.1 군시설: 12.42% → 10.00% (mixed → current-only)

- mixed 데이터 (legacy 155 + current 31)의 win-zone 진입률 = 12.42%
- **current-only (n=60, 60일 윈도우) win-zone 진입률 = 10.00%**
- mixed 측정이 실제 성과를 +2.42%p **부풀려서 측정**하고 있었음. 코덱스의 "post-m20 기준 수치 미고정" 우려가 정확히 적중.
- 목표 15%까지 **-5.00%p** 격차. Mode A 군시설 자체의 한계 가능성 (HANDOFF §8.4 "Mode A WARN 처리" 미해결 의문 강화).

#### 2.2 지자체 p90_gap = 0.2345 — Mode A 후보 영역 부상

- 마스터플랜 §3 D2 표 기준 지자체 p90_gap = **0.0209** (이전 측정)
- m26 current-only 재측정: p90_gap = **0.2345** (10배 이상 증가)
- 마스터플랜 §3 D2 모드 분기 조건 `gap_p90 ≥ 0.10` → **지자체 Mode A 가동 후보 영역**으로 부상
- 지자체 n=126 (60일 current), Mode A 표본 충분
- 단 pct_in_win_zone = 2.38%로 매우 낮음 → 지자체 Mode A 가동해도 즉시 PASS 도달 어려움

#### 2.3 다른 영역 (한전·교육청·LH·조달청) — WIN-zone 0%

- 모두 p90_gap < 0.01 — 사정률 산포 극히 작음
- pct_pass_floor 60~70% (하한 통과는 하지만)
- pct_in_win_zone = 0.00% (1위 가능 범위 진입 0)
- 의미: 자사 my_bid_rate가 win_bid_rate를 거의 항상 초과 = **자사 투찰가가 1위 가능 범위보다 너무 보수적**
- 또는 자사 사정률 신고가 1위 사정률과 산포만큼 빗나감 (sub-percent 단위)
- 마스터플랜 §3 D2 권장 모드 (B) 유지 — 사정률 점추정 정확도가 본질

#### 2.4 조달청 pct_pass_top1 = 71.43% — 이상치

- 조달청 n=7로 표본 매우 부족
- pct_pass_floor (28.57%) < pct_pass_top1 (71.43%) 패턴 — 비정상
- HAVING COUNT(*) >= 3 통과했으나 신뢰구간 매우 넓음
- 마스터플랜 §3 D2의 "B + 공격성 교정" 정책 유효

---

## 3. m27 효과 — floor_pass_daily 2026-05-21 (v2_modeB_canonical)

| at | n | pred | actual | gap | model_version |
|---|---|---|---|---|---|
| _overall_ | 135 | 0.9498 | 0.9704 | 0.0206 | v2_modeB_canonical |
| LH | 6 | 0.9500 | 1.0000 | 0.0500 | canonical |
| 교육청 | 6 | 0.9500 | 1.0000 | 0.0500 | canonical |
| 조달청 | 3 | 0.9500 | 1.0000 | 0.0500 | canonical |
| 지자체 | 95 | 0.9497 | 0.9579 | 0.0082 | canonical |
| 한전 | 25 | 0.9500 | 1.0000 | 0.0500 | canonical |

### 핵심 발견: v2_modeB_canonical ≡ v2_modeB_real (5/21 시점)

- 5/21 측정값이 v2_modeB_real(mixed)와 **완전히 동일**
- 의미: 현재 `bid_predictions.b_pred_*` 컬럼에 적재된 row가 **이미 모두 current era**에서 생성됐음
- m27의 era_v2 필터는 향후 legacy era row가 b_pred_* 컬럼에 들어올 경우의 **안전망**으로 작동
- 즉 m27 자체는 5/21 시점 즉각적 측정값 변화 없음, 다만 **정합 기준 확립**

### V6 retire 게이트 카운터 영향

- 5/18·5/19 PASS 누적 (mixed real 기준) → **무효**
- v2_modeB_canonical 첫 weekly gate: **5/25(월)** jobid 11 자동 실행 시점
- 4주 연속 PASS 완성까지 ~6주 (~2026-06-22)
- V6 retire ETA: ~2026-06-22 무렵 (이전 추정 5/26 → +4주 연장)

---

## 4. cron 정합 상태 (적용 후)

| jobid | 스케줄 | 함수/조회 | 정합 상태 |
|---|---|---|---|
| 10 | 매일 00:00 UTC | `refresh_floor_pass_daily(...,'v2_modeB_canonical',24)` | ✅ canonical 정합 |
| 11 | 매주 월 01:00 UTC | mode_gate_report Mode B (model_version='v2_modeB_canonical') | ✅ canonical 정합 |
| 12 | 매일 00:15 UTC | `refresh_win_zone_daily()` — 함수 본체 era 필터 | ✅ current-only 자동 |
| 13 | 매주 월 01:15 UTC | mode_gate_report Mode A 군시설 win_zone_daily | ✅ current-only 자동 (jobid 12 결과 의존) |

→ **4개 cron 모두 G-도메인 #0·#7 정합 상태**. V6 retire 판정 신뢰도 회복.

---

## 5. 시사점 (코덱스 메타 상의에 대한 보강)

### 5.1 코덱스 우려 검증 결과
- **post-m20 기준 수치 고정 필요** → ✅ 확인. 군시설 +2.42%p 부풀림이 mixed에서 발생.
- **4주 PASS 누적이 mixed 기준이면 retire 판정 신뢰도 의심** → ✅ 확인. v2_modeB_canonical로 카운터 신규 시작.

### 5.2 시스템 점검 보고서(SYSTEM_AUDIT)의 영역별 모드 적합성 재평가에 미친 영향
- **지자체** = Mode A 후보 영역으로 부상 (p90_gap 0.0209 → 0.2345)
- **군시설** = Mode A WARN 더 심각 (12.42% → 10.00%, current-only 측정 시)
- 그 외 영역 (한전·교육청·LH·조달청) = Mode B 영역 유지 (p90_gap < 0.01)

### 5.3 마스터플랜 §3 D2 표 갱신 필요

마스터플랜 §3 D2의 영역별 gap p90 표는 mixed 기준일 가능성. m26 적용으로 current-only 측정값 확보:

| 영역 | §3 D2 표 (이전) | m26 current-only (2026-05-21) | Mode 권장 |
|---|---|---|---|
| 군시설 | 0.7993 | 0.6070 | A (유지) |
| 지자체 | 0.0209 | **0.2345 (10배+)** | **B + 조건부 A** (§3 D2 그대로지만 조건부 A 활성화 가능) |
| 교육청 | 0.0102 | 0.0059 | B (유지) |
| 한전 | 0.0060 | 0.0060 | B (유지) |
| 조달청 | 0.0019 | 0.0006 | B (유지) |
| LH | 0.0060 | 0.0013 | B (유지) |

→ 지자체 외 영역은 측정값 유사. **지자체의 Mode A 조건부 활성화**가 다음 검토 대상.

---

## 6. 후속 작업 (코덱스 권고 갱신)

| # | 작업 | 우선순위 | 코드/문서 변경 |
|---|---|---|---|
| 6.1 | 본 결과(§3 D2 표 갱신 포함)를 HANDOFF §9에 추가 | 즉시 | 문서 |
| 6.2 | 지자체 Mode A 조건부 활성화 검토 — `lookup_agency_mode` RPC 동작 확인 + 지자체 grain별 gap_p90 조회 | 1~2일 | 진단 |
| 6.3 | 군시설 10.00% WARN의 본질 검토 — 군시설 Mode A 자체 적합성 (15% 목표 도달 가능성) | 1주 | 정책 검토 |
| 6.4 | 마스터플랜 §3 D2 표를 m26 current-only 값으로 갱신 | 1~2일 | 문서 |
| 6.5 | 라운드 15 BRIEF — m26·m27 fix + 본 결과 + 후속 작업 통합 의뢰 | 6.1~6.4 완료 후 | 코덱스 의뢰 |

라운드 N+1 BRIEF는 **메타 결정 반영 후 1회 통합** (코덱스 권고 Q4 — 6.5 시점).

---

## 7. 다음 cron 자동 실행 일정

- 5/22 00:00 UTC: jobid 10 daily refresh (canonical 첫 일배치)
- 5/22 00:15 UTC: jobid 12 win_zone_daily (current-only 두 번째)
- 5/25 01:00 UTC: jobid 11 **canonical 첫 weekly gate** (V6 retire 카운터 시작점)
- 5/25 01:15 UTC: jobid 13 Mode A weekly gate (current-only)

5/25 게이트가 PASS면 V6 retire 카운터 1주 누적 시작. 4주 PASS 완성: 2026-06-22 무렵.

---

_본 보고서는 m26·m27 적용 직후 정합 검증 + 영역별 측정값 재평가 결과. 사용자 결정으로 4주 PASS 카운터 초기화 비용을 감수하고 정합 회복 우선._
_적용자: Claude Opus 4.7 / Supabase MCP apply_migration / cron.alter_job / 2026-05-21_
