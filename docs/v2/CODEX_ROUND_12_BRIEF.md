# Codex Round 12 검증 의뢰문

> 작성일: 2026-05-21 (라운드 11로부터 ~3시간 후)
> 직전 라운드: 11 (composite 8.6/10, KPI 신뢰도 8.2)
> 평가 대상: **라운드 11 권고 3개 (own_score + invalidation + m21 operational) 전부 수용 효과**

---

## 1. 평가 의뢰 핵심 질문

1. **라운드 11 권고 3개 전부 수용 효과** (8.6 → ?)
2. **own_score 컬럼 + invalidation으로 measured-value drift 문제 완전 해소됐는가?**
3. **m21 operational화가 실효적 효과를 내는가** (grid 좁힌 LH/한전 영역)?
4. **남은 잔여 #2 (ba_seg → ep) 작업 우선순위 및 V6 retire 종료 조건 ETA 변경?**

---

## 2. 라운드 11 → 12 사이 commit 시퀀스

| commit | 종류 | 내용 |
|---|---|---|
| `a8e18fe` | feat | **own_score + invalidation (권고 #1·#2)** — m22 컬럼 추가, App.jsx ref `false→null|scoreSnap` 전환, NULL≡20 동치 규칙으로 matched row 보호, updates push에 own_score 함께 적재 |
| `4744b93` | feat | **m21 operational 완성 (권고 #3)** — m23 메타산출 함수 (13 row 갱신, LH ±0.96, 한전 ±1.38, 군시설 ±1.38 등), m24 lookup_agency_mode RPC 확장, recommendV2에 클램프 추가 (Math.min(1.5, max(|min|,|max|))) |

---

## 3. 변경 정량 영향

### m23 실측 분위수 적재 결과 (n≥20)
| at | p01 | p99 | 갱신 row |
|---|---|---|---|
| LH | -0.87 | +0.96 | 1 (가장 좁음) |
| 한전 | -1.38 | +1.27 | 3 |
| 군시설 | -1.29 | +1.38 | 2 (제7군단 포함) |
| 지자체 | -1.73 | +1.50 | 4 |
| 교육청 | -1.60 | +1.37 | 1 |
| 조달청 | -1.22 | +1.50 | 2 |
| 수자원공사 | -1.52 | +1.27 | (1, n=21) |

나머지 12 row n<20 디폴트 ±3.0 유지.

### recommendV2 grid 클램프 효과 추정
- LH: ±1.5 → ±0.96 (35% 축소) — 가장 큰 효과
- 한전: ±1.5 → ±1.38 (8% 축소)
- 지자체: ±1.5 → ±1.5 유지 (메타가 ±1.50)
- 군시설 Mode A: grid 미사용 (recommendModeA gap 분포 기반)
- 디폴트 ±3.0 발주처: 메타가 넓어 클램프 작동 안함 (±1.5 유지)

### own_score 적재
- 신규 INSERT/backfill 시 own_score=ownScore 함께 기록
- matched 1,640건은 NULL 유지 (legacy/A안 보호)
- pending row가 score 변경 시 자동 재계산 (`(p.own_score ?? 20) !== ownScore`)

---

## 4. 라운드 11 평가 항목별 변화 예상

| 라운드 11 항목 | 점수 | 라운드 12 변화 |
|---|---|---|
| 도메인 정확성 (30%) | 8.9 | m21 operational화 → 상승 예상 |
| **안전성 (25%)** | 8.6 | own_score + invalidation으로 stale 위험 추가 해소 → 상승 |
| **측정 일관성 (20%)** | 8.0 | own_score 컬럼 도입으로 적재 시점 추적 가능 → **상승 강함** |
| 코드-문서 정합성 (15%) | 8.7 | 유지 |
| **KPI 신뢰도 (10%)** | 8.2 | own_score 도입 + drift 차단 → 상승 |

---

## 5. V2 마스터플랜 §9 종료 조건 진척

- ✅ n≥500: 누적 1,127건
- ❌ 4주 연속 PASS: ~2주 누적 (5/18~5/19), **~4주 더 필요** (자연 진행)
- V6 retire ETA: 변경 없음 (~4주)

---

## 6. V2_DOMAIN_RULES_CHECK 진척

- ✅ 8/9 close
- ⚠ 잔여: #2 ba_seg → ep (Phase 3, 별도 세션)

---

## 7. 평가 항목 (라운드 11 동일 가중치)

1. 도메인 정확성 — 30%
2. 안전성 — 25%
3. 측정 일관성 — 20%
4. 코드-문서 정합성 — 15%
5. KPI 신뢰도 — 10%

추가 권고 받을 항목:
- m23 cron 자동화 우선순위
- Phase 3 #2 ba_seg → ep 진입 시점
- 다음 세션 권고 3 actions

---

## 8. 단일 진실 문서

- `docs/v2/HANDOFF_NEXT_SESSION.md`
- `docs/v2/CODEX_ROUND_8/9/10/11_BRIEF.md` + 본 문서
- `docs/v2/migrations/m22_alter_bid_predictions_add_own_score.sql`
- `docs/v2/migrations/m23_create_refresh_agency_adj_range.sql`
- `docs/v2/migrations/m24_extend_lookup_agency_mode_with_adj_range.sql`

---

_의뢰자: Claude Opus 4.7 / 의뢰 일자: 2026-05-21 (라운드 11로부터 ~3시간 후)_
