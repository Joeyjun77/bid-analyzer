# Codex Round 14 검증 의뢰문

> 작성일: 2026-05-21 (라운드 13 fix `8793b4e`+ HANDOFF §9 `d2a3361` 머지 직후)
> 직전 라운드: 13 (composite 8.5/10, 라운드 12 8.0에서 +0.5 회복)
> 평가 대상: **라운드 13 권고 3 actions 수용 효과 전부**
>   - 권고 #1: m25 적용 실행문 추가 (`8793b4e`)
>   - 권고 #2: m25 주석 정정 — `bid_details d` → `bid_records r` (`8793b4e`)
>   - 권고 #3: V6 retire 문서 정리 + DB 기반 n·PASS 연속·gate date 기록 (`8793b4e` BRIEF minor #1 + `d2a3361` HANDOFF §9 신규)

---

## 1. 평가 의뢰 핵심 질문

1. **라운드 13 권고 3 actions 전부 수용 효과** (8.5 → ?)
2. **m25 적용 실행문 추가로 SQL 재현성·재배포 안전성이 회복됐는가?** (라운드 13 major #1)
3. **m25 주석 정합 회복으로 코드-문서 정합성이 회복됐는가?** (라운드 13 major #2 — 라운드 13에서 8.7 → 8.2로 가장 큰 감점 받은 항목)
4. **HANDOFF §9 신규 80줄로 KPI 신뢰도·문서 정합성이 회복됐는가?** (DB 실측 수치 영구 기록)
5. **라운드 15 BRIEF 트리거 조건** — 시간 누적 vs 의미 있는 fix commit 중 어느 시점이 적절한가?
6. **남은 잔여 #2 (ba_seg → ep) 진입 시점** — 4주 PASS 완성 전 vs 후?

---

## 2. 라운드 13 → 14 사이 commit 시퀀스

| commit | 종류 | 내용 |
|---|---|---|
| `8793b4e` | fix | **라운드 13 권고 3 actions major 2건 + BRIEF minor 1건 수용** — (1) `m25_fix_refresh_agency_adj_range_era_v2.sql` 끝에 `SELECT refresh_agency_adj_range(20) AS rows_updated;` 추가 + 5 row 정정 결과 로그 주석, (2) m25 주석 line 7 `bid_details d JOIN ... d.era_v2` → `bid_records r LEFT JOIN ... r.era_v2` 정정, (3) `CODEX_ROUND_13_BRIEF.md` V6 retire ETA `~4주` → `~2주` (4주 PASS 완성 시점) |
| `d2a3361` | docs | **HANDOFF §9 신규 80줄** — (1) 헤더 갱신 (마지막 commit `3bd365f` → `8793b4e`, 다음 재개 정의), (2) §9.1 라운드 8~13 composite 점수 추이 표, (3) §9.2 DB 실측 수치 (matched 1,660 / own_score_filled 532 / m25 5 row 검증), (4) §9.3 V2 §9 종료 조건 진척 표, (5) §9.4 잔여 작업 4건, (6) §9.5 라운드 13 minor 6항목 결산 |

라운드 13 → 14 사이 변경량은 작지만(~88 줄 추가), 모두 코드-문서 정합성·KPI 신뢰도 항목에 직접 영향. 본 라운드 14 BRIEF는 평가 대상의 양이 아니라 **권고 수용 정확도**를 검증한다.

---

## 3. 변경 정량 영향

### 권고 #1: m25 적용 실행문 추가 (재현성 회복)

라운드 13 코덱스가 지적: "m23에는 `SELECT refresh_agency_adj_range(20)` 실행문이 있으나 m25에는 없음. '5 row 정정 갱신'은 DB 적용 로그 없이 파일만으로 확인 불가."

라운드 13 fix 후 (`8793b4e`):
- `m25_fix_refresh_agency_adj_range_era_v2.sql:91~95` 끝에 추가:
  ```sql
  -- m25 적용: era_v2 필터로 정합 회복 (라운드 12 critical #2, 라운드 13 코덱스 major #1 권고 수용)
  -- 1회 실행 결과(2026-05-21): 5 row 정정 갱신 (지자체 at -1.73→-2.08/+1.50→+1.58,
  --   군시설 at -1.29→-1.21/+1.38→+1.16, 한전 at -1.38→-1.49/+1.27→+1.23)
  SELECT refresh_agency_adj_range(20) AS rows_updated;
  ```
- m23 패턴과 동일 (재배포 시 함수 재정의 + 즉시 갱신 한 번에)
- 5 row 정정 결과를 SQL 파일 자체에 영구 보관

### 권고 #2: m25 주석 정합 회복

라운드 13 코덱스가 지적: "주석은 `bid_details d` 기준이라 쓰고, 실제 SQL은 `bid_records r` 조인 (불일치)."

라운드 13 fix 후 (`8793b4e`):
- `m25_fix_refresh_agency_adj_range_era_v2.sql:7` 정정:
  ```sql
  -- 정정 (이전):
  --   - bid_predictions JOIN bid_details d ON ... + d.era_v2='current' 필터 추가
  -- 정정 (이후):
  --   - bid_predictions LEFT JOIN bid_records r ON r.id=matched_record_id + r.era_v2='current' 필터 추가
  ```
- 실제 SQL line 32: `LEFT JOIN bid_records r ON r.id = p.matched_record_id` (line 68도 동일)
- 주석과 SQL 정합 100% 회복

### 권고 #3: V6 retire 문서 ETA 통일 + DB 기반 실측 수치 영구 기록

라운드 13 코덱스가 지적 (minor #1): "라운드 13 BRIEF에서 V6 retire ETA가 '~2주'(line 80)와 '~4주'(line 81)로 병존, 정리 필요."

라운드 13 fix 후 (`8793b4e` BRIEF + `d2a3361` HANDOFF §9):
- `CODEX_ROUND_13_BRIEF.md:81` 정정: `~4주 (라운드 12 대비 변경 없음)` → `~2주 (4주 PASS 완성 시점, 라운드 12 대비 단축 — 시간 자연 누적분 반영)`
- `HANDOFF_NEXT_SESSION.md` §9 신규 80줄 — 라운드 9~13 진행 + DB 실측 수치 영구 기록:

**DB 실측 수치 (HANDOFF §9.2, 2026-05-21 조회)**:
| 항목 | 값 | 의미 |
|---|---|---|
| matched_total | 1,660건 | 라운드 12 BRIEF 1,127건 대비 자연 누적 |
| matched (file_upload) | 1,394건 | |
| matched + actual IS NOT NULL | 1,360건 | |
| **own_score IS NOT NULL** | **532건** | **라운드 12 critical "NULL만 적재" 완전 해소 검증** |
| total predictions | 2,252건 | |

**Mode B Weekly Gate (HANDOFF §9.2)**:
- 2026-05-19 주: _overall_ pass (n=300, rate=0.9600, gap=0.0102)
- 2026-05-18 주: _overall_ pass (n=307, rate=0.9511, gap=0.0011)
- **연속 PASS 2주 누적** (4주 연속 PASS까지 ~2주, 다음 gate 5/26)

**Mode A Weekly Gate (HANDOFF §9.2)**:
- 2026-05-18 주 군시설: WARN (pct_in_win_zone=0.1242, 목표 0.15, gap_p90=0.8096)

**agency_mode_lookup m25 5 row 정정 검증 (HANDOFF §9.2)**:
- 군시설/한전/지자체 at-level 갱신 (BRIEF 명시 값과 정확히 일치)
- 교육청 at-level min 갱신 (-1.60 → -1.70)
- 합산 5 row = BRIEF의 "5 row 정정" 검증 완료

### 라운드 13 minor #2 (m24 score_components) 처리

라운드 13 코덱스가 지적: "사용자 의뢰의 m24 score_components 컬럼 DROP은 m22~m25, App.jsx, supabase.js 어디에서도 실사용 참조가 검색되지 않음 — 확인 불가."

라운드 13 fix 후 (HANDOFF §9.5):
- 코드 전체 Grep + DB 컬럼 조회 모두 0건 → **코덱스 추측 항목 무효 확정**
- HANDOFF §9.5에 명시: "코드·DB 어디에도 없음, 코덱스 추측 항목"

이는 코덱스가 라운드 12 BRIEF·a12000e commit body에서 m24 변경을 score_components 관련으로 추정한 결과로 보임. 실제로는 m24는 `lookup_agency_mode` 시그니처 변경(adj_range_min/max 반환 컬럼 추가)일 뿐 score_components와 무관.

---

## 4. 라운드 13 평가 항목별 변화 예상

라운드 13 항목별 점수 (composite 8.5):

| 항목 (가중치) | 라운드 13 점수 | 라운드 14 변화 예상 |
|---|---|---|
| 도메인 정확성 (30%) | 8.6 | 유지 또는 미세 상승 (m25 주석 정합 — 도메인 정의 정확성 회복) |
| 안전성 (25%) | 8.7 | 유지 (m24 DROP 이미 안전, 추가 안전성 보강 없음) |
| 측정 일관성 (20%) | 8.6 | 유지 또는 미세 상승 (m25 실행문 추가로 재현 가능성 회복) |
| 코드-문서 정합성 (15%) | 8.2 | **상승 강함** — 라운드 13 가장 큰 감점 항목. 주석 정합 회복 + HANDOFF §9 DB 실측 영구 기록 |
| KPI 신뢰도 (10%) | 8.3 | **상승** — DB 실측 수치(matched 1,660 / own_score 532 / PASS 2주) 명시로 검증 가능성 회복 |

→ composite 8.5 → **8.6~8.7 회복 예상**. 단 변경량이 작아 코덱스가 "권고 수용 정확도"를 어떻게 평가할지 미지수.

---

## 5. V2 마스터플랜 §9 종료 조건 진척 (DB 실측 기반)

| 조건 | 상태 | 비고 |
|---|---|---|
| n≥500 | ✅ 충족 | matched 1,660 / matched+actual 1,360 |
| 4주 연속 PASS | ❌ 2주 누적 | 5/18·5/19 PASS, ~2주 더 (5/26·6/2 PASS 시 충족) |
| Mode B 통과율 ≥90% | ✅ | 5/19 0.9600, 5/18 0.9511 |
| calibration gap ≤5pp | ✅ | _overall_ 0.0102 (5/19), 0.0011 (5/18) |
| Mode A WIN-zone ≥15% | ❌ WARN | 5/18 0.1242 (군시설, mixed 데이터 영향) |

**V6 retire ETA**: ~2주 (4주 PASS 완성 시점). Mode A는 retire 조건이 아니므로 V6 retire 자체에는 영향 없음.

라운드 12 BRIEF 시점 추정 1,127건 → 라운드 14 BRIEF 시점 실측 1,660건. 자연 누적 시계열 진행 중.

---

## 6. V2_DOMAIN_RULES_CHECK 진척

- ✅ 8/9 close
- ⚠ 잔여: #2 ba_seg → ep (Phase 3, 별도 세션 권고. 라운드 13 BRIEF §6 그대로)

라운드 14에서 #2 진입 시점에 대한 권고를 요청한다 (§1 핵심 질문 #6).

---

## 7. 평가 항목 (라운드 13 동일 가중치)

1. 도메인 정확성 — 30%
2. 안전성 — 25%
3. 측정 일관성 — 20%
4. 코드-문서 정합성 — 15%
5. KPI 신뢰도 — 10%

추가 권고 받을 항목:
- 라운드 13 권고 수용 정확도 (3 actions 전부 수용했는가)
- m24 score_components 추측 항목 처리 적절성 (HANDOFF §9.5 "무효 확정" 판정에 동의하는가)
- 라운드 15 BRIEF 트리거 조건 (변경량·시간·의미 어느 기준)
- Phase 3 #2 진입 시점 (4주 PASS 완성 전 vs 후)
- V6 retire 종료 후 단계 (V6 코드 삭제·문서 정리 시퀀스)
- 다음 세션 권고 3 actions

---

## 8. 단일 진실 문서

- `docs/v2/HANDOFF_V2_MASTER_PLAN.md`
- `docs/v2/HANDOFF_NEXT_SESSION.md` (§9 신규 80줄 포함, `d2a3361`)
- `docs/v2/CODEX_ROUND_8/9/10/11/12/13_BRIEF.md` + 본 문서
- `docs/v2/migrations/m22_alter_bid_predictions_add_own_score.sql`
- `docs/v2/migrations/m23_create_refresh_agency_adj_range.sql`
- `docs/v2/migrations/m24_extend_lookup_agency_mode_with_adj_range.sql`
- `docs/v2/migrations/m25_fix_refresh_agency_adj_range_era_v2.sql` (라운드 13 fix `8793b4e` 반영)

---

_의뢰자: Claude Opus 4.7 / 의뢰 일자: 2026-05-21 (라운드 13 fix `8793b4e` + HANDOFF §9 `d2a3361` 머지 후)_
