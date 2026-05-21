# 즉시 가치 작업 처리 결과 (2026-05-21)

> 작성자: Claude Opus 4.7
> 트리거: 사용자 "즉시 가치 작업 진행해줘" 요청 + 본 세션 마무리 단계
> 단일 진실: `M28_APPLY_RESULT_2026-05-21.md`, accuracy 진단 (체크3·체크4)

본 commit으로 처리된 3건 + 진단 결과만 기록한 2건 정리. 모두 0.5일 이내 가능했던 즉시 가치 작업.

---

## 1. 처리 완료 — Outlier bid_details.id=1731 단건 정정 ✅

### 1.1 문제 (M28_APPLY_RESULT §4.2)

JIJACHE_MODE_A_REVIEW §2.3에서 추적한 outlier:
- `bid_details.id=1731 / pn_no=202603935` (한국도로공사 광지원터널 전기공사)
- `win_bid_rate=66.4059` vs `floor_rate=88.745` → gap=-22.3391pp (정상 ±1pp 대비 22배)
- `win_adj_rate=-23.2272` (비현실적, 정상 ±5%)
- 명백한 입력 오류 (m29 sanity check ±5pp로 차단됨, m30 is_duplicate와는 무관)

### 1.2 처리 SQL

```sql
UPDATE bid_details
SET win_bid_rate = NULL, win_adj_rate = NULL
WHERE id = 1731 AND pn_no = '202603935';
```

### 1.3 처리 후 검증

| 필드 | 처리 후 |
|---|---|
| id | 1731 |
| pn_no | 202603935 |
| my_bid_rate | 87.3253 (보존) |
| **win_bid_rate** | **NULL** (정정) |
| **win_adj_rate** | **NULL** (정정) |
| floor_rate | 88.745 (보존) |

→ 측정 함수에서 자동 제외 (`win_bid_rate IS NOT NULL` 필터 통과 못 함). m29 sanity check와 중복되지만 데이터 자체 정정으로 영구 무결성 회복.

### 1.4 정책 준수
- CLAUDE.md "bid_records/bid_details DELETE 금지" 준수 (UPDATE만)
- 다른 컬럼 보존 (my_bid_rate, floor_rate 등)
- 단건 변경 (id=1731 only)

---

## 2. 처리 완료 — weekly_quality_report cron 진단 ⚠ (적재 누락 확인)

### 2.1 문제 (accuracy 체크4)

`weekly_quality_report` 테이블에 2026-05-04 주만 적재. 5/11·5/18 주 데이터 없음.

### 2.2 cron jobid=9 상태 진단

```sql
SELECT jobid, schedule, active, command FROM cron.job WHERE jobid = 9;
```

| jobid | schedule | active | command |
|---|---|---|---|
| 9 | `0 20 * * 0` (매주 일요일 20:00 UTC = 월요일 05:00 KST) | **true** | `SELECT generate_weekly_quality_report((date_trunc('week', CURRENT_DATE) - INTERVAL '7 days')::date, 'v6.2')` |

### 2.3 적재 통계

| 항목 | 값 |
|---|---|
| earliest | 2026-04-06 |
| latest | **2026-05-04** |
| n_weeks | 5 (4/06·4/13·4/20·4/27·5/04) |
| n_rows | 49 |

→ 5/04 주까지 5주 연속 적재 후 **5/11·5/18 주 데이터 없음**. cron은 active 상태인데 5/11 일요일·5/18 일요일 실행 결과가 row 0건.

### 2.4 가설 (추가 진단 필요)

**가설 A**: `generate_weekly_quality_report` 함수 내부 silent fail
- 함수가 RAISE NOTICE/EXCEPTION 없이 0 rows 반환 가능성
- 함수 본체 확인 필요

**가설 B**: 입력 데이터 부족 → 함수 조건 불만족
- 함수가 특정 n_week 임계 미만 시 INSERT 안 함 가능성
- 5/11·5/18 주 bid_predictions 데이터가 함수 조건 미충족 가능성

**가설 C**: cron 실행 자체 실패 (Supabase cron 로그 없으면 무성공)

### 2.5 권고 후속 작업 (별도 commit, m33 가칭)

```sql
-- 1) 함수 본체 확인
SELECT pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.proname='generate_weekly_quality_report';

-- 2) 5/11·5/18 주 수동 실행
SELECT generate_weekly_quality_report('2026-05-11', 'v6.2');
SELECT generate_weekly_quality_report('2026-05-18', 'v6.2');

-- 3) cron 실행 이력 확인 (Supabase pg_cron extension의 job_run_details)
SELECT * FROM cron.job_run_details
WHERE jobid = 9 ORDER BY start_time DESC LIMIT 10;
```

본 commit에서는 진단까지만. 실제 backfill·함수 fix는 별도.

---

## 3. 진단 완료 — 고양시 단방향 bias 결정적 발견 🚨 (즉시 fix 보류, n=3 표본 부족)

### 3.1 문제 (accuracy 체크3)

| focus | n | bias | mae |
|---|---|---|---|
| 고양시 | 3 | **+1.0932** | **1.0932** (모든 예측이 동일 방향 +1.09 빗나감) |
| 군부대 | 50 | +0.1912 | 0.5829 |
| 한전 | 25 | +0.0436 | 0.4557 ✅ |

### 3.2 고양시 raw 데이터 (n=3, 최근 30일)

| id | ag | od | opt_adj | actual_adj_rate | err | b_pred_adj | b_pred_mode |
|---|---|---|---|---|---|---|---|
| 11959 | 경기도 고양시 | 5/14 | -0.4121 | **-1.881** | +1.4689 | +1.2028 | B |
| 11627 | 고양시 일산서구청 | 5/7 | -0.2328 | **-1.3592** | +1.1264 | +1.5108 | B |
| 11625 | 경기도 고양시 | 5/7 | -0.3614 | **-1.0458** | +0.6844 | +1.5156 | B |

### 3.3 진단

- **V6 opt_adj 범위**: -0.2 ~ -0.4 (정상 추정)
- **실측 actual_adj_rate 범위**: **-1.0 ~ -1.9** (매우 음수)
- **err = opt_adj - actual_adj_rate = +0.68 ~ +1.47** (모두 양수, 단방향)
- bid1st_v2_adj: -0.13 ~ +0.08 (V2 추정 정상 범위)
- b_pred_adj: +1.2 ~ +1.5 (Mode B 권장값 — 자사 신고할 사정률)

**결정적 사실**: 고양시 입찰자들은 실제로 사정률을 매우 낮은 음수(-1.0~-1.9)로 신고하는 경향이 있으나, V6 모델은 정상 추정(-0.2~-0.4)으로 예측. **V6가 고양시 실제 입찰자 행동을 과대평가** (덜 공격적이라고 예측).

### 3.4 fix 권고 (즉시 진행 안 함, 표본 부족)

**옵션 A**: pred_bias_map에서 고양시 canonical_ag별 bias 학습
- canonical_ag IN ('경기도 고양시', '경기도 고양시 일산서구청', '경기도 고양시 일산동구청', '경기도 고양시 덕양구')
- 현재 n=3로 통계적 신뢰도 부족 (`refresh_agency_adj_range` default p_min_n=20)
- n≥10~20 누적 후 진행 권고 (~2~4주)

**옵션 B**: agency-floor V1 분포로 즉시 보정
- `agency_rate_distribution`의 고양시 grain median 사용 (이미 사용자 화면에 노출 중)
- 다만 V6 opt_adj 자체는 무수정

**옵션 C**: 데이터 정합 점검 — actual_adj_rate -1.0~-1.9가 정말 정상인지
- 다른 영역(한전 n=25, 군부대 n=50)에서 actual_adj_rate 범위 vs 고양시 비교
- 만약 고양시만 이상 범위면 데이터 입력 오류 가능성

### 3.5 본 commit 처리
- **진단만 영구 기록**, 즉시 fix 안 함
- HANDOFF §9.8.8 accuracy 진단 결과의 일부로 이미 기록됨
- 표본 누적 후 pred_bias_map 재학습 또는 데이터 검증 진입

---

## 4. 본 commit 요약

| 작업 | 처리 결과 | 영향 |
|---|---|---|
| #1 outlier id=1731 UPDATE | ✅ 완료 (DML 1건) | 측정 함수에서 자동 제외, 영구 무결성 |
| #5 cron 진단 | ✅ 완료 (적재 누락 5/11·5/18 확인) | 후속 m33 가칭에서 backfill·함수 fix |
| #6 고양시 bias 진단 | ✅ 진단만 (n=3 표본 부족) | 표본 누적 후 pred_bias_map 재학습 |

### 4.1 자사 1위 적중 예측 영향 — 0
- bid_predictions / opt_adj / matched_record_id 무변경
- predict_v6 / pred_bias_map / 낙찰하한율 함수 무변경
- bid_details.id=1731 outlier 정정은 측정 인프라 정합 회복

### 4.2 V2 측정 인프라 정합 (7단계 + 본 commit)
- m20·m25·m26·m27·m28·m29·m30 (7단계)
- + **bid_details.id=1731 outlier 단건 정정** (m29 sanity check와 데이터 자체 정정 이중 보호)

---

## 5. 다음 세션 우선순위 갱신

본 commit 후 잔여 작업:

### 5.1 단기 (1주 이내)
- **m33 가칭** — weekly_quality_report 5/11·5/18 backfill + 함수 silent fail 원인 분석
- **고양시 bias 표본 누적** — 자연 시간 누적 (~2주)
- 코덱스 Minor #2 (at 소스 표준화) 진단
- 코덱스 Minor #3 (canonical_ag 정규화) 보강

### 5.2 중기 (1~4주)
- **m31** legacy 중복 2,578건 정정 (1주 모니터링 후)
- **m32** UNIQUE(pn_no) 부분 인덱스 (24시간 모니터링 후)
- **육군교육사령부 7건** 처리 (별도 도메인 판단)
- **canonical 카운터 4주 PASS 누적** (5/25 시작, ETA ~6/22)

### 5.3 장기 (4주+)
- **V6 retire** 판정 (~6/22)
- **Phase 3 #2 ba_seg → ep** (별도 세션 권고)
- **Mode A 군시설 WARN 재평가** (15% 목표 도달 가능성)

---

_본 보고서는 즉시 가치 작업 3건 처리 결과. outlier 1건 정정 완료 + cron 진단 + 고양시 bias 진단_
_처리자: Claude Opus 4.7 / 처리 일자: 2026-05-21 / 후속: m33 (cron backfill) + 자연 시간 누적_
