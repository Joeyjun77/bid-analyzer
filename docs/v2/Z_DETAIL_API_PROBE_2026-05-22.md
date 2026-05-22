# Z-DETAIL 종결 — 인포21c API 사정률 자동 수집 불가 확인 (2026-05-22)

## 1. 배경
A 트랙(매칭 자동화) 작업 중 발견: matched + actual NULL 306건은 **bid_records.ar1이 NULL**이라서 백필 불가. 진짜 fix는 ar1 도착 자체를 자동화하는 것 (Z-DETAIL).

가설:
- A. 인포21c PASS A list 응답에 사정률이 포함되어 있는데 `upsert_bid_record`가 매핑 누락
- B. list 응답에는 없고 별도 detail API가 있음
- C. 자동 수집 자체가 불가능

## 2. 진단 (`fn-test-prepc-api`)

### 2.1 PASS A (`getOpengResultListInfoCnstwk`) 전체 응답 필드 (16개)

| 필드 | 의미 |
|---|---|
| bidNtceNo, bidNtceOrd, bidClsfcNo, rbidNo | 공고 키 |
| bidNtceNm | 공고명 |
| opengDt | 개찰일 |
| prtcptCnum | 참여자수 |
| opengCorpInfo | 낙찰자 정보 (`회사^사업자^대표^낙찰가^낙찰가율`) |
| progrsDivCdNm | 진행상태 |
| inptDt | 입력일 |
| **rsrvtnPrceFileExistnceYn** | 예비가 파일 존재 여부 (`"Y"` — 별도 파일 신호) |
| ntceInsttCd/Nm, dminsttCd/Nm | 발주기관 |
| opengRsltNtcCntnts | 공고내용 (빈 문자열) |

→ **사정률(ar1) 필드 0개**. `opengCorpInfo`의 5번째 ^ 토큰(낙찰가율)은 br1로 매핑 중. 사정률은 별도 파일(`rsrvtnPrceFileExistnceYn=Y`)에 존재한다는 신호만.

### 2.2 16개 후보 API 호출 결과 (mode=test)

| 후보 API | 결과 |
|---|---|
| getOpengResultListInfoCnstwk | ✓ 작동 (사정률 필드 0개) |
| getOpengResultListInfoCnstwkPPSSrch | ✓ 작동 (동일 16필드, 사정률 0개) |
| getPrearngPrceInfo, getPrearngPrceInfoCnstwk | 404 |
| getOpengPrearngPrceInfoCnstwk | 404 |
| getOpengPrepceInfoCnstwk, getPrepceDetailInfoCnstwk | 404 |
| getPrepcListInfoCnstwk | 404 |
| getMultiPrePcsListCnstwk, getMultiplePrearngPriceInfoCnstwk | 404 |
| getBidPrtcptRankListInfoCnstwk, getBidRankListInfoCnstwk | 404 |
| getOpengResultRankListInfoCnstwk | 404 |
| getBidDetailInfoCnstwk, getOpengResultDetailInfoCnstwk | 404 |
| getScsbidListInfoCnstwkPPSSrch | 404 |

→ 사정률·복수예비가·세부정보 관련 14개 후보 모두 **존재하지 않음**.

## 3. 결론 — **자동 수집 경로 부재**

### 3.1 가설 판정
| 가설 | 결과 |
|---|---|
| A. list 응답 사정률 + 매핑 누락 | **반증** (응답에 사정률 0건) |
| B. 별도 detail API | **반증** (14개 후보 모두 404) |
| **C. 자동 수집 불가** | **확인** |

### 3.2 사정률 출처
- `rsrvtnPrceFileExistnceYn:"Y"` — 사정률은 인포21c **사이트에서 별도 파일 다운로드** 필요
- 사용자가 직접 인포21c 화면에서 사정률 포함 파일을 받아 시스템에 업로드하는 워크플로우만 가능

## 4. 안전망 — 이번 세션에 이미 완비

| 컴포넌트 | 역할 | commit |
|---|---|---|
| `src/lib/utils.js` `_normRate` | toRecord에서 ar1/ar0/br1/br0 단위 자동 감지 (`|v|<50`→ +100) | d724019 |
| `src/lib/supabase.js` line 75 | sbMatchPredictions ar1 단위 자동 감지 | b47e226 |
| `match_pending_predictions()` SQL | 동일 단위 자동 감지 로직 + 멱등 매칭 | b47e226 |
| `cron jobid 14` (매시간 15분) | 사용자가 사정률 파일 업로드 → 다음 시간 자동 매칭 회복 | b47e226 |

## 5. 사용자 워크플로우 (사정률 회복)

1. 인포21c 사이트에서 사정률 포함 파일 다운로드 (예: 개찰결과 상세, SUCVIEW 등)
2. bid-analyzer 데이터탭에 파일 업로드 → `toRecord` → `_normRate` 자동 단위 보정 → `bid_records.ar1` 채움
3. 다음 cron jobid 14 실행 시 (매시간 15분) 자동 재매칭 → `bid_predictions.actual_adj_rate` 백필
4. `/accuracy` 또는 V8 화면에서 정정된 매칭 확인

## 6. 가능한 후속 작업 (낮은 우선순위, 별도 commit)

### 6.1 사용자 안내 메시지 추가 (선택)
- App.jsx 어딘가에 "사정률 파일 미업로드 시 매칭 지연" 안내 추가 가능
- 우선순위 낮음 (현재 UX 큰 결함 아님)

### 6.2 인포21c API 사정률 endpoint 재탐색 (정기)
- 정부 데이터포털(data.go.kr)이 새 endpoint 추가할 가능성 → 분기마다 1회 fn-test-prepc-api 실행 검토

### 6.3 m30 113건 dedup_key 우회 패턴 분석 (M32 §5.1 후속)
- 우선순위 낮음

## 7. Phase 23-3 게이트
| 게이트 | 결과 |
|---|---|
| Generator 분류? | **No** (작업 자체 없음, 진단만) |
| Evaluator 분류 | N/A |
| 적용 마이그레이션 | 0건 |
| deploy-gate | 면제 |

---
_처리자: Claude Opus 4.7 / 처리 일자: 2026-05-22 / 종결: 자동 수집 불가 확인, 안전망 완비_
