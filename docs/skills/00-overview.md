# 입찰 분석 시스템 — 전체 개요
> 최종 업데이트: 2026-04-12 (Phase 12-D A안 배포 완료)
> 다른 스킬 파일을 참조하기 전에 이 문서부터 읽을 것

## 시스템 정체

한국 공공조달 입찰(전기/통신/소방) 낙찰 분석 + 1순위 사정률 예측 + 발주사별 낙찰 예측 시스템. 준이라는 사용자가 실제 여성기업 전기 시공사를 운영하면서 매주 실전 투찰에 사용 중. 시스템의 추천 사정률·투찰금액이 실제 비즈니스 의사결정에 영향을 미치므로, 안정성·정확성·재현성이 최우선.

## 사용자

- 이름: 준 (PM/서비스 기획)
- 사업: 여성기업 전기 시공사 (경기 지역 주력)
- 주력 발주사: 고양시 3개 행정구, 한전 경기 3본부, LH 경기남부, 서울교통공사
- 환경: Windows 11, Git Bash, VS Code
- 한국어 응대 필수

## 핵심 식별 정보

| 항목 | 값 |
|------|-----|
| 라이브 배포 | https://bid-analyzer-pi.vercel.app |
| GitHub | https://github.com/Joeyjun77/bid-analyzer |
| Supabase 프로젝트 ID | `sadunejfkstxbxogzutl` |
| Supabase 리전 | ap-northeast-2 (Seoul) |
| Vercel 배포 방식 | main 브랜치 push → 자동 배포 (1~2분) |

## 기술 스택

- **프론트**: React 18 + Vite, SheetJS (xlsx, codepage:949)
- **백엔드**: Supabase PostgreSQL (REST API 직접 호출, SDK 없음)
- **AI**: Claude API (`/api/chat` Vercel Function 경유)
- **빌드**: `npx vite build` (esbuild)
- **번들 크기**: 707 KB (gzip 230 KB)

## 파일 구조

```
src/
├── main.jsx              — Vite 엔트리
├── App.jsx (1,745줄)     — UI 컴포넌트, 상태 관리, 비즈니스 로직
└── lib/
    ├── constants.js (9줄)  — SB_URL, SB_KEY, hdrs, C(색상), PAGE, inpS, CHO
    ├── utils.js (706줄)    — predictV5, 파싱, 통계, 시뮬레이션, AI 헬퍼
    └── supabase.js (134줄) — sbFetch*, sbUpsert*, sbMatch* 등
api/
└── chat.js               — Claude API 프록시 (Vercel Function)
```

**중요**: App.jsx는 import 경로상 lib/ 하위 파일만 참조. constants.js → utils.js → supabase.js 순으로 의존성이 단방향. 순환 참조 금지.

## 데이터 규모 (2026-04-12 기준)

| 테이블 | 행 수 | 용도 |
|---|---|---|
| `bid_records` | ~53,200건 | 과거 낙찰 이력 (전국, 모든 발주사) |
| `bid_details` | ~600건 | SUCVIEW 복수예가 상세 (15개 예비가격) |
| `bid_predictions` | ~1,210건 | 준의 예측 + 매칭 결과 |
| `agency_win_stats` | 114개 | 발주사별 낙찰 통계 (Phase 12-C) |
| `agency_predictor` | 114개 | 발주사별 예측 보정 (Phase 12-D) |
| `target_matrix` | 26개 | 기관유형×금액대 이론 낙찰률 |
| `sweet_spot_agencies` | 98개 | 3억+ 공고 빈도 |

## 현재 성능 지표

| 지표 | 값 | 비고 |
|---|---|---|
| MAE (전체 매칭) | **0.5857%** | 1,088건 기준 (Phase 12-D 적용 시 0.5446%) |
| 노이즈 바닥 | 0.642% | C(15,4) 추첨의 구조적 한계 |
| 실제 낙찰률 | 0.74% | 8/1,088건 |
| 이론 낙찰률 (P1+P2 평균) | ~30% | 발주사별 완벽 예측 시 가능 |
| 이론 상한 | 4.6% | 50/1,088건 — 모든 예측이 완벽할 때 |

## Phase 진행 상태 (2026-04-12)

| Phase | 내용 | 상태 |
|---|---|---|
| 1 | DB 연동, 3종 파싱, predictV3, 기본 UI | ✅ |
| 2 | predictV5, 노이즈바닥, drift 제거 | ✅ |
| 3 | 시뮬레이터, 1순위 경쟁분석, 일괄 엑셀 | ✅ |
| 4-A | LLM 어드바이저 (Claude API 연동) | ✅ |
| 5 | ROI 등급 (S/A/B/C/D), 점수 시스템 | ✅ |
| 6~10 | (여성기업 오염으로 인한 폐기) | ❌ |
| 11 | 여성기업 오염 제거 | ✅ |
| 12-A | 데이터 클린업, target_matrix 재구축 | ✅ |
| 12-B | 코드 정리, isWomenBiz 완전 제거 | ✅ |
| 12-B1 | 928건 corrupted floor_rate 수정 | ✅ |
| 12-C | 발주사별 낙찰 예측 UI (P1~P5 배지) | ✅ |
| 12-D A | 발주사 오프셋을 predictV5에 통합 | ✅ |
| 12-D B | 과거 pending 재계산 | 보류 |
| 방안 D | 낙찰확률 스코어 모델 | 계획 |
| 방안 B | 주간 투찰 계획 탭 | 계획 |
| 방안 C | 가정 사정률 상한율 모델 | 계획 |

## 다음 단계 우선순위 (준이 결정 대기)

준은 **이번 주 P1 8건의 실전 투찰 결과를 모은 후** 다음 단계를 결정하기로 함. 가능한 다음 단계:

1. **방안 D (낙찰확률 스코어 모델)** — 발주사 이론 낙찰률 + 마진 여유 + 예측 신뢰도 + 참여자/금액 보정의 5-factor 결합. 1 세션, 가장 즉시적 가치
2. **방안 C (가정 사정률 상한율 모델)** — 소수점 4자리 경쟁 시스템. 2 세션, 가장 큰 낙찰률 개선 가능성
3. **방안 B (주간 투찰 계획 탭)** — UI 계층 통합. 1 세션, 위 두 개 후 자연 통합

## 새 세션 시작 시 권장 행동

1. 이 문서(00-overview.md) 먼저 읽기
2. 이전 세션 transcript에서 진행 중인 작업 확인
3. 사용자 질문이 도메인 지식 → `01-domain-knowledge.md`
4. 사용자 질문이 SQL/스키마 → `02-data-architecture.md`
5. 사용자 질문이 예측 로직 → `03-prediction-engine.md`
6. 사용자 질문이 UI/표기 → `04-frontend-codebase.md`
7. 사용자 질문이 배포/운영 → `05-operations-deployment.md`
8. 사용자 질문이 "왜 이렇게 했나" → `06-history-decisions.md`

## 사용자 응대 원칙 (이 시스템 특화)

- **사정률 표기는 무조건 100% 기준** (예: 99.78%, 100.06%). 0-base는 내부 계산에만 사용
- **DB를 건드리는 변경은 반드시 사전 확인** (특히 DROP, UPDATE, DELETE)
- **과거 데이터 무결성 유지가 최우선** — bid_predictions의 opt_adj 같은 영구 저장값은 함부로 수정하지 않음
- **Phase 11 이전 코드는 여성기업 오염 가능성** — `isWomenBiz` 같은 단어가 보이면 즉시 경고
- **준의 직관 검증 우선** — 통계적으로 맞아도 준이 "이건 아닌데" 하면 다시 봄
- 새로운 가설을 세우면 반드시 SQL로 데이터 검증 후 결론 도출
- 빌드 검증 (`npx vite build`) 없이 코드 변경 완료 선언 금지
