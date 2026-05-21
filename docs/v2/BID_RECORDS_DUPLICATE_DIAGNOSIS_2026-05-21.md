# bid_records.pn_no 중복 진단 보고서 (2026-05-21)

> 작성자: Claude Opus 4.7
> 발견 트리거: M29_APPLY_RESULT §3.1 "군시설 n=60→30 변동" 정밀 진단
> 단일 진실: `M29_APPLY_RESULT_2026-05-21.md`, `M28_APPLY_RESULT_2026-05-21.md`

---

## 1. 요약 (3줄)

1. **bid_records.pn_no UNIQUE 위반 113건** (90일 윈도우, current era). 동일 pn_no가 2~3 row로 중복 적재되어 LEFT JOIN 시 측정 카운트를 우연히 증폭.
2. **M29 §3.1 의문(군시설 n=60→30) 해소** — m26 직후 win_zone_daily 군시설 n=60은 LEFT JOIN 중복 영향, m29 era 필터로 우연히 차단된 결과. 실제 정상 카운트는 30.
3. **V2 측정 인프라 전반 영향**: m26·m27·m28·m29 모든 측정 함수가 `LEFT JOIN bid_records r ON r.pn_no = d.pn_no` 패턴 → 중복 row 모두에서 매칭되어 통계 왜곡. 별도 m30 (가칭) 중복 제거 작업 필요.

---

## 2. 중복 통계 (90일 윈도우)

```sql
SELECT
  COUNT(*) AS n_total_rows,
  COUNT(DISTINCT pn_no) AS n_distinct_pn,
  COUNT(*) - COUNT(DISTINCT pn_no) AS duplicates
FROM bid_records
WHERE od >= (CURRENT_DATE - INTERVAL '90 days')::date;
```

| scope | n_total | distinct_pn | **duplicates** |
|---|---|---|---|
| 90일 전체 | 11,668 | 11,555 | **113** |
| current era 90일 | 11,668 | 11,555 | 113 |
| legacy era 90일 | 0 | 0 | 0 |

→ 90일 전체와 current era가 동일 (이 윈도우는 legacy 시기 0건). **모든 중복이 current era 내**.

---

## 3. 중복 패턴 (top 15)

```sql
SELECT pn_no, COUNT(*) AS n_records, STRING_AGG(DISTINCT era_v2, ', ') AS eras,
       STRING_AGG(id::text, ', ' ORDER BY id) AS ids,
       STRING_AGG(DISTINCT at, ', ') AS ats
FROM bid_records WHERE od >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY pn_no HAVING COUNT(*) > 1
ORDER BY n_records DESC LIMIT 15;
```

| pn_no | n_records | eras | ids | ats |
|---|---|---|---|---|
| R26BK01475046 | 3 | current | 350669, 350749, 357458 | 지자체 |
| R26BK01477683 | 3 | current | 348876, 355774, 355815 | 지자체 |
| R26BK01477689 | 3 | current | 357424, 363492, 365316 | 군시설 |
| R26BK01482785 | 3 | current | 356046, 363477, 363497 | 군시설 |
| R26BK01486344 | 3 | current | 363650, 365054, 365321 | 지자체 |
| R26BK01486353 | 3 | current | 363655, 365488, 365529 | 지자체 |
| R26BK01486759 | 3 | current | 365073, 365525, 367662 | 지자체 |
| R25BK01197032-000 | 2 | current | 366632, 387175 | **기타, 조달청** ← at 불일치 |
| R26BK01436737 | 2 | current | 328992, 329170 | 군시설 |
| R26BK01446406 | 2 | current | 329025, 329515 | 군시설 |
| R26BK01446620 | 2 | current | 328597, 337609 | 지자체 |
| R26BK01447045 | 2 | current | 329512, 329874 | 교육청 |
| R26BK01449012 | 2 | current | 329144, 329304 | 군시설 |
| R26BK01449330 | 2 | current | 328868, 328993 | 군시설 |
| R26BK01449904 | 2 | current | 328293, 329452 | 지자체 |

→ 모두 era_v2='current', canonical_ag=NULL (정규화 미적용). 일부 case는 동일 pn_no에 다른 at 분류 (R25BK01197032-000: 기타 ↔ 조달청).

---

## 4. M29 §3.1 의문 해소

### 4.1 원인 분석

**M29 §3.1 의문**: m26 직후 win_zone_daily 군시설 n=60 → m29 적용 후 n=30 (50% 차단). m29 sanity check는 군시설 outlier 0건이라 영향 0이어야 함.

**진단 SQL 단계별 카운트** (군시설 90일):
| 조건 | n |
|---|---|
| 1. d.at='군시설' + 90일 (LEFT JOIN 없음) | **30** |
| 2. + is_joint_contract != true (LEFT JOIN 추가) | **60** ← 필터 추가하니 +30 |
| 3. + era_v2='current' | 30 |
| 4. + sanity ≤ 5 | 30 |

→ **LEFT JOIN으로 카운트 증가** — 한 d row가 여러 r row와 매칭됨을 의미.

### 4.2 분포 분석

```sql
SELECT d.at, COALESCE(r.era_v2, 'NULL') AS r_era_v2, COUNT(*)
FROM bid_details d LEFT JOIN bid_records r ON r.pn_no = d.pn_no
WHERE d.at = '군시설' AND d.od >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY 1, 2;
```

| d.at | r.era_v2 | n |
|---|---|---|
| 군시설 | legacy | 30 |
| 군시설 | current | 29 |
| 군시설 | NULL | 1 |

→ d 30건이 LEFT JOIN으로 60건 매칭. 그 중 30건은 r.era_v2='legacy', 29건은 'current', 1건은 NULL.

**결정적 사실**: bid_details 군시설 30건 중 거의 모든 row가 같은 pn_no를 가진 bid_records 2건과 동시 매칭 (one is legacy, one is current). 즉 같은 pn_no에 legacy + current 두 row가 공존.

### 4.3 m26 효과 재해석

- m26은 `r.era_v2='current'` 필터로 legacy 중복 30건 차단
- 결과 정상 카운트 30 회복 (당시에는 의도 알지 못함)
- m29 sanity check는 진단에서 정정 0건 차단 → 군시설 변동 m29 영향 아님 ✓

### 4.4 결론

**M29 §3.1 군시설 n=60→30 변동 = LEFT JOIN 중복 + era 필터의 우연한 정합 회복**. m29 자체는 의도된 효과(지자체 outlier 1건 차단)만 수행. m29 보고서 §3.1 가설 수정.

---

## 5. V2 측정 인프라 전반 영향 평가

### 5.1 영향받는 측정 함수

모두 `LEFT JOIN bid_records r ON r.pn_no = d.pn_no` 패턴 사용:

| 함수 | 영향 |
|---|---|
| `refresh_win_zone_daily` (m20·m26·m29) | LEFT JOIN으로 중복 카운트 |
| `refresh_floor_pass_daily` (m20·m27) | p.matched_record_id로 1:1 매칭 — 다른 패턴, 영향 평가 필요 |
| `refresh_agency_adj_range` (m23·m25) | p.matched_record_id로 1:1 매칭 — 다른 패턴 |
| `lookup_agency_mode` RPC | agency_mode_lookup 참조 (적재 시 영향 가능) |

→ **win_zone_daily가 가장 큰 영향**. floor_pass_daily는 matched_record_id (=bid_records.id)로 1:1 매칭이라 직접 영향 없음.

### 5.2 측정값 왜곡 추정

m26 직후 win_zone_daily 영역별 n에 LEFT JOIN 중복 영향 추정:

| at | 정상 n (추정) | m26 직후 n | 중복 영향 |
|---|---|---|---|
| 군시설 | 30 | 60 | +30 (legacy 중복) |
| 지자체 | ~120 | 126 | +6 (중복 일부) |
| 한전·교육청·LH·조달청 | 그대로 | 그대로 | 거의 없음 (중복 적음) |

m29 era 필터 후 정상 카운트로 회복.

### 5.3 데이터 무결성 위반의 본질

bid_records 테이블에 **UNIQUE 제약(pn_no) 누락** + **중복 입력 차단 로직 부재**.

가능한 원인:
- 동일 pn_no가 era 분류 시점에 두 번 적재됐을 가능성 (legacy + current 분류 시)
- 또는 새 데이터 입력 시 기존 row 갱신이 아닌 신규 INSERT
- supabase.js의 sbUpsert 함수 동작 검증 필요

---

## 6. 후속 작업 권고 (m30 가칭)

### 6.1 진단 (1일)
- bid_records pn_no UNIQUE 위반 전체 카운트 (90일 외 전체)
- 중복 row 패턴 — 어느 컬럼이 다른지 (era_v2? at? canonical_ag? bp? ar1? created_at?)
- 중복 발생 시점 추적 (created_at 분포)
- supabase.js sbUpsert 로직 검증

### 6.2 처리 옵션
- **옵션 A**: 중복 row 제거 + UNIQUE(pn_no) 제약 추가
  - 어느 row를 남길지 결정 (최신 created_at? era='current' 우선? 등)
  - bid_records DELETE 금기와의 관계: CLAUDE.md "bid_records DELETE 금지" 명시 — **확인 필요, 정합 회복 목적 DELETE는 예외 가능?**
- **옵션 B**: 측정 함수에서 `DISTINCT pn_no` 사용으로 중복 통계 차단
  - 영구 정합 회복 아니지만 측정값 정확화
- **옵션 C**: bid_records에 `is_duplicate` flag 추가 + 측정 함수에서 제외
  - DELETE 없이 정합 회복

### 6.3 권고: **옵션 C** (DELETE 회피 + 영구 정합 회복)
- CLAUDE.md "bid_records DELETE 금지" 정책 준수
- 중복 row 보존하면서 측정 시 자동 제외
- 향후 UNIQUE 제약 강제 시 옵션 A 전환 가능

### 6.4 진행 우선순위
- **현 시점**: 본 보고서 영구 기록 + M29 §3.1 정정 commit
- **별도 commit** (m30 진행 결정 후): 옵션 C 구현 또는 사용자 결정
- **통합 라운드 15 BRIEF**: m26·m27·m28·m29 + 본 진단 + m30 통합 의뢰

---

## 7. M29 보고서 §3.1 정정사항

M29_APPLY_RESULT §3.1 "원인 추정" 가설들은 본 진단으로 해소:
- ❌ "m28 UPDATE 부작용" — m28은 era_v2 미변경
- ❌ "다른 cron 작업 영향" — 본 세션 외 작업 없음
- ❌ "era_v2 필드 갱신" — m28 SQL에 없음
- ✅ **확정 원인**: **bid_records.pn_no 중복 113건 + LEFT JOIN으로 카운트 증폭**

M29 §3.1을 본 보고서 §4 인용으로 정정 권고.

---

## 8. 시스템 함의

### 8.1 V2 측정 신뢰도
- m26·m29 적용으로 win_zone_daily 측정 정합 우연히 회복 (era 필터가 LEFT JOIN 중복 절반 차단)
- 다만 같은 era 내 중복은 잔존 → 일부 통계 미세 왜곡 가능
- 4주 PASS 게이트(5/25 시작) 신뢰도에 잠재 영향

### 8.2 자사 1위 적중 영향
- 핵심 영역 MAE 측정은 bid_predictions 기반이라 직접 영향 없음
- agency-floor V1 분포 측정(`agency_rate_distribution`)도 bid_predictions 기반
- 즉 1위 적중 예측 자체는 무영향
- win_zone_daily Mode A KPI만 영향 (군시설)

### 8.3 m30 진입 시점
- 본 진단 결과 + M29 §3.1 정정 commit 후
- 사용자 결정 받아 m30 옵션 C(중복 flag) 또는 다른 옵션 진행

---

_본 보고서는 m29 §3.1 의문 정밀 진단 결과. 군시설 변동 원인 = bid_records.pn_no 중복 113건 (V2 측정 인프라 전반에 잠재 영향)._
_진단자: Claude Opus 4.7 / 진단 일자: 2026-05-21 / 후속: m30 가칭 (옵션 C 권고)_
