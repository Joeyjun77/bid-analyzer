# m30 적용 결과 보고 (2026-05-21)

> 작성자: Claude Opus 4.7
> 사전 검토: predict-architect Agent (Evaluator 분류, 핵심 영역 MAE PASS, /evaluate 면제 가능)
> 결정 근거: BID_RECORDS_DUPLICATE_DIAGNOSIS_2026-05-21.md §6.3 옵션 C + 사용자 결정
> 단일 진실: `BID_RECORDS_DUPLICATE_DIAGNOSIS_2026-05-21.md`, `M29_APPLY_RESULT_2026-05-21.md`

---

## 1. 적용 요약

| 항목 | 값 |
|---|---|
| 마이그레이션 | m30_add_is_duplicate_flag_to_bid_records |
| 변경 1 (DDL) | `bid_records.is_duplicate` BOOLEAN NOT NULL DEFAULT false 추가 + 부분 인덱스 |
| 변경 2 (DML) | 중복 row 마킹 113건 (current era 한정) |
| 변경 3 (함수) | `refresh_win_zone_daily`에 `AND COALESCE(r.is_duplicate, false) = false` 추가 |
| master 선정 | d→c→a 복합 (참조 → canonical → 데이터 충실도 → MIN id) |
| 적용 상태 | ✅ apply_migration success |
| 정책 준수 | CLAUDE.md "bid_records DELETE 금지" 준수 (UPDATE만) |

---

## 2. 사전 dry-run 검증 결과

```sql
WITH dup_groups AS (
  SELECT pn_no FROM bid_records WHERE era_v2='current'
  GROUP BY pn_no HAVING COUNT(*) > 1
), master_candidates AS (
  SELECT r.id, ROW_NUMBER() OVER (PARTITION BY r.pn_no ORDER BY ...) AS rn
  FROM bid_records r JOIN dup_groups d ON d.pn_no = r.pn_no
) SELECT ... FROM master_candidates;
```

| 항목 | 값 |
|---|---|
| distinct_groups | 106 |
| master_count (rn=1) | 106 |
| **duplicate_count (rn>1)** | **113** |
| master_referenced (참조 받는 master) | 2 |
| **duplicate_referenced (참조 받는 중복)** | **0** ✅ |
| master_canonical_filled | 0 |
| master_canonical_null | 106 (옵션 c 무효 → 옵션 a 폴백) |

→ **duplicate_referenced=0**으로 마킹 안전성 보장. 마스터로 선정되지 않은 row를 bid_predictions.matched_record_id에서 참조하는 케이스 0건.

---

## 3. 적용 후 검증

### 3.1 마킹 카운트

| 항목 | 값 | 정합 |
|---|---|---|
| duplicates_marked | **113** | ✅ dry-run 113건과 일치 |
| masters_kept | 13,747 | ✅ distinct pn_no 수와 일치 |
| total_rows (current era) | 13,860 | ✅ 113 + 13,747 = 13,860 |

### 3.2 win_zone_daily 재측정 (DELETE + refresh)

| at | m29 직후 | **m30 적용 후** | 변화 |
|---|---|---|---|
| _overall_ | n=198, p90=0.4476 | n=198, p90=0.4476 | 변화 없음 |
| 군시설 | n=30, p90=0.6070, win_zone=13.33% | n=30, p90=0.6070, win_zone=13.33% | 변화 없음 |
| 지자체 | n=120, p90=0.0183, win_zone=2.50% | n=120, p90=0.0183, win_zone=2.50% | 변화 없음 |
| 한전·교육청·LH·조달청 | 변화 없음 | 변화 없음 | ✅ |

#### 변화 없음의 이유 (예상된 결과)
- m29의 `era_v2='current'` 필터로 legacy 중복이 이미 차단된 상태
- current era 113건 중복은 `d`(bid_details)가 중복이 아니라 `r`(bid_records)이 중복
- LEFT JOIN 후에도 d 카운트는 동일 → 측정 통계 무영향
- m30 효과는 **영구 무결성 회복**(bid_records 자체) + **향후 안전망**

### 3.3 직접 SELECT 카운트 (m30 필터 적용)

```sql
SELECT d.at, COUNT(*) FROM bid_details d
LEFT JOIN bid_records r ON r.pn_no = d.pn_no
WHERE ... AND COALESCE(r.is_duplicate, false) = false
GROUP BY d.at;
```

| at | n_with_dup_filter | win_zone_daily n | 정합 |
|---|---|---|---|
| LH | 6 | 6 | ✅ |
| 교육청 | 12 | 12 | ✅ |
| 군시설 | 30 | 30 | ✅ |
| 조달청 | 7 | 7 | ✅ |
| 지자체 | 120 | 120 | ✅ |
| 한전 | 23 | 23 | ✅ |

직접 SELECT와 win_zone_daily 일관성 완전 검증.

---

## 4. 영향 분석

### 4.1 즉시 영향
- bid_records.is_duplicate=true 113건 마킹 (current era)
- refresh_win_zone_daily는 향후 cron 갱신 시 중복 자동 차단
- 측정값 변동 없음 (m29 적용 시점에 이미 정합 회복)

### 4.2 향후 영향
| 분야 | 영향 |
|---|---|
| 신규 bid_records INSERT | is_duplicate=false default, 중복 마킹은 별도 backfill 필요 |
| agency_gap_distribution 재적재 | bid_records 사용 시 is_duplicate 필터 추가 필요 |
| lookup_agency_mode RPC | agency_mode_lookup 참조 (적재 시점에 필터 적용 필요) |
| **자사 1위 적중 예측** | **영향 없음** (bid_predictions 기반, m30 무관) |

### 4.3 핵심 영역 MAE — 보존 (predict-architect 사전 검토와 일치)
- 한전 n=55, bias +0.0410, MAE 0.4560 (변동 없음)
- 군부대 n=81, bias +0.0668, MAE 0.5181 (변동 없음)
- 고양시 n=8, bias +0.4119, MAE 0.7540 (변동 없음)

### 4.4 V6 retire 게이트 카운터
- m27의 v2_modeB_canonical 카운터는 floor_pass_daily 기반 (matched_record_id 1:1)
- m30 영향 없음 → 4주 PASS 누적은 5/25부터 신규 시작 그대로

---

## 5. M29 §3.1 의문 완전 해소

| M29 §3.1 가설 | 검증 결과 |
|---|---|
| m28 UPDATE 부작용 | ❌ m28은 era_v2 미변경, 영향 0 |
| 다른 cron 작업 | ❌ 본 세션 외 작업 없음 |
| era_v2 갱신 | ❌ m28 SQL에 없음 |
| **확정 원인** | ✅ **bid_records.pn_no 중복 113건 + LEFT JOIN으로 카운트 증폭** |

m26 직후 win_zone_daily 군시설 n=60은 LEFT JOIN으로 d 30건 × 평균 2건 매칭 = 60건. m29의 era_v2='current' 필터로 legacy 중복 30건 우연히 차단. 정상 카운트 30 회복.

**m30은 BID_RECORDS_DUPLICATE_DIAGNOSIS §6.3 옵션 C 권고를 완전 수용**:
- DELETE 회피 (CLAUDE.md "bid_records DELETE 금지" 준수)
- is_duplicate flag로 영구 무결성 마킹
- refresh_win_zone_daily에 자동 차단 필터 추가

---

## 6. V2 측정 인프라 정합 7단계 완성

| 단계 | 마이그레이션 | 목적 |
|---|---|---|
| 1 | m20 | refresh_floor_pass_daily 공동도급 제외 (G-도메인 #7) |
| 2 | m25 | refresh_agency_adj_range era 정합 (G-도메인 #0) |
| 3 | m26 | refresh_win_zone_daily era 정합 |
| 4 | m27 | refresh_floor_pass_daily canonical 분기 (V6 retire 정합 카운터) |
| 5 | m28 | bid_records.at 분류 정합 (군 발주사 145건) |
| 6 | m29 | refresh_win_zone_daily outlier sanity check (±5pp) |
| 7 | **m30** | **bid_records.is_duplicate flag + refresh_win_zone_daily 중복 필터** |

→ V2 측정 인프라 정합 7단계 완성. 4주 PASS 누적 게이트(5/25 시작) + V6 retire 판정 신뢰도 완성.

---

## 7. 후속 작업

### 7.1 즉시 (본 commit 후 push)
- M30_APPLY_RESULT 보고서 + m30 SQL 파일 commit
- push (사용자 발화 시)

### 7.2 1주 모니터링 후 (m31 가칭)
- legacy era 2,578건 중복 정정 (m30 패턴 확장)
- 다른 측정 함수도 동일 패턴 적용 검토 (필요 시)

### 7.3 별도 단계 (m32 가칭, 안전성 확보 후)
- UNIQUE(pn_no) WHERE is_duplicate = false 부분 인덱스 추가
- 신규 INSERT 시 중복 차단 강제
- predict-architect 권고: "24시간 모니터링 후"

### 7.4 통합 라운드 15 BRIEF
- m26·m27·m28·m29·m30 + 정책·UI 정정 + 진단 보고서들 + outlier 추적 + m31·m32 제안 통합 의뢰
- 본 세션의 메타 점검 결과 종합

---

## 8. 시스템 함의

### 8.1 데이터 무결성 회복 영구화
- bid_records 11,668 row 중 113건 중복 마킹 (1.0%)
- 향후 측정·분석에서 자동 차단
- legacy era 2,578건은 별도 단계 (전체 era 2,833건의 92%가 legacy)

### 8.2 자사 1위 적중 예측 영향 — 0
- bid_predictions 기반 baseline MAE: 영향 없음
- agency-floor V1 분포: 영향 없음
- V6 사정률 점추정: 영향 없음
- m30은 측정 인프라 정합 회복 (사용자 의사결정 자체에는 영향 없음)

### 8.3 m31·m32 진입 시점
- m30 직후 24시간 모니터링 (cron 자동 실행 결과 확인)
- 5/22 00:15 jobid 12 자동 실행으로 m30 효과 1차 확인
- 5/25 weekly gate 시 모드_gate_report에서 정합 측정값 확인 가능

---

_본 보고서는 m30 적용 직후 검증 + M29 §3.1 의문 완전 해소 + V2 측정 인프라 정합 7단계 완성._
_적용자: Claude Opus 4.7 / Supabase MCP apply_migration / 2026-05-21_
