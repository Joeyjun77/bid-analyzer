# 코덱스 라운드 16 사전 후속 — B+C+D 묶음 적용 (2026-05-22)

## 1. 배경
오늘 9 commit 적용 후 `/accuracy` 9체크 + 코덱스 검증 의뢰. 코덱스 라운드 15+ 평가에서 4개 평가(§1~§4) + 추가 맹점(§5) 도출. 그중 **Evaluator 분류** 3개(B/C/D)를 묶어 즉시 적용. **Generator 분류** 1개(A — WIN_OPT_GAP 동적화)는 다음 세션에서 predict-architect 사전 검토 후 진행.

## 2. 코덱스 평가 요약

| § | 판정 | 권고 |
|---|---|---|
| §1 9 commit 우선순위 | 합리적 | jobid 14/15/16 영향 건수 일별 모니터링 |
| §2 m32 종결 | 합리적 | (pn_no, ag, od, ba, 공고연도) 충돌 리포트 관측만 |
| §3 MAE-승률 미스매치 | 보완 필요 | **WIN_OPT_GAP 동적화 1순위** → TYPE_OFF → agency_predictor 재학습 |
| §4 고양시 +1.05 bias | 보완 필요 | shadow 관측만, n≥10 + bias≥+0.7 후 승격 |
| §5 분해 지표 부족 | 보완 필요 | at × mode × strategy별 floor_pass / win_zone / top1_hit / sample_n 고정 출력 |

## 3. 적용된 작업 (B/C/D)

### 3.1 D — cron 건강 view (`v_cron_health`)
- 마이그레이션: `d_cron_health_view`
- jobid 1·2·4·7·8·10·11·12·13·14·15·16 모두 포함
- 7일 success_pct, avg_duration_sec, last_run_at 집계
- 첫 측정: jobid 14 (`match-pending-predictions-hourly`) 1회 실행, 성공 100%, duration 40.91초

### 3.2 C — 고양시 shadow bias view (`v_shadow_bias_goyang`)
- 마이그레이션: `c_goyang_shadow_bias_view`
- canonical_ag 4개 (경기도 고양시·일산서구청·일산동구청·덕양구) 90일 윈도우 + overall GROUPING SETS
- `promotion_status`: eligible (n≥10 + bias≥+0.7) / watch (n≥10 + bias≥+0.5) / insufficient_or_low_bias
- **즉시 발견된 인사이트**: 30일 윈도우(체크 3) vs 90일 윈도우 bias **부호 반전**

| 윈도우 | n | bias |
|---|---|---|
| 30일 (체크 3) | 4 | **+1.0491** (양) |
| 90일 (shadow view) | 8 | **-0.3857** (음) |

→ 코덱스 §4 경고가 정확히 검증됨. n=4 단방향 +1.05를 production 보정으로 넣으면 실제 분포와 정반대 방향 적용 위험.

### 3.3 B — `/accuracy` 리포트 12체크로 확장
- `.claude/commands/accuracy.md` 편집
- 신설: 체크 10 (at × route별 mae/hit/floor_safe 분해), 체크 11 (`v_shadow_bias_goyang` 출력), 체크 12 (`v_cron_health` 출력)
- 리포트 포맷 §10/11/12 추가
- 첫 줄 "6개 체크" → "12개 체크" 정정

## 4. 보류 작업 (다음 세션)

### 4.1 A — WIN_OPT_GAP 동적화 (코덱스 §3 권고 1순위)
- 본질 fix: MAE는 양호한데 지자체/군시설/교육청 Top-1 hit 1~9% 미스매치
- 원인: MAE 모델이 "평균 사정률" 최적화 ≠ "낙찰 1순위 위치" 최적화
- 우선순위: WIN_OPT_GAP 동적화 → TYPE_OFF 동적화 → agency_predictor 재학습 순
- **Generator 변경**: `src/lib/utils.js` WIN_OPT_GAP 상수 또는 `getFinalRecommendation` 영향
- 필수 절차: predict-architect 사전 호출 + /evaluate 검증 + deploy-gate

### 4.2 §2 충돌 후보 키 리포트 (코덱스 §2 권고)
- (pn_no, canonical_ag, od, ba, 공고연도) 후보 키의 충돌 후보만 관측
- 우선순위 낮음 — 2~4주 후 패턴 누적 시 결정

## 5. Phase 23-3 게이트
| 게이트 | 결과 |
|---|---|
| Generator 분류? | **No** (B/C/D 모두 Evaluator) |
| Evaluator 분류 | **Yes** (관측·진단·리포트 강화) |
| /evaluate 면제 | **Yes** |
| predict-architect 면제 | **Yes** |
| deploy-gate | 면제 (코드 변경 1건 — `.claude/commands/accuracy.md` 문서) |

## 6. 다음 단계
1. **다음 세션 진입점**: A (WIN_OPT_GAP 동적화) — predict-architect 사전 검토 → 본 작업
2. 2026-05-25(월) 01:00 UTC canonical 첫 weekly gate 결과 → 라운드 16 BRIEF 작성 권고
3. 1주 후 shadow_bias_goyang 재측정 (4주 누적 후 promotion_status 재평가)
4. v_cron_health 일별 점검 — jobid 15·16 첫 실행(5/24 일 + 5/22 19:30) 후 success_pct 확인

---
_처리자: Claude Opus 4.7 / 처리 일자: 2026-05-22 / 후속: A (WIN_OPT_GAP 동적화) 다음 세션_
