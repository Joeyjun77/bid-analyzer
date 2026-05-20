# Codex Round 8 검증 의뢰문

> 작성일: 2026-05-21
> 직전 라운드: 6 (8.9/10) + 도메인 8.5/10
> 평가 대상: V2 Phase 1 (도메인 규칙 정정 5단계) + 2026-05-21 발견 사항 2건

---

## 1. 평가 의뢰 핵심 질문

1. **Phase 1 5단계가 V2 안전성을 얼마나 끌어올렸는가?** (정량 점수: 도메인 8.5 → ? / 종합 8.9 → ?)
2. **m20(공동도급 제외) 효과 = 0건이라는 발견이 m20 마이그레이션의 정당성에 영향을 주는가?**
3. **B3 보류 정책 vs 실제 코드 동작 불일치가 V2 마스터플랜의 무결성을 깨뜨리는가?**

---

## 2. 변경 사항 — Phase 1 (m17~m20 + G-도메인 게이트)

| Migration | 내용 | 적용일 |
|---|---|---|
| m17 | `era_v2` 컬럼 추가 (bid_records legacy 50,632 / current 13,045) | 2026-05-19 |
| m18 | `agency_gap_distribution` 'mixed' 마킹 + current 재적재 | 2026-05-19 |
| m19 | `lookup_gap_distribution` RPC era_v2='current' 필터 | 2026-05-19 |
| m20 | refresh_floor_pass_daily 공동도급 제외 (`is_joint_contract != true`) | 2026-05-19 |
| G-도메인 | `.claude/commands/evaluate.md` §10 5번째 게이트 신설 | 2026-05-19 |

도메인 근거: 낙찰하한율 두 차례 개정 (2025-07-01, 2026-01-30) — legacy/current 혼입 표본은 median_gap 260배 차이 발생.

---

## 3. 2026-05-21 발견 사항

### 3.1 m20 효과 = 0건

```
b_pred_mode='B' 30일 윈도우 표본:
  n_excl_joint = 133
  n_incl_joint = 133
  n_joint_only = 0    ← 공동도급 표본 0건
```

**m20은 미래 안전장치로 정착했으나 현 표본에 변화 없음.** 이게 m20의 정당성을 약화시키는가? 강화시키는가?

### 3.2 floor_pass_daily 비교 (v2_modeB_real vs v2_modeB_post_m20)

| at | n_real / pass_real / gap_real | n_post / pass_post / gap_post |
|---|---|---|
| 전체 | 300 / 96.00% / 0.0102 | 133 / 96.99% / 0.0201 |
| 지자체 | 209 / 94.74% / 0.0024 | 93 / 95.70% / 0.0072 |
| 한전 | 56 / 98.21% / 0.0321 | 24 / 100.00% / 0.0500 |
| 교육청 | 12 / 100% / - | 7 / 100% / - |
| 조달청 | 10 / 100% / - | 3 / 100% / - |
| LH | 10 / 100% / - | 6 / 100% / - |
| 수자원공사 | 3 / 100% / - | (n<3, HAVING 컷) |

표본 일률 -56% (window 차이 + cron 1회 적재 패턴 때문). 모든 발주사 PASS 유지.

### 3.3 B3 보류 vs 실제 동작 불일치

핸드오프 §6: "current AG grain 0건 → B3 사실상 보류, 종형 fallback 동작"

실제 `agency_gap_distribution` 군시설 era 분포:
- `current` AT 1행, n=31  ← lookup_gap_distribution 반환
- `mixed` AG 5행, `mixed` AG_BA 6행, `mixed` AT 1행 (n=186) — 모두 current 필터 제외

`recommendV2` 코드 (src/lib/utils.js:1054):
```js
if (gapDist && gapDist.n >= 5 && gapDist.gap_p25 != null) {
  const result = recommendModeA(gapDist, { strategy: 'balanced' });
  // ...
}
```

n=31, gap_p25=0.0013 (둘 다 충족) → **종형 fallback이 아니라 컨볼루션 정상 가동**. 핸드오프 표현이 부정확.

### 3.4 win_zone_daily 군시설 어제→오늘

| 측정일 | n | pct_in_win_zone | median_gap |
|---|---|---|---|
| 2026-05-19 (mixed) | 153 | 12.42% | 0.0053 |
| 2026-05-20 (current) | 60 | 10.00% | 0.4245 |

median_gap이 80배 증가 — era filter로 표본 성격이 완전히 달라짐.

---

## 4. 의뢰 평가 항목 (가중치 권장)

1. 도메인 정확성 (era 분리·공동도급 제외·게이트 신설) — 30%
2. 안전성 (Mode B PASS 유지, Mode A 게이트 WARN 유지) — 25%
3. 측정 일관성 (cron 자동화, model_version 분리) — 20%
4. 코드-문서 정합성 (B3 불일치 같은 표현 정확성) — 15%
5. KPI 신뢰도 (n=31 컨볼루션이 충분한가) — 10%

---

## 5. 단일 진실 문서

- `docs/v2/HANDOFF_V2_MASTER_PLAN.md`
- `docs/v2/V2_DOMAIN_RULES_CHECK.md`
- `docs/v2/HANDOFF_NEXT_SESSION.md` (어제 종료 시점)
- 본 문서 (`docs/v2/CODEX_ROUND_8_BRIEF.md`)

---

_의뢰자: Claude Opus 4.7 / 의뢰 일자: 2026-05-21_
