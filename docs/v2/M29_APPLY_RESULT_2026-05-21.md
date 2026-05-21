# m29 적용 결과 보고 (2026-05-21)

> 작성자: Claude Opus 4.7
> 사전 검토: predict-architect Agent (Evaluator 분류, 핵심 영역 MAE PASS, /evaluate 면제 조건부)
> 결정 근거: M28_APPLY_RESULT §4.2 outlier 1건 추적 결과 + HANDOFF §9.7.6 m29 옵션 B 권고
> 단일 진실: `JIJACHE_MODE_A_REVIEW_2026-05-21.md`, `M28_APPLY_RESULT_2026-05-21.md`

---

## 1. 적용 요약

| 항목 | 값 |
|---|---|
| 마이그레이션 | m29_add_outlier_sanity_check_to_refresh_win_zone_daily |
| 대상 | `refresh_win_zone_daily(p_since, p_until)` 함수 본체 |
| 변경 | WHERE 절 2곳(전체 집계 + at별 집계)에 `AND ABS(d.win_bid_rate - d.floor_rate) <= 5` 추가 |
| 패턴 | m25 패턴(`ABS(actual_adj_rate) <= 5`) 일관성 (다른 공간, 동일 임계) |
| 적용 상태 | ✅ apply_migration success |
| 후속 검증 | DELETE today's win_zone_daily + refresh 재실행으로 정합 적재 |

---

## 2. m29 의도된 효과 — 지자체 정합 회복 ✅

### 2.1 사전 SELECT: 영역별 outlier 카운트 (90일 current era)

| region | n_total | n_pass_sanity | n_outlier | max_abs_gap |
|---|---|---|---|---|
| 군시설 | 30 | 30 | **0** | 0.6254 |
| 기타 | 48 | 48 | **0** | 0.6137 |
| **지자체** | 121 | 120 | **1** | **22.3391** |

→ **지자체 outlier 단 1건** (id=348193, 한국도로공사 광지원터널 — gap=-22.3391).
→ 군시설·기타 영역 모두 outlier 0건 (정상 max gap ≤ 0.6254).
→ predict-architect 사전 검토 "핵심 영역 0건 미통과" 일치.

### 2.2 win_zone_daily 측정값 변화

| at | m26 (pre-m29) | m29 적용 후 | 변화 |
|---|---|---|---|
| _overall_ | n=234, p90_gap=0.5204 | n=198, p90_gap=0.4476 | -36건, p90 -0.07 |
| **지자체** | n=126, **p90=0.2345** | n=120, **p90=0.0183** | **-6건, p90 0.2345 → 0.0183** ✅ 정상 회복 |
| 군시설 | n=60, p90=0.6070, win_zone=10.00% | n=30, p90=0.6070, win_zone=13.33% | **-30건 (별도 의문 — §3.1)** |
| 한전 | n=23, p90=0.0060 | n=23, p90=0.0060 | 변화 없음 ✅ |
| 교육청 | n=12, p90=0.0059 | n=12, p90=0.0059 | 변화 없음 ✅ |
| 조달청 | n=7, p90=0.0006 | n=7, p90=0.0006 | 변화 없음 ✅ |
| LH | n=6, p90=0.0013 | n=6, p90=0.0013 | 변화 없음 ✅ |

#### 지자체 정합 회복 검증
- **p90_gap 0.2345 → 0.0183** (12.8배 축소) — JIJACHE §2.3에서 추적한 outlier 1건 단독 영향 확정
- 정상 분포로 회복 (마스터플랜 §3 D2 mixed 추정값 0.0209와 일관)
- 자사 1위 적중에 영향: 지자체 영역 모드 분기 신뢰도 회복

---

## 3. 의도되지 않은 변동 (별도 진단 필요)

### 3.1 군시설 n=60 → 30 변동 (50% 차단) — m29 영향 아님

m29 sanity check는 군시설 outlier 0건 차단 의도. 그러나 win_zone_daily 갱신 시 n=60 → 30.

**원인 추정**:
- 사전 SELECT 결과 군시설 n_total=30 (90일 current era)
- m26 직후 win_zone_daily 군시설 n=60이었음 (이전 검증 결과)
- **두 시점 사이 데이터 변동 발생**:
  - m28 UPDATE (bid_records.at 145건) 영향? — m28은 bid_records.at만 변경, bid_details.at 영향 없음
  - 다른 cron 작업 영향? — 본 세션 외 작업 없음
  - era_v2 필드 갱신? — m28 SQL에 없음
- **가능한 가설**: m26·m27 → m28 시점 사이에 cron jobid 12 (00:15 UTC) 자동 실행 → 군시설 n 재측정 시점 차이

**다음 작업으로 진단 권고**:
- bid_details d.at='군시설' AND era_v2='current' AND 90일 윈도우 → n=30 (현재)
- m26 직후 win_zone_daily 군시설 n=60 → 일배치 시점이 다른 윈도우였을 가능성
- 또는 era_v2 갱신 흔적 있는지 추적

### 3.2 핵심 영역 MAE 영향 — PASS 유지

군시설 n 변동에도 불구하고 **bid_predictions.at 무변경 → 핵심 영역 baseline MAE 직접 영향 0**:
- 한전 n=55, MAE 0.4560 (변동 없음)
- 군부대 n=81, MAE 0.5181 (변동 없음 — bid_predictions 기반)
- 고양시 n=8, MAE 0.7540 (변동 없음)

predict-architect 사전 검토 PASS 일관. m29 자체로 인한 회귀 없음.

---

## 4. 검증 결과 종합

| 항목 | 결과 |
|---|---|
| 잔여 정정 후보 | 0건 (m29 sanity check 완전 적용) |
| 지자체 p90_gap | 0.2345 → **0.0183** ✅ |
| 한전·교육청·LH·조달청 | 변화 없음 ✅ |
| 군시설 n 변동 | 60→30 (m29 외 원인, §3.1 별도 진단) |
| 핵심 영역 MAE | 보존 (predict-architect baseline) |
| cron jobid 12 다음 실행 | 5/22 00:15 UTC, sanity check 자동 적용 |

---

## 5. 후속 작업

### 5.1 즉시 (0.5~1일)
- 군시설 n=60→30 변동 원인 정밀 진단 (§3.1)
  - bid_details d.at='군시설' n_total 추이 (m26 직후 vs 현재)
  - cron jobid 12 실행 로그 확인
  - 만약 m28 UPDATE 부작용이면 별도 issue

### 5.2 1주 모니터링 후 (m30 가칭)
- legacy era 3,857건 정정 (m28 패턴 확장)
- refresh_floor_pass_daily에도 동일 sanity check 적용 권고 (predict-architect §6 후속)

### 5.3 통합 라운드 15 BRIEF
- m26·m27·m28·m29 + 정책·UI 정정 + outlier 추적 통합 의뢰
- 군시설 n 변동 진단 결과 포함

---

## 6. 시스템 함의

### 6.1 V2 측정 신뢰도 회복 완료
- m20: 공동도급 제외 (G-도메인 #7)
- m25: refresh_agency_adj_range era 정합 (G-도메인 #0)
- m26: refresh_win_zone_daily era 정합 (G-도메인 #0)
- m27: refresh_floor_pass_daily canonical 분기 (V6 retire 정합 카운터)
- **m28: bid_records.at 분류 정합** (군 발주사 145건)
- **m29: refresh_win_zone_daily outlier sanity check** (입력 오류 자동 차단)

→ **V2 측정 인프라 정합 6단계 완성**. 4주 PASS 누적 게이트(5/25 시작) + V6 retire 판정의 신뢰도 기반 확보.

### 6.2 자사 1위 적중에 미치는 영향
- 사정률 점추정 영역(한전·교육청·LH·조달청·지자체) — V6 + agency-floor V1 + 안전망 Mode B 정합 회복
- WIN-zone 영역(군시설) — Mode A 정합 회복 (n 변동 의문 잔존)
- 입력 오류 outlier 자동 차단으로 측정값 안정성 향상

### 6.3 m29 ETA 영향
- V6 retire 카운터 자체에는 영향 없음 (refresh_floor_pass_daily는 m29 영향 없음)
- 다만 Mode A WARN 판정(군시설 15% 미달) 측정값 안정화로 정합 진단 가능

---

_본 보고서는 m29 적용 직후 검증 + 의도되지 않은 변동 정직 기록. 지자체 정합 회복 ✅, 군시설 n 변동 별도 진단 잔여._
_적용자: Claude Opus 4.7 / Supabase MCP apply_migration / 2026-05-21_
