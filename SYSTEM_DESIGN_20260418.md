# bid-analyzer 시스템 설계 · Phase 21-R

> **기준일**: 2026-04-18
> **Live**: https://bid-analyzer-pi.vercel.app
> **Repo**: github.com/Joeyjun77/bid-analyzer
> **구조 모델**: 예측 코어(수직) × 6파트(수평) 매트릭스

---

## 0. 서비스 정체성

한국 공공조달(전기/통신/소방 공사) 입찰에서 **발주사별 낙찰 확률을 극대화**하기 위한 4대 출력 예측 시스템.

**4대 출력 (핵심 목표)**
1. 최소 사정률 — 투찰 하한 공격 시나리오
2. 최소 하한금액 — 투찰 무효 경계선
3. 1위 추천 사정률 — 낙찰 목표 추천값
4. 추천 투찰금액 — 실제 투찰 액면가

---

## 1. 조직 구조 — 매트릭스 모델

```
                    ┌──────── 수평 파트 (6개) ────────┐
                    │                                  │
  수직 코어(1개)     ① 설계   ② 수집   ③ 분석   ④ 구축   ⑤ 운영   ⑥ 검증
                    │                                  │
  ★ 예측 코어 ──────┤ 상수    is_excl   MAE    엔진코드 배포게이트 회귀방지
  (Prediction       │ 공식    _filter   trend  registry  모델헬스  하네스
   Core)            │                                  │
                    └──────────────────────────────────┘

  수직 = 도메인(모델·버전·실험)
  수평 = 엔지니어링 관심사(역할·스킬)
```

- **수직 1개**: 예측 코어 — 모델·버전·실험·하네스 전용 자산
- **수평 6개**: 설계 · 수집 · 분석 · 구축 · 운영 · 검증
- 교차점은 **좁은 계약(Interface Contract)**으로 정의 — 파트 내부 변경이 타 파트로 전파되지 않음

---

## 2. 수직 — 예측 코어 (Prediction Core)

서비스의 유일한 차별화 자산. 모델의 **수명주기·측정·교체·게이팅**을 단독 소유.

### 2-1. 책임 범위

| 자산 | 상세 |
|---|---|
| 모델 레지스트리 | predict_v6_2 / predictV5 / 후보 v7 버전·가중치·이력 관리 |
| 백테스트 하네스 | walk-forward runner, at별 복제, paired t-test |
| 릴리스 게이트 | 신규 모델의 baseline MAE 대비 악화 시 자동 차단 |
| A/B 쉐도우 레인 | 운영은 v6.2, 쉐도우는 v7 병행 예측 → 무위험 비교 |
| 재학습 트리거 | 주 1회 가중치 재평가, 드리프트 시 재학습 제안 |
| 라우트 정책 | agency_rich / blend / tier_fallback 분기 규칙·임계값 |

### 2-2. 예측 엔진 현황

| 엔진 | 위치 | 역할 | 상태 |
|---|---|---|---|
| `predict_v6_2` | DB (PL/pgSQL) | 운영 자동 예측 | 가동 중 (MAE 0.49 이론한계 근접) |
| `predictV5` | utils.js | 수동 업로드·백테스트 | 가동 중 (2층 보정) |
| `routePrediction` | utils.js | 라우팅 분류기 | 신규 (Phase 21-R) |

### 2-3. 예측 코어 신규 스키마 (설계안)

#### 2-3-1. `model_registry` — 모델 버전·설정 관리

```sql
CREATE TABLE model_registry (
  id               bigserial PRIMARY KEY,
  version          text NOT NULL,                   -- 'v5.3', 'v6.2', 'v7-shadow' 등
  engine           text NOT NULL,                   -- 'predict_v6_2' | 'predictV5' | 기타
  params           jsonb NOT NULL,                  -- 가중치·TYPE_OFF·임계값 스냅샷
  baseline_mae     numeric,                         -- 배포 시점 기준 MAE
  baseline_n       int,                             -- 기준 표본 수
  status           text NOT NULL DEFAULT 'candidate', -- candidate|shadow|production|retired
  activated_at     timestamptz,
  retired_at       timestamptz,
  created_at       timestamptz DEFAULT NOW(),
  created_by       text,
  notes            text,
  UNIQUE(version, engine)
);

CREATE INDEX idx_model_registry_status ON model_registry(status, activated_at DESC);
```

**운영 규칙**
- 한 번에 `status='production'`은 엔진당 1개만 가능
- 신규 모델은 `candidate` → `shadow`(쉐도우 트래픽) → `production` 승격
- 승격 시 baseline MAE 대비 **악화하면 게이트가 차단**

#### 2-3-2. `prediction_quality_daily` — 일간 품질 지표 누적

```sql
CREATE TABLE prediction_quality_daily (
  id               bigserial PRIMARY KEY,
  measured_on      date NOT NULL,                   -- 평가 일자(KST)
  model_version    text NOT NULL,                   -- model_registry.version 참조
  route            text,                            -- agency_rich|blend|tier_fallback|agency_redirect|all
  at               text,                            -- 발주유형, NULL이면 전체
  n                int NOT NULL,                    -- 평가 대상 matched 건수
  mae              numeric,
  median_err       numeric,
  p90_err          numeric,
  max_err          numeric,
  hit_0_5_pct      numeric,
  hit_0_3_pct      numeric,
  floor_safe_pct   numeric,                         -- 투찰금≥낙찰하한 비율
  direction_pct    numeric,                         -- 방향 정확도(+/-)
  residual_mean    numeric,                         -- 편향 확인용
  created_at       timestamptz DEFAULT NOW(),
  UNIQUE(measured_on, model_version, route, at)
);

CREATE INDEX idx_pqd_trend ON prediction_quality_daily(model_version, route, measured_on DESC);
```

**채움 방식**: cron 일 1회 (매일 KST 04:00) → 최근 90일 matched 재집계 → UPSERT

#### 2-3-3. `model_release_gate` — 릴리스 차단 규칙

```sql
CREATE TABLE model_release_gate (
  id               bigserial PRIMARY KEY,
  metric           text NOT NULL,                   -- 'mae', 'hit_0_5_pct', 'floor_safe_pct' 등
  comparator       text NOT NULL,                   -- 'le'(작아져야), 'ge'(커져야)
  tolerance_pct    numeric NOT NULL,                -- 허용 회귀 %, 예: 5.0
  scope            text DEFAULT 'overall',          -- 'overall' | at명 | route명
  enabled          boolean DEFAULT true,
  created_at       timestamptz DEFAULT NOW()
);

-- 예시 시드
INSERT INTO model_release_gate(metric, comparator, tolerance_pct, scope) VALUES
  ('mae', 'le', 5.0, 'overall'),
  ('hit_0_5_pct', 'ge', 3.0, 'overall'),
  ('floor_safe_pct', 'ge', 0.0, 'overall');
```

### 2-4. 예측 코어 하네스 루틴 (자동화 목표)

```
매일 04:00 KST:
  1. 전일 신규 matched 건 → prediction_quality_daily 삽입
  2. 7일/30일 MAE trend 계산 → 드리프트 감지
  3. 드리프트 발견 시 알림(이메일/Slack)

매주 일요일 03:00 KST:
  1. 전주 신규 matched 전수 재평가
  2. TYPE_OFF·WIN_OPT_GAP 잔차 재계산 → 재보정 후보 flag
  3. agency_predictor n<10 발주사 성장 관찰
  4. 주간 리포트 → Supabase Storage + 관리자 이메일

모델 승격 요청 시:
  1. candidate → shadow 승격 (쉐도우 레인에서 병행 예측)
  2. shadow 90일 누적 → baseline 대비 release_gate 검사
  3. 통과 시 production 승격 / 실패 시 retired
```

---

## 3. 수평 파트 상세

### ① 설계 (Design)
- **책임**: 도메인 모델·스키마·보정층 상수
- **입력**: 도메인 지식, 백테스트 결과
- **출력**: `constants.js`의 TYPE_OFF/RATE_TABLE/WIN_OPT_GAP, DB 스키마
- **하네스**: 수식 단위테스트, 도메인 불변식 검사
- **자동화**: 스키마 드리프트 감지 (migration vs current)

### ② 수집 (Collection)
- **책임**: 나라장터 API · SUCVIEW · 수집 규칙 · 품질 필터
- **입력**: API 응답(JSON), SUCVIEW XLS(cp949)
- **출력**: `bid_notices` / `bid_records` / `bid_details`
- **하네스**: 수집 성공률, 중복률, cp949 파싱 오류율
- **자동화**: 30분 cron + 비정상 건 자동 탐지 (pc=1, [시담])

### ③ 분석 (Analysis)
- **책임**: MAE·라우트·백테스트·드리프트·재보정 제안
- **입력**: `bid_predictions` matched + 예측 코어 registry
- **출력**: `prediction_quality_daily`, 재보정 후보 리포트
- **하네스**: walk-forward 재현성, t-test 유효성
- **자동화**: 일 1회 + 주간 자가검증 리포트

### ④ 구축 (Build)
- **책임**: DB 함수·JS 엔진·UI 컴포넌트
- **입력**: 설계 상수 + 예측 코어 엔진 사양
- **출력**: 배포 가능 코드 (main 브랜치)
- **하네스**: `npx vite build`, 회귀 스냅샷, 수동 E2E 체크
- **자동화**: PR 당 Vercel 자동 배포
- **⚠ 병목**: App.jsx 1,834줄 단일 파일 — 점진 컴포넌트 분리 필요

### ⑤ 운영 (Operation)
- **책임**: cron·알림·장애 대응·모니터링
- **입력**: cron 실행 로그, Vercel 빌드 상태
- **출력**: 가동률, SLA, 장애 리포트
- **하네스**: cron 헬스체크, 알림 도달률
- **자동화**: 현 5개 cron + 실패 재시도·페이저 훅 (미구축)

### ⑥ 검증 (Verification)
- **책임**: 타 파트 자체 검수, 통합 회귀 방지
- **입력**: 전 파트 출력물
- **출력**: 커버리지·회귀 리포트
- **하네스**: 메타 테스트(다른 파트 하네스의 유효성)
- **자동화**: 월 1회 통합 리포트 (미구축)

---

## 4. 교차점 계약 (Interface Contract)

교차점은 **좁은 스키마·좁은 기간**으로 정의해 파트 간 변경이 서로 전파되지 않도록 격리.

```
① 설계 ←→ 예측코어  : constants.js (PR 리뷰 필수) · DB schema migration
② 수집 ←→ 예측코어  : bid_records (is_excluded 준수) · bid_notices (status)
예측코어 ←→ ③ 분석  : prediction_quality_daily (UPSERT만 허용)
예측코어 ←→ ④ 구축  : model_registry (status='production' 단일)
⑤ 운영 ←→ 예측코어  : 모델 헬스 엔드포인트 · cron 실행 결과
⑥ 검증 ←→ 전체      : 주간 리포트 (Supabase Storage)
```

**계약 위반 예시 (금지)**
- ④ 구축이 `model_registry` 우회하여 직접 엔진 코드 변경
- ② 수집이 `is_excluded=true` 건을 학습에 포함
- ③ 분석이 `prediction_quality_daily` 외의 경로로 재보정 직접 반영

---

## 5. 데이터 파이프라인

```
외부 ─(30분)─▶ bid_notices ─(auto_predict)─▶ bid_predictions(pending)
외부 ─(1일)─▶ bid_records ─(match)─▶ bid_predictions(matched, actual_*)
수동 ─────▶ bid_details ─(pattern bias)─▶ predictV5 보정
예측코어 ─(04:00)─▶ prediction_quality_daily ─▶ 드리프트 알림
예측코어 ─(주 1회)─▶ release_gate 검사 ─▶ 모델 승격/회수
```

---

## 6. 현재 규모·성능 (2026-04-18)

| 지표 | 값 |
|---|---|
| bid_records 활성 | 54,750건 (88 배제) |
| bid_predictions 활성 | 1,246건 (1,192 matched) |
| bid_notices open | 394건 |
| bid_details | 636건 |
| DB 테이블/뷰/함수 | 34 / 19 / 50 |
| cron | 5개 |

**route별 MAE (matched 1,148)**
| route | n | MAE | hit ±0.5% |
|---|---|---|---|
| agency_rich | 1,053 | 0.526% | 55.4% |
| blend | 38 | 0.532% | 57.9% |
| tier_fallback | 57 | 0.576% | 50.9% |

이론 바닥 0.642%에 근접. 세 루트 모두 건강.

---

## 7. Phase 21-R 변경 이력 (오늘)

| # | 내용 |
|---|---|
| #12 | routePrediction + opt_adj_router (백필 1,280건) |
| #13 | TYPE_OFF 일괄 0 회귀안 — 데이터 반증으로 폐기 |
| #19 | LH 150억 건 시나리오 검증 |
| #20 | 진주시 폴백 부재 건 is_cancelled |
| #21 | 4대 출력 UI 블록 |
| #22 | blend MAE 2.82% → 단일 아웃라이어 규명 + 데이터 복구 3건 |
| #23 | [수의] 태그 오판 → pc=1/[시담] 정밀 기준 88건 배제 |
| #24 | SYSTEM_DESIGN 매트릭스 구조 개정 (이 문서) |
| #25 | P0 예측코어 인프라 구축 — model_registry(v6.2/v5.3 시드) · prediction_quality_daily(90일 백필 212건) · model_release_gate(3 rule) · refresh 함수 · pg_cron 일배치(KST 04:00) |

**교훈**: 공고명 태그는 안내 문자열일 뿐. 계약 방식은 `cntrctCnclsMthdNm` API 필드 or `pc=1` 같은 구조적 지표로 판정해야 함.

---

## 8. 다음 단계 로드맵

### Phase 22 (우선순위 순)

| 순위 | 작업 | 파트 | 기대 효과 |
|---|---|---|---|
| ~~P0~~ ✅ | `prediction_quality_daily` 테이블·일배치 구현 (pg_cron KST 04:00) | 예측코어×③ | 드리프트 가시화 |
| ~~P0~~ ✅ | `model_registry` 시드 (v5.3, v6.2 등록) + `model_release_gate` 3 rule | 예측코어×① | 버전 관리 시작 |
| P1 | 수집 API에 `cntrctCnclsMthdNm` 필드 추가 | ② | 수의계약 구조적 필터 |
| P1 | 주간 자가검증 리포트 자동 생성 | 예측코어×⑥ | 회귀 방지 |
| P2 | App.jsx 컴포넌트 분리 (WinStrategy 외 1~2개) | ④ | 변경 블래스트 반경 축소 |
| P2 | 낙찰 결과 자동 피드백 탭 | ④×③ | 사용자 루프 완결 |
| P3 | A/B 쉐도우 레인 구축 | 예측코어 | 무위험 모델 실험 |
| P3 | 투찰 마감 임박 알림 | ⑤ | 사용자 신뢰 |

### 2주 실측 관찰 윈도우 (04-20 ~ 05-04)
- Phase 21 Bayesian shrinkage + amount_band_correction 실측 효과
- route별 MAE 안정성
- blend 표본 38→100 돌파 시 재평가

---

## 9. 자동화·검증 상세 방향성

### 9-1. 예측 시스템 자동 검증

**(1) 자동 드리프트 감지**
- 일 1회 route별 MAE → 7일 MA 대비 +20% 악화 시 알림
- `prediction_quality_daily` 기반

**(2) 자동 데이터 무결성 체크**
- 매칭 시 `actual_adj_rate` vs `(actual_expected_price/ba - 1)*100` 차이 >1%p → quarantine
- 오늘 발견한 id=773/1047/10229 사례의 선제 감지

**(3) 자동 백테스트**
- 월 1회 지난 30일 matched 전건 walk-forward 재예측
- predict_v6_2 vs predictV5 vs 후보 모델 리포트

**(4) 자동 비정상 탐지**
- `pc=1`/`[시담]` 외 신규 패턴 주 1회 스캔
- 잔차 > p99 건 자동 quarantine + 사유 labeling

### 9-2. 서비스 목표 자동화

| 영역 | 현재 | 목표 |
|---|---|---|
| 의사결정 지원 | 수동 모달 열기 | 공고 등록 즉시 Top-N 자동 정렬 |
| 낙찰 결과 반영 | 수동 업로드 | 나라장터 낙찰정보 API 자동 매칭 |
| 성적표 | MAE 모달 | 예상 vs 실측 누적 P&L 탭 |
| 마감 임박 | 헤더 배지 | 이메일/카카오 푸시 |
| 격전지 경보 | 없음 | tier≤2 발주사 신규 공고 즉시 알림 |
| AI 상담 | 단답 QA | 함수 콜로 예측엔진 직접 호출 |

### 9-3. 피드백 루프

```
투찰 → 매칭 → MAE → parameter 평가
                     ├ 통과: 유지
                     └ 악화: 재보정 제안 자동 생성 → 수동 승인 → production 승격
```

---

## 10. 실전 투입 체크리스트 (4/20~)

- [x] 예측 엔진 (predict_v6_2 + predictV5) 검증
- [x] 4대 출력 UI 노출
- [x] route 레이블 저장·분석 인프라
- [x] 비정상 건 격리 (is_excluded + is_cancelled)
- [x] 데이터 복구 3건
- [x] 매트릭스 조직 구조 설계 확정
- [x] model_registry + prediction_quality_daily 구축
- [x] 자동 드리프트 감지 배치 (pg_cron job#8, 매일 KST 04:00 최근 7일 재집계)
- [ ] 주간 자가검증 리포트
- [ ] 낙찰 자동 피드백 탭
- [ ] 투찰 마감 알림

---

## 11. 레퍼런스

- Phase 21 핸드오프: `HANDOFF_CLAUDE_CODE.md`
- 프로젝트 컨텍스트: `CLAUDE.md`
- 메모리: `C:\Users\home\.claude\projects\C--Users-home-bid-analyzer\memory\MEMORY.md`
