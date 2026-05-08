# 예측 시스템 v7 재설계 — Phase 21

**작성일**: 2026-05-08
**작성자**: bsilisk777@gmail.com (with Claude Opus 4.7)
**상태**: 설계 — 사용자 검토 게이트
**선행 자료**: `c:\Users\home\Downloads\HANDOFF_PHASE_21_V7_REDESIGN.md` (핸드오프 원본)
**관련 Phase**: 21-A ~ 21-E (분포 모델 v7 도입, v6.2 단계적 폐기)

---

## 1. 배경

### 1.1 현재 v6.2의 진단

점예측 MAE는 0.49 ~ 0.554% — 복수예비가격 C(15,4) 추첨 노이즈 플로어(0.642%) **아래까지 이미 도달**. 더 이상의 점예측 정밀화는 구조적으로 불가능하지만, 동시 운영 중인 변수는 계속 늘어남:

- `OPT_OFFSET` 발주처 5종 + `prediction_bias` rolling 보정 + 4-tier fallback (`v_similar_cases` → `v_agency_company_history` → `v_prediction_v6` → 기본값) + `win_score_v2` 6-factor + `company_strategy_profile` 3,629사 × 6 strategy + `agency_environment_profile` 210기관 + v7/v7.2/v8 사정률 + `bid1st_v2` 추천 + 보수/균형/공격 3종 + AI 권장 + 매트릭스 추천

→ **한 건당 13개 이상의 예측·추천 값이 동시 노출**. 사용자 인지 부담 + 과적합 위험 누적.

### 1.2 입찰 산식 재확인 (재설계 근거)

```
투찰금액 = 기초금액 × (예가/기초 비율) × 낙찰하한율
```

| 변수 | 정체 | 결정자 | v7에서의 처리 |
|---|---|---|---|
| 기초금액 | 공고문 명시 | 발주처 | 입력 (예측 아님) |
| 예가/기초 비율 | 복수예비가격 4개 추첨 평균/기초 | 발주처+추첨 운 | **유일한 예측 대상 (분포)** |
| 낙찰하한율 | 적격심사 산식 해 (87.745% 등) | 법령 | **룩업 테이블 (예측 아님)** |

→ 진짜 예측해야 할 변수는 **단 하나**. 나머지는 입력·룩업·결정적 산식.

---

## 2. 데이터 검증 결과 (2026-05-08 진단 쿼리)

### 2.1 컬럼 매핑 확정

| 핸드오프 가정 | 실제 DB 컬럼 | 비고 |
|---|---|---|
| `agency_id` | `canonical_ag` (text) | 정규화된 발주사명 사용 |
| `industry` | `cat` (text, 전기 LIKE) | 분포 94% "전기" 단일 — 그러나 PK 차원 유지 (확장성) |
| `adj_ratio` (예: 0.99866) | **`ar1`** (= xp/ba × 100) | 평균 99.8061%, std 6.09 — 100% 기준 표기 |
| 사정률(%) | `ar0` (= ar1 − 100) | 평균 −0.19% |
| 낙찰하한율 | `fr` (이미 채워져 있음) | 평균 87.75% — 룩업 테이블과 병행 운영 |
| `winner_name` | `co` | 컨소시엄 정규식 매치율 0% |

**검증 결론**: 핸드오프의 `adj_ratio = base_ratio` 추정은 **틀렸음** (`base_ratio` ≈ `br1`, 낙찰가/기초가 87.71%). v7의 핵심 변수는 **`ar1`** (= 100 × xp/ba).

### 2.2 표본 분포 (canonical_ag × cat=전기)

| Tier | 조건 | 발주사 수 | 누적 건수 | 점유율 |
|---|---|---|---|---|
| Tier 1 | n ≥ 10 | 345 | 49,818 | **96.7%** |
| Tier 2 | 5 ≤ n < 10 | 149 | 982 | 1.9% |
| Tier 3 | n < 5 | 934 | 1,578 | 3.1% |

→ Tier 1이 압도적. shrinkage 강도 튜닝 부담 거의 없음. **n_pool=10 유지 + 가속 마이그레이션 가능**.

### 2.3 공동도급 마킹 신호 부재

- `co` 정규식 (`외 N개사|컨소시엄|공동수급|(공동)`): **0건 매치** (61,065건 중)
- `contract_method`: **100% NULL** (61,321/61,321)

→ 핸드오프 §4 "공동도급 격리 운영 규칙"은 현 데이터로 **작동 불가**. 사용자 결정: **격리 단계 보류, 컬럼만 추가 후 전체 false**. 공동도급 분석은 Phase 22+로 이월 (별도 데이터 보강 필요).

---

## 3. 사용자 합의 결정 사항 요약

진단 결과를 반영해 핸드오프 4건의 미해결 항목 + 신규 발견 3건에 대해 합의:

| # | 항목 | 결정 |
|---|---|---|
| 1 | 출력 범위 | 사정률 분포 + 하한율 룩업 2개를 **메인**으로, 기존 v6.2 산출물은 **참고용 보관 후 Phase 21-E에서 단계적 제거** |
| 2 | 그레인 | `(canonical_ag, cat)` PK 유지 (industry 확장성 보존) |
| 3 | 하한율 정의 | 발주사 과거 **실측 기반** 학습 (별도로 `lower_bound_rate_lookup` 제도 표준값 보관용 테이블 신설) |
| 4 | 공동도급 격리 | **단계 보류** — `is_joint_contract` 컬럼만 추가, 전체 false 채움 |
| 5 | n_pool 초기값 | 10 (Tier 1 압도적이라 영향 미미) |
| 6 | 마이그레이션 페이스 | **가속 — Shadow 1주/20건 후 default 전환** |
| 7 | 작업 브랜치 | **main 직접 작업** (CLAUDE.md 룰 우선 — 핸드오프의 `feature/` 권장 무시) |

---

## 4. 데이터 모델

### 4.1 신규 테이블 1: `agency_rate_distribution`

```sql
CREATE TABLE agency_rate_distribution (
    canonical_ag        text NOT NULL,
    cat                 text NOT NULL,            -- 전기 / 전기,통신 / ...
    median_adj_ratio    numeric(8,5) NOT NULL,    -- 100% 기준 (예: 99.87654)
    p25_adj_ratio       numeric(8,5) NOT NULL,
    p75_adj_ratio       numeric(8,5) NOT NULL,
    std_adj_ratio       numeric(8,5) NOT NULL,
    sample_size         int NOT NULL,
    tier                text NOT NULL CHECK (tier IN ('tier1','tier2','tier3')),
    confidence          text NOT NULL CHECK (confidence IN ('high','med','low')),
    last_recalc_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (canonical_ag, cat)
);
ALTER TABLE agency_rate_distribution ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_read_agency_rate_distribution
    ON agency_rate_distribution FOR SELECT TO anon USING (true);
```

> **단위 보정**: 핸드오프 `numeric(7,5)`는 100.00000을 표현하지 못함 (max 9.99999). `numeric(8,5)`로 확장 — 평균 99.8 + std 6 분포 안전 수용.

### 4.2 신규 테이블 2: `lower_bound_rate_lookup`

```sql
CREATE TABLE lower_bound_rate_lookup (
    agency_type         text NOT NULL,            -- 조달청/지자체/LH/한전/교육청/군시설
    cat                 text NOT NULL,            -- 전기/통신/소방
    size_band           text NOT NULL,            -- u80m / u150m / u300m / u1b / u5b
    lower_bound_rate    numeric(7,5) NOT NULL,    -- 100% 기준 (예: 87.74500)
    source_regulation   text,                     -- 근거 법령 텍스트
    PRIMARY KEY (agency_type, cat, size_band)
);
ALTER TABLE lower_bound_rate_lookup ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_read_lower_bound_rate_lookup
    ON lower_bound_rate_lookup FOR SELECT TO anon USING (true);
```

**시드 데이터** (핸드오프 §2.2 표 기준 초안 — 시드 적용 전 `docs/skills/`의 최신 규정 + 메모리 "Floor rate 89.745% confirmed (2025-07/2026-01 revisions)" 재확인 후 보정):

| agency_type | cat | size_band | lower_bound_rate | 근거 |
|---|---|---|---|---|
| 지자체 | 전기/통신/소방 | u150m | 87.74500 | 1.5억 미만, 90점 산식 |
| 지자체 | 전기/통신/소방 | u300m | 87.74500 | 1.5억~3억, 80점 산식 |
| 지자체 | 전기/통신/소방 | u5b | 86.74500 | 3억~50억, 70점 산식 |
| 조달청 | 전기/통신/소방 | u80m | 87.74500 | 8천만 미만 |
| 조달청 | 전기/통신/소방 | u300m | 87.74500 | 8천만~3억 |
| 조달청 | 전기/통신/소방 | u5b | 86.74500 | 3억~50억 |
| LH | 전체 | 전체 | 87.74500 | 별도 (예가 천원 절상) |

> 시드 적용은 Phase 21-A 마이그레이션 안에서 `execute_sql` INSERT (DDL은 `apply_migration`, DML은 `execute_sql` 분리 — 메모리 원칙).

### 4.3 `bid_records` 컬럼 추가 (격리는 보류, 스키마만 준비)

```sql
ALTER TABLE bid_records
    ADD COLUMN IF NOT EXISTS is_joint_contract boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS joint_contract_type text;
```

→ 인덱스는 격리 활성화 시점에 추가 (현재는 모든 행 false라 인덱스 무의미).

---

## 5. `predict_v7()` RPC 설계

### 5.1 시그니처

```sql
CREATE OR REPLACE FUNCTION predict_v7(
    p_canonical_ag text,
    p_cat          text DEFAULT '전기'
) RETURNS TABLE (
    median_adj   numeric,    -- 100% 기준 (예: 99.876)
    p25_adj      numeric,
    p75_adj      numeric,
    std_adj      numeric,
    confidence   text,        -- high/med/low
    tier         text,        -- tier1/tier2/tier3
    sample_size  int
) LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_n_self     int;
    v_n_pool     int := 10;
    v_at         text;
BEGIN
    SELECT at INTO v_at
    FROM bid_records
    WHERE canonical_ag = p_canonical_ag
    LIMIT 1;

    SELECT count(*) INTO v_n_self
    FROM bid_records
    WHERE canonical_ag = p_canonical_ag
      AND cat LIKE p_cat || '%'
      AND is_joint_contract = false
      AND ar1 IS NOT NULL
      AND COALESCE(is_excluded,false) = false;

    IF v_n_self >= 10 THEN
        -- Tier 1: 자체 분포만
        RETURN QUERY
        SELECT
            percentile_cont(0.50) WITHIN GROUP (ORDER BY ar1)::numeric,
            percentile_cont(0.25) WITHIN GROUP (ORDER BY ar1)::numeric,
            percentile_cont(0.75) WITHIN GROUP (ORDER BY ar1)::numeric,
            stddev_samp(ar1)::numeric,
            'high'::text, 'tier1'::text, v_n_self
        FROM bid_records
        WHERE canonical_ag = p_canonical_ag
          AND cat LIKE p_cat || '%'
          AND is_joint_contract = false
          AND ar1 IS NOT NULL
          AND COALESCE(is_excluded,false) = false;

    ELSIF v_n_self >= 5 THEN
        -- Tier 2: Bayesian shrinkage (구체 SQL은 Phase 21-B에서 작성)
        -- weight_self = n_self / (n_self + n_pool)
        -- median_final = w_self*median_self + (1-w_self)*median_global
        RETURN QUERY
        SELECT
            NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric,
            'med'::text, 'tier2'::text, v_n_self;

    ELSE
        -- Tier 3: 전역 fallback (at + cat)
        RETURN QUERY
        SELECT
            percentile_cont(0.50) WITHIN GROUP (ORDER BY ar1)::numeric,
            percentile_cont(0.25) WITHIN GROUP (ORDER BY ar1)::numeric,
            percentile_cont(0.75) WITHIN GROUP (ORDER BY ar1)::numeric,
            stddev_samp(ar1)::numeric,
            'low'::text, 'tier3'::text, v_n_self
        FROM bid_records
        WHERE at = v_at
          AND cat LIKE p_cat || '%'
          AND is_joint_contract = false
          AND ar1 IS NOT NULL
          AND COALESCE(is_excluded,false) = false;
    END IF;
END;
$$;
```

### 5.2 투찰금액 (모델 외부, 결정적 산식)

```sql
CREATE OR REPLACE FUNCTION calc_bid_amount_v7(
    p_ba              numeric,
    p_adj_ratio_pct   numeric,    -- 100% 기준 (예: 99.876)
    p_lower_bound_pct numeric     -- 100% 기준 (예: 87.745)
) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
    SELECT ceil(p_ba * (p_adj_ratio_pct / 100.0) * (p_lower_bound_pct / 100.0));
$$;
```

> **LH 특례 (예정가격 천원 절상 후 하한율)**: 현재 핸드오프 §3.2 주석으로 후속. Phase 21-B에서 `calc_bid_amount_v7_lh()` 별도 함수로 분리 — bid_records 데이터에서 LH 비율 + 평균 ba 측정한 뒤 결정. 시드 시점에 미적용이면 LH는 일반 함수 결과 사용 (소수 케이스, 추후 보정).

---

## 6. 마이그레이션 단계 (가속 페이스, main 직접 작업)

각 단계 완료 시 commit + push, push 직전 `deploy-gate` 서브에이전트 호출 필수.

### Phase 21-A — 스키마 (apply_migration)
1. `agency_rate_distribution` 생성 + RLS + anon read
2. `lower_bound_rate_lookup` 생성 + RLS + anon read
3. `bid_records.is_joint_contract`, `joint_contract_type` 컬럼 추가
4. `lower_bound_rate_lookup` 시드 INSERT (별도 execute_sql)

**검증**: `npx vite build` 통과 (UI 미변경, 빌드 영향 없어야 함). `deploy-gate` 통과.

### Phase 21-B — 추정 함수 + 백필
1. `predict_v7()` RPC 작성 (위 5.1 완성)
2. `calc_bid_amount_v7()` 작성
3. `agency_rate_distribution` 초기 백필:
   ```sql
   INSERT INTO agency_rate_distribution
   SELECT canonical_ag, cat,
          percentile_cont(0.50) WITHIN GROUP (ORDER BY ar1),
          percentile_cont(0.25) WITHIN GROUP (ORDER BY ar1),
          percentile_cont(0.75) WITHIN GROUP (ORDER BY ar1),
          stddev_samp(ar1),
          count(*),
          CASE WHEN count(*)>=10 THEN 'tier1'
               WHEN count(*)>=5  THEN 'tier2'
               ELSE 'tier3' END,
          CASE WHEN count(*)>=10 THEN 'high'
               WHEN count(*)>=5  THEN 'med'
               ELSE 'low' END,
          now()
   FROM bid_records
   WHERE COALESCE(is_excluded,false)=false AND ar1 IS NOT NULL
     AND canonical_ag IS NOT NULL AND cat IS NOT NULL
   GROUP BY canonical_ag, cat
   HAVING count(*) >= 1;
   ```
4. 야간 재계산: GitHub Actions 기존 keep-alive workflow에 SQL 트리거 추가 (메모리상 운영 중).

**검증**: `predict_v7()` 호출 결과가 `bid_records` 직접 집계와 일치하는지 표본 5건 확인. `deploy-gate` 통과.

### Phase 21-C — Shadow mode (1주, 가속)
1. `WinStrategyDashboard.jsx`에 "v7 (베타)" 토글 추가 (default OFF)
2. A-grade 입찰부터 v7 출력 노출 (median + p25-p75 band)
3. 같은 입찰건에 대해 v6.2 vs v7 결과를 `bid_predictions`에 별도 컬럼(`v7_median_adj`, `v7_p25_adj`, `v7_p75_adj`, `v7_tier`)으로 기록

**합격 기준** (1주 / 신규 20건 누적 후):
- v7 MAE ≤ 0.642% (노이즈 플로어)
- v7 ±0.5% hit rate ≥ v6.2 동등 이상
- p25-p75 band 적중률 ≥ 50%
- **핵심 영역(한전·고양시·군부대) MAE 악화 ≤ +0.02** (CLAUDE.md 강제 룰)
- `evaluate_model_release(v7, v6.2, 7)` PASS

**FAIL 시**: 즉시 토글 OFF, 원인 분석. WARN 시 24시간 내 `/accuracy` 재측정.

### Phase 21-D — default 전환
1. 토글 default ON
2. 화면에서 v6.2 산출물(보수/균형/공격, AI 권장, 매트릭스, v7/v7.2/v8 비교, bid1st_v2)을 **숨김 처리** (DB 컬럼은 보존)
3. 메인 표출은 (a) 발주사별 사정률 분포 (median + p25-p75) (b) 적용 낙찰하한율 (c) 결정적 산식으로 계산된 투찰금액 — 3가지

**검증**: 4주간 실사용 모니터링 (이건 가속 후에도 유지). `/accuracy` 주간 점검.

### Phase 21-E — 죽은 코드 제거 (한 분기 유예 후)
**예측 경로에서 제거** (테이블/뷰는 유예):
- `OPT_OFFSET` 상수 (utils.js)
- `prediction_bias` 호출
- `v_similar_cases`, `v_agency_company_history`, `v_prediction_v6` (4-tier fallback)
- `predict_v6()` 함수
- `win_score_v2` 6-factor 의 예측 입력부 (사후 평가용은 보존)
- `bid1st_v2_*` 컬럼 read 경로 (App.jsx)
- v7/v7.2/v8 사정률 비교 패널

**유지 (예측 경로 분리, UI 참고용)**:
- `company_strategy_profile`, `agency_environment_profile`, `floor_margin_benchmark`, 발주사별 낙찰 이력

**기존 `v7_agency_offset` 테이블 (9건, 다른 개념의 실험 잔재)**: Phase 21-E에서 명시적 DROP. 새 v7 분포 모델과 무관하므로 혼동 방지.

---

## 7. 검증·롤백 기준

### 7.1 자동 게이트 (CLAUDE.md 5단계 하네스 준수)

| 단계 | 트리거 | 게이트 | 실패 시 |
|---|---|---|---|
| 설계 | 본 문서 작성 | `predict-architect` 서브에이전트 호출 (Generator 분류 확정) | 재설계 |
| 구축 | RPC/테이블 생성 직후 | `npx vite build` PASS | 빌드 수정 |
| 검증 | 백필 후 / 토글 ON 직전 | `/evaluate` 슬래시 (PASS/WARN/FAIL) | FAIL → 롤백 |
| 운영 | git push 직전 | `deploy-gate` 서브에이전트 (빌드+MAE+핵심영역) | push 금지 |
| 운영 후 | 배포 후 24시간 | `/accuracy` (WARN 이상이었다면) | WARN 지속 시 롤백 |

### 7.2 롤백 시나리오
- **Phase 21-C Shadow에서 FAIL**: 토글 OFF, RPC/테이블 유지 (재시도 여지)
- **Phase 21-D 전환 후 FAIL**: UI default 토글 OFF, v6.2 경로 즉시 복원
- **Phase 21-E 코드 제거 후 FAIL**: 한 분기 유예 덕에 git revert로 복원 가능

---

## 8. CLAUDE.md 정렬 체크

| 룰 | 적용 |
|---|---|
| Generator 분류 변경은 `predict-architect` 사전 호출 | 설계 단계에서 호출 (구현 전 필수) |
| FAIL 판정 시 git push 금지 | `deploy-gate` 가 강제 |
| 핵심 영역(한전·고양시·군부대) MAE +0.02 악화 즉시 FAIL | Phase 21-C 합격 기준 |
| WARN 이상 변경 후 24시간 내 `/accuracy` 재측정 | 운영 게이트로 명시 |
| Supabase SDK 미사용, REST 직접 호출 유지 | UI는 PostgREST RPC 호출로 `predict_v7` 사용 |
| 브랜치 자제, main 직접 작업 | 핸드오프의 `feature/` 권장 무시, Phase별 push |
| `apply_migration` ↔ DDL, `execute_sql` ↔ DML 분리 | 21-A 시드 INSERT 분리 |

---

## 9. 리스크와 대응

| 리스크 | 영향 | 대응 |
|---|---|---|
| LH 특례 함수 분리 미적용 시 LH 입찰 투찰금액 미세 오차 | 낮음 (LH 비율 적음 추정) | Phase 21-B 진단으로 LH 비율 측정, 임계 초과 시 `calc_bid_amount_v7_lh()` 추가 |
| 공동도급 보류로 분포에 컨소시엄 데이터 혼입 | 중 (현재 마킹 신호 없음) | 영향도 측정용 사후 모니터링 — `co` 패턴 외 다른 신호 발견 시 Phase 22 재격리 |
| `cat` 단일성으로 인한 industry 차원 무용 | 낮음 | PK 유지 (스키마 비용 미미), 통신·소방 데이터 누적 시 자연 활용 |
| 가속 페이스(1주/20건)로 표본 부족 | 중 | `evaluate_model_release` 통합 + 핵심 영역 MAE 게이트로 보완. **WARN 시 Shadow 기간 자동 연장 (1주/20건 → 핸드오프 원안 2~3주/50건)**, FAIL 시 즉시 토글 OFF |
| `v7_agency_offset` 기존 9건이 v7 신규와 혼동 | 낮음 | Phase 21-E에서 명시적 DROP, 21-A 단계에서 deprecate 주석 추가 |
| 시드 하한율 규정 변경 (89.745 vs 87.745) | 중 | 시드 적용 전 `docs/skills/`의 최신 규정 문서 + 메모리 재확인 단계 명시 |

---

## 10. 미해결 후속 (Phase 22+)

- 공동도급 마킹 데이터 보강 (외부 source 확보 후 별도 분포 모델)
- LH 특례 별도 분포 (예정가격 천원 절상 영향)
- 분포 외 보조 신호 (참여업체수 → 분산도, 발주사 시즌성) — 점예측이 아닌 분포 폭 보정용
- 예측 정확도 회귀 자동 감지 cron + Slack 알림

---

## 11. 다음 작업자에게

```bash
# 1. predict-architect 서브에이전트 호출 (영향도 검토)
#    → 핵심 영역 영향 표 받은 후에만 21-A 진행

# 2. Phase 21-A: 스키마 마이그레이션
#    - apply_migration 명: phase_21a_v7_distribution_schema
#    - execute_sql 로 시드 INSERT

# 3. 빌드 검증
npx vite build

# 4. deploy-gate 호출 → push
git add . && git commit -m "feat(phase-21a): v7 분포 스키마 + 하한율 룩업 + 격리 컬럼"
git push origin main

# 5. Phase 21-B ~ E 순차 진행, 각 단계 deploy-gate 통과 필수
```

---

**다음 단계**: 본 spec 사용자 검토 → `predict-architect` 영향도 검토 → `writing-plans` 스킬로 구현 계획 작성 → 별도 세션에서 Phase 21-A 부터 실행.
