# V2 작업 핸드오프 — 다음 세션 (2026-05-20 종료 시점)

> 작업 중단: 2026-05-20
> 다음 재개: 2026-05-21~
> 마지막 commit: `3bd365f` (main)
> 단일 진실: `docs/v2/HANDOFF_V2_MASTER_PLAN.md` + `docs/v2/V2_DOMAIN_RULES_CHECK.md`

---

## 0. 현 상태 한 줄

V2 Mode B 본격 도입 + Mode A 군시설 엔진(보류) + 도메인 규칙 정정 Phase 1 완료. 코덱스 마지막 평가 8.6/10(라운드 5) / 8.9/10(라운드 6) / 도메인 심각도 8.5/10 → Phase 1 후 잠정 5/10.

---

## 1. V2 트랙별 완료도

### B 트랙 (백엔드)
- ✅ B0a/B0b: 검증 인프라 4개 테이블 + 1개 RPC
- ✅ B1: agency_mode_lookup 41 row 적재 + lookup_agency_mode RPC
- ✅ B2: Mode B 엔진 (recommendModeB·recommendV2·m7·자동 적재 useEffect)
- ✅ B2.5: UI wire-up (ModeBadge·effMode·메인 메트릭·안내문)
- ✅ B2.6: calibration (m10·m11 window 분리)
- ✅ B5: pg_cron 자동화 (m12 일간/주간)
- 🚨 **B3 보류** (군시설 시대 혼입 표본 — current n=31뿐)
  - m13~m16 적재됨, 그러나 v2_modeA_real 데이터는 mixed/legacy
  - cron 2개(v2_modeA_daily_winzone, v2_modeA_weekly_gate) active 상태 그대로
  - recommendV2 Mode A 분기는 현재 종형 fallback 동작 (gap n<5)

### U 트랙 (UI)
- ✅ U0 Phase 1·2: V2 미리보기 탭 + mock 컴포넌트 + App.jsx import
- ✅ U1: ModeBadge wire-up (B2.5a)
- ✅ U2: 메인 메트릭 + 안내문 + effMode (B2.5b/c)
- 🟡 U3 보류: 군시설 공략 모드 prop (B3 후행)

### D 트랙 (재설계)
- ✅ D1~D4 문서 4건 (docs/v2/)

### Phase 1 (도메인 규칙 정정 — V2_DOMAIN_RULES_CHECK 7건)
- ✅ #0 era_v2 컬럼 (m17, bid_records legacy 50,632 / current 13,045, bid_details legacy 209 / current 671)
- ✅ #4 B3 보류 + agency_gap_distribution 'mixed' 마킹 + current 재적재 (m18)
- ✅ #7 refresh 함수들 공동도급 제외 (m20)
- ✅ G-도메인 게이트 신설 (.claude/commands/evaluate.md §10, 5번째 게이트)

### 잔여 정정 (Phase 2·3)
- ⚠ #1 적격심사 ≠ 1.0 — 자사 유효 낙찰하한율 모듈
- ⚠ #2 ba_seg = ep — 추정가격 기반 전환
- ⚠ #3 LH 천원 절상 — recommendModeB LH 분기
- ⚠ #5 투찰금액 절상 — fmtAdj/utils.js 공통 함수
- ⚠ #6 발주처별 사정범위 — agency_mode_lookup 메타 컬럼

---

## 2. DB 마이그레이션 누적 (m1~m20)

```
m1~m4   B0a 측정 코어 + 결함 보정 (UNIQUE NULLS NOT DISTINCT, INSERT 정책)
m5~m6   B0b 운영 테이블 (win_zone_daily, mode_gate_report)
m7      bid_predictions에 b_pred_* 6컬럼
m8      phase17_validation passed_floor_bid_rate
m9      lookup_agency_mode RPC
m10·m11 refresh_floor_pass_daily + window 분리
m12     Mode B pg_cron (일간·주간)
m13~m16 B3 인프라 (현재 보류)
m17     era_v2 컬럼 (V2_DOMAIN_RULES_CHECK #0)
m18     agency_gap_distribution era_v2 (B3 보류 선언)
m19     lookup_gap_distribution RPC era_v2='current' 필터
m20     refresh 함수 공동도급 제외 (#7)
```

`docs/v2/migrations/` 폴더에 모든 SQL + README 저장됨.

---

## 3. 핵심 측정값 (재개 시 비교용)

### Mode B (안착)
- 전체 calibration_gap: 1.02%p (model_version='v2_modeB_real')
- 통과율: 96.00% (n=300, current+legacy 혼입 — m20 적용 후 재측정 필요)
- 영역별 PASS: 한전 98.21% / 지자체 94.74% / 교육청·조달청·LH 100%

### Mode A (보류)
- 군시설 WIN-zone: 12.42% (n=153, mixed 데이터 — m20 적용 후 current-only 재측정 필요)
- 목표 15%까지 -2.58%p

### 자동 cron 4개 (모두 active)
- `v2_modeB_daily_calibration` (매일 00:00 UTC)
- `v2_modeB_weekly_gate` (매주 월 01:00 UTC)
- `v2_modeA_daily_winzone` (매일 00:15 UTC)
- `v2_modeA_weekly_gate` (매주 월 01:15 UTC)

→ 내일 09:00 KST 이후 새 측정값 누적되어 있음.

---

## 4. 다음 세션 즉시 실행 가능 작업

### 우선순위 A (가장 안전)
1. **m20 효과 재측정** — refresh_floor_pass_daily 재실행 후 공동도급 제외 전후 비교
   ```sql
   SELECT refresh_floor_pass_daily(
     (CURRENT_DATE - INTERVAL '30 days')::date,
     CURRENT_DATE,
     'v2_modeB_post_m20',
     24
   );
   SELECT * FROM floor_pass_daily WHERE model_version='v2_modeB_post_m20';
   ```
2. **라운드 8 코덱스 재검증** — Phase 1 5단계 효과 정량 평가
3. **B3 보류 검증** — recommendV2가 종형 fallback 잘 동작하는지 확인

### 우선순위 B (Phase 2 — 자사 유효 낙찰하한율 + LH 천원 절상)
4. **자사 유효 낙찰하한율 모듈** — utils.js에 calcEffectiveFloorRate(at, baseFloorRate, ownScore)
5. **LH 천원 절상 함수** — recommendV2 LH 분기에 `Math.ceil(price / 1000) * 1000`
6. **공동 절상 함수** — `src/lib/fmtAdj.js`에 ceilToWon(amount)

### 우선순위 C (Phase 3 — ba → ep 기반 전환)
7. **agency_mode_lookup·agency_gap_distribution 재적재** (ba_seg를 ep 기반으로)
8. **baSegOf 함수 deprecate** + baSegOfEp 신설
9. **floor_rate_history 테이블** (m21+) — 시대×금액구간 하한율 캐시

### 우선순위 D (시간 누적)
- B5 cron이 자동으로 매일/매주 측정 누적
- §9 종료 조건 "4주 연속 pass + n≥500" 자연 진행 (~6주 후 V6 retire 후보)

---

## 5. 재개 명령 추천 시퀀스

```
1. cd C:\Users\home\bid-analyzer
2. git pull
3. /context-restore (이전 세션 컨텍스트 복원)
4. /accuracy (현 시점 진단 — Phase 1 효과 + cron 자동 적재 결과)
5. (선택) /evaluate (G-도메인 게이트 포함 5대 게이트로 변경됐는지 확인)
```

또는 직접 진행:
```
1. m20 효과 재측정 SQL 실행
2. 코덱스 라운드 8 검증 의뢰
3. 사용자가 결정 후 Phase 2 진입
```

---

## 6. 컨텍스트 핵심 발견 (다음 세션 즉시 인지 필요)

### 라운드 5에서 사용자가 발견한 결함 (가장 중요)
1,754건 b_pred_* 적재가 모두 동일 1.0560 — **win1stDistMap 가드 누락**으로 노이즈 플로어 fallback 일률값. commit `95288c8`에서 가드 추가 + SQL 일괄 재계산 + 1.0560 → 발주사별 다른 값 검증 완료.

### V2_DOMAIN_RULES_CHECK가 폭로한 결함 (이번 세션)
- 라운드 6 검증 8.9점 → 도메인 게이트 누락 8.5점 결함 명시
- 핵심: 낙찰하한율 두 차례 개정 (2025-07-01 + 2026-01-30) — 발주유형별 이중 경계
- B3 시대 혼입 표본: n=186 = legacy 155 + current 31 (median_gap 260배 차이)
- agency_gap_distribution 'mixed' 마킹 후 current 재적재 → current AG grain 0건 (n<5)
- B3 사실상 보류, 종형 fallback 동작

### Mode B 안전성 (잠정)
- calibration 96.00% 측정값이 mixed/legacy 혼입 가능 — m20 공동도급 제외 후 재측정 필요
- 자사 유효 낙찰하한율 미반영 → Phase 2 필요

---

## 7. 절대 금지 (재개 시에도 유지)

- `bid_records`/`bid_details` DELETE 금지
- `bid_predictions.opt_adj` 매칭 row UPDATE 금지 (A안)
- `predictions_v2` UPDATE 금지
- adj_rate 공간 WIN-zone 신규 KPI 추가 금지 (G-단위 게이트)
- Mode B 분기에 "낙찰 확률" 문구 금지 (G-모드표시 게이트)
- bias 레이어 중복 적용 금지 (G-bias)
- era_v2 미사용 신규 SQL 금지 (G-도메인 게이트 신설)
- 공동도급 필터 없는 학습·예측 SQL 금지 (G-도메인 #7)

---

## 8. 미해결 의문 (다음 세션 검토)

1. **자사 유효 낙찰하한율 입력 UI** — 자사 시공경험·경영상태 점수를 어디서 입력받을지 (Phase 2)
2. **floor_rate_history 테이블 적재 원천** — 공고문 실측 vs bid_records.fr 평균 추정
3. **m20 효과 측정** — refresh_floor_pass_daily 재실행 후 calibration 변화 폭
4. **mode_gate_report Mode A WARN 처리** — 12.42% (mixed 데이터) → current-only 측정 시 어떻게 변하나
5. **라운드 8 점수** — Phase 1 효과로 도메인 8.5/10 → 5/10 추정. 실제 평가는 별도

---

_본 문서는 V2 작업 중단 시점의 영구 기록. 다음 세션이 자족 가능하도록 작성됨._
_단일 진실: `HANDOFF_V2_MASTER_PLAN.md` + `V2_DOMAIN_RULES_CHECK.md`._
