# Codex Round 13 검증 의뢰문

> 작성일: 2026-05-21 (라운드 12 critical fix로부터 ~24시간 후)
> 직전 라운드: 12 (composite 8.0/10, 라운드 11 8.6에서 -0.6 — critical 3건 영향)
> 평가 대상: **라운드 12 critical 3건 fix (a12000e) 효과 전부**
>   - Fix #1: own_score 실제 DB 저장 (ALLOWED_V2_COLUMNS 허용 + dbRows 적재)
>   - Fix #2: m25 era_v2 필터 (refresh_agency_adj_range 정합 회복)
>   - Fix #3: m24 DROP FUNCTION IF EXISTS (재배포 안전성)

---

## 1. 평가 의뢰 핵심 질문

1. **라운드 12 critical 3건 fix 전부 수용 효과** (8.0 → ?)
2. **own_score 실제 적재로 measured-value drift / KPI 신뢰도 하락이 완전 해소됐는가?** (라운드 12 가장 critical 결함)
3. **m25 era_v2 필터로 G-도메인 #0 정합이 회복됐는가?** (legacy/mixed 혼입 차단)
4. **m24 DROP FUNCTION IF EXISTS로 재배포 안전성이 확보됐는가?**
5. **남은 잔여 #2 (ba_seg → ep) 작업 우선순위 및 V6 retire 종료 조건 ETA 변경?**

---

## 2. 라운드 12 → 13 사이 commit 시퀀스

| commit | 종류 | 내용 |
|---|---|---|
| `a12000e` | fix | **라운드 12 critical 3건 일괄 수정** — (1) supabase.js ALLOWED_V2_COLUMNS에 own_score 추가 + App.jsx 2곳 dbRows에 own_score 적재 (라인 884·959), (2) m25 — refresh_agency_adj_range에 era_v2='current' + \|adj\|≤5 필터 추가 (5 row 정정 갱신), (3) m24 SQL에 DROP FUNCTION IF EXISTS 명시 (반환 타입 변경 시 CREATE OR REPLACE 불가 대응) |

(라운드 12 BRIEF 자체는 `4765265` push 와 별개로 라운드 12 fix와 함께 main에 머지된 상태. 본 라운드 13 BRIEF는 신규 의뢰 문서.)

---

## 3. 변경 정량 영향

### Fix #1: own_score 실제 적재 (가장 critical)

라운드 11에서 m22 own_score 컬럼이 추가됐으나 실제 INSERT 경로에서 누락 → 라운드 12 코덱스가 "컬럼은 있는데 값이 NULL만 적재" critical로 지목.

라운드 12 fix 후:
- `src/lib/supabase.js` ALLOWED_V2_COLUMNS에 `own_score` 포함 → PATCH allowlist 통과
- `src/App.jsx` 라인 884·959 dbRows에 `own_score:ownScore` 추가 → file_upload INSERT 시 적재
- 신규 INSERT/backfill row는 own_score 컬럼이 실제 ownScore 값으로 채워짐
- matched row (1,640건)는 NULL 유지 (A안 INSERT-only 정책 보호)
- pending row의 score 변경 → `(p.own_score ?? 20) !== ownScore` 가드로 자동 재계산 트리거

### Fix #2: m25 era_v2 필터 적용 결과 (5 row 정정 갱신)

| at | 라운드 12 직후 (m25 전) | m25 적용 후 | 변동 |
|---|---|---|---|
| 지자체 (at-level) | -1.73 / +1.50 | **-2.08 / +1.58** | min -0.35, max +0.08 (legacy 혼입 제거 효과) |
| 군시설 (at-level) | -1.29 / +1.38 | **-1.21 / +1.16** | 둘 다 좁아짐 (current 정합) |
| 한전 (at-level) | -1.38 / +1.27 | **-1.49 / +1.23** | min -0.11 (legacy 제거 후 분포 재확립) |

5 row 정정 = G-도메인 #0 era_v2 정합 회복 효과.

### Fix #3: m24 DROP 안전성

m24 RPC가 반환 타입에 `adj_range_min/max` 추가 → CREATE OR REPLACE 불가. SQL 파일에 `DROP FUNCTION IF EXISTS` 명시. 재배포 시 PostgreSQL 에러로 차단되던 결함 해소.

---

## 4. 라운드 12 평가 항목별 변화 예상

라운드 12 composite 8.0/10. 항목별 세부 점수는 코덱스 평가 보고서에 명시 안 됐으나, critical 3건의 성격으로 미루어 다음과 같이 추정:

| 항목 (가중치) | 라운드 11 점수 | 라운드 12 변화 (추정) | 라운드 13 변화 예상 |
|---|---|---|---|
| 도메인 정확성 (30%) | 8.9 | m25 미적용 → era_v2 정합 결함으로 하락 | m25 적용으로 **회복 + 상승** (5 row 정정 효과) |
| 안전성 (25%) | 8.6 | m24 재배포 차단 결함으로 하락 | m24 DROP으로 **회복** |
| 측정 일관성 (20%) | 8.0 | own_score NULL만 적재 → measured-value drift 부활 (가장 큰 감점 추정) | own_score 실제 적재로 **회복 + 상승 강함** |
| 코드-문서 정합성 (15%) | 8.7 | 라운드 12 BRIEF·문서 변경 없음, 코드만 결함 | 유지 |
| KPI 신뢰도 (10%) | 8.2 | own_score + era_v2 동시 결함 → 가장 큰 회의 발생 | own_score 적재 + era_v2 정합 동시 회복으로 **상승** |

→ 라운드 13에서 라운드 11 수준(8.6/10) 회복 + α 가능성. 단 critical을 한 차례 놓친 안전성 평가에 코덱스가 어떤 가중치를 둘지는 미지수.

---

## 5. V2 마스터플랜 §9 종료 조건 진척

- ✅ n≥500: 라운드 12 시점 누적 1,127건 (라운드 13 시점 자동 누적, 정확 수치는 DB 쿼리 필요)
- ❌ 4주 연속 PASS: 라운드 12 시점 ~2주 누적, **~2주 더 필요**
- V6 retire ETA: ~4주 (라운드 12 대비 변경 없음, 자연 진행)

cron 4개 모두 active (B5 m12, m13, m14, m15) — 라운드 12 fix 이후 own_score 실제 적재가 시작됐으므로 다음 calibration cycle부터 측정값에 자사 점수 반영.

---

## 6. V2_DOMAIN_RULES_CHECK 진척

- ✅ 8/9 close (#0 era_v2 — m25로 G-도메인 정합 회복 완료)
- ⚠ 잔여: #2 ba_seg → ep (Phase 3, 별도 세션 권고. 라운드 12 BRIEF §6 그대로)

---

## 7. 평가 항목 (라운드 12 동일 가중치)

1. 도메인 정확성 — 30%
2. 안전성 — 25%
3. 측정 일관성 — 20%
4. 코드-문서 정합성 — 15%
5. KPI 신뢰도 — 10%

추가 권고 받을 항목:
- m23 cron 자동화 우선순위 (라운드 12 BRIEF에서 미해결)
- m25 효과 측정 후 calibration_gap 변화 폭 (own_score 적재 + era_v2 정합 동시 작용)
- Phase 3 #2 ba_seg → ep 진입 시점
- V6 retire 종료 조건 4주 연속 PASS 누적 가속화 방안
- 다음 세션 권고 3 actions

---

## 8. 단일 진실 문서

- `docs/v2/HANDOFF_V2_MASTER_PLAN.md`
- `docs/v2/HANDOFF_NEXT_SESSION.md`
- `docs/v2/CODEX_ROUND_8/9/10/11/12_BRIEF.md` + 본 문서
- `docs/v2/migrations/m22_alter_bid_predictions_add_own_score.sql`
- `docs/v2/migrations/m23_create_refresh_agency_adj_range.sql`
- `docs/v2/migrations/m24_extend_lookup_agency_mode_with_adj_range.sql`
- `docs/v2/migrations/m25_fix_refresh_agency_adj_range_era_v2.sql`

---

_의뢰자: Claude Opus 4.7 / 의뢰 일자: 2026-05-21 (라운드 12 fix `a12000e` 머지 후)_
