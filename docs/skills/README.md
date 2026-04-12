# 입찰 분석 시스템 스킬 문서
> Claude 세션에서 이 시스템 작업 시 참조하는 통합 문서
> 최종 업데이트: 2026-04-12 (Phase 12-D A안 배포 완료 시점)

## 📚 문서 구성

| # | 파일 | 줄수 | 용도 |
|---|---|---|---|
| 0 | [00-overview.md](./00-overview.md) | 121 | 전체 시스템 개요·로드맵·원칙 |
| 1 | [01-domain-knowledge.md](./01-domain-knowledge.md) | 187 | 입찰 도메인 지식 (사정률·하한율·복수예가) |
| 2 | [02-data-architecture.md](./02-data-architecture.md) | 368 | DB 스키마·SQL 패턴·REST API |
| 3 | [03-prediction-engine.md](./03-prediction-engine.md) | 288 | predictV5·오프셋·발주사 모델 |
| 4 | [04-frontend-codebase.md](./04-frontend-codebase.md) | 445 | App.jsx 구조·UI·표기 규칙 |
| 5 | [05-operations-deployment.md](./05-operations-deployment.md) | 326 | Vercel·Supabase·배포·디버깅 |
| 6 | [06-history-decisions.md](./06-history-decisions.md) | 343 | Phase 1~12-D 이력·의사결정 |

## 🎯 새 Claude 세션 시작 방법

### 방법 1: Project Knowledge로 일괄 첨부 (권장)

claude.ai의 Projects 기능을 사용하는 경우:
1. Project 설정에서 7개 `.md` 파일을 모두 Knowledge에 업로드
2. 새 대화를 시작하면 Claude가 자동으로 참조 가능
3. 첫 메시지에서 명시적으로 언급:
   ```
   "이전 세션 이어서. 00-overview.md부터 확인해줘."
   ```

### 방법 2: GitHub URL 직접 참조

Project 기능을 사용하지 않는 경우:
```
"GitHub https://github.com/Joeyjun77/bid-analyzer/tree/main/docs/skills 
의 스킬 문서를 참조해서 작업해줘. 00-overview.md부터 시작."
```

Claude가 web_fetch로 직접 가져올 수 있습니다.

### 방법 3: 파일 직접 업로드

채팅창에 7개 파일을 드래그 앤 드롭. 매번 반복해야 해서 비효율적이지만 가장 확실.

## 🔍 작업별 필수 참조 문서

| 작업 | 필요한 스킬 |
|---|---|
| 새 SQL 쿼리 작성 | 02 + 01 (도메인 이해 시) |
| predictV5 수정 | 03 + 02 (스키마) |
| UI 컴포넌트 추가/수정 | 04 + 03 (필드 이해) |
| 배포 문제 해결 | 05 + 04 (코드) |
| "왜 이렇게 했나" 질문 | 06 |
| 새 기능 기획 | 00 + 06 (이전 시도 확인) |

## 📦 시스템 핵심 정보

| 항목 | 값 |
|---|---|
| 라이브 배포 | https://bid-analyzer-pi.vercel.app |
| Supabase 프로젝트 ID | `sadunejfkstxbxogzutl` |
| 현재 Phase | 12-D A안 (배포 완료) |
| 데이터 규모 | 53K 낙찰 이력 / 1.2K 예측 / 114 발주사 분류 |
| 예측 성능 | MAE 0.5446% (Phase 12-D 적용 시) |
| 노이즈 바닥 | 0.642% (구조적 한계) |

## 🚀 다음 단계 (사용자 결정 대기)

이번 주 P1 8건 실전 결과 수집 후 다음 중 선택:
1. **방안 D**: 낙찰확률 스코어 모델 (1 세션, 즉시 가치)
2. **방안 C**: 가정 사정률 상한율 모델 (2 세션, 가장 큰 지렛대)
3. **방안 B**: 주간 투찰 계획 탭 (1 세션, UI 통합)

## ⚠️ 절대 원칙

1. **사정률은 100% 표기** (예: 99.78%, 100.06%). 0-base 사용자 노출 금지
2. **bid_predictions의 opt_adj는 영구 저장값** — UPDATE 금지
3. **bid_records 53K건은 마스터 데이터** — DELETE 금지
4. **isWomenBiz 흔적이 보이면 즉시 경고** (Phase 11 청산 완료)
5. **모든 변경은 빌드 검증 후 outputs 복사**
6. **Claude는 한국어로 응대**

## 🔄 문서 업데이트 시점

이 스킬 문서는 다음 시점에 갱신해야 합니다:
- 새 Phase 완료 시 (06-history-decisions.md에 추가)
- DB 스키마 변경 시 (02-data-architecture.md)
- 예측 엔진 로직 변경 시 (03-prediction-engine.md)
- UI 구조 대규모 변경 시 (04-frontend-codebase.md)
- 새 운영 절차 추가 시 (05-operations-deployment.md)

업데이트 후 GitHub commit:
```bash
git add docs/skills/
git commit -m "docs: update skills for Phase XX"
git push
```

## 📞 사용자 정보

- **이름**: 준 (PM/서비스 기획)
- **사업**: 여성기업 전기 시공사 (경기 지역 주력)
- **주력 발주사**: 고양시 3개 행정구, 한전 경기 3본부, LH 경기남부, 서울교통공사
- **개발 환경**: Windows 11 + Git Bash + VS Code
- **언어**: 한국어 필수
