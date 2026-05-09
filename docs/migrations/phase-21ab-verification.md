# Phase 21-A·B 마이그레이션 검증 기록

**적용일**: 2026-05-09
**spec**: docs/superpowers/specs/2026-05-08-v7-prediction-redesign-design.md
**plan**: docs/superpowers/plans/2026-05-08-v7-redesign-phase-21ab.md
**명명 결정**: 신규 분포 모델은 predict_dist 계열 (기존 predict_v7 라인 보존)

## Task 1: Phase 21-A 스키마

- 마이그레이션명: `phase_21a_dist_schema`
- Supabase 응답: `{"success": true}`
- 신규 테이블: agency_rate_distribution, lower_bound_rate_lookup, agency_residual_offset
- 신규 컬럼: bid_records.is_joint_contract (NOT NULL DEFAULT false), bid_records.joint_contract_type (text, nullable)
- RLS: 3 테이블 모두 활성, anon_read 정책 적용

### 검증 쿼리 결과 (Step 3)

**테이블 존재 확인** — 3행:
- agency_rate_distribution
- agency_residual_offset
- lower_bound_rate_lookup

**컬럼 존재 확인** — 2행 (bid_records):
- is_joint_contract
- joint_contract_type

**RLS 활성화 확인** — relrowsecurity=true 3건:
- agency_rate_distribution: true
- agency_residual_offset: true
- lower_bound_rate_lookup: true

**정책 존재 확인** — 3건:
- agency_rate_distribution → anon_read_agency_rate_distribution
- agency_residual_offset → anon_read_agency_residual_offset
- lower_bound_rate_lookup → anon_read_lower_bound_rate_lookup

### bid_records NOT NULL 검증 (Step 4)

- `rows_with_null_is_joint` = 0
- `total` = 61624, `false_count` = 61624 (전 행 DEFAULT false 적용)

### 빌드 결과 (Step 5)

`npx vite build` PASS — 42 modules transformed, built in 3.00s. UI/코드 미변경, 회귀 없음.

## 보존 객체 (사용자 결정)

기존 v7 라인은 손대지 않음:
- `predict_v7`, `predict_v7_2` 함수
- `v7_calibration` 등 기존 테이블·뷰

신규 분포 모델은 `predict_dist` 계열로 별도 명명하여 충돌 회피.

## Task 2: 시드 데이터

- lower_bound_rate_lookup INSERT: 7 rows
- avg_rate: 87.45929%, range 86.74500~87.74500%
- anon SELECT 권한 확인: PASS (count=7)
- 시드 출처: docs/superpowers/specs/2026-05-08-v7-prediction-redesign-design.md §4.2 표
- numeric(7,5) 정밀도 보존 확인: 87.74500, 86.74500 정확 저장

## Task 3: 추정 RPC 함수 3개

- 마이그레이션명: `phase_21b_dist_rpc_functions`
- Supabase 응답: `{"success": true}`
- 함수 존재 확인 (pg_proc): 3행
  - calc_bid_amount_dist (pronargs=3)
  - predict_dist (pronargs=2)
  - predict_dist_combined (pronargs=3)
- 기존 predict_v7(3), predict_v7_2(4) 보존 확인 PASS

### predict_dist 표본 검증 (Tier1)

- 선택된 canonical_ag: `한국전력공사 경기본부`
- rpc_median = 99.78245, direct_median = 99.78245 → 정확 일치 PASS
- tier = tier1, sample_size = 3020, direct_n = 3020

### predict_dist_combined

- 함수 정의 적용됨 (호출 검증은 Task 5: agency_residual_offset 백필 후 수행)
- 잔차 미존재 시 v_residual=0, residual_src='없음'/'표본부족'으로 안전 fallback

### calc_bid_amount_dist 산식 검증

- 입력: ba=1억, adj_ratio_pct=99.87600%, lower_bound_pct=87.74500%
- computed = 87,636,197
- expected = ceil(100000000 × 0.998760 × 0.877450) = 87,636,197
- 정확 일치 PASS

