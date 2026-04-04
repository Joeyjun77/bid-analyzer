# 입찰 분석 시스템 — 통합 스킬 문서
> 최종 업데이트: 2026-04-04 (Phase 4-A 완료, P3 AI 고도화, P4 문서화)

## 1. 시스템 개요

한국 공공조달 입찰(전기/통신/소방) 낙찰 분석 및 1순위 사정율 예측 시스템.

| 항목 | 값 |
|------|-----|
| GitHub | `https://github.com/Joeyjun77/bid-analyzer` |
| 배포 | Vercel (main 브랜치 자동 배포) |
| DB | Supabase 프로젝트 `sadunejfkstxbxogzutl` |
| 프론트엔드 | React 18 + Vite, SheetJS (xlsx, codepage:949) |
| 코드 규모 | 6파일 1,194줄 (App.jsx 933 + lib/ 381 + api/ 261) |
| 데이터 | records 53,183건 / details 598건 / predictions 34건(25 matched) |
| 예측 성능 | MAE 0.6245% / Bias -0.081% / ±0.5% 적중 48% |
| 이론적 하한 | 노이즈 바닥 0.642% (같은 기관 연속건 사정률 차이 중앙값, 51K 측정) |
| AI 모델 | Claude Opus 4.6 (상담), Sonnet 4 (개별건 전략 분석) |

## 2. 파일 구조

```
프로젝트 루트/
├── vercel.json                — SPA + API 라우팅
├── api/
│   ├── ai.js (29줄)           — Claude API 단순 프록시 (Sonnet 4, 개별건 분석용)
│   └── chat.js (232줄)        — AI 상담 전용: 사용자 질문 → DB 조회 → Claude Opus 4.6
├── src/
│   ├── main.jsx               — Vite 엔트리
│   ├── App.jsx (933줄)        — UI 컴포넌트 (NI, AgencyInput, App)
│   └── lib/
│       ├── constants.js (9줄) — SB_URL, SB_KEY, hdrs, C(색상), PAGE, inpS, CHO
│       ├── utils.js (309줄)   — 유틸, MD5, 파싱 3종, calcStats, predictV5, SUCVIEW, simDraws
│       └── supabase.js (66줄) — sbFetchAll, sbUpsert, sbDelete*, sbSave/FetchPredictions, sbMatchPredictions, sbDeletePredictions, sbSave/FetchDetails
```

**import 규칙**: App.jsx는 constants.js와 utils.js, supabase.js를 import. supabase.js는 constants.js와 utils.js(sanitizeJson만)를 import. utils.js는 constants.js(CHO만)를 import.

**API 라우팅 (vercel.json)**:
- `/api/ai` → `api/ai.js` (단순 프록시, Sonnet 4)
- `/api/chat` → `api/chat.js` (DB 조회 + Opus 4.6)
- `/*` → `index.html` (SPA)

## 3. DB 스키마

### bid_records (53,183건)
낙찰정보리스트에서 파싱된 모든 낙찰 이력.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | serial PK | |
| dedup_key | text UNIQUE | MD5(pn+ag+od+ba) — upsert 키 |
| pn | text | 공고명 |
| pn_no | text | 공고번호 (군시설: L-prefix, 나라장터: R-prefix) |
| ag | text | 발주기관명 |
| at | text | 기관유형 (조달청/지자체/교육청/한전/LH/군시설/수자원공사) |
| ep | numeric | 추정가격 |
| ba | numeric | 기초금액 |
| av | numeric | A값 (관급자재비) |
| xp | numeric | 예정가격 |
| bp | numeric | 1순위 투찰금액 |
| br1 | numeric | 1순위 예정가격비율 (100 기준, 사정율 = br1-100) |
| br0 | numeric | 자사 예정가격비율 |
| ar1, ar0 | numeric | 사정율 (100 기준) |
| co | text | 1순위 업체명 (유찰 시 "유찰"/"유찰(무)") |
| pc | integer | 참여업체수 |
| od | date | 개찰일 |
| era | text | "new"/"old" (투찰률 기준 시대 구분) |
| fr | numeric | 적용 낙찰하한율 |
| created_at | timestamptz | DB 삽입 시각 |

### bid_predictions (34건)
예측 결과 + 실제 매칭 비교. source='file_upload' 건만 저장 (수동입력은 DB 미저장).

| 컬럼 | 타입 | 설명 |
|------|------|------|
| dedup_key | text UNIQUE | "pred\|"+pn_no+"\|"+od |
| pred_adj_rate | numeric | 예측 사정율 |
| pred_expected_price | numeric | 예측 예정가격 |
| pred_floor_rate | numeric | 적용 낙찰하한율 |
| pred_bid_amount | numeric | 추천 투찰금액 |
| match_status | text | "pending" / "matched" |
| actual_adj_rate | numeric | 실제 사정율 (매칭 후) |
| adj_rate_error | numeric | 예측-실제 오차 |
| source | text | "file_upload" (수동입력은 DB에 저장하지 않음) |

### bid_details (598건)
SUCVIEW 복수예가 상세파일에서 파싱.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| pn_no | text UNIQUE | 공고번호 |
| pre_rates | jsonb | 15개(또는 14개) 복수예비가격 사정율 배열 |
| pre_avg | numeric | pre_rates 평균 |
| adj_rate | numeric | 실제 사정율 |

## 4. API 보안 아키텍처

- **Anthropic API 키**: Vercel 환경변수 `ANTHROPIC_API_KEY`에만 저장 (클라이언트 노출 없음)
- **Supabase 키**: Vercel 환경변수 `SUPABASE_ANON_KEY`에 저장 (서버사이드 DB 조회용)
- **프록시 패턴**: 브라우저 → `/api/ai` 또는 `/api/chat` (같은 도메인) → Anthropic API (CORS 우회)
- **RLS**: 전체 허용 상태 (Phase 4-B에서 Auth 도입 시 제한 필요)

## 5. AI 시스템 아키텍처

### 5.1 개별건 전략 분석 (/api/ai → Sonnet 4)
- 예측 탭 상세 모달에서 "전략 분석 요청" 클릭 시 호출
- `buildAiPrompt(r)` → 입찰 기본 정보 + 예측 결과 → Sonnet 4 (max_tokens: 500)
- 용도: 특정 입찰건의 투찰 전략 간략 코멘트

### 5.2 AI 상담 챗봇 (/api/chat → Opus 4.6)
- 4번째 탭 "AI 상담"에서 대화형 상담
- 서버 사이드 DB 조회 (5가지 패턴):

| 패턴 | 트리거 | 조회 내용 |
|------|--------|----------|
| 기관 통계 | 기관명 감지 (정규식) | ag LIKE '%키워드%' → 통계 + 최근 5건 |
| 기관유형 비교 | "기관별", "vs", "비교" | GROUP BY at 통계 (최근 5,000건) |
| 예측 성능 | "MAE", "정확도", "매칭" | bid_predictions 매칭 건 + 기관유형별 MAE |
| 최근 동향 | "최근", "추이", "트렌드" | 최신 30건 낙찰 건 |
| 투찰 마진 | "투찰", "마진" + 기관명 | 1순위 투찰율-하한율 분석 |

- 시스템 프롬프트 구성: `buildChatSystem()` (프론트 정적 통계) + DB 조회 결과 (서버 동적)
- 대화 컨텍스트: 최근 20개 메시지 전달
- 응답 렌더링: `md2html()` → 제목/볼드/리스트/코드/테이블 HTML 변환
- 문서 다운로드: 대화 내용을 마크다운(.md) 파일로 다운로드

### 5.3 수동 시뮬레이션 (DB 미저장)
- 예측 탭 "빠른 시뮬레이션" 토글로 열림
- `doManualPred()` → `predictV5()` 호출 → 결과를 인라인 카드로 표시
- DB에 저장하지 않음 (일회성 조회, 예측 통계에 영향 없음)
- AI 전략 분석 버튼으로 Sonnet 4 즉석 분석 가능

## 6. UI 구조 (Phase 4-A)

### 6.1 4탭 구조
- **대시보드(dash)**: 데이터 현황 카드, 기관유형별 요약, 데이터 신선도
- **분석(analysis)**: 기관유형별 사정율 분포, 발주기관 검색(초성), 전략 참조 대시보드, 전체 데이터 테이블
- **예측(predict)**: 파일 업로드 + 시뮬레이션 토글, 모델 성능 카드, 통합 예측 리스트 + 상세 모달
- **AI 상담(chat)**: Claude Opus 4.6 기반 대화형 상담 (서버 DB 조회 연동)

### 6.2 예측 탭 구조 (개편 후)
```
상단: [파일 업로드 드롭존] [빠른 시뮬레이션 토글]
중단: [MAE] [Bias] [적중률] [매칭] — 4개 성능 카드
하단: 통합 예측 리스트 (file_upload 건만)
      └ 각 행 [상세] 버튼 → 모달 팝업
          ├ 예측 vs 실제 비교 테이블 (4행: 사정률/예정가격/투찰금액/투찰율)
          ├ 입찰 기본 정보 (기초금액/추정가격/A값/하한율/공고번호/참여업체/근거/1순위)
          └ AI 전략 어드바이저 (Sonnet 4)
```

### 6.3 AI 상담 탭 구조
```
대화 영역: 사용자(금색Q 아바타) / AI(보라AI 아바타) 대화 버블
  └ AI 응답: md2html 마크다운 렌더링 (제목/볼드/리스트/코드/테이블)
  └ 초기 화면: 6개 추천 질문 버튼
입력 영역: textarea + 전송 버튼
  └ Enter 전송 / Shift+Enter 줄바꿈
  └ [문서 다운로드] [초기화] 버튼
```

## 7. 핵심 비즈니스 로직

### 7.1~7.6 (변경 없음 — Phase 3 skills 문서 참조)
- 기관유형 분류 (clsAg)
- 낙찰하한율 (RATE_TABLE) — 2026 개정 반영
- 투찰금액 산출식
- 예측 엔진 predictV5 (3단계 블렌딩)
- 추첨 시뮬레이션 simDraws
- 자동매칭 로직 (sbMatchPredictions)

## 8. 파싱 (3종 자동 판별)
(변경 없음 — Phase 3 skills 문서 참조)

## 9. 운영 / 배포 / 보안

### 9.1 Vercel 환경변수 (필수)
| 변수 | 용도 |
|------|------|
| `ANTHROPIC_API_KEY` | Claude API 인증 (ai.js, chat.js에서 사용) |
| `SUPABASE_ANON_KEY` | 서버 사이드 DB 조회 (chat.js에서 사용) |

### 9.2 Vercel/Vite 빌드 주의사항
- bare `catch{}` → `catch(e){}` (빌드 실패)
- 같은 함수 스코프 내 변수 shadowing 금지
- ESM 호환 확인 (SheetJS는 `import * as XLSX from "xlsx"`)
- `vercel.json` 필수 (없으면 /api/* 라우팅 실패)

## 10. Phase 이력 및 로드맵

### 완료
| Phase | 내용 | 주요 성과 |
|-------|------|----------|
| 1 | DB 연동, 3종 파싱, predictV3, 3탭 UI | 28K건 로드, 기본 예측 |
| 2 | v5 엔진, 노이즈바닥, drift 제거, 백테스트 | MAE 0.6245%, 이론적 한계 근접 |
| 3 | 투찰시뮬레이터, 1순위경쟁분석, 일괄엑셀, refreshAll | 53K건, 실전 도구 완성 |
| P0 | 군시설 매칭 버그 검증 | 25건 전부 day_diff=0 확인 |
| P2 | 코드 모듈분리 (1파일→4파일) | App.jsx 1,288→915줄 |
| 4-A | AI 어드바이저 (Sonnet 4 개별건, Opus 4.6 상담) | API 프록시, 서버 환경변수 보안 |
| UI개편 | 예측 탭 전면 개편 | 시뮬레이션 분리, 통합 리스트, 상세 모달 |
| P3 | AI 고도화 (서버 사이드 DB 조회) | /api/chat, 5가지 DB 조회 패턴 |
| P4 | Skills 문서 최신화 | Phase 4-A 이후 전체 반영 |

### Phase 4 남은 계획
| Step | 내용 | 전제조건 |
|------|------|----------|
| 4-B | 사용자 인증 (Supabase Auth) | P3 완료 |
| 4-C | 자동화 (Edge Function + Cron) | 4-B 완료 |

### P1 (대기중)
나라장터에서 pending 9건의 개찰 결과 데이터 확보 → 자동 매칭 → v5 검증 샘플 확대.

## 11. 핵심 교훈

- **복수예비가격 메커니즘은 본질적으로 랜덤**: C(15,4) 추첨의 std ≈ 0.6%가 예측의 이론적 하한을 결정
- **br1은 100 기준**: 사정율 = br1-100. raw 값 사용 시 ~2배 오차 발생
- **투찰율은 사정률의 결과**: 예측 변수로 사용 시 MAE 악화. 표시용(UX)으로만 유지
- **수동입력은 DB 미저장**: 시뮬레이션 전용. 예측 통계 오염 방지
- **API 키는 서버 환경변수만**: localStorage 사용 금지. Vercel Serverless Function이 프록시
- **Supabase REST API 1000건 제한**: 반드시 offset 페이지네이션 필요
- **CORS 해결**: 브라우저 → 같은 도메인 프록시(`/api/*`) → 외부 API
