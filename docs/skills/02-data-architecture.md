# 데이터 아키텍처 — DB 스키마 & SQL 패턴
> Supabase 프로젝트 ID: `sadunejfkstxbxogzutl`
> 전체 9개 테이블의 스키마, 관계, 자주 쓰는 SQL 패턴

## 테이블 목록

| 테이블 | 용도 | 행 수 | Phase |
|---|---|---|---|
| `bid_records` | 과거 낙찰 이력 (전국) | 53K+ | 1 |
| `bid_details` | SUCVIEW 복수예가 상세 | 600+ | 1 |
| `bid_predictions` | 준의 예측 + 매칭 결과 | 1.2K+ | 1 |
| `target_matrix` | 기관유형×금액대 이론 낙찰률 | 26 | 12-A |
| `sweet_spot_agencies` | 3억+ 공고 빈도 | 98 | 12-A |
| `agency_bias` | 발주사별 편향 (참고용) | 59 | 12-A |
| `agency_win_stats` | 발주사별 낙찰 통계 | 114 | 12-C |
| `agency_predictor` | 발주사별 예측 보정 | 114 | 12-C |
| (drop됨) `ag_assumed_stats`, `priority_agencies`, `selection_rules`, `ag_win_patterns`, `bid_scoring`, `bid_win_probability`, `prediction_bias`, `roi_matrix`, `ai_strategy_analysis`, `agent_reports`, `bid_predictions_archive` | Phase 11 청산 | - | 11~12 |

## bid_records 스키마 (53K건)

```sql
CREATE TABLE bid_records (
  id              SERIAL PRIMARY KEY,
  dedup_key       TEXT UNIQUE,         -- MD5(pn+ag+od+ba)
  pn              TEXT,                -- 공고명
  pn_no           TEXT,                -- 공고번호 (군시설: L-prefix, 나라장터: R-prefix)
  ag              TEXT,                -- 발주기관명
  at              TEXT,                -- 기관유형 (clsAg 결과)
  ep              NUMERIC,             -- 추정가격
  ba              NUMERIC,             -- 기초금액
  av              NUMERIC,             -- A값 (관급자재비)
  xp              NUMERIC,             -- 예정가격
  bp              NUMERIC,             -- 1순위 투찰금액
  br1             NUMERIC,             -- 1순위 예정가격비율 (100 기준)
  br0             NUMERIC,             -- 자사 예정가격비율
  ar1             NUMERIC,             -- 사정율 (100 기준, 1순위)
  ar0             NUMERIC,             -- 사정율 (100 기준, 자사)
  co              TEXT,                -- 1순위 업체명 (유찰 시 "유찰"/"유찰(무)")
  pc              INTEGER,             -- 참여업체수
  od              DATE,                -- 개찰일
  era             TEXT,                -- "new"/"old" (낙찰하한율 시대)
  fr              NUMERIC,             -- 적용 낙찰하한율
  cat             TEXT,                -- 업종 (전기/통신/소방)
  reg             TEXT,                -- 지역
  created_at      TIMESTAMPTZ
);
```

**중요 컬럼 설명**:
- `br1`: 100 기준 (예: 99.78). 0-base 사정률은 `br1 - 100`
- `pc`: 참여업체수. NULL 거의 없음 (51K건 100% 채움)
- `od`: 개찰일. `eraFR()` 함수가 시대 판별에 사용

## bid_predictions 스키마 (1.2K건)

```sql
CREATE TABLE bid_predictions (
  id                       SERIAL PRIMARY KEY,
  dedup_key                TEXT UNIQUE,  -- "pred|"+pn_no+"|"+od
  pn                       TEXT,
  pn_no                    TEXT,
  ag                       TEXT,
  at                       TEXT,
  ep                       NUMERIC,
  ba                       NUMERIC,
  av                       NUMERIC,
  raw_cost                 TEXT,
  cat                      TEXT,
  open_date                DATE,
  
  -- 예측값 (생성 시점에 영구 저장)
  pred_adj_rate            NUMERIC,    -- 순수 통계 예측 (편향 보정 전)
  pred_expected_price      NUMERIC,
  pred_floor_rate          NUMERIC,    -- 낙찰하한율
  pred_bid_amount          NUMERIC,
  pred_source              TEXT,       -- 예측 근거 문자열
  pred_base_adj            NUMERIC,
  
  -- 추천값 (편향 보정 + 오프셋 적용 후 최종)
  opt_adj                  NUMERIC,    -- 최종 추천 사정률
  opt_bid                  NUMERIC,    -- 최종 추천 투찰금액
  
  -- 3시나리오 추천
  rec_adj_p25              NUMERIC,    -- 공격
  rec_adj_p50              NUMERIC,    -- 균형
  rec_adj_p75              NUMERIC,    -- 보수
  rec_bid_p25              NUMERIC,
  rec_bid_p50              NUMERIC,
  rec_bid_p75              NUMERIC,
  rec_strategy             TEXT,
  
  -- 매칭 결과
  match_status             TEXT,       -- "pending" / "matched" / "expired"
  matched_record_id        INTEGER,    -- bid_records.id 참조
  actual_adj_rate          NUMERIC,
  actual_bid_amount        NUMERIC,
  actual_expected_price    NUMERIC,
  actual_winner            TEXT,
  adj_rate_error           NUMERIC,    -- opt_adj - actual_adj_rate
  
  source                   TEXT,       -- "manual" / "file_upload"
  created_at               TIMESTAMPTZ
);
```

**필드 명명 주의**:
- `actual_bid_amount` (NOT `actual_bid`)
- `actual_expected_price` (NOT `actual_xp`)
- 컬럼명 짧게 줄여 쓰지 말 것 — SQL 작성 시 자주 실수

## bid_details 스키마 (600건)

```sql
CREATE TABLE bid_details (
  id                  SERIAL PRIMARY KEY,
  pn_no               TEXT UNIQUE,
  pn                  TEXT,
  ag                  TEXT,
  at                  TEXT,
  od                  DATE,
  ba                  NUMERIC,
  xp                  NUMERIC,
  pre_rates           JSONB,    -- 15개 (또는 14개) 복수예비가격 사정율 배열
  pre_avg             NUMERIC,
  selected_indices    JSONB,
  adj_rate            NUMERIC,  -- 실제 사정률
  participant_count   INTEGER,
  bid_dist            JSONB,    -- 투찰율 구간 분포 (8구간)
  created_at          TIMESTAMPTZ
);
```

## agency_win_stats 스키마 (Phase 12-C)

```sql
CREATE TABLE agency_win_stats (
  id                     SERIAL PRIMARY KEY,
  ag                     TEXT NOT NULL UNIQUE,
  at                     TEXT,
  
  n_total                INT NOT NULL,    -- 매칭 건수 (cutoff: 3건 이상)
  n_perfect_win          INT,             -- 완벽 예측 시 이론 낙찰
  n_actual_win           INT,             -- 실제 낙찰 (준의 1순위)
  
  theoretical_win_rate   NUMERIC,         -- n_perfect_win / n_total × 100
  actual_win_rate        NUMERIC,
  
  median_adj_rate        NUMERIC,         -- 사정률 P50 (0-base)
  std_adj_rate           NUMERIC,
  mae                    NUMERIC,
  mean_bias              NUMERIC,
  
  avg_participants       INT,
  avg_amount_eok         NUMERIC,
  
  priority_tier          INT,             -- 1~5
  priority_label         TEXT,             -- "🏆 P1 주력 타깃" 등
  recommendation         TEXT,             -- "집중 투찰" / "선택 투찰" / "회피"
  confidence             NUMERIC,          -- 0~1, LEAST(1, n_total/20)
  
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agency_win_stats_priority ON agency_win_stats(priority_tier, theoretical_win_rate DESC);
CREATE INDEX idx_agency_win_stats_at ON agency_win_stats(at);
```

**P1~P5 등급 기준** (theoretical_win_rate):
- P1: 30%+
- P2: 18~30%
- P3: 10~18%
- P4: 3~10%
- P5: 0~3%

**컷오프 변경 이력**:
- 초기: 5건 이상 → 59개 발주사
- Phase 12-C 후반: **3건 이상 → 114개 발주사** (현재)

## agency_predictor 스키마 (Phase 12-C/D)

```sql
CREATE TABLE agency_predictor (
  id                  SERIAL PRIMARY KEY,
  ag                  TEXT NOT NULL UNIQUE,
  at                  TEXT,
  n                   INT NOT NULL,
  
  adj_offset          NUMERIC,    -- median_actual - median_my_pred
  shrinkage           NUMERIC,    -- LEAST(1, n/20)
  effective_offset    NUMERIC,    -- adj_offset × shrinkage
  
  strategy            TEXT,       -- 'boost_positive' / 'boost_negative' / 'keep_current'
  
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
```

**오프셋 계산 공식**:
```
adj_offset = (발주사 실제 사정률 중앙값) - (준의 평균 예측값)
shrinkage = LEAST(1.0, n_total / 20)
effective_offset = adj_offset × shrinkage
```

샘플 20건에서 신뢰도 1.0, 10건에서 0.5, 3건에서 0.15.

## target_matrix 스키마 (Phase 12-A)

```sql
CREATE TABLE target_matrix (
  id              SERIAL PRIMARY KEY,
  at              TEXT,
  amount_band     TEXT,    -- "<1억", "1-3억", "3-10억", "10-50억", "50억+"
  n_total         INT,
  n_perfect_win   INT,
  win_rate_pct    NUMERIC,
  priority_tier   INT,
  notes           TEXT
);
```

26개 행 = 7개 기관유형 × ~4개 금액대.

## SQL 패턴 (자주 쓰는 것들)

### 패턴 1: 정상 낙찰 데이터 필터링
```sql
WHERE br1 BETWEEN 95 AND 105     -- 사정률 ±5% 이내
  AND co NOT LIKE '%유찰%'        -- 유찰 제외
  AND ar1 IS NOT NULL              -- 사정률 있음
```

### 패턴 2: 매칭된 예측의 정상 데이터
```sql
WHERE p.match_status = 'matched'
  AND p.actual_adj_rate IS NOT NULL
  AND p.actual_bid_amount IS NOT NULL
  AND p.actual_expected_price IS NOT NULL
  AND ABS(p.adj_rate_error::numeric) < 5
  AND (p.actual_winner IS NULL OR p.actual_winner NOT LIKE '%유찰%')
```

### 패턴 3: 법정 하한 / 낙찰 가능 범위 계산
```sql
-- 법정 하한
CEIL(CASE 
  WHEN av > 0 
  THEN av + (actual_xp - av) * (fr/100) 
  ELSE actual_xp * (fr/100) 
END)::bigint as legal_floor

-- 완벽 예측 시 투찰금액
CEIL(CASE 
  WHEN av > 0 
  THEN av + (ba * (1 + actual_adj/100) - av) * (fr/100) 
  ELSE ba * (1 + actual_adj/100) * (fr/100) 
END)::bigint as perfect_bid

-- 낙찰 여부
(perfect_bid BETWEEN legal_floor AND actual_bid) as is_win
```

### 패턴 4: 100% 표기로 변환
```sql
-- 0-base → 100-base 변환
ROUND((100 + br1::numeric - 100)::numeric, 4) as 사정률_100
-- 더 간단하게 (br1이 이미 100-base인 경우)
ROUND(br1::numeric, 4) as 사정률_100

-- 0-base 컬럼(actual_adj_rate)을 100-base로
ROUND((100 + actual_adj_rate::numeric)::numeric, 4) as actual_100
```

### 패턴 5: PERCENTILE_CONT (분위수)
```sql
PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY actual_adj_rate::numeric)
```
PostgreSQL 14+에서 안정적 작동.

### 패턴 6: 발주사별 P1~P5 분류 (등급 부여)
```sql
CASE 
  WHEN (n_perfect_win * 100.0 / n_total) >= 30 THEN 1
  WHEN (n_perfect_win * 100.0 / n_total) >= 18 THEN 2
  WHEN (n_perfect_win * 100.0 / n_total) >= 10 THEN 3
  WHEN (n_perfect_win * 100.0 / n_total) >= 3 THEN 4
  ELSE 5
END as priority_tier
```

### 패턴 7: pending 정리 (만료 + 취소)
```sql
-- 7일 경과 → expired
UPDATE bid_predictions SET match_status = 'expired'
WHERE match_status = 'pending' 
  AND open_date < CURRENT_DATE - INTERVAL '7 days';

-- 취소 공고 → expired
UPDATE bid_predictions SET match_status = 'expired'
WHERE match_status = 'pending' 
  AND (pn LIKE '%취소%' OR pn LIKE '%(취소)%');
```

## SQL 작성 시 함정

| 함정 | 대처 |
|---|---|
| `actual_bid` (X) | `actual_bid_amount` 정확히 |
| `actual_xp` (X) | `actual_expected_price` 정확히 |
| WITH CTE 자기참조 | PostgreSQL은 forward reference 불가. 순서 재배치 |
| `numeric` 캐스팅 누락 | `br1::numeric` 명시 (text 비교 방지) |
| 평균 사정률 0-base 표시 | `(100 + AVG(...))` 변환 후 표시 |
| 군시설 pn_no 재사용 | 매칭 시 30일 근접 필수 |
| 0-base에 100 두 번 더하기 | `(100 + (br1 - 100))` ≡ `br1`. 헷갈림 주의 |

## REST API 호출 패턴

### Upsert (필수: URL 파라미터 + 헤더)
```javascript
fetch(SB_URL + "/rest/v1/table?on_conflict=dedup_key", {
  method: "POST",
  headers: {
    ...hdrs,
    "Prefer": "resolution=merge-duplicates,return=minimal"
  },
  body: JSON.stringify(rows)
})
```

`?on_conflict=dedup_key`가 URL에 반드시 있어야 함. 헤더만으로는 동작 안 함.

### Pagination (1000건 제한)
```javascript
let all = [];
for (let offset = 0; ; offset += PAGE) {
  const res = await fetch(`${SB_URL}/rest/v1/table?offset=${offset}&limit=${PAGE}`, {headers: hdrsSel});
  const rows = await res.json();
  all = all.concat(rows);
  if (rows.length < PAGE) break;
}
```

### Count 헤더
```javascript
fetch(url, {
  headers: {...hdrs, "Prefer": "count=exact"}
})
// 응답 헤더의 content-range에서 총 건수 추출
```

## sanitizeJson() 필수

PostgreSQL text 컬럼은 `\u0000`과 lone surrogate(`\uD800-\uDFFF`)를 거부.
모든 JSON 저장 전 적용 필수:

```javascript
export function sanitizeJson(s) {
  return s.replace(/\\u0000/g, "").replace(/[\uD800-\uDFFF]/g, "");
}
```

## 데이터 안전 원칙

1. **DROP TABLE은 사용자 명시적 확인 후에만**
2. **bid_predictions의 opt_adj는 영구 저장값** — 함부로 UPDATE 금지
3. **agency_win_stats / agency_predictor는 재구축 가능** — DELETE + INSERT 가능
4. **MIGRATION으로 DDL** (`apply_migration`), DML은 `execute_sql`
5. **bid_records 53K건은 마스터 데이터** — 절대 손상 금지
