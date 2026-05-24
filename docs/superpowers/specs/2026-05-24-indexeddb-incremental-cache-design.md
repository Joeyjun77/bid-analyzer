# IndexedDB 증분 캐시 — 디자인 스펙

> **작성일**: 2026-05-24
> **근거**: 모바일 초기 로드 성능 후속 작업 (b3ee04c 컬럼 축소 / 207121a 병렬 페치에 이은 3차 개선)
> **목표**: 복귀 사용자 재방문 시 `bid_records` 전량(65,115행) 페치를 델타만으로 축소 → 초기 대시보드 표시까지 시간 단축
> **분류**: 데이터 로딩 인프라 (예측 로직 무관 — predict_v6/getFinalRecommendation/낙찰하한율 미변경 → CLAUDE.md `/evaluate` 트리거 비해당)
> **선행 사실 (2026-05-24 DB 실측)**:
> - `bid_records` 65,115행, `created_at` NULL 0건, `updated_at` 컬럼 **부재**
> - 증가율: 1일 237 / 7일 1,772 / 30일 8,402 (주당 ~2.7%)
> - `dedup_key = md5(pn|ag|od|ba)`, upsert 페이로드(`toRecord`)에 created_at 미포함 → merge 시 created_at 보존(원래 insert 시각)
> - ar1 NULL 12,248건 = 휘발성(사정률 미발표) 후보. 단 180일 초과 old-NULL 753건은 영구 미발표(불변)

---

## 0. 한 줄 요약

`bid_records`에 `updated_at` 컬럼+트리거를 추가하고, 클라이언트가 전체 행을 IndexedDB에 캐시한 뒤 매 로드마다 `(count, max(updated_at))` 싼 게이트로 변경 여부를 확인해 **변경분(`updated_at > lastSync`)만 델타 페치**한다. 무변경 시 행 페치 0, 일 복귀 시 ~250~500행(<1페치) = **99%+ 절감**. 캐시는 순수 최적화로, 어떤 실패든 기존 `sbFetchAll` 전체 페치로 폴백한다.

---

## 1. 문제 정의

### 1.1 현 시스템

- 앱은 매 로드마다 `sbFetchAll()`로 `bid_records` 전량(현재 65,115행, 65페이지)을 페치 → calcStats → 통계·예측 입력.
- 207121a로 순차 66회 → CONC=6 병렬화했으나, **전송량·페치 횟수 자체는 그대로**. 복귀 사용자도 매번 65k행 전량 재수신.
- 데이터의 ~97%는 과거 낙찰 결과(불변 history). 매 로드 전량 재페치는 낭비.

### 1.2 핵심 제약 — created_at 기반 델타는 불안전

- `bid_records`에 `updated_at`이 없음. `created_at`은 insert 시각이며 upsert merge(`resolution=merge-duplicates`)는 페이로드에 created_at이 없어 **기존 행의 created_at을 보존**.
- 따라서 ar1 백필(같은 dedup_key 재업로드로 사정률 채움) 등 **in-place UPDATE는 created_at이 안 바뀌어 `created_at > lastSync` 델타가 놓침** → 캐시가 stale ar1=NULL 유지 → 통계·예측 오염.
- 변경(휘발) 행은 대부분 최근/미래 od에 집중(ar1 NULL의 93.5%가 최근 90일)이나, old-NULL 753건과 드문 옛 행 정정까지 휴리스틱으로 100% 커버하기는 불완전.

### 1.3 결론

in-place 변경을 완벽 포착하려면 **권위 있는 변경 시각(`updated_at`)이 필요**하다. 표준적·가산적 DB 변경 1건으로 해결하며, 예측 로직과 무관해 검증 게이트를 건드리지 않는다.

---

## 2. 결정 사항

| # | 결정 | 근거 |
|---|---|---|
| 1 | `updated_at` 컬럼 + `BEFORE UPDATE` 트리거 추가 | upsert merge가 발생시키는 UPDATE에서 트리거가 갱신 → 모든 in-place 변경(ar1 백필 포함) 포착 |
| 2 | 전체 행을 IndexedDB에 캐시, 델타 동기화 | 복귀 로드 시 변경분만 수신 (99%+ 절감) |
| 3 | `(count, max(updated_at))` 싼 게이트 RPC | 무변경 시 행 페치 0 — 65페이지 대신 RPC 1회 |
| 4 | 삭제는 count 불일치 감지 → 전체 reconcile | `updated_at` 델타는 삭제를 못 잡음. count 비교로 자가치유 |
| 5 | `colsVersion` 자동 무효화 | 페치 컬럼셋 변경(b3ee04c류) 시 캐시 폐기·재적재 — 스키마-stale 방지 |
| 6 | 전 경로 try/catch → `sbFetchAll` 폴백 + 킬 스위치 | 캐시 실패가 데이터 로드·예측을 절대 막지 않음 (clsAg 교훈) |
| 7 | RPC는 `authenticated` role 노출 | 앱은 authedFetch만 사용. anon 노출 불필요 |

---

## 3. DB 변경 (1회성·가산적·예측 무관)

```sql
-- 1) 컬럼 + 백필
ALTER TABLE bid_records ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
UPDATE bid_records SET updated_at = COALESCE(created_at, now());   -- service_role, timeout 무관

-- 2) 델타 키셋 인덱스
CREATE INDEX IF NOT EXISTS idx_br_updated_at ON bid_records(updated_at, id);

-- 3) BEFORE UPDATE 트리거
CREATE OR REPLACE FUNCTION set_br_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER trg_br_updated_at BEFORE UPDATE ON bid_records
  FOR EACH ROW EXECUTE FUNCTION set_br_updated_at();

-- 4) 싼 변경 게이트 RPC (authenticated)
CREATE OR REPLACE FUNCTION bid_records_sync_meta()
  RETURNS TABLE(cnt bigint, max_updated timestamptz)
  LANGUAGE sql STABLE AS $$ SELECT count(*), max(updated_at) FROM bid_records $$;
GRANT EXECUTE ON FUNCTION bid_records_sync_meta() TO authenticated;
```

**주의·고려:**
- upsert(`ON CONFLICT DO UPDATE`)는 값이 동일해도 UPDATE를 실행 → 트리거가 `updated_at` 갱신. 동일 데이터 재업로드도 dirty 마킹되나 **무해**(캐시가 같은 값 재페치만, 정합성 보존). 구현 1단계에서 **트리거 fire를 실측 검증**(ar1 NULL 행 재업로드 → updated_at 변화 확인).
- 백필 UPDATE(65k행)는 마이그레이션(service_role)으로 1회 실행 — `statement_timeout` 무관.
- 인덱스 `(updated_at, id)`는 델타 키셋 쿼리 `WHERE (updated_at,id) > (?,?)` seq scan 회피용.
- `bid_records_sync_meta`의 `count(*)`+`max(updated_at)`는 인덱스로 <100ms. authenticated `statement_timeout`(8s) 내 여유.
- DB 객체 2건(트리거 함수·RPC)은 git에 없으므로 마이그레이션 SQL을 본 spec과 함께 보존(재배포 유실 방지).

---

## 4. IndexedDB 스키마 (`bid-analyzer-cache`)

| objectStore | keyPath | 내용 |
|---|---|---|
| `bid_records` | `id` | `sbFetchAll` 반환 형태 그대로 (25컬럼) + `updated_at` |
| `meta` | `key` | `{ key:'bid_records', lastSyncUpdatedAt, cachedCount, colsVersion }` |

- IndexedDB 버전 번호는 objectStore 구조 변경 시에만 bump(`onupgradeneeded`).
- 반환 시 `getAll()` → **od.desc 정렬** 후 반환 → `sbFetchAll` 계약과 동일(드롭인 대체). calcStats/예측 입력 불변.

---

## 5. 동기화 흐름 — `sbFetchAllCached()`

`sbFetchAll`을 래핑하는 신규 함수. 호출부(App.jsx:752/768/909)는 `sbFetchAll` → `sbFetchAllCached`로 교체.

```
1. localStorage.cacheDisabled === 'true'  → [F] 전체 페치
2. IDB 열기. colsVersion 불일치 또는 IDB 에러  → 캐시 폐기 → [F]
3. meta 읽기 {lastSyncUpdatedAt, cachedCount}. meta 없음(최초)  → [F]
4. 싼 게이트: bid_records_sync_meta() RPC → {server_count, server_max_updated}  (요청 1회)
5. (신선) server_max_updated === lastSyncUpdatedAt && server_count === cachedCount
     → getAll → od.desc → RETURN.  (행 페치 0)   [cache hit]
6. (변경) 델타:
   a. WHERE updated_at > lastSyncUpdatedAt ORDER BY updated_at,id
      키셋 페이징(limit 1000, (updated_at,id) 커서). 각 행 IDB upsert(id).
   b. 삭제/발산 체크: IDB count(신규) !== server_count
      → 전체 reconcile: sbFetchAll 전량 → IDB store 교체 → cachedCount = server_count
   c. meta 갱신: lastSyncUpdatedAt = server_max_updated, cachedCount = server_count,
      colsVersion = CACHE_COLS_VERSION
   d. getAll → od.desc → RETURN.   [cache delta N] / [cache reconcile]

[F] 폴백·최초: sbFetchAll() 전체 네트워크 페치 → 캐시·meta 적재 → RETURN.   [cache fallback / full]
```

**완전성 불변식:** 매 동기화 후 `IDB count === server_count`를 단언. 불일치 시 6.b reconcile로 자가치유. 반환 배열 길이 == server_count == "낙찰 데이터" KPI → **65,115 불변식 유지**.

**키셋 페이징 근거:** offset 페이징은 동시 쓰기 중 drift 위험 + PostgREST 1000캡. `(updated_at, id)` 복합 커서로 안정적 델타 순회.

---

## 6. 캐시 버저닝·무효화

- `CACHE_COLS_VERSION` = `BID_RECORDS_COLS` 컬럼셋의 버전(예: 컬럼 목록 md5 앞 8자). 페치 컬럼이 바뀌면 자동 변경.
- 로드 시 `meta.colsVersion !== CACHE_COLS_VERSION` → 캐시가 스키마-stale(신규 컬럼 누락 가능) → **캐시 폐기 + 전체 페치 + 재적재**. 컬럼 축소·추가 배포(b3ee04c류) 시 자동 자가무효화.

---

## 7. 에러 처리·폴백 (clsAg 교훈 — 절대 crash 금지)

- 캐시 경로 **전체 try/catch**. 어떤 실패든(IDB 미지원=사파리 시크릿, QuotaExceeded, RPC 에러, 델타 throw) → `console.warn` + `sbFetchAll()` 전체 페치 폴백.
- 용량: 65k × 25컬럼 ≈ 수 MB (IDB 수백 MB 한도 내). QuotaExceeded → 캐시 clear 후 전체 페치.
- 멀티탭: id upsert idempotent, meta last-write-wins. 최악 = 중복 페치 1회. 락은 YAGNI(보류).
- **킬 스위치**: `localStorage.cacheDisabled='true'` → 캐시 우회. 재배포 없이 라이브 즉시 비활성화.

---

## 8. 테스트

**단위(mock IDB + mock fetch):**
1. 신선 게이트 — server meta 동일 → 0행 페치, 캐시 반환
2. 델타 — updated_at>lastSync 행만 upsert, meta 갱신
3. 삭제 — count 불일치 → 전체 reconcile 발동
4. colsVersion bump — 캐시 폐기·전체 페치
5. 에러(IDB/RPC/델타 throw) → sbFetchAll 폴백, 앱 정상

**수동/통합:**
- 로드 → 새로고침 = 행 페치 0 (`[cache] hit`)
- 신규 파일 업로드 → 델타만 페치
- **(트리거 실측)** ar1 NULL 행 재업로드로 ar1 백필 → updated_at bump → 델타 재페치 → 캐시 ar1 채워짐 = 트리거 fire 입증
- 행 삭제 → count 불일치 → reconcile
- 라이브: "낙찰 데이터" KPI === 65,115 (완전성 회귀 체크)

---

## 9. 롤아웃

1. **DB 변경 먼저** 적용(updated_at + 백필 + 인덱스 + 트리거 + RPC) → 트리거 fire 실측 검증
2. 클라 캐시 코드 배포(`sbFetchAllCached` + 호출부 교체) → 킬 스위치 대기
3. 이상 징후(KPI≠65,115, 콘솔 에러) 시 `cacheDisabled`로 즉시 폴백
- `/evaluate` 비해당(예측 로직 무관). 단 deploy-gate의 MAE + 65,115 완전성 체크는 적용. build 통과 + 수동 캐시 정합성 시나리오 통과 필수.

---

## 10. 비목표 (YAGNI)

- 오프라인 열람(네트워크 없이 동작) — 1차 목표 아님(게이트 RPC는 네트워크 필요)
- 콜드(최초) 로드 단축 — 본 설계는 복귀 로드만 단축
- 멀티탭 동기화 락 — 중복 페치 1회 허용
- `bid_predictions`/`bid_details` 캐시 — 별도 후속(동일 패턴 적용 가능하나 본 spec 범위 외)
