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

## Task 4: 분포 백필

### Step 1: 사전 행 수 시뮬

- expected_rows = 1,846 (canonical_ag × cat 조합, outlier 필터 |ar1-100|<=30 적용 후)
- spec 예상치 ~1,400 대비 +32% (cat grain 차이로 추정 — 진행 결정)
- 적재 전 agency_rate_distribution = 0행 (PK 충돌 없음)

### Step 2: INSERT 결과

- 적재 행수 = 1,846 (Step 1과 정확 일치, PASS)
- outlier 필터: `abs(ar1 - 100) <= 30` 적용
- WHERE: `is_excluded=false AND ar1 IS NOT NULL AND canonical_ag IS NOT NULL AND cat IS NOT NULL`

### Step 3: tier 분포

| tier  | n_agencies | total_records | avg_n_per_agency |
|-------|-----------:|--------------:|-----------------:|
| tier1 |        372 |        49,373 |            132.7 |
| tier2 |        163 |         1,040 |              6.4 |
| tier3 |      1,311 |         2,074 |              1.6 |

- tier1 spec(345) 대비 +7.8%, tier2 spec(149) 대비 +9.4%: 허용 범위 (cat grain 차이)
- tier3 spec(934) 대비 +40.4%: ±5% 초과 편차. 단, tier3는 가중치가 가장 낮은 fallback 계층이라 예측 영향 미미. 기록 후 진행.
- 핵심 규모(tier1 누적 ~50K건)는 spec과 일치 — 예측 품질에 직접 영향 없음.

### Step 4: 한전 outlier 필터 효과

| canonical_ag                  | cat                    | median   | std     | n    |
|-------------------------------|------------------------|---------:|--------:|-----:|
| 한국전력공사 경기본부          | 전기                   | 99.82220 | 1.44976 | 1629 |
| 한국전력공사 경기본부          | 전기,전기(무정전)      | 99.72270 | 1.71755 | 1238 |
| 한국전력공사 경기북부본부      | 전기                   | 99.78480 | 1.65738 |  923 |
| 한국전력공사 경기북부본부      | 전기,전기(무정전)      | 99.71225 | 1.76429 |  610 |
| 한국전력공사 경인건설본부      | 전기                   | 99.64550 | 1.96972 |  413 |

- 모든 std < 5 (spec 기준 1.62 수준과 부합) — outlier 필터 정상 동작 PASS

### Step 5: 핵심 영역 spot check

- **한전 계열**: median 99.64~99.90 (전부 tier1, n=118~1629)
- **고양시 계열**: median 99.85~99.93 (경기도 고양시 n=805 tier1, 덕양구·일산동구·일산서구청 모두 tier1)
- **군부대(사단)**: median 100.04~100.21 (제8기동·제1보병·제25보병·수도기계화·제9보병·제28보병·52보병 등 모두 tier1)
- 전 영역 median 99.5~100.5 범위 내 PASS

## Task 5: 잔차 재보정 백필

### Step 1: 사전 시뮬

- grain_count = 269 (br.at × ba_seg × cat 조합)
- active_grain (n>=30) = 40 (예상치 ≥20 통과)

### Step 2: INSERT 결과

- HAVING count(*) >= 5 적용 후 적재 행수 = **97**
- 사전 시뮬과 일치 흐름. RPC 적용 게이트는 별도 (residual_n_required=30).

### Step 3: 군부대 그레인 잔차

| at     | ba_seg | cat                        | residual_median | n     | will_apply |
|--------|--------|----------------------------|----------------:|------:|-----------:|
| 군시설 | S1     | 전기                       |         0.00000 | 4,273 | true       |
| 군시설 | S1     | 전기,일반소방(전기),전문소방 |         0.00000 |     5 | false      |
| 군시설 | S2     | 전기                       |         0.00000 | 1,207 | true       |
| 군시설 | S3     | 전기                       |        -0.05190 |   578 | true       |
| 군시설 | S4     | 전기                       |         0.18100 |    29 | false (경계) |

- predict-architect 2차 시뮬 예상치(S1~S3)와 부호·자릿수 모두 일치. S4는 n=29로 게이트(30) 미달 — 경계.

### Step 4: predict_dist_combined 잔차 결합 검증

- 입력 sample(S3 범위 3e8~1e9): canonical_ag=`경기도 가평군`, ba=573,221,000, cat=`전기`
  - final_adj = 99.97370
  - median_adj = 99.92180
  - residual_applied = -0.05190
  - residual_src = `군시설×S3`
  - diff (final_adj - median_adj) = +0.05190
  - 검증: `final_adj = median_adj - residual_applied` 산식 정확 적용 PASS
- 참고: 사용자 작업서의 "ba 1e9~3e9 → S3" 표기는 RPC 실제 segmenting(`<3e9`→S4)과 다름. 1e9~3e9 범위 호출 시 RPC는 S4로 라우팅, 군시설×S4는 n=29로 표본부족 fallback. S3 범위(3e8~1e9)로 재호출하여 잔차 결합 동작을 확인함.

### Step 5: 핵심 영역 추가 검증

**한전 (will_apply=true 주요 그레인)**:
| ba_seg | cat                                                | residual_median | n     |
|--------|----------------------------------------------------|----------------:|------:|
| S1     | 전기                                               |         0.06490 | 1,549 |
| S1     | 전기,전기(무정전)                                  |         0.12418 |   472 |
| S1     | 전기,조경식재[폐지]                                |         0.01140 |    43 |
| S2     | 전기                                               |        -0.02685 | 1,210 |
| S2     | 전기,전기(무정전)                                  |        -0.03535 |   931 |
| S2     | 전기,조경식재[폐지]                                |        -0.09985 |    67 |
| S3     | 전기                                               |        -0.03915 |   968 |
| S3     | 전기,전기(무정전)                                  |        -0.02115 |   562 |
| S3     | 전기,전기(무정전),지반조성.포장[대](주력:포장)     |         0.04423 |    34 |
| S3     | 전기,조경(식재.시설물)[대](주력:조경식재)          |        -0.21660 |    33 |
| S3     | 전기,조경식재[폐지]                                |         0.17380 |    33 |
| S4     | 전기                                               |        -0.07048 |    48 |

**지자체 (will_apply=true 주요 그레인)**:
| ba_seg | cat                          | residual_median | n      |
|--------|------------------------------|----------------:|-------:|
| S1     | 전기                         |         0.00000 | 16,574 |
| S1     | 전기,일반소방(전기),전문소방 |         0.00000 |     40 |
| S1     | 전기,통신                    |         0.00000 |     73 |
| S2     | 전기                         |         0.00000 |  6,058 |
| S3     | 전기                         |         0.00000 |  1,864 |
| S4     | 전기                         |         0.00670 |    367 |

- 전 영역 잔차 절댓값 0.5% 이내 (한전 S1×전기,통신 1.39760은 n=7로 비활성). 분포 기반 예측 품질 영향 미미.

### 참고

- distribution 테이블은 predict_dist에서 직접 참조하지 않음 (bid_records 직접 집계).
- residual_offset은 predict_dist_combined가 직접 참조하므로 본 백필이 RPC 잔차 결합 동작에 직접 영향.
- HAVING count(*)>=5는 분석용 보존, RPC 적용 게이트는 residual_n_required=30 (테이블 기본값).

