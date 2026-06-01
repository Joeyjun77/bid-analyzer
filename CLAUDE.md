# bid-analyzer 프로젝트 컨텍스트

## 개요
한국 공공조달 입찰 분석/예측 플랫폼. 전기/통신/소방 건설계약의 낙찰 데이터 분석, 사정률 예측.

## 스택
- React + Vite (src/App.jsx 중심, 1800+ 줄 단일 파일 구조)
- Supabase PostgreSQL (직접 REST API 호출, SDK 미사용)
- Vercel 자동 배포 (main 브랜치 push 트리거)
- SheetJS (xlsx, codepage:949) — XLS 파싱

## 주요 경로
- 로컬: C:\Users\home\bid-analyzer
- Supabase 프로젝트 ID: sadunejfkstxbxogzutl
- Live: https://bid-analyzer-pi.vercel.app
- GitHub: Joeyjun77/bid-analyzer

## 현재 Phase: 4-B MVP Auth
- 이메일/비밀번호 로그인 (Supabase Auth)
- 파일: src/auth.js (REST 래퍼), src/components/AuthGate.jsx (관문)
- 배포 상태: 1차 완료, UI 정리 진행 중

## 도메인 지식 핵심
- 사정률: (예정가격/기초금액 - 1) × 100, 100% 기준 표기 선호
- 복수예비가: C(15,4) 추첨 → 이론적 MAE 하한 0.642%
- 낙찰하한율: 기관·금액대별 상이 (3억 미만 87.745% 등)
- 1순위 마진: 낙찰하한율 대비 +0.001~0.005%

## 작업 스타일
- npx vite build 로 빌드 검증 후 git commit
- git pull --rebase 먼저, 그 후 push
- Windows PowerShell 환경 (CRLF 경고는 무시)
- main에 push하면 Vercel 자동 배포 (2~3분)

## DB 주요 객체
- bid_records (53,199+ 건), bid_predictions (855+ 건)
- predict_v6 함수 (Phase 15 예측 엔진)
- agency_win_stats (발주사별 낙찰 통계, Phase 12-C)
- 검증 인프라: prediction_quality_daily, weekly_quality_report, phase17_validation, pred_bias_map VIEW
- prediction_corrected_eval VIEW (2026-06-01): 라이브 표시값 corrected_adj=opt_adj+biasFix 재현. raw opt_adj만 보던 사각지대 보완. read-only
- 검증 함수: evaluate_model_release(candidate, baseline, window_days), refresh_prediction_quality_daily(since, until, model_version)
- eval_bias_correction_loo(window_days) (2026-06-01): AG_BA bias 보정 OOS 가치 LOO 판정. delta_corr>0=무보정보다 악화. 보정 수정 검토 게이트

## Generator / Evaluator 분리 규칙 (Phase 23-3)
예측 코드(`getFinalRecommendation`, `opt_adj` 계산, `pred_bias_map` 관련, 낙찰하한율 함수) 변경 시:
1. 변경 직전에 baseline MAE를 `evaluate_model_release` 또는 bid_predictions 직접 쿼리로 측정
2. 변경 후 `/evaluate` 슬래시 커맨드로 회귀 검증 (PASS/WARN/FAIL 3값 판정)
3. FAIL 판정 시 git push 금지 → 롤백 또는 수정 후 재검증
4. WARN 이상 판정 받은 변경은 배포 후 24시간 내 `/accuracy` 재측정 필수
5. 핵심 영역(한전·고양시·군부대) MAE +0.02 이상 악화는 즉시 FAIL
슬래시 커맨드: `.claude/commands/accuracy.md`, `.claude/commands/evaluate.md`

## 5단계 하네스 진입 트리거 (세션 무관 강제)
어떤 세션에서 작업하더라도 아래 트리거 발동 시 해당 단계 절차를 강제 실행한다.

### 1단계 — 설계 (Design)
**진입 트리거**: 사용자가 예측 로직 변경/신규 기능을 제안하는 발화 (예: "predict_v6 에 X 보정 추가", "낙찰하한율 함수 바꿔줘", "pred_bias_map grain 조정")
**필수 절차**:
- 코드 작성 전에 `predict-architect` 서브에이전트(Agent 툴, subagent_type=`predict-architect`) 호출하여 격리된 컨텍스트로 영향도 사전 검토
- 검토 결과 Generator 분류 시 → 2단계 진입 가능, Evaluator 분류 시 → 검증 면제
- 핵심 영역(한전·고양시·군부대) 영향 예측 표 받은 후에만 코드 수정 시작

### 2단계 — 구축 (Build)
**진입 트리거**: `src/App.jsx` 또는 `src/utils*.js`의 `getFinalRecommendation`, `opt_adj`, `pred_bias_map`, 낙찰하한율 함수 Edit/Write
**필수 절차**:
- Edit 직후 PostToolUse hook이 자동 알림 (변경 키워드 감지 시)
- 변경 즉시 `npx vite build` 통과 확인
- 빌드 통과 → 3단계 진입

### 3단계 — 검증 (Verify)
**진입 트리거**: 2단계 완료 직후, 또는 사용자가 "검증해줘"·"테스트"·"백테스트" 발화
**필수 절차**:
- `/evaluate` 슬래시 커맨드 실행 (PASS/WARN/FAIL 3값)
- FAIL 시 git push 금지, 롤백 또는 수정 후 재검증
- WARN/PASS 시 4단계 진입 가능

### 4단계 — 운영 (Operate)
**진입 트리거**: 사용자가 "push", "배포", "main에 올려" 발화 또는 git push 실행 직전
**필수 절차**:
- `deploy-gate` 서브에이전트(Agent 툴, subagent_type=`deploy-gate`) 호출하여 통합 게이트 실행
- 빌드 + 핵심 영역 MAE + evaluate_model_release 통합 PASS 시에만 push 허용
- 배포 후 24시간 내 `/accuracy` 재측정 (WARN 이상 판정인 경우)

### 5단계 — 예측 시스템 (Predict)
**진입 트리거**: 사용자가 신규 입찰 데이터를 추가하거나 "예측해줘" 발화
**필수 절차**:
- DB 함수 `predict_v6(...)` 직접 호출 (코드 변경 없음)
- 결과는 정보 제공 도구로만 사용 (UI에 "확정/제출" 류 액션 금지)
- 예측 품질이 의심되면 즉시 `/accuracy` 실행

### 트리거 충돌·우회 방지
- Plan/메모리는 강제력이 없다. 위 절차는 commands/agents/hooks로만 실행된다.
- "빠르게 고치고 싶다" 같은 발화로 검증 단계 건너뛰기 금지. 단축 요청 시 사용자에게 "Phase 23-3 규칙 위반 가능 — 그래도 진행할까요?" 명시 후 동의 받을 것.

## V2 재설계 진행 중 (Phase 23-9 → V2)
- **단일 진실**: `docs/v2/HANDOFF_V2_MASTER_PLAN.md` (코덱스 검증 정정판)
- **문서 묶음** (`docs/v2/`):
  - `HANDOFF_V2_MASTER_PLAN.md` — D/B/U 3트랙 통합 마스터플랜
  - `V2_DDL_SPEC.md` — 4개 신규 테이블 명세 (insufficient_sample enum + confidence 산식)
  - `V2_UI_SPEC.md` — U0~U3 화면 명세 (안착/공략 모드 분기)
  - `V2_MEASUREMENT_SPEC.md` — bid_rate 측정 공간 정식 명세 (단위 게이트 근거)
  - `HANDOFF_V2_WIN_DEFINITION.md` — 선행 핸드오프 (3중 조건)
  - `HANDOFF_V2_PREDICTION_DEFINITION.md` — 선행 핸드오프 (P(낙찰|X) 정의)
  - `HANDOFF_V2_DIAGNOSIS_RESULT.md` — 선행 핸드오프 (bid_rate 공간 전환 근거)
- **측정 공간**: `bid_rate` 공간만 신규 KPI 허용 (`adj_rate` 공간 WIN-zone 영구 폐기)
- **DB 인프라 (B0a/B0b/B1 완료, 2026-05-19)**: 4개 테이블 + lookup RPC 완성
  - `agency_mode_lookup` — 41건 적재 (at 6 + AG 22 + AG_BA 13)
  - `floor_pass_daily` / `win_zone_daily` / `mode_gate_report` — 빈 테이블, 일배치 대기
  - 모두 UNIQUE NULLS NOT DISTINCT + RLS + service_role INSERT 정책
  - `lookup_agency_mode(at, canonical_ag, ba)` RPC — 3단계 fallback (AG_BA→AG→AT)
- **DB 인프라 (예정)**: B2 시점 `bid_predictions` 모드 컬럼 6개 ADD, B0b 잔여 `m8_alter_phase17_add_floor_bidrate`
- **모드 분기**: 군시설=A(WIN-zone 노림), 그 외=B(하한 안착). 자사 낙찰률은 추적만, KPI 아님
- **검증 게이트**: `/evaluate` 4대 강제 — G-단위/G-A안/G-bias/G-모드표시 (`.claude/commands/evaluate.md`)
- **MAE 강등**: 보조 모니터링만, 1차 KPI 아님 (V2 retire 후 제거 검토)

## 금기사항
- Supabase SDK 설치하지 말 것 (기존 REST 패턴 유지)
- .env.local, .env는 절대 git에 올리지 말 것 (.gitignore로 차단됨)
- 브랜치 사용 자제 (비용 이슈로 main 직접 작업 결정됨)
- adj_rate 공간 WIN-zone/승률 KPI 신규 추가 금지 (`/evaluate` G-단위 FAIL)
- 매칭된 `bid_predictions.opt_adj`·`bid1st_v2_*` UPDATE 금지, `predictions_v2` UPDATE 금지 (A안 INSERT-only)
- `bid_records`/`bid_details` DELETE 금지
