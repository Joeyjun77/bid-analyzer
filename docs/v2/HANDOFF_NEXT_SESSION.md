# V2 작업 핸드오프 — 다음 세션 (2026-05-20 종료 시점)

> 작업 중단: 2026-05-20 (1차) / 라운드 9~13 후속: 2026-05-21
> 다음 재개: 라운드 14 BRIEF 작성 또는 4주 PASS 누적 대기 (~2주)
> 마지막 commit: `8793b4e` (main, 라운드 13 major 2건 + BRIEF minor 1건 fix)
> 단일 진실: `docs/v2/HANDOFF_V2_MASTER_PLAN.md` + `docs/v2/V2_DOMAIN_RULES_CHECK.md`
> 후속 § 9 참조 (라운드 9~13 진행 + DB 실측 수치, 2026-05-21 추가)

---

## 0. 현 상태 한 줄

V2 Mode B 본격 도입 + Mode A 군시설 엔진(AT grain n=31 컨볼루션 가동, KPI WARN) + 도메인 규칙 정정 Phase 1 완료. 코덱스 라운드 5 8.6/10 → 라운드 6 8.9/10 → 라운드 8 8.1/10 (코드-문서 정합성 6.5 + KPI 신뢰도 6.8 감점). 도메인 정확성은 8.5 → 8.8 상승. B3 정책-실태 불일치는 라운드 8 권고 옵션 A(현 동작 유지 + 문서 정정)로 해소.

---

## 1. V2 트랙별 완료도

### B 트랙 (백엔드)
- ✅ B0a/B0b: 검증 인프라 4개 테이블 + 1개 RPC
- ✅ B1: agency_mode_lookup 41 row 적재 + lookup_agency_mode RPC
- ✅ B2: Mode B 엔진 (recommendModeB·recommendV2·m7·자동 적재 useEffect)
- ✅ B2.5: UI wire-up (ModeBadge·effMode·메인 메트릭·안내문)
- ✅ B2.6: calibration (m10·m11 window 분리)
- ✅ B5: pg_cron 자동화 (m12 일간/주간)
- 🟡 **B3 운영 중 (KPI 신뢰도 낮음/WARN)** — 코덱스 라운드 8 (2026-05-21) 권고 옵션 A 채택
  - AG/AG_BA grain 0건, AT grain n=31 current 실측으로 Mode A gap 추천 가동
  - m13~m16 적재됨, v2_modeA_weekly_gate KPI는 12.42% (목표 15%) WARN 유지
  - cron 2개(v2_modeA_daily_winzone, v2_modeA_weekly_gate) active 상태 그대로
  - recommendV2 Mode A 분기는 AT grain n=31로 `recommendModeA` 컨볼루션 정상 가동 (gap_p25=0.0013, gap_p50=0.3903)

### U 트랙 (UI)
- ✅ U0 Phase 1·2: V2 미리보기 탭 + mock 컴포넌트 + App.jsx import
- ✅ U1: ModeBadge wire-up (B2.5a)
- ✅ U2: 메인 메트릭 + 안내문 + effMode (B2.5b/c)
- 🟡 U3 보류: 군시설 공략 모드 prop (B3 후행)

### D 트랙 (재설계)
- ✅ D1~D4 문서 4건 (docs/v2/)

### Phase 1 (도메인 규칙 정정 — V2_DOMAIN_RULES_CHECK 7건)
- ✅ #0 era_v2 컬럼 (m17, bid_records legacy 50,632 / current 13,045, bid_details legacy 209 / current 671)
- ✅ #4 agency_gap_distribution 'mixed' 마킹 + current 재적재 (m18) — current AT n=31로 Mode A 가동
- ✅ #7 refresh 함수들 공동도급 제외 (m20)
- ✅ G-도메인 게이트 신설 (.claude/commands/evaluate.md §10, 5번째 게이트)

### 잔여 정정 (Phase 2·3)
- ✅ #1-a 자사 유효 낙찰하한율 모듈 (commit `466a308`, 2026-05-21) — recommendV2 한정, score=20 디폴트=비트 동등
- ✅ #1-b legacy 통합 (commit `1cc32e3`, 2026-05-21) — predictV5/recommendAssumedAdj/recommendBid1st/recommendV2 Mode A fallback 모두 calcEffectiveFloorRate 적용. App.jsx 9 호출처 ownScore 전달. 라운드 9 권고 #1 수용
- ⚠ #2 ba_seg = ep — 추정가격 기반 전환
- ✅ #3 LH 천원 절상 (commit `b4e9470`, 2026-05-21) — ceilToThousand 공통 함수 추출
- ✅ #5 투찰금액 절상 (commit `58e95fd`, 2026-05-21) — ceilToWon 공통 함수 추출
- ✅ #6 발주처별 사정범위 (m21, commit `7009018`, 2026-05-21) — agency_mode_lookup adj_range_min/max 41 row 일률 ±3% 적재

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
m18     agency_gap_distribution era_v2 ('mixed' 마킹 + current 재적재)
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
3. ✅ **B3 컨볼루션 가동 검증 완료 (2026-05-21)** — AT grain n=31로 `recommendModeA` 정상 실행 확인. 코덱스 라운드 8 (composite 8.1/10) 권고 옵션 A 채택.

### 우선순위 B (Phase 2 — 완료)
- ✅ 자사 유효 낙찰하한율 모듈 — Plan #1-a 완료 (commit `466a308`)
- ✅ 자사 유효 낙찰하한율 legacy 통합 — Plan #1-b 완료 (commit `1cc32e3`) — 4 함수 모두 일관 적용
- ✅ UI 듀얼 표기 — 라운드 9 권고 #2 (commit `edc4d9d`) — V2 보조 표시 영역 자사 하한 표기
- ✅ LH 천원 절상 함수 — ceilToThousand 적용 (commit `58e95fd`)
- ✅ 공동 절상 함수 — `src/lib/fmtAdj.js`에 ceilToWon (commit `58e95fd`)
- ✅ 사정범위 메타 컬럼 — m21 (commit `7009018`)

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
- agency_gap_distribution 'mixed' 마킹 후 current 재적재 → current AG/AG_BA grain 0건, current AT grain n=31만 생존
- **recommendV2 Mode A는 AT grain n=31로 `recommendModeA` 컨볼루션 정상 가동** (gap_p25=0.0013, gap_p50=0.3903 사용). KPI 신뢰도 낮음/WARN 상태. 코덱스 라운드 8 (2026-05-21, composite 8.1/10) 권고 옵션 A 채택

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

---

## 9. 라운드 9~13 후속 진행 (2026-05-21 추가)

§1~§8은 2026-05-20 종료 시점 스냅샷. 본 절은 라운드 9~13 추가 진행분 + DB 실측 수치를 기록한다.

### 9.1 코덱스 라운드 9~13 점수 추이

| 라운드 | composite | 핵심 사건 |
|---|---|---|
| 8 | 8.1/10 | 코드-문서 정합성 6.5 + KPI 신뢰도 6.8 감점 (BRIEF: `CODEX_ROUND_8_BRIEF.md`) |
| 9 | (평가 미공개) | #1-a UI 듀얼 표기 (`edc4d9d`) |
| 10 | 8.5/10 | #1-b legacy 4함수 calcEffectiveFloorRate 통합 (`1cc32e3`) + ownScore React deps 수정 (`fe1ee1a`) |
| 11 | 8.6/10 | own_score 컬럼 + invalidation (`a8e18fe`) + m21 operational (`4744b93`) |
| 12 | **8.0/10** (-0.6 회귀) | critical 3건 fix (`a12000e`) — own_score 실제저장 + m25 era_v2 + m24 DROP |
| 13 | **8.5/10** (+0.5 회복) | major 2건 + BRIEF minor 1건 fix (`8793b4e`) — m25 적용문 + 주석 정정 + V6 retire ETA 통일 |

라운드 13 항목별: 도메인 8.6 / 안전성 8.7 / 측정 일관성 8.6 / 코드-문서 8.2 / KPI 신뢰도 8.3 (composite 8.5/10).

### 9.2 DB 실측 수치 (2026-05-21 조회)

**bid_predictions 누적**:
- matched_total: **1,660건**
- matched (source=file_upload): 1,394건
- matched + actual_adj_rate IS NOT NULL: 1,360건
- **own_score IS NOT NULL: 532건** (라운드 12 fix 후 정상 적재 검증 — NULL만 적재 critical 해소)
- total predictions: 2,252건

**Mode B Weekly Gate (`mode_gate_report`)**:
- 2026-05-19 주: _overall_ pass (n=300, rate=0.9600, gap=0.0102) — 모든 영역 pass
- 2026-05-18 주: _overall_ pass (n=307, rate=0.9511, gap=0.0011) — 모든 영역 pass
- **연속 PASS 2주 누적** (4주 연속 PASS까지 ~2주 더)
- 다음 주간 gate: 2026-05-26

**Mode A Weekly Gate**:
- 2026-05-18 주 군시설: WARN (pct_in_win_zone=0.1242, 목표 0.15) — 첫 Mode A 게이트, gap_p90=0.8096

**agency_mode_lookup adj_range (m25 5 row 정정 검증)**:
- LH at-level: -0.87 / +0.96 (m23 그대로, m25 영향 없음)
- 군시설 at-level: -1.21 / +1.16 (m25 갱신)
- 한전 at-level: -1.49 / +1.23 (m25 갱신)
- 지자체 at-level: -2.08 / +1.58 (m25 갱신)
- 교육청 at-level: -1.70 / +1.22 (m25 min 갱신)
- 조달청 at-level: -1.22 / +1.50 (m23 그대로)

### 9.3 V2 §9 종료 조건 진척 (V6 retire)

| 조건 | 상태 | 비고 |
|---|---|---|
| n≥500 | ✅ 충족 | matched 1,660 / matched+actual 1,360 |
| 4주 연속 PASS | ❌ 2주 누적 | ~2주 더 (5/26·6/2 주 PASS 시 충족) |
| Mode B 통과율 ≥90% | ✅ | 5/19 0.9600, 5/18 0.9511 |
| calibration gap ≤5pp | ✅ | _overall_ 0.0102 (5/19), 0.0011 (5/18) |
| Mode A WIN-zone ≥15% | ❌ WARN | 5/18 0.1242 (군시설 mixed 데이터 영향, current-only 재측정 미실행) |

**V6 retire ETA**: ~2주 (4주 PASS 완성 시점, 라운드 12 대비 단축). Mode A는 retire 조건이 아니므로 V6 retire 자체에는 영향 없음.

### 9.4 잔여 작업

- ⚠ V2_DOMAIN_RULES_CHECK #2 — `ba_seg` → `ep` 기반 전환 (Phase 3, 별도 세션 권고)
- ⚠ Mode A 군시설 current-only 재측정 — mixed 데이터 영향 분리
- ⚠ m20 효과 정량 측정 — refresh_floor_pass_daily post_m20 vs real 비교 데이터 5/20에 일부 적재됨, 누적 비교 분석 미실행
- ⚠ 라운드 14 BRIEF 작성 — 라운드 13 major fix(`8793b4e`) 효과 재평가 의뢰

### 9.5 라운드 13 minor 결산

| 항목 | 처리 | 근거 |
|---|---|---|
| major #1 — m25 적용 실행문 부재 | ✅ fix (`8793b4e`) | SELECT refresh_agency_adj_range(20) + 결과 로그 주석 추가 |
| major #2 — m25 주석 ↔ SQL 불일치 | ✅ fix (`8793b4e`) | `bid_details d` → `bid_records r` 정정 |
| minor #1 — BRIEF V6 retire ETA 병존 | ✅ fix (`8793b4e`) | ~4주 → ~2주 (4주 PASS 시점) |
| minor #2 — m24 score_components 검색 안 됨 | ✅ 무효 확정 | 코드·DB 어디에도 없음, 코덱스 추측 항목 |
| minor #3 — m25 5 row 정정 DB 검증 | ✅ 검증 완료 | §9.2 agency_mode_lookup 표 참조 |
| minor #4 — n 누적·PASS 연속·gate date | ✅ 검증 완료 | §9.2·9.3 참조 |

_§9 추가일: 2026-05-21 / 작성자: Claude Opus 4.7 / 후속 commit: `8793b4e` + 본 갱신_
