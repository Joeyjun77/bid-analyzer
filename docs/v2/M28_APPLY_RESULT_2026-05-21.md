# m28 적용 결과 보고 (2026-05-21)

> 작성자: Claude Opus 4.7
> 사전 검토: predict-architect Agent (Evaluator 분류, 핵심 영역 MAE PASS, /evaluate 면제 조건부)
> 결정 근거: JIJACHE_MODE_A_REVIEW_2026-05-21.md §4.1 High 우선순위 + 사용자 옵션 A 채택
> 단일 진실: `JIJACHE_MODE_A_REVIEW_2026-05-21.md`, `SYSTEM_AUDIT_2026-05-21.md`

---

## 1. 적용 요약

| 항목 | 값 |
|---|---|
| 마이그레이션 | m28_fix_bid_records_at_military_misclass |
| 대상 | `bid_records` UPDATE (UPDATE만, DELETE 없음) |
| 범위 | era_v2='current' 한정 (legacy 보존, 단계적 롤아웃) |
| 조건 | `at='지자체'` AND `canonical_ag` 군 키워드(`사령부`/`^제\s?[0-9]+부대`/`^[0-9]+부대`) AND NOT `%대학교%` |
| 거짓 양성 차단 | `중부대학교` 1건 제외 (predict-architect 권고 화이트리스트) |
| 영향 row | **145건 UPDATE → 27개 발주사 정정** |
| 적용 상태 | ✅ apply_migration success |

---

## 2. 정정 대상 발주사 27개 (사전 SELECT 보관)

| 순위 | canonical_ag | n | first_od | last_od |
|---|---|---|---|---|
| 1 | 지상작전사령부 | 22 | 2025-07-07 | 2026-04-07 |
| 2 | 제3697부대 | 15 | 2025-07-15 | 2025-12-30 |
| 3 | 특수전사령부 | 14 | 2025-07-29 | 2026-03-26 |
| 4 | 제5378부대 | 12 | 2025-07-03 | 2025-09-04 |
| 5 | 제2136부대 | 12 | 2025-07-04 | 2025-08-27 |
| 6 | 제9181부대 | 10 | 2025-09-02 | 2026-04-13 |
| 7 | 제9911부대 | 6 | 2025-09-01 | 2026-03-23 |
| 8 | 수도방위사령부 | 6 | 2025-08-12 | 2025-12-15 |
| 9 | 제3007부대 | 5 | 2025-07-02 | 2025-08-22 |
| 10 | 제9691부대 | 5 | 2025-08-08 | 2026-03-23 |
| 11 | 제 2167부대 | 4 | 2025-07-08 | 2025-10-24 |
| 12 | 제5708부대 | 4 | 2025-07-01 | 2025-07-28 |
| 13 | 제1891부대 | 4 | 2025-09-10 | 2025-11-20 |
| 14 | 동원전력사령부 | 3 | 2025-07-28 | 2025-11-18 |
| 15 | 드론작전사령부 | 3 | 2025-07-31 | 2025-11-21 |
| 16 | 제7297부대 | 3 | 2025-08-05 | 2025-12-11 |
| 17 | 제5181부대 | 2 | 2025-08-19 | 2025-09-04 |
| 18 | 제6953부대 | 2 | 2025-08-13 | 2025-08-28 |
| 19 | 제5067부대 | 2 | 2025-09-02 | 2025-09-02 |
| 20 | 제3707부대 | 2 | 2025-07-10 | 2025-09-04 |
| 21 | 제2062부대 | 2 | 2025-07-09 | 2025-08-19 |
| 22 | 제5733부대 | 2 | 2025-08-13 | 2025-08-19 |
| 23 | 제6060부대 | 1 | 2025-10-22 | 2025-10-22 |
| 24 | 제9251부대 | 1 | 2025-07-09 | 2025-07-09 |
| 25 | 제1719부대 | 1 | 2025-09-04 | 2025-09-04 |
| 26 | 제7862부대 | 1 | 2025-10-14 | 2025-10-14 |
| 27 | 제2879부대 | 1 | 2025-07-23 | 2025-07-23 |

→ **모두 명백한 군시설 발주사** (사령부 5건 + 제XXXX부대 22건). 거짓 양성 0건.

거짓 양성 차단 통계: `중부대학교` 1건 (NOT ILIKE '%대학교%' 필터로 제외).

---

## 3. 적용 직후 검증 결과

### 3.1 잔여 정정 후보 — 0건 ✅

```sql
SELECT COUNT(*) FROM bid_records
WHERE at='지자체' AND era_v2='current'
  AND (canonical_ag ILIKE '%사령부%' OR canonical_ag ~ '^제\s?[0-9]+부대' OR canonical_ag ~ '^[0-9]+부대')
  AND canonical_ag NOT ILIKE '%대학교%';
→ 0
```

UPDATE 100% 적용 확인.

### 3.2 bid_records.at 분포 (current era, 군 키워드 카운트)

| at | n_total | military_n (현재) | 정합 |
|---|---|---|---|
| LH | 14 | 0 | ✅ |
| 교육청 | 846 | 0 | ✅ |
| **군시설** | 236 | 151 | ✅ (m28로 +145 이동, 기존 군 6건 포함 = 151) |
| 조달청 | 25 | 0 | ✅ |
| **지자체** | 1,430 | **0** | ✅ (m28 정합 회복) |
| 한전 | 123 | 0 | ✅ |

다른 영역(한전·교육청·LH·조달청)에도 군 키워드 혼입 없음 확인.

### 3.3 win_zone_daily 측정값 — 변화 없음 (예상된 결과)

m28 직후 `refresh_win_zone_daily()` 1회 호출 결과 영역별 변화 없음. **사유**:
- refresh_win_zone_daily 본체가 `d.at`(bid_details.at) 사용 — bid_records.at UPDATE는 본 함수 측정값에 직접 영향 없음
- `ON CONFLICT (measured_on, at, canonical_ag) DO NOTHING` 정책이라 같은 날짜 같은 키 갱신 무시

→ **m28의 win_zone_daily 효과는 0** (이 함수는 d.at 기반).

### 3.4 m28 효과가 실제로 나타나는 영역

| 영역 | 함수/테이블 | bid_records.at 사용 여부 | m28 효과 |
|---|---|---|---|
| win_zone_daily | refresh_win_zone_daily | d.at 사용 | **변화 없음** |
| floor_pass_daily | refresh_floor_pass_daily | p.at 사용 (bid_predictions) | 변화 없음 (bid_predictions.at 무변경) |
| **agency_gap_distribution** | (별도 적재 함수) | bid_records.at 사용 추정 | **다음 적재에서 정합 회복** |
| **lookup_agency_mode** RPC | agency_mode_lookup 참조 | canonical_ag 기준이라 무관 | 영향 없음 |
| **bid_predictions backfill** | 신규 row 생성 시 r.at 참조 가능 | 케이스별 | **신규 row부터 정합** |
| /accuracy 영역별 baseline | bid_predictions.at 기준이면 무영향 | 코드 확인 필요 | 추정 영향 없음 |

→ m28 즉시 효과는 제한적. **현재 cron 측정값에는 영향 없음**. 다만 **bid_records 자체의 영구 정합 회복**으로 향후 신규 분석·신규 예측에서 정확화.

### 3.5 핵심 영역 MAE 영향 — 보존 (예상)

| 영역 | predict-architect baseline (60일) | m28 적용 후 |
|---|---|---|
| 한전 | n=55, bias +0.0410, MAE 0.4560 | 변동 없음 (군 키워드 0건) |
| 군부대 | n=81, bias +0.0668, MAE 0.5181 | bid_predictions.at 무변경 → MAE 직접 영향 0 |
| 고양시 | n=8, bias +0.4119, MAE 0.7540 | 변동 없음 (군 키워드 0건) |

predict-architect Evaluator 분류 + PASS 판정과 일치.

---

## 4. 후속 작업

### 4.1 즉시 (1~2일)
- HANDOFF §9에 m28 결과 추가 (`9.7` 신규 sub-section)
- 마스터플랜 §3 D2 표 갱신 — 지자체 "B 유지" 명문화 (JIJACHE §4.4)
- outlier 1건 추적 (JIJACHE §4.2, `od=2026-04-27, win_bid_rate=66.4059`)

### 4.2 1주 모니터링 후
- legacy era 3,857건 정정 검토 (m29 가칭) — 같은 패턴이지만 legacy 시기 통계 재계산 영향
- 육군교육사령부 7건 처리 (현재 at='교육청') — m28 범위 제외 케이스, 별도 도메인 판단

### 4.3 검증 인프라 (Low)
- agency_gap_distribution 지자체 current era 적재 (JIJACHE §4.3) — 검증 인프라 공백 해소

### 4.4 통합 라운드 15 BRIEF (위 작업 진행 후)
- m26·m27·m28 + 메타 점검 + 정책·UI 정정 + 라운드 13 fix 통합 의뢰

---

## 5. 시스템 함의

### 5.1 mixed era 결함의 본질
JIJACHE 보고서에서 발견한 "mixed가 군 데이터 부풀린다"의 진짜 원인이 era 분류가 아니라 **at 분류 결함**임을 m28로 확정.
- 군시설 12.42% (mixed) vs 10.00% (current-only)의 -2.42pp 차이는 era 필터 효과
- m28의 145건은 그 차이의 일부 (다만 win_zone_daily 함수가 d.at 기반이라 직접 효과는 다음 측정에서)
- bid_records.at은 영구 정합 회복

### 5.2 다른 결함의 잔존
- canonical_ag NULL 비율: 지자체 28% (36/127), 군시설 12% (9/78) — **정규화 자체 미적용 row 다수**
- bid_details.pn → bid_records.pn_no 매칭 실패 3건 (90일)
- 이 결함들은 별도 작업 (m29·m30 후보)

### 5.3 라운드 N+1 BRIEF 통합 시 포함 항목
- m28 적용 사실 + 145건 정합 회복
- 향후 신규 예측·분석에서 정합 보장
- 다음 cron 갱신에서 lookup_agency_mode·agency_gap_distribution 영향 추적 필요

---

_본 보고서는 m28 적용 직후 정합 검증 + 영역별 정합 회복 + 측정 함수 효과 분석. 145건 UPDATE 성공, 거짓 양성 0건._
_적용자: Claude Opus 4.7 / Supabase MCP apply_migration / 2026-05-21_
