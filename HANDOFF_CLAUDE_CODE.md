# bid-analyzer 예측 시스템 핸드오프 문서 (Claude Code 전환용)

> **작성일**: 2026-04-16 (Phase 20) / **최종갱신**: 2026-04-17 (Phase 21)
> **Live**: https://bid-analyzer-pi.vercel.app

---

## 0. Phase 21 업데이트 (2026-04-17) — 이번 세션 완료 사항

### 핵심 성과

| 지표 | Phase 20 | **Phase 21** | 변화 |
|------|---------|-------------|------|


| 교육청 MAE | 1.070% | **0.383%** | -64% |
| LH MAE | 0.654% | **0.348%** | -47% |
| 1위 낙찰 가능 (지자체) | 3% | **25.2%** | 8.4배 |
| 1위 낙찰 가능 (한전) | 21.6% | **41.2%** | 1.9배 |

### Phase 21 DB 스키마 변경

1. **신규 테이블**
   - `amount_band_correction` — 기관유형×금액대 편향 보정
2. **신규 컬럼**
   - 없음 (기존 스키마 유지)
3. **신규 UNIQUE 제약**
   - `agency_predictor (ag, at)` UNIQUE

### Phase 21 신규/수정 DB 함수

| 함수 | 변경 | 설명 |
|------|------|------|
| `refresh_agency_predictor()` | **신규 (v4 Bayesian)** | Bayesian shrinkage k=15, 최근 2년 matched만, 극단값 ABS≤2.0 필터 |
| `refresh_amount_band_correction()` | **신규** | 금액대별 bias 자동 학습, k=30, min_correction=0.05 |
| `classify_agency_type(text)` | 신규 | JS clsAg 동일 로직 (SQL) |
| `get_floor_rate_db(at, ep, od)` | 신규 | 낙찰하한율 (JS eraFR 동일) |
| `predict_notice(notice_id)` | 신규 + band correction 통합 | 단건 공고 예측 등록 |
| `auto_predict_from_notices()` | 수정 + band correction 통합 | 자동 파이프라인 |
| `upsert_bid_record()` | 수정 | at 컬럼 버그 수정, br1 계산식 bp/xp*100 |
| `upsert_bid_notice()` | 수정 | at 컬럼 classify_agency_type 적용 |

### Phase 21 뷰 변경

- **`v_agency_direct_stats`**: 시점 가중 blend 적용 (최근 90일 n≥5이면 60% 가중)

### Phase 21 cron 작업 (총 5개)

| jobid | 이름 | 스케줄 |
|-------|------|--------|
| 1 | collect_notices_every_30min | `*/30 * * * *` |
| 2 | collect_results_daily_06kst | `0 21 * * *` |
| 3 | reset_api_counters_daily_00kst | `5 15 * * *` |
| 4 | auto-predict-every-30min | `3,33 * * * *` |
| **5** | **refresh-analysis-assets-daily** | `0 18 * * *` |

refresh-analysis-assets-daily 실행 순서:
```
refresh_agency_predictor()               -- Bayesian shrinkage
refresh_agency_environment_profile()
refresh_company_strategy_profile()
refresh_prediction_bias()
refresh_amount_band_correction()         -- 신규
refresh_win_strategy_cache()
```

### Phase 21 Edge Function 신규

- `fn-auto-predict` — auto_predict_from_notices RPC 호출
- `fn-test-prepc-api` / `fn-test-bssamt-api` — API 연산명 탐색용 (테스트 완료 후 제거 가능)

### Phase 21 예측 엔진 보정층 (현재 적용 중)

**predictV5 (클라이언트, utils.js)**:
```javascript
TYPE_OFF = {
  "지자체":   -0.15, "군시설":    0.0,
  "교육청":   -0.45,   // Phase 21 수정 (이전 -0.20)
  "한전":      0.10, "LH":       -0.10,
  "조달청":   -0.10, "수자원공사":-0.10
}
WIN_OPT_GAP = {  // Phase 17-A (1위 목표 보정)
  "지자체":    0.493, "군시설":    0.385,
  "교육청":    0.533, "한전":      0.367,
  "조달청":    0.676, "LH":        0.088,
  "수자원공사": 0.003
}
```

**predict_v6_2 (DB 함수)**:
```
predicted_adj = weighted_sum + bias_correction
final_adj (auto_predict) = predicted_adj + amount_band_correction
```

### Phase 21 보안/품질 이슈 해결 (4건)

1. anon key 하드코딩 → 환경변수화 (VITE_SUPABASE_ANON_KEY)
2. CORS `*` → `bid-analyzer-pi.vercel.app` 제한
3. RLS 정책 강화: bid_records/bid_details/bid_notices 익명 전권 제거
4. sbDeleteAll admin 전용: `records_delete_admin` policy (bsilisk777@gmail.com만)

### Phase 21 UI 개선

- 공고 탭 "예측 등록" 버튼 + 필터 (전체/target/등록됨)
- 헤더 "공고 N분 전 갱신" 배지
- 예측 탭 투찰 결정 가이드 카드 재설계
- 1위 목표 투찰금 표시 (Phase 17-A)
- 분석탭 이상 기준 완화 (95~105 → 87~110)
- XLS 업로드 공종 비율 경고

### Phase 21 API 수집 필터 변경

`api_collection_rules` 3건(electric/comm/fire):
- `exclude_keywords`: `['취소','수의계약','긴급']` → **`['취소','수의계약']`**
- "긴급" 키워드 제거로 긴급 공사도 정상 수집 (기존 3건 소급 복구)

### Phase 21 미해결 / 실측 대기 사항

**2주 후 (05-01 전후) 확인할 것**:
1. Phase 1 (시점 가중 + Bayesian shrinkage) 효과 실측 MAE
2. amount_band_correction 효과 실측
3. 자동 재계산 cron 안정성 확인

**남은 제도적 한계 (수정 불가)**:
- 군부대(UMM), 직찰, 민간 발주처 나라장터 비공개 → SUCVIEW 수동 업로드 유지
- 공고 시점 기초금액/A값 비공개 → `bdgt_amt` 사용 (근사치)
- 복수예비가 15개 값 → SUCVIEW 수동 업로드만 가능

**Priority (다음 세션)**:
- Phase 1/2 실측 후 Phase 3 결정 (predict_v6_3 필요 여부)
- 지자체 under_300M (n=264) 세분화 추가 검토

### Phase 21 Git 커밋 요약

```
c645dff  feat: XLS 업로드 시 공종 비율 경고
ab591e4  fix(matching): pn_no prefix fallback 매칭
5653a96  feat: 공고 탭 데이터 부족 안내 강화
878cb38  feat: 나라장터 공고 탭 예측 등록 버튼
7f68232  refactor(UX): 투찰 결정 가이드 재설계
537fd82  feat(Phase17-A): 1위 목표 투찰금
3ef83b0  fix(analysis): 이상 기준 완화 (87~110)
012c042  fix(predict): 교육청 TYPE_OFF -0.45
07da502  fix(chat): Korean-only responses
e8feede  security: anon key 환경변수화
```

---

## 1. 프로젝트 개요

한국 공공조달 입찰(전기/통신/소방 공사)의 사정률 예측 및 최적 투찰 전략 시스템.
나라장터(g2b.go.kr) 낙찰 데이터를 분석하여 복수예비가격 기반 사정률을 예측하고 투찰금액을 추천한다.

### 핵심 도메인 개념
- **복수예비가격**: 발주처가 기초금액 ±2~3%에서 15개 예비가격 생성 → 참여업체가 2개씩 선택 → 다빈도 4개 산술평균 = 예정가격
- **사정률**: (예정가격/기초금액 - 1) × 100. 시스템이 예측하는 핵심 값
- **투찰금액**: 기초금액 × (1 + 사정률/100) × 낙찰하한율/100
- **A값 공식**: A값 있을 때 = (기초-A값) × (1+사정률/100) × 하한율/100 + A값
- **이론 노이즈 바닥**: 4-of-15 추첨의 구조적 랜덤성 → 중앙값 0.642% 예측 한계

### 스택
- **Frontend**: React/Vite (App.jsx 단일 파일 코어 + WinStrategyDashboard.jsx)
- **Backend**: Supabase PostgreSQL (project_id: `sadunejfkstxbxogzutl`)
- **Deployment**: Vercel (auto-deploy from GitHub)
- **Repo**: github.com/Joeyjun77/bid-analyzer
- **Local**: C:\Users\home\bid-analyzer (Windows 11)

---

## 2. DB 테이블 구조 (핵심 테이블만)

### 2.1 bid_records (53,423건) — 학습 데이터
과거 낙찰 이력. 나라장터 낙찰정보에서 파싱.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| dedup_key | text UNIQUE | MD5(pn+ag+od+ba) — upsert 키 |
| pn, pn_no | text | 공고명, 공고번호 |
| ag, at | text | 발주기관, 기관유형 (조달청/지자체/교육청/한전/LH/군시설/수자원공사) |
| ep, ba, av | numeric | 추정가격, 기초금액, A값 |
| xp | numeric | 예정가격 |
| bp | numeric | 1순위 투찰금액 |
| br0 | numeric | 1순위 사정률 (예정가격 대비) |
| co, co_no | text | 1순위 업체명, 사업자번호 |
| pc | int | 참여업체수 |
| od | date | 개찰일 |
| era | text | "new"/"old" (낙찰하한율 개정 전후) |
| fr | numeric | 적용 낙찰하한율 |
| canonical_ag | text | 정규화된 발주사명 |

### 2.2 bid_predictions (1,259건) — 예측 결과
| 컬럼 | 타입 | 설명 |
|---|---|---|
| dedup_key | text UNIQUE | "pred\|"+pn_no+"\|"+od |
| pred_adj_rate | numeric | v5 예측 사정률 |
| opt_adj | numeric | v6.2 최적 추천 사정률 |
| opt_bid | numeric | 추천 투찰금액 (A값 공식 정확 적용) |
| pred_floor_rate | numeric | 적용 낙찰하한율 |
| match_status | text | "pending"/"matched" |
| actual_adj_rate | numeric | 실제 사정률 (매칭 후) |
| canonical_ag | text | 자동 정규화 (트리거) |

### 2.3 bid_notices (341건) — 나라장터 공고
나라장터 API로 수집된 입찰 공고. 자동 예측 파이프라인의 입구.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| bid_ntce_no | text | 입찰공고번호 |
| dedup_key | text UNIQUE | ntce_no+ord+clsfc+rbid |
| pn, ag | text | 공고명, 발주기관 |
| ep, ba, av | numeric | 추정가격, 기초금액, A값 |
| od | timestamptz | 개찰일시 |
| status | text | open/closed |
| is_target | boolean | 수집 규칙 매칭 여부 |
| raw_json | jsonb | 원본 API 응답 |

### 2.4 bid_details (600건) — SUCVIEW 복수예가 상세
| 컬럼 | 타입 | 설명 |
|---|---|---|
| pn_no | text UNIQUE | 공고번호 |
| pre_rates | jsonb | 15개 복수예비가격 사정률 배열 |
| adj_rate | numeric | 실제 사정률 |
| participant_count | int | 참여업체수 |

### 2.5 Phase 19-A 프로파일 테이블
- **company_strategy_profile** (3,629개): 업체 전략 6유형 (precise/aggressive/conservative/neutral/diverse/random)
- **agency_environment_profile** (210개): 발주사 환경 + Top5 단골 + 진입난이도

### 2.6 Phase 17 검증
- **phase17_validation** (19건): A등급 6건 판정완료(83.3% 통과), B등급 13건 추적중

### 2.7 Phase 20 프론트엔드
- **win_strategy_cache**: 정적 캐시 테이블 (LATERAL view의 PostgREST 충돌 방지)

---

## 3. 핵심 함수 (Supabase PostgreSQL)

### 3.1 predict_v6_2(p_pred_id INT) — 메인 예측 엔진
5계층 가중평균으로 사정률 예측. **MAE 0.49% (이론 한계 0.51% 근접)**

가중치 계산:
1. **직접 매칭** (동일 발주사 동일 금액대): w=0.40 (n≥5)
2. **유사 케이스** (동일 발주사 유사 금액대): w=0.25 (n≥3)
3. **주력업체** (해당 발주사 단골 업체): w=0.15
4. **발주사 학습** (agency_predictor 오프셋): w=0.10
5. **발주유형 기본** (at 전체 평균): w=0.10

+ predictor_bias_correction 테이블 보정 적용

### 3.2 win_score_v2(p_pred_id INT) — Win-Optimizer
6요소 점수 (0~100) → A/B/C/D 등급 분류

| 요소 | 만점 | 측정 대상 |
|---|---|---|
| s_volatility | 25 | 발주사 사정률 표준편차 (낮을수록 ↑) |
| s_data_qty | 20 | 학습 데이터 건수 |
| s_predictor | 15 | 예측 모델 MAE |
| s_amount | 10 | 기초금액 적정 범위 (3~30억 최적) |
| s_competition_real | 20 | 발주사 분산도 (낮을수록 단골점유 ↑) |
| s_competitor_signal | 10 | 경쟁 3사 최근 낙찰수 |

등급: A_high(≥75) / B_med(≥60) / C_low(≥45) / D_skip(<45)

### 3.3 refresh_win_strategy_cache() — 캐시 갱신
win_score_v2를 모든 pending 건에 실행하고 결과를 win_strategy_cache 테이블에 저장.
프론트엔드는 이 테이블만 조회 (LATERAL view 성능 문제 회피).

### 3.4 auto_predict_from_notices() — 자동 예측 파이프라인
bid_notices(나라장터 공고) → bid_predictions 자동 생성.

---

## 4. 나라장터 API 연동 (이미 구축됨)

### 4.1 API 키
| 이름 | 서비스 | 용도 |
|---|---|---|
| prod_bid_public | 입찰공고정보서비스 | 공고 수집 |
| prod_scsbid_info | 낙찰정보서비스 | 낙찰 결과 수집 |

키는 Supabase Vault에 암호화 저장. `get_api_key()` 함수로 조회.

### 4.2 수집 규칙 (api_collection_rules)
| 규칙 | 공종 | 추정가격 범위 | 제외 키워드 |
|---|---|---|---|
| electric_target | 전기공사 | 8천만~50억 | 취소, 수의계약, 긴급 |
| comm_target | 통신공사/정보통신 | 8천만~50억 | 취소, 수의계약, 긴급 |
| fire_target | 소방시설공사/소방 | 8천만~50억 | 취소, 수의계약, 긴급 |

### 4.3 Edge Functions (Supabase)
- `upsert_bid_notice(p jsonb)`: 나라장터 JSON → bid_notices upsert
- `upsert_bid_record(p jsonb)`: 낙찰결과 JSON → bid_records upsert
- `auto_predict_from_notices()`: 공고 → 자동 예측

### 4.4 나라장터 OpenAPI 엔드포인트
- 입찰공고: `http://apis.data.go.kr/1230000/BidPublicInfoService04/`
- 낙찰결과: `http://apis.data.go.kr/1230000/ScsbidInfoService/`

---

## 5. 낙찰하한율 규칙 (2026 개정 반영)

| 기관 | 시행일 | 3억 미만 | 3억~10억 | 10억~50억 | 50억+ |
|---|---|---|---|---|---|
| 조달청 | 2026-01-30 | 89.745% | 88.745% | 88.745% | 87.495% |
| 지자체 | 2025-07-01 | 89.745% | 89.745% | 88.745% | 87.495% |
| 교육청 | 2025-07-01 | 89.745% | 89.745% | 88.745% | 87.495% |
| 한전 | 2026-01-30 | 89.745% | 89.745% | 88.745% | 87.495% |
| 군시설 | 2026-01-19 | 89.745% | 88.745% | 88.745% | 87.495% |

**여성기업 가산**: 경영상태 10% 가산 → 낙찰하한율 -0.25%p (사용자 선택)

---

## 6. 투찰금액 산출 공식

```
A값 없을 때:
  투찰금액 = CEIL(기초금액 × (1 + 사정률/100) × 낙찰하한율/100)

A값 있을 때:
  투찰금액 = CEIL((기초금액 - A값) × (1 + 사정률/100) × 낙찰하한율/100 + A값)

소수점 이하 절상 (LH만 천원 이하 절상)
```

---

## 7. 프론트엔드 구조

```
src/
├── App.jsx (1,834줄)              — UI 메인 (대시보드/분석/예측/작전/AI상담 5탭)
├── WinStrategyDashboard.jsx (319줄) — Phase 20 작전 대시보드
└── lib/
    ├── constants.js (9줄)          — SB_URL, SB_KEY, hdrs, C(색상), PAGE
    ├── utils.js (~400줄)           — 파싱, predictV5, calcBidAmount, RATE_TABLE
    └── supabase.js (~110줄)        — sbFetchAll, sbUpsert, sbSavePredictions
```

### 핵심 JS 함수
- `calcBidAmount(ba, av, adj, fr)`: 투찰금액 계산 (A값 공식 포함)
- `predictV5(...)`: 프론트엔드 예측 (DB함수 predict_v6_2와 별도)
- `RATE_TABLE`: 기관×금액대별 낙찰하한율 (2026 개정 반영)

---

## 8. 현재 성능 지표

### 예측 정확도 (2025년+ 558건)
| 발주유형 | n | MAE | ±0.5% 적중률 |
|---|---|---|---|
| 한전 | 64 | 0.434 | 62.5% |
| 군시설 | 100 | 0.473 | 59.0% |
| 교육청 | 56 | 0.499 | 60.7% |
| 지자체 | 319 | 0.600 | 47.3% |

### Phase 17 실측 검증
- A등급 6건: 83.3% 밴드 통과 (5/6)
- B등급 13건: 추적 중

---

## 9. 검증된 결론 (변경 금지 사항)

1. **v6.2 단독이 최적**: 단골 평균 가중평균은 MAE 악화 (514건 백테스트)
2. **낙찰하한율 89.745%는 정확**: 2025-07 / 2026-01 개정 후 신기준
3. **이론 노이즈 바닥**: 4-of-15 추첨 → 0.642% 중앙값, 추가 개선 한계
4. **A값 공식 필수**: A값 있는 건은 반드시 분리 계산 (2026-04-16 12건 수정 완료)

---

## 10. 배포 워크플로우

```bash
# 1. 로컬 수정
cd C:\Users\home\bid-analyzer
# 파일 수정...

# 2. 빌드 확인
npx vite build

# 3. 커밋 & 푸시
git add -A
git commit -m "설명"
git pull --rebase
git push

# Vercel 자동 배포 (1~2분)
```

---

## 11. Supabase REST API 패턴

```javascript
// 기본 조회
const url = `${SB_URL}/rest/v1/테이블명?select=*&order=컬럼.asc`;
const res = await fetch(url, { headers: hdrs });

// Upsert (on_conflict 필수)
await fetch(`${SB_URL}/rest/v1/테이블명?on_conflict=dedup_key`, {
  method: 'POST',
  headers: { ...hdrs, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify(rows)
});

// RPC 호출
await fetch(`${SB_URL}/rest/v1/rpc/함수명`, {
  method: 'POST',
  headers: { ...hdrs, 'Content-Type': 'application/json' },
  body: JSON.stringify({ param1: value1 })
});
```

**주의**: 응답 최대 1,000건 → offset 페이지네이션 필수. `sanitizeJson()`으로 \u0000 제거 필수.

---

## 12. 다음 단계 (Claude Code에서 진행)

### Priority 1
- 4/16 낙찰 결과 업로드 → B등급 매칭 → Phase 17 2차 판정
- 사정률 표기 100% 기준 병행 표시 (fmtAdj 함수 반영 확인)

### Priority 2
- Phase 4-B: Auth 구현 (RBAC + Supabase Auth)
- 나라장터 API 자동 수집 스케줄링 (Edge Function + cron)

### Priority 3
- 분산투찰 밴드 폭 최적화
- 교육청 예측 악화 원인 분석
- 사업자번호 기반 다법인 클러스터링
