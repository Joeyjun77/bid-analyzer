# V2 마이그레이션 저장소

> V2 재설계 SQL 본문 — `apply_migration` (Supabase MCP) 호출 기록
> 모든 마이그레이션은 2026-05-19에 프로젝트 `sadunejfkstxbxogzutl`에 적용 완료

## 적용 순서 (apply_migration)

```
m1_create_agency_mode_lookup       ✅ B0a (테이블 생성)
m2_create_floor_pass_daily         ✅ B0a (테이블 생성)
m3_unique_nulls_not_distinct       ✅ B0a 결함 #1 정정 (UNIQUE NULL 처리)
m4_add_insert_policies             ✅ B0a 결함 #2 정정 (service_role INSERT/UPDATE)
m5_create_win_zone_daily           ✅ B0b (테이블 생성, NULLS NOT DISTINCT 처음부터 적용)
m6_create_mode_gate_report         ✅ B0b (테이블 생성)
m7_alter_bid_predictions_add_modeb ✅ B2.1 (bid_predictions 6컬럼 ADD)
m8_alter_phase17_add_floor_bidrate ✅ B0b (phase17 bid_rate 컬럼 ADD)
m9_create_lookup_agency_mode_rpc   ✅ B1   (3단계 fallback RPC)
m10_create_refresh_floor_pass_daily ✅ B2.6 (calibration 일배치)
m11_refresh_floor_pass_daily_window ✅ B2.6 보강 (window 분리 — 코덱스 라운드 3 권고 #2)
m12_v2_modeB_cron_schedule          ✅ B5    (pg_cron 자동화 — 코덱스 라운드 5 권고 #2)
m13_create_agency_gap_distribution  ✅ B3.1  (군시설 gap 분포 테이블)
m14_create_lookup_gap_distribution_rpc ✅ B3.2 (gap 분포 3단계 fallback RPC)
m15_create_refresh_win_zone_daily   ✅ B3.6  (Mode A KPI 누적 함수)
m16_v2_modeA_cron_schedule          ✅ B3.7  (Mode A pg_cron 자동화)
m17_add_era_v2_columns              ✅ Phase1 Step1 (era_v2 컬럼 — V2_DOMAIN_RULES_CHECK #0)
m18_alter_agency_gap_distribution_add_era_v2 ✅ Phase1 Step2 (시대 혼입 'mixed' 마킹 + current 재적재 — current AT n=31로 Mode A 가동)
m19_lookup_gap_distribution_era_filter ✅ Phase1 Step3 (RPC era_v2='current' 필터)
m20_refresh_funcs_joint_contract_filter ✅ Phase1 Step4 (refresh 함수들 공동도급 제외 #7)
```

## 🟡 B3 운영 중 — KPI 신뢰도 낮음 (2026-05-21 코덱스 라운드 8 권고 옵션 A)

`V2_DOMAIN_RULES_CHECK.md` §2 + 코덱스 라운드 8 (composite 8.1/10) 결론 반영:
- 시대 혼입 표본: n=186 = legacy 155 + current 31 (m18 'mixed' 마킹 후 격리)
- current 재적재 결과: AG/AG_BA grain 0건, AT grain 1행 n=31
- **recommendV2 Mode A 분기는 AT grain n=31 current 실측 분포로 `recommendModeA` 컨볼루션 정상 가동** (gap_p25=0.0013 통과)
- v2_modeA_weekly_gate KPI는 12.42% (목표 15%) WARN 유지 — n=31 신뢰도 낮음
- 군시설 데이터 누적 후 (주 ~10건 가정 시 7개월) AG grain n>=5 도달 시 보다 정밀한 추천 가능

> **m10 → m11 변경**: 같은 row에서 예측·실측 산출 시 자기충족예언 위험 → window 분리.
> `created_at < matched_at AND matched_at < NOW() - 24h` 조건 추가. m10 함수는 DROP되고 m11 시그니처 (4 params)로 재생성.

## 적용 정책

- 본 SQL은 `apply_migration` MCP 도구로만 실행 (`execute_sql` DDL 금지)
- 각 파일은 한 번에 한 트랜잭션으로 적용됨 — 실패 시 자동 롤백
- DB 동기 상태는 `supabase_migrations.schema_migrations` 테이블로 추적
- 본 저장소 파일은 DB 적용 후 **사후 기록 목적** — 직접 실행해도 멱등성 보장 안 함

## 코덱스 라운드 3 권고 대응

코덱스가 "함수 본문이 저장소에 없어 검증 불가" 결함으로 지적 → 본 디렉토리 도입.
이후 추가 마이그레이션은 `apply_migration` 호출과 동시에 본 디렉토리에 SQL 본문 commit.

## 다음 마이그레이션 예정

| ID | 명칭 | 작업 |
|---|---|---|
| m13+ | Mode A 엔진 (B3) | 군시설 한정 경쟁 분포 컨볼루션 + 부트스트랩 신뢰구간 |
| m14+ | refresh_win_zone_daily 함수 | Mode A KPI 누적 |
| m15+ | recompute_bpred_modeb_sql 함수 | App.jsx useEffect 우회 — SQL 단독 재계산 (메모리화)
