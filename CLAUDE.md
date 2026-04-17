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

## 금기사항
- Supabase SDK 설치하지 말 것 (기존 REST 패턴 유지)
- .env.local, .env는 절대 git에 올리지 말 것 (.gitignore로 차단됨)
- 브랜치 사용 자제 (비용 이슈로 main 직접 작업 결정됨)
