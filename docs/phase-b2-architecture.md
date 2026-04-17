# Phase B-2 아키텍처: 나라장터 API 자동 수집 파이프라인

> Supabase 서버 측에서 완전히 자율적으로 동작하는 수집 파이프라인.
> 로컬 Node 스크립트 개입 없이 `pg_cron` → `pg_net` → Edge Function → PostgREST(RPC) 로 데이터가 흐른다.

---

## 1. 전체 흐름

```
[나라장터 OpenAPI]
     ▲  ▼  serviceKey 인증 (Vault 복호화 값)
[Edge Function: fn-collect-notices / fn-collect-results]
     ▲  ▼  PostgREST RPC 호출 (service_role JWT)
[Postgres SECURITY DEFINER 함수]
     ▲  ▼  upsert / log
[DB 테이블: bid_notices, bid_records, api_ingestion_log, api_key_config]
     ▲
     │ pg_net.http_post (Vault: SB_SERVICE_ROLE_JWT)
     │
[pg_cron 스케줄러]  *30분 / 일1회 / 일1회 카운터 리셋*
```

### 설계 원칙
- **Postgres 안에서 최대한 처리**: 데이터 정규화·dedup 키 생성·필터 룰 매칭을 모두 RPC(SECURITY DEFINER) 안에서 수행. Edge Function은 얇게 유지.
- **Vault 시크릿 중심**: 외부 API 키와 내부 JWT 모두 Postgres Vault에 저장. 코드·환경변수에 평문 노출 없음.
- **멱등성 보장**: `dedup_key` 유니크 제약 + `ON CONFLICT DO UPDATE` 로 중첩 호출에도 안전. 30분 Cron이 35분 윈도우로 5분 중첩 수집하는 구조.
- **관찰 가능성**: 모든 API 호출은 `api_ingestion_log` 에 페이지 단위로 기록. `v_ingestion_summary_24h`, `v_cron_recent` 뷰로 상태 확인.

## 2. 구성 요소

### 2.1 테이블

| 테이블 | 용도 | PK/Unique |
|---|---|---|
| `bid_notices` | 입찰공고 | `dedup_key = bidNtceNo-bidNtceOrd-bidClsfcNo-rbidNo` |
| `bid_records` | 낙찰결과 + 최종낙찰자 병합 | `dedup_key` (bid_notices와 동일 규칙) |
| `bid_details` | 복수예비가 15행 상세 | `pn_no` (현 Phase 범위 외) |
| `api_ingestion_log` | 호출 이력 | — |
| `api_collection_rules` | 수집 필터 규칙 | `id` |
| `api_key_config` | API 키 메타데이터 + 일일 호출 카운터 | `key_name` |

### 2.2 Vault 시크릿

| 이름 | 용도 | 설정 위치 |
|---|---|---|
| `G2B_BID_PUBLIC_KEY` | 입찰공고서비스 serviceKey (64자) | Dashboard > Vault |
| `G2B_SCSBID_INFO_KEY` | 낙찰정보서비스 serviceKey (동일 값) | Dashboard > Vault |
| `SB_PROJECT_URL` | Supabase 프로젝트 URL | Dashboard > Vault |
| `SB_SERVICE_ROLE_JWT` | service_role JWT (pg_cron → Edge Function) | Dashboard > Vault |

### 2.3 RPC (SECURITY DEFINER, service_role only)

| 함수 | 용도 |
|---|---|
| `get_api_key(p_key_name)` | Vault 복호화 + 일일 카운터 롤오버 |
| `increment_api_call(p_key_name, p_n)` | 카운터 원자적 증가 |
| `upsert_bid_notice(p jsonb)` | 공고 정규화 + `is_target` 판정 + upsert |
| `upsert_bid_record(p jsonb)` | 낙찰 정규화 (`opengCorpInfo` 파싱) + upsert |
| `upsert_bid_detail(p jsonb)` | 복수예비가 15행 저장 (현 범위 외) |
| `log_api_ingestion(...)` | 호출 이력 기록 |
| `invoke_edge_function(slug, body)` | pg_cron → Edge Function 호출 래퍼 |
| `reset_daily_api_counters()` | 자정 일괄 카운터 리셋 |

### 2.4 Edge Function

| 함수 | 용도 | 버전 |
|---|---|---|
| `fn-collect-notices` | 30분 주기 입찰공고 수집 | v3 |
| `fn-collect-results` | 일1회 개찰결과+최종낙찰자 수집 (2-pass) | v4 |

### 2.5 Cron Job

| jobname | 스케줄 (UTC) | KST | 호출 대상 |
|---|---|---|---|
| `collect_notices_every_30min` | `*/30 * * * *` | 0분·30분 매시간 | `fn-collect-notices` (35분 윈도우, max 5p) |
| `collect_results_daily_06kst` | `0 21 * * *` | 06:00 | `fn-collect-results` (7일 윈도우, max 10p × 2 API) |
| `reset_api_counters_daily_00kst` | `5 15 * * *` | 00:05 | `reset_daily_api_counters()` |

## 3. 운영 관찰 뷰

### 3.1 `v_vault_status` — 시크릿 설정 상태

```sql
SELECT * FROM v_vault_status;
-- exists_flag가 모두 true 여야 정상 동작
```

### 3.2 `v_ingestion_summary_24h` — 최근 24시간 호출 집계

```sql
SELECT * FROM v_ingestion_summary_24h ORDER BY last_call_at DESC;
```

호출별로 `ok_count / error_count / rows_saved / avg_duration_ms` 집계 제공.

### 3.3 `v_cron_recent` — Cron 실행 이력 (최근 48h)

```sql
SELECT jobname, status, start_time, duration_ms FROM v_cron_recent LIMIT 20;
```

`status = 'succeeded'` 가 기본이며, `failed` 시 `return_message` 에 에러 단서.

## 4. 수집 필터 규칙 (`api_collection_rules`)

현재 3개 룰이 설정되어 있으며 모두 `enabled = true`, `main_cat_only = true`.

| rule_name | cat_keywords | ep_min | ep_max | contract_methods |
|---|---|---|---|---|
| `electric_target` | `[전기공사]` | 80M | 5B | `[제한경쟁, 일반경쟁]` |
| `comm_target` | `[통신공사, 정보통신공사, 정보통신]` | 80M | 5B | 동일 |
| `fire_target` | `[소방시설공사, 소방공사, 소방]` | 80M | 5B | 동일 |

### 매칭 알고리즘

1. `main_cat_only = true` (기본): `mainCnsttyNm` (주공종) 만 대상
2. `main_cat_only = false`: 주공종 + 부공종 (`subsiCnsttyNm1~5`) 까지 키워드 매칭
3. `ep_min ≤ ep ≤ ep_max` (추정가격 범위)
4. `contract_method` 가 `contract_methods` 배열에 포함
5. `exclude_keywords` 중 어느 것이 `bidNtceNm` 에 있으면 제외

하나 이상의 enabled 규칙이 매칭되면 `is_target = true`.

## 5. 로컬 개발자 가이드

### 5.1 서버 상태 확인

```sql
-- 한 번에 건강도 체크
SELECT
  (SELECT count(*) FROM v_vault_status WHERE exists_flag = false) AS vault_missing,
  (SELECT count(*) FROM v_ingestion_summary_24h WHERE error_count > 0) AS services_with_errors,
  (SELECT max(last_call_at) FROM v_ingestion_summary_24h) AS last_api_call,
  (SELECT count(*) FROM v_cron_recent WHERE status = 'failed') AS recent_cron_failures;
```

### 5.2 수동 트리거 (개발/테스트)

```sql
-- 입찰공고 즉시 수집
SELECT invoke_edge_function('fn-collect-notices',
  '{"hours":2, "operation":"공사", "page_size":50, "max_pages":2}'::jsonb);

-- 낙찰결과 즉시 수집
SELECT invoke_edge_function('fn-collect-results',
  '{"days":1, "page_size":50, "max_pages":3}'::jsonb);

-- 응답 확인 (리턴된 request_id로 조회)
SELECT id, status_code, left(content::text, 500)
FROM net._http_response ORDER BY id DESC LIMIT 5;
```

### 5.3 수집된 최신 타깃 공고 조회

```sql
SELECT bid_ntce_no, cat, contract_method, ep, reg, left(pn, 50) AS title, bid_close_dt
FROM bid_notices
WHERE is_target = true
ORDER BY bid_close_dt DESC NULLS LAST
LIMIT 20;
```

### 5.4 낙찰 추적 (최근 1주)

```sql
SELECT pn_no, left(ag, 30) AS agency, co, bp, br1, od
FROM bid_records
WHERE od >= current_date - 7 AND co IS NOT NULL
ORDER BY od DESC, bp DESC NULLS LAST
LIMIT 30;
```

## 6. 장애 대응

### 6.1 Cron이 안 돌 때

```sql
SELECT * FROM v_cron_recent WHERE jobname LIKE 'collect_%' LIMIT 10;
```

- `status = 'failed'` + `return_message` 확인
- `return_message` 에 `Vault secrets ... missing` → Vault 시크릿 누락. `v_vault_status` 확인
- `return_message` 에 `403/401` → service_role JWT 만료/변경. Vault 업데이트

### 6.2 API가 에러를 반환할 때

```sql
SELECT * FROM api_ingestion_log
WHERE status = 'error' AND ingested_at > now() - interval '1 hour'
ORDER BY ingested_at DESC;
```

- `result_code 06/08` → 파라미터 문제. Edge Function 코드 확인
- `result_code 22/99` → 한도 초과. `api_key_config.calls_today` 확인
- `status 500` 반복 → 나라장터 서버 장애 또는 키 문제. `docs/g2b-api-spec.md` 트러블슈팅 표 참조

### 6.3 수집이 되는데 `is_target` 이 0건일 때

- `mainCnsttyNm` 실제 값 확인: `SELECT DISTINCT cat FROM bid_notices WHERE notice_dt > now() - interval '1 day';`
- 룰의 `cat_keywords` 와 비교하여 오탈자·키워드 누락 점검
- `ep_min/ep_max` 범위가 너무 좁지 않은지 확인

## 7. 확장 로드맵

### 우선순위 1 — Phase 4-B Auth 구현
- Supabase Auth + RLS 도입
- `api_collection_rules`, `api_ingestion_log`, `bid_notices.is_target` 등을 사용자별로 분리 (멀티테넌트)
- 현재 단일 사용자 전제의 스키마를 `user_id` 기준 소유권 모델로 확장

### 우선순위 2 — 복수예비가 15행 상세 수집
- 공공데이터포털 추가 활용신청 필요 (현재 확인된 범위의 API 중에는 없음)
- 별도 서비스 ID 발견 시 `fn-collect-details` Edge Function 추가

### 우선순위 3 — 용역/물품 업종 확장
- `BidPublicInfoService` 의 `Servc`, `Thng`, `Frgcpt` 오퍼레이션 활성화
- `api_collection_rules` 에 업종 구분 플래그 추가

## 8. 파일 구조 참고 (Supabase 측)

Supabase 서버 측 리소스는 로컬 레포에 없고 Supabase 마이그레이션/Edge Function으로 관리된다.

```
Supabase project (sadunejfkstxbxogzutl)
├── migrations/
│   ├── phase_b1_api_tables               (bid_notices, api_ingestion_log, api_collection_rules, api_key_config)
│   ├── phase_b2_api_helpers              (RPC 6종)
│   ├── phase_b2_enable_cron_net          (pg_cron, pg_net)
│   ├── phase_b2_cron_jobs                (3 Cron Jobs + invoke_edge_function 래퍼)
│   ├── phase_b2_ops_views                (v_vault_status, v_ingestion_summary_24h, v_cron_recent)
│   ├── phase_b2_fix_invoke_wrapper       (net.http_post 시그니처 수정)
│   ├── phase_b2_fix_upsert_bid_notice_cat (mainCnsttyNm 매핑 수정)
│   ├── phase_b2_fix_upsert_bid_record    (opengCorpInfo 파싱, COALESCE 보강)
│   └── phase_b2_rules_main_cat_only      (부공종 제외 옵션)
└── functions/
    ├── fn-collect-notices/               (v3)
    └── fn-collect-results/               (v4)
```

---

## 변경 이력

- 2026-04-17: 초판. 30분 주기 공고 수집 + 일1회 낙찰결과 수집 파이프라인 완성.
