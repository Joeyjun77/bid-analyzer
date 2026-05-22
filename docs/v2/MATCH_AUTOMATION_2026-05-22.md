# 매칭 자동화 + ar1 단위 자동 감지 — 2026-05-22

## 1. 배경
사용자 발화 "오늘 낙찰데이터 매칭 확인" — 실제 사정률과 예측 사정률이 매칭되지 않는다.

원래 다음 세션 첫 작업은 **m33** (`weekly_quality_report` cron silent fail fix)이었으나, 사용자가 매칭 진단을 먼저 요청 → **m33 pre-step**으로 매칭 자동화 + ar1 단위 자동 감지를 처리하고 m33은 다음 세션으로 미룬다.

## 2. 진단 결과 (오늘 2026-05-22 기준)

### 2.1 표면 증상
- 5/18~5/22 예측 190건: `match_status='pending'` 100% (record 매칭 0건)
- 5/11~5/15 예측 256건: matched 41건이지만 `actual_adj_rate=NULL` (백필 0건)
- 마지막으로 `actual_adj_rate` 채워진 날: 5/14 (62/102)

### 2.2 진짜 원인 — 3개 버그
1. **버그 #1 — 매칭은 클라이언트 전용**
   - `sbMatchPredictions` (src/lib/supabase.js:20)는 App.jsx 초기 로드와 파일 업로드 후에만 실행
   - cron 자동화 없음 → 사용자가 앱을 안 켜면 매칭 영구 지연
   - 5/17·5/18·5/21 매칭 시각은 사용자가 앱을 켰던 시점

2. **버그 #2 — line 35 `if(p.match_status==="matched")continue;`**
   - 매칭 당시 record의 ar1이 NULL이면 `actual_adj_rate=null`로 박힘
   - 이후 ar1 채워진 record가 들어와도 **재매칭 안 됨**
   - 결과: 5/11~5/15 matched 41건 모두 actual=NULL로 고착

3. **버그 #3 — ar1 단위 혼재**
   - `bid_records.ar1` 컬럼에 두 단위 공존: 100% 기준(52,844건, 84~110 범위) + 0% 기준(17건, -2~+18 범위)
   - 0% 기준 17건 거의 전부가 2026-05-22 11:07 UTC 단일 시점에 외부 수동 적재
   - App 코드(`ar1-100`)는 100% 기준 가정 → 0% 기준 record 만나면 -100 오차 박힘

### 2.3 백필 가능 영역 측정
matched + actual NULL **317건** 중:
| 회복 경로 | 가능 건수 |
|---|---|
| 매칭된 record에 ar1 직접 존재 | **0** |
| xp+ba 있어 ar1 계산 가능 | **0** |
| 같은 pn_no 다른 record에 ar1 존재 (exact) | **0** |
| **prefix 매칭으로 ar1 있는 별도 record 존재** | **18** (그중 100% 기준 16) |

→ 즉시 백필 가능 16건, 나머지 299건은 인포21c 정상 record(ar1 포함)가 도착해야 회복 가능.

### 2.4 데이터 동기성 — Z-CALC 무효 확정
최근 14일 `bid_records` 채움률:
- `n_ba == n_ar1` (정확히 동일, 항상)
- `n_recoverable` (ba 있는데 ar1 NULL) = **0**

→ ba와 ar1이 함께 움직임. **xp/ba로 ar1 자동 계산하는 마이그레이션(Z-CALC) 효과 0**.

## 3. 적용된 작업 (R2 옵션)

### 3.1 Q1 — 1회성 백필 16건
- prefix 매칭으로 ar1 있는 별도 record 식별 (ag 첫4자 일치 + 30일 이내 + ar1 BETWEEN 80 AND 120)
- 0% 기준 ar1 2건(pred 11904·12091) 스킵 (안전)
- `matched_record_id` 갱신 + `actual_adj_rate`/`actual_expected_price`/`actual_bid_amount`/`actual_winner`/`actual_participant_count`/`adj_rate_error`/`bid_amount_error`/`matched_at` 8개 컬럼 백필

### 3.2 Q2 — `src/lib/supabase.js` 3곳 수정
- **line 32** `usedRecIds`: `actual_adj_rate IS NOT NULL` 케이스만 used에 등록 (재매칭 대상은 풀로 환원)
- **line 35**: matched이지만 `actual_adj_rate` NULL이면 재매칭 허용 — `if(p.match_status==="matched"&&p.actual_adj_rate!=null)continue;`
- **line 75**: ar1 단위 자동 감지 — `ar1>=50 ? ar1-100 : ar1`
- 빌드 통과: 861.63 kB → gzip 273.82 kB

### 3.3 Q3 — 서버 자동화 (cron jobid 14)
- `match_pending_predictions()` SQL 함수 신설 — `sbMatchPredictions` 로직 SQL 포팅
  - 대상: `match_status='pending' OR (matched AND actual_adj_rate IS NULL)`
  - exact pn_no → prefix fallback (ag 검증)
  - ar1 채워진 후보 우선, 그 다음 open_date 가까운 record
  - 30일 컷, 단위 자동 감지, 멱등 UPDATE
  - 마이그레이션: `m33_pre_match_pending_predictions`
- cron jobid 14 — `15 * * * *` (매시간 15분, 다른 cron과 시간 겹치지 않게)
  - 마이그레이션: `m33_pre_cron_match_predictions_hourly`
- 첫 실행: 14건 갱신 (pending→matched 6건, actual NULL 백필 8건)

### 3.4 Z 작업 — 보류
- **Z-CALC 무효 확정** (n_recoverable=0, 위 §2.4)
- **Z-DETAIL** (별도 commit 예정): 인포21c PASS A 응답에 사정률 필드 포함 여부 검증 → upsert_bid_record 매핑 추가 또는 detail fetch edge function 신설
  - 작업량: 3~4시간
  - 우선순위: m33 다음

## 4. 최종 통계

### 4.1 매칭 통계 변동
| 항목 | Before | After | Δ |
|---|---|---|---|
| n_matched | 1,681 | **1,692** | +11 |
| n_with_actual | 1,364 | **1,386** | +22 |
| n_pending | 564 | **553** | -11 |
| n_matched_null_actual | 317 | **306** | -11 |

### 4.2 cron 전체 (jobid 14 신설 후)
| jobid | jobname | schedule |
|---|---|---|
| 1 | collect_notices_every_30min | `*/30 * * * *` |
| 2 | collect_results_daily_06kst | `0 21 * * *` |
| 4 | auto-predict-every-30min | `3,33 * * * *` |
| 7 | refresh-analysis-assets-daily | `0 18 * * *` |
| 8 | prediction-quality-daily | `0 19 * * *` |
| 9 | weekly-quality-report | `0 20 * * 0` (m33 silent fail) |
| 10 | v2_modeB_daily_calibration | `0 0 * * *` |
| 11 | v2_modeB_weekly_gate | `0 1 * * 1` |
| 12 | v2_modeA_daily_winzone | `15 0 * * *` |
| 13 | v2_modeA_weekly_gate | `15 1 * * 1` |
| **14** | **match-pending-predictions-hourly** | **`15 * * * *`** (신설) |

## 5. Phase 23-3 게이트 판정

| 게이트 | 결과 |
|---|---|
| Generator 분류? | **No** — `getFinalRecommendation` / `opt_adj` / `pred_bias_map` / 낙찰하한율 함수 미변경 |
| Evaluator 분류 | **Yes** — `sbMatchPredictions`는 매칭 백필 코드 |
| /evaluate 면제 | **Yes** |
| predict-architect 면제 | **Yes** |
| deploy-gate (push 직전) | 호출 필요 (CLAUDE.md 4단계 운영 트리거) |

## 6. 알려진 한계 / 후속 작업

### 6.1 ar1 NULL인 매칭 케이스 306건
- 인포21c가 list 응답에 사정률을 거의 안 보냄
- Q3 cron이 매시간 돌면서 새 ar1 들어올 때마다 자동 회복 — 자연 누적 대기
- 근본 fix는 Z-DETAIL

### 6.2 0% 기준 ar1 17건 — 정정 안 함
- App 코드는 단위 자동 감지로 대응 (line 75)
- 17건 정정 마이그레이션은 별도 작업 (현재 위험 0)

### 6.3 5/22 외부 수동 적재 경로 미식별
- 11:07 UTC에 적재된 12건은 `api_ingestion_log`에 흔적 없음
- fn-collect-results 우회 — 외부 스크립트 또는 수동 SQL 추정
- 추적 어려움. 새 적재 시 동일 패턴 감지되면 별도 진단

## 7. 다음 세션
- **m33 본 작업 진입**: `weekly_quality_report` cron silent fail 함수 본체 분석 + 5/11·5/18 backfill
- m33 다음: **m34 + m32** (`FORWARD_DIRECTION_2026-05-21.md` §6.5)
- 그 다음: **Z-DETAIL** (인포21c PASS A 응답 검증 + detail fetch 추가)

---
_처리자: Claude Opus 4.7 / 처리 일자: 2026-05-22 / 후속: m33 (cron silent fail) + Z-DETAIL (detail fetch)_
