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
