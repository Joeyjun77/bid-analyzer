# O3 자동 마킹 트리거 — 빈 record 중복 자동 처리 (2026-05-22)

## 1. 배경
`M30_DEDUP_PATTERN_2026-05-22.md` §5.2 후속 — m30 113건 패턴(인포21c가 같은 공고를 rbidNo 001/002로 빈 record 중복 발행) 향후 자동 차단.

## 2. 설계 정책

### 2.1 마킹 조건
| 조건 | 사유 |
|---|---|
| `is_duplicate IS NOT TRUE` | 이미 마킹된 row 재처리 방지 |
| `ar1 IS NULL` | 사정률 데이터 없는 빈 record |
| `bp IS NULL` | 낙찰가 데이터 없는 빈 record |
| 그룹 `(pn_no, ag, od, ba)`에 2건 이상 | 진짜 중복 |

### 2.2 keep 정책
- 그룹 내 `(created_at ASC, id ASC)` 가장 첫 row keep
- 나머지 `is_duplicate=true` 마킹

### 2.3 안전망
- **한 쪽이라도 ar1/bp 채워진 경우 자동 마킹 안 함** — 정상 데이터 보호
- 단일 빈 record (그룹에 1건만)는 마킹 안 함 — 향후 사정률 채워질 가능성

## 3. 적용 마이그레이션 (2건)

### 3.1 `o3_mark_empty_duplicates`
`public.mark_empty_duplicates() RETURNS int` 신설.
- SECURITY DEFINER + service_role grant
- 멱등 (반복 실행 안전)

### 3.2 `o3_cron_mark_empty_duplicates_daily`
cron jobid 16, `mark-empty-duplicates-daily`, `30 19 * * *` (매일 19:30 UTC = 04:30 KST).
- 다른 cron 시간과 충돌 없음 (jobid 8 prediction-quality-daily 19:00 직후)

## 4. 첫 실행 결과
| 항목 | Before | After | Δ |
|---|---|---|---|
| `is_duplicate=true` | 113 | **114** | +1 |
| 빈 record(ar1+bp NULL) 잔존 | 5,206 | **5,205** | -1 (마킹된 1건 제외) |

→ m30이 이미 113건 처리 + O3가 잔존 1건 추가 마킹. 남은 5,205건은 **단일 그룹의 단일 빈 record** (향후 사정률 채워질 가능성 보존, 마킹 대상 아님).

## 5. cron 전체 (jobid 16 추가)
| jobid | jobname | schedule |
|---|---|---|
| 1 | collect_notices_every_30min | `*/30 * * * *` |
| 2 | collect_results_daily_06kst | `0 21 * * *` |
| 4 | auto-predict-every-30min | `3,33 * * * *` |
| 7 | refresh-analysis-assets-daily | `0 18 * * *` |
| 8 | prediction-quality-daily | `0 19 * * *` |
| 10 | v2_modeB_daily_calibration | `0 0 * * *` |
| 11 | v2_modeB_weekly_gate | `0 1 * * 1` |
| 12 | v2_modeA_daily_winzone | `15 0 * * *` |
| 13 | v2_modeA_weekly_gate | `15 1 * * 1` |
| 14 | match-pending-predictions-hourly | `15 * * * *` |
| 15 | weekly-quality-report (4주 backfill) | `0 20 * * 0` |
| **16** | **mark-empty-duplicates-daily** | **`30 19 * * *`** (오늘 신설) |

## 6. Phase 23-3 게이트
| 게이트 | 결과 |
|---|---|
| Generator 분류? | **No** (DB 마이그레이션, 예측 로직 미변경) |
| Evaluator 분류 | **Yes** (데이터 무결성 자동화) |
| /evaluate 면제 | **Yes** |
| deploy-gate | 면제 (코드 변경 0) |

## 7. 후속 모니터링
- 매일 19:30 UTC cron 실행 후 `is_duplicate=true` 증가량 추적
- 갑작스러운 증가(예: 일배치당 10건+) 발생 시 인포21c 발행 패턴 변경 의심 → 별도 진단
- 분기 단위 인포21c API 재탐색 (사정률 endpoint 추가 여부 점검)

## 8. 관련 문서
- `M30_DEDUP_PATTERN_2026-05-22.md` — 113건 패턴 진단 (본 작업의 원인 출처)
- `Z_DETAIL_API_PROBE_2026-05-22.md` — 인포21c API 사정률 자동 수집 불가 확인
- `MATCH_AUTOMATION_2026-05-22.md` — A 트랙 매칭 자동화 (jobid 14)

---
_처리자: Claude Opus 4.7 / 처리 일자: 2026-05-22 / 후속: 분기 인포21c API 재탐색_
