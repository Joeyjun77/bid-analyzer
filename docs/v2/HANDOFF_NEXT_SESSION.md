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

### 9.3 V2 §9 종료 조건 진척 (V6 retire) — m26·m27 적용 후 갱신

| 조건 | 상태 | 비고 |
|---|---|---|
| n≥500 | ✅ 충족 | matched 1,660 / matched+actual 1,360 |
| 4주 연속 PASS | ❌ **canonical 카운터 0주** | 5/18·5/19 mixed PASS 무효 (m27 적용), canonical 첫 게이트 2026-05-25(월), 4주 완성 ~2026-06-22 |
| Mode B 통과율 ≥90% | ✅ | 5/21 canonical _overall_ 0.9704 (n=135) — v2_modeB_real ≡ v2_modeB_canonical (b_pred_* 적재가 이미 current era만) |
| calibration gap ≤5pp | ✅ | _overall_ 0.0206 (5/21 canonical) |
| Mode A WIN-zone ≥15% | ❌ **WARN 더 심각** | m26 current-only 재측정: 군시설 12.42% → **10.00%** (mixed가 +2.42pp 부풀려 측정). 목표 15%까지 -5pp |

**V6 retire ETA**: ~**2026-06-22** (canonical 첫 weekly gate 5/25에서 4주 PASS 누적 시작, m27 정합 회복 비용 +4주 연장). 코덱스 메타 권고 Q4 "정합 회복 우선 동의" 수용.

### 9.4 잔여 작업

- ✅ Mode A 군시설 current-only 재측정 — m26 적용 완료 (`c504571`), 12.42→10.00%
- ✅ m20 효과 정량 측정 — m27 적용 직후 v2_modeB_canonical 측정 결과로 검증 완료 (canonical ≡ real 5/21, b_pred_* 이미 current era만 적재)
- ⚠ V2_DOMAIN_RULES_CHECK #2 — `ba_seg` → `ep` 기반 전환 (Phase 3, 별도 세션 권고)
- ⚠ 지자체 Mode A 조건부 활성화 검토 — m26 결과 p90_gap 0.0209→**0.2345(10배+)**, 마스터플랜 §3 D2 조건 `gap_p90 ≥ 0.10` 충족 (별도 진단 세션)
- ⚠ 군시설 10.00% WARN 본질 검토 — Mode A 군시설 자체 적합성 (15% 목표 도달 가능성, 1주)
- ⚠ 마스터플랜 §3 D2 표 갱신 — current-only 측정값으로 정정 (지자체 0.0209→0.2345 외)
- ⚠ 라운드 14 BRIEF (`81d9747`) 코덱스 평가 의뢰 — m26·m27 적용 후 통합 라운드 15 BRIEF로 흡수 권고
- ⚠ 라운드 15 BRIEF 통합 작성 — 위 잔여 항목 진행 후 m26·m27 + 정책·UI 정정 통합 의뢰

### 9.5 라운드 13 minor 결산

| 항목 | 처리 | 근거 |
|---|---|---|
| major #1 — m25 적용 실행문 부재 | ✅ fix (`8793b4e`) | SELECT refresh_agency_adj_range(20) + 결과 로그 주석 추가 |
| major #2 — m25 주석 ↔ SQL 불일치 | ✅ fix (`8793b4e`) | `bid_details d` → `bid_records r` 정정 |
| minor #1 — BRIEF V6 retire ETA 병존 | ✅ fix (`8793b4e`) | ~4주 → ~2주 (4주 PASS 시점) |
| minor #2 — m24 score_components 검색 안 됨 | ✅ 무효 확정 | 코드·DB 어디에도 없음, 코덱스 추측 항목 |
| minor #3 — m25 5 row 정정 DB 검증 | ✅ 검증 완료 | §9.2 agency_mode_lookup 표 참조 |
| minor #4 — n 누적·PASS 연속·gate date | ✅ 검증 완료 | §9.2·9.3 참조 |

### 9.6 메타 점검 + m26·m27 적용 결과 (2026-05-21 추가 갱신)

사용자 발화 "예측 시스템에 낙찰사정율 예측이 맞는 건지" + "반복 작업만 진행" 트리거로 라운드 N+1 BRIEF 패턴을 멈추고 **메타 시스템 점검** 진입. 상세: `SYSTEM_AUDIT_2026-05-21.md`, `M26_M27_APPLY_RESULT_2026-05-21.md`.

#### 9.6.1 commit 시퀀스 (4 commit, 모두 push 완료)

| commit | 종류 | 내용 |
|---|---|---|
| `0ad2feb` | docs | 시스템 점검 보고서 — 4종 예측 비교 + 반복 루프 진단 + 작업 로드맵 재정렬 |
| `c9c4ed3` | docs | MAE 1차 KPI 폐기 정책 영역별 예외 명문화 (MASTER §0 + MEASUREMENT_SPEC §6.1 신규) |
| `fe26365` | docs | V2_UI_SPEC §3.1 라벨 정책 신규 ("사정률 점추정 / WIN-zone / 하한 안전망" 3분류) |
| `c504571` | fix | **m26·m27 측정 함수 정합 회복 + cron canonical 전환** |

#### 9.6.2 코덱스 메타 상의 응답 요약

| # | 질문 | 코덱스 답 | 수용 |
|---|---|---|---|
| Q1 | 영역별 MAE 예외? | 부분 동의 (산포 낮은 영역만 예외) | ✅ `c9c4ed3` |
| Q2 | 의사결정 분기? | 동의 + 지자체·조달청 라벨 추가 | ✅ `fe26365` §3.1.2 |
| Q3 | 반복 루프 원인? | 동의 + 측정 신뢰도 회복도 부산물 | (분석 반영) |
| Q4 | 로드맵 우선순위? | A→D→**C→B→E** + 라운드 N+1 메타 통합 | ✅ 통합 라운드 15 BRIEF 예정 |
| Q5 | 정책 정정? | 명문화 + V6 retire 후 점추정 모듈 별도 분리 | ✅ MEASUREMENT_SPEC §6.1 |

코덱스 추가 우려 (m20 효과 미실행) → m27 적용으로 해소.

#### 9.6.3 m26·m27 적용 핵심 발견

- **군시설 mixed 12.42% → current-only 10.00%** — mixed가 실제 성과를 +2.42pp 부풀려 측정
- **지자체 p90_gap 0.0209 → 0.2345 (10배+)** — Mode A 후보 영역 신규 부상 (마스터플랜 §3 D2 조건부 A 활성화 가능성)
- **v2_modeB_canonical ≡ v2_modeB_real (5/21)** — b_pred_* 적재가 이미 current era만, m27은 향후 안전망 역할
- **4개 cron 모두 정합 회복** (jobid 10·11 canonical, jobid 12·13 함수 본체 era 필터)

#### 9.6.4 m26·m27 적용 win_zone_daily 영역별 결과 (2026-05-21 current-only)

| at | n | pct_in_win_zone | p90_gap | 모드 판정 |
|---|---|---|---|---|
| 군시설 | 60 | **10.00%** (WARN, ↓ 2.42pp from mixed) | 0.6070 | A 유지 |
| 지자체 | 126 | 2.38% | **0.2345** | **B + 조건부 A 활성화 후보** |
| 한전 | 23 | 0.00% | 0.0060 | B 유지 |
| 교육청 | 12 | 0.00% | 0.0059 | B 유지 |
| LH | 6 | 0.00% | 0.0013 | B (n 보강 필요) |
| 조달청 | 7 | 0.00% | 0.0006 | B + 공격성 교정 |

→ 마스터플랜 §3 D2 표 (mixed 기준)의 5건 중 4건은 측정값 유사. **지자체만 의미 있는 변동**.

#### 9.6.5 V6 retire 정합 기준 카운터 신규 시작

- 5/18·5/19 PASS 누적 = **mixed real 기준, 무효**
- 첫 v2_modeB_canonical weekly gate: **2026-05-25(월) 01:00 UTC**
- 4주 연속 PASS 완성 ETA: **~2026-06-22 무렵**
- ETA +4주 연장 비용 < 측정 신뢰도 영구 손상 비용 (predict-architect + 코덱스 + 사용자 합의)

### 9.7 m28 데이터 정합 + outlier 추적 + 마스터플랜 정정 (2026-05-21 추가 갱신)

JIJACHE_MODE_A_REVIEW §4.1·§4.2·§4.4 후속 작업 진행. 상세: `JIJACHE_MODE_A_REVIEW_2026-05-21.md`, `M28_APPLY_RESULT_2026-05-21.md`.

#### 9.7.1 commit 시퀀스 (3 commit, push 완료)

| commit | 종류 | 내용 |
|---|---|---|
| `7224e83` | docs | 지자체 Mode A 조건부 활성화 검토 — 활성화 불가 + 데이터 정합 결함 발견 |
| `a76d59e` | fix | **m28 — bid_records.at 군 발주사 145건 정합 회복** (current era, 27개 발주사) |
| (현재) | docs | HANDOFF §9.7 + 마스터플랜 §3 D2.1 (current-only 측정값 명시) |

#### 9.7.2 m28 데이터 정합 회복 (145건 UPDATE)

| 항목 | 값 |
|---|---|
| 대상 | bid_records.at='지자체' AND canonical_ag 군 키워드 |
| 정정 | at → '군시설' |
| 범위 | era_v2='current' 한정 (legacy 3,857건 후속 m29 보류) |
| 영향 | 27개 발주사 — 지상작전사령부 22 / 제3697부대 15 / 특수전사령부 14 등 |
| 거짓 양성 | 0건 (중부대학교 NOT '%대학교%' 화이트리스트 차단) |
| 즉시 측정값 변화 | 없음 (win_zone_daily는 d.at 사용, floor_pass_daily는 p.at 사용) |
| 영구 정합 회복 | ✅ bid_records.at 자체 + 향후 신규 예측·분석에서 정확화 |

검증: 지자체 1,430건 / military_n=0 ✅, 군시설 236건 / military_n=151 (m28 +145 + 기존 6).

#### 9.7.3 지자체 Mode A 조건부 활성화 — **불가** 확정

- `lookup_agency_mode` RPC 결과: 지자체 7개 발주사 모두 Mode B 권장
- 최대 p90_gap = 0.0518 (경기도 고양시 medium confidence n=33) — 마스터플랜 §3 D2 조건 0.10의 절반
- m26 win_zone_daily 0.2345 측정은 outlier 1건 단독 영향 (정상 분포는 ≤ 0.05)
- **마스터플랜 §3 D2.1 신규 추가** — 지자체 "B 유지" 명문화 + current-only 측정값 표

#### 9.7.4 Outlier 추적 결과 (`id=348193, pn_no=202603935`)

| 컬럼 | 값 | 판정 |
|---|---|---|
| ag | 한국도로공사 서울경기본부 | 공기업 |
| canonical_ag | NULL | 정규화 미적용 |
| at | 지자체 | ❌ 잘못된 분류 (m28 패턴 미적중 — 사령부·부대 아님) |
| bid_records 본체 | br1=100.86, base_ratio=90.09 | 정상 |
| **bid_details.win_bid_rate** | **66.4059** | ❌ floor 88.745 대비 -22pp, 명백한 입력 오류 |
| **bid_details.win_adj_rate** | **-23.2272** | ❌ 비현실적 (정상 ±5%) |
| participants | 3,346 | 비정상적으로 많음 |

→ **이 1건이 m26 win_zone_daily 지자체 0.2345 측정값을 단독으로 끌어올림**

**처리 권고** (별도 commit, m29 가칭):
- 옵션 A: UPDATE bid_details SET win_bid_rate=NULL, win_adj_rate=NULL WHERE id=...
- 옵션 B: refresh_win_zone_daily에 sanity check `ABS(d.win_bid_rate - d.floor_rate) <= 5` 추가 (m25 패턴)
- 옵션 C: bid_records.at + canonical_ag 정규화 추가 (한국도로공사 패턴)
- 권고: **옵션 B** (구조적 sanity check가 향후 outlier도 자동 차단)

#### 9.7.5 마스터플랜 §3 D2 → §3 D2.1 신규 추가

마스터플랜 §3 D2 표는 작성 시점(2026-05-19) mixed era 추정값. m26 current-only 측정으로 갱신된 §3 D2.1 표 추가:

| 영역 | n (current 90일) | gap p90 | 모드 판정 (재검증) |
|---|---|---|---|
| 군시설 | 60 | 0.6070 | A 유지 |
| 지자체 | 126 | 0.2345 (outlier 영향, 정상 ≤ 0.0518) | **B 유지** (조건부 A 미활성) |
| 교육청 | 12 | 0.0059 | B 유지 |
| 한전 | 23 | 0.0060 | B 유지 |
| 조달청 | 7 | 0.0006 | B + 공격성 교정 유지 |
| LH | 6 | 0.0013 | B (n 보강 필요) |

#### 9.7.6 잔여 작업 갱신 (§9.4 보강)

- ✅ HANDOFF §9.7 + 마스터플랜 §3 D2.1 — 본 갱신
- ⚠ m29 (가칭) outlier sanity check — refresh_win_zone_daily에 `ABS(win - floor) ≤ 5` 추가
- ⚠ legacy era 3,857건 정정 — m28 패턴, 1주 모니터링 후
- ⚠ 육군교육사령부 7건 처리 (현재 at='교육청', 별도 도메인 판단)
- ⚠ canonical_ag 정규화 결함 — 한국도로공사·NULL 28%(지자체) 정규화 보강
- ⚠ 통합 라운드 15 BRIEF — 위 작업 진행 후 m26·m27·m28·m29 + 정책·UI + outlier 처리 통합 의뢰

### 9.8 m29·m30 적용 + 코덱스 라운드 15 평가 + UI_SPEC 정합 (2026-05-21 추가 갱신)

§9.7 이후 진행분 영구 기록. 상세: `M29_APPLY_RESULT_2026-05-21.md`, `BID_RECORDS_DUPLICATE_DIAGNOSIS_2026-05-21.md`, `M30_APPLY_RESULT_2026-05-21.md`, `CODEX_ROUND_15_BRIEF.md`.

#### 9.8.1 commit 시퀀스 (m29~m30 + 코덱스 라운드 15 의뢰 + 본 갱신)

| commit | 종류 | 내용 |
|---|---|---|
| `781a762` | fix | **m29 outlier sanity check** — 지자체 p90_gap 0.2345 → 0.0183 정상 회복 |
| `91fa277` | docs | **bid_records.pn_no 중복 113건 진단** — M29 §3.1 의문 해소 |
| `208e6d0` | fix | **m30 is_duplicate flag** — 중복 113건 영구 마킹 (current era) |
| `4a25fef` | docs | 코덱스 라운드 15 의뢰문 — 메타 점검 통합 평가 |
| (현재) | docs | UI_SPEC §3.1.2 정합 + HANDOFF §9.8 신규 |

#### 9.8.2 코덱스 라운드 15 평가 결과

**Composite 8.9/10** (라운드 13 8.5 → +0.4 상승)

| 항목 (가중치) | 라운드 13 | 라운드 15 | 변화 |
|---|---|---|---|
| 도메인 정확성 (30%) | 8.6 | **9.0** | ⬆⬆ |
| 안전성 (25%) | 8.7 | 8.8 | ⬆ |
| **측정 일관성** (20%) | 8.6 | **9.1** | ⬆⬆⬆ |
| 코드-문서 정합성 (15%) | 8.2 | 8.5 | ⬆ |
| KPI 신뢰도 (10%) | 8.3 | 8.7 | ⬆⬆ |

**메타 점검 자체 평가** (코덱스 인용): "옳았다. 이 라운드의 가장 큰 개선점이다." — 라운드 N+1 BRIEF 반복 루프를 끊고 시스템 본질 점검으로 전환한 판단이 가장 큰 가치. MAE 전역 강등을 영역별 예외로 정정한 것은 **단순 버그 수정이 아닌 시스템 방향 수정**.

#### 9.8.3 코덱스 평가 결함 분류

**Critical**: 0건

**Major (3건)**:
1. Mode A 군시설 목표 미달 지속 (10.00% → 13.33%, 목표 15% 미달)
2. 중복 무결성 영구 차단 미완료 (legacy 2,578건 + UNIQUE 인덱스 m31·m32 대기)
3. **V2_UI_SPEC §3.1.2 지자체 표현 불일치** — ✅ 본 commit으로 정정 (`B 유지, 조건부 A 미활성`)

**Minor (3건)**:
1. HANDOFF §9.6~§9.7에 m29/m30 미반영 — ✅ 본 §9.8로 반영
2. 측정 함수들이 사용하는 at 소스(d.at vs r.at) 표준화 필요
3. canonical_ag NULL 결함 (지자체 28%, 중복 마스터 100%) — Mode lookup 신뢰도 향상에 필수

#### 9.8.4 V2 측정 인프라 정합 7단계 완성 (재요약)

| 단계 | 마이그레이션 | 목적 |
|---|---|---|
| 1 | m20 | refresh_floor_pass_daily 공동도급 제외 (G-도메인 #7) |
| 2 | m25 | refresh_agency_adj_range era 정합 (G-도메인 #0) |
| 3 | m26 | refresh_win_zone_daily era 정합 |
| 4 | m27 | refresh_floor_pass_daily canonical 분기 (V6 retire 정합 카운터) |
| 5 | m28 | bid_records.at 분류 정합 (군 발주사 145건) |
| 6 | m29 | refresh_win_zone_daily outlier sanity check (±5pp) |
| 7 | m30 | bid_records.is_duplicate flag (중복 113건) + refresh_win_zone_daily 필터 |

#### 9.8.5 V6 retire 진척 (캐노니컬 카운터 기준)

| 조건 | 상태 |
|---|---|
| n≥500 | ✅ matched 1,660 / matched+actual 1,360 |
| 4주 연속 PASS | ❌ canonical 카운터 **0주** (mixed 5/18·5/19 무효, canonical 5/25 시작) |
| Mode B 통과율 ≥90% | ✅ canonical _overall_ 0.9704 (n=135) |
| calibration gap ≤5pp | ✅ _overall_ 0.0206 |
| Mode A WIN-zone ≥15% | ❌ WARN (current-only 10.00%, m30 후 13.33%, 목표 -1.67pp~-5pp 격차) |

**ETA**: ~2026-06-22 (canonical 첫 weekly gate 5/25 + 4주 PASS 누적). **6/22 전 retire 판정 불가** (코덱스 평가 기준).

#### 9.8.6 다음 세션 우선순위 3 actions (코덱스 라운드 15 권고)

1. **M31** — legacy 중복 처리 (2,578건, m30 패턴 확장). dry-run → 참조 row 0 확인 → 마킹 적용. 1주 모니터링 후 진입.
2. **M32** — 신규 중복 차단 (`UNIQUE(pn_no) WHERE is_duplicate=false` 부분 인덱스 + sbUpsert 경로 확인). 24시간 모니터링 후.
3. **U-spec 정합** — V2_UI_SPEC §3.1.2 지자체 "B 유지" 정정 ✅ (본 commit), HANDOFF §9.8 m29/m30 반영 ✅ (본 commit).

#### 9.8.7 라운드 16 BRIEF 트리거 조건 (즉시 X)

코덱스 권고: 다음 중 하나 발생 시 트리거.
1. M31 또는 M32 완료 후 — 데이터 무결성 축 평가 가치 충분
2. **2026-05-25 첫 canonical weekly gate 결과 수신 후** — 4주 PASS 카운터 1주차 실측값
3. Mode A 군시설 WARN 재평가 자료 확보 후 — 15% 목표 미달 원인 분석 또는 목표 재정의

#### 9.8.8 accuracy 진단 핵심 발견 (2026-05-21)

`/accuracy` 슬래시 커맨드 9개 체크 실행 결과:
- **전체 MAE 5/20 = 0.7188** (5/19 0.4084 대비 +0.3104 악화 ⚠)
- **군시설 14일 드리프트 +0.1949 🚨** (지자체 +0.04, 한전 +0.03)
- **고양시 MAE 1.0932** (n=3, 모든 예측 +1.09 단방향 bias)
- **한전 Top-1 적중률 72.73%** vs 군시설 2.53% / 지자체 7.87% / 교육청 0~8% — **한전 위주 비대칭 (시스템 함의)**
- weekly_quality_report cron 적재 누락 (5/04 주만 있음, 5/11·5/18 누락)
- Phase 17 confidence_band_pct 41.67% 🚨 (목표 70%+, 신뢰구간 재조정 필요)
- 전략 캘리브레이션: use_fallback=false (실측 충분), aggressive 0.7752 / balanced 0.6175 / safe 0.3692

위 발견은 **자사 1위 적중 예측 자체에는 무영향**(메타 점검 + m26~m30 fix가 baseline MAE 무수정 보존) 다만 운영 모니터링 차원에서 추적 필요.

_§9 최초 추가일: 2026-05-21 / 후속 갱신 (§9.6 포함): 2026-05-21 / 후속 갱신 (§9.7 포함): 2026-05-21 / 후속 갱신 (§9.8 포함): 2026-05-21 / 작성자: Claude Opus 4.7 / 관련 commit: `8793b4e`, `d2a3361`, `0ad2feb`, `c9c4ed3`, `fe26365`, `c504571`, `7224e83`, `a76d59e`, `29b8067`, `781a762`, `91fa277`, `208e6d0`, `4a25fef` + 본 갱신_
