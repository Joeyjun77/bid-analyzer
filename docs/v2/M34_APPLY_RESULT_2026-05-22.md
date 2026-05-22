# m34 적용 — canonical_ag 정규화 + at 표준화 (2026-05-22)

## 1. 배경
`FORWARD_DIRECTION_2026-05-21.md` §6.5 권고 3 actions 중 두 번째 — S2(canonical_ag NULL 정규화) + S3(at 소스 표준화) 묶음.

## 2. 진단 (적용 전)

### 2.1 canonical_ag NULL
| 테이블 | total | NULL | 비율 |
|---|---|---|---|
| **bid_records** | 64,824 | **11,447** | 17.7% |
| bid_predictions | 2,278 | 0 | 0% |

원인: `trg_ensure_canonical_ag` 트리거가 `bid_predictions`에만 설치되어 있고 `bid_records`에는 부재.

### 2.2 at 비표준 (총 45건, bid_records)
| 비표준 at | n | → 매핑 |
|---|---|---|
| 공기업 | 18 | 기타 |
| 국방기관 | 15 | 군시설 |
| 교육기관 | 5 | 교육청 |
| 준정부기관 | 4 | 기타 |
| 지방자치단체 | 3 | 지자체 |

표준 7종: 지자체 / 교육청 / 군시설 / 한전 / 조달청 / LH / 수자원공사 (+ 기타).

## 3. 적용된 마이그레이션 (3건)

### 3.1 `m34_s2_canonical_ag_trigger_records`
`ensure_canonical_ag_trigger_records` BEFORE INSERT/UPDATE 트리거 추가
- 함수: `trg_ensure_canonical_ag` (재사용)
- 효과: 향후 INSERT/UPDATE 시 canonical_ag NULL → `normalize_agency_name(ag)` 자동 채움

### 3.2 `m34_s2_canonical_ag_backfill`
기존 NULL 11,447건 일괄 백필
```sql
UPDATE bid_records SET canonical_ag = normalize_agency_name(ag)
WHERE canonical_ag IS NULL AND ag IS NOT NULL;
```

### 3.3 `m34_s3_at_standardize`
비표준 45건 표준 매핑 UPDATE (4개 그룹)

## 4. 검증 (적용 후)
| 항목 | Before | After |
|---|---|---|
| `bid_records.canonical_ag` NULL | 11,447 | **0** ✓ |
| `bid_records.at` 비표준 | 45 | **0** ✓ |
| `bid_records.at` 표준 카테고리 | 8 (비표준 포함) | **8** (표준만) ✓ |
| canonical_ag distinct | 1,639 | **3,149** (NULL이 정규화되며 추가) |
| 트리거 `ensure_canonical_ag_trigger_records` | 부재 | INSERT + UPDATE 설치 ✓ |

### 4.1 at 분포 (After)
| at | n |
|---|---|
| 지자체 | 33,783 |
| 교육청 | 13,083 |
| 군시설 | 9,098 |
| 한전 | 6,395 |
| 조달청 | 1,130 |
| LH | 784 |
| 수자원공사 | 478 |
| 기타 | 73 |

## 5. Phase 23-3 게이트
| 게이트 | 결과 |
|---|---|
| Generator 분류? | **No** (`getFinalRecommendation` / `opt_adj` / `pred_bias_map` / 낙찰하한율 함수 미변경) |
| Evaluator 분류 | **Yes** (데이터 정규화) |
| /evaluate 면제 | **Yes** |
| predict-architect 면제 | **Yes** |
| deploy-gate | 면제 (코드 변경 0, DB 마이그레이션만) |

## 6. 영향
- agency_predictor / agency_environment_profile 등 canonical_ag 기반 집계의 표본 +11,447건 (17.7% 증가)
- 다음 jobid 7 (`refresh-analysis-assets-daily`, 매일 18 UTC) 실행 시 자연 갱신

## 7. 다음 단계
- **m32** (partial UNIQUE 인덱스 + upsert 경로) — `FORWARD_DIRECTION_2026-05-21.md` §6.5 마지막 권고
- 별도 후속: **Z-DETAIL** (인포21c PASS A 응답 검증 + detail fetch)

---
_처리자: Claude Opus 4.7 / 처리 일자: 2026-05-22 / 후속: m32 + Z-DETAIL_
