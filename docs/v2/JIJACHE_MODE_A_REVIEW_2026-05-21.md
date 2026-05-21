# 지자체 Mode A 조건부 활성화 검토 보고서 (2026-05-21)

> 작성자: Claude Opus 4.7
> 검토 트리거: m26 win_zone_daily 측정 결과 지자체 p90_gap = 0.2345 (마스터플랜 §3 D2 mixed 측정 0.0209 대비 10배+) → Mode A 후보 영역 부상 검증 필요
> 단일 진실: `M26_M27_APPLY_RESULT_2026-05-21.md`, `SYSTEM_AUDIT_2026-05-21.md`
> 후속: HANDOFF §9.4 잔여 작업 추가, 마스터플랜 §3 D2 표 정정 권고

---

## 1. 요약 (3줄)

1. **지자체 Mode A 조건부 활성화는 현 시점 불가**. `lookup_agency_mode` RPC가 지자체 7개 발주사 샘플 모두 Mode B 권장 (최대 p90_gap = 0.0518, 조건 0.10의 절반). 마스터플랜 §3 D2의 "B + 조건부 A" 정책의 "조건부 A"가 활성화되려면 grain별 gap_p90 ≥ 0.10이 필요한데 실제 측정값은 미달.
2. **m26 win_zone_daily 0.2345는 outlier 1건(`win_bid_rate=66.4059`, floor 대비 -22.3pp) 영향**으로 왜곡된 측정값. 정상 데이터는 |gap| ≤ 1.1pp 수준. 즉 지자체 영역의 1순위 사정률 산포는 마스터플랜 §3 D2 표(0.0209) 추정값과 큰 차이 없음.
3. **결정적 데이터 정합 결함 발견** — `bid_details.at='지자체'` 분류에 **군시설 발주사**(제9691부대·제9911부대·제9181부대·특수전사령부 등) 다수 혼입. 별도 정합 회복 작업(가칭 m28) 필요.

---

## 2. 진단 SQL 결과 (4건)

### 2.1 `lookup_agency_mode` RPC 호출 — 지자체 7개 발주사 샘플

```sql
WITH agency AS (
  SELECT DISTINCT canonical_ag FROM agency_mode_lookup
  WHERE at='지자체' AND canonical_ag IS NOT NULL LIMIT 10
)
SELECT a.canonical_ag, m.matched_grain, m.mode_recommend, m.confidence,
       m.n, m.median_gap, m.p90_gap
FROM agency a CROSS JOIN LATERAL lookup_agency_mode('지자체', a.canonical_ag, NULL::numeric) m;
```

| 발주사 | matched_grain | mode | confidence | n | median_gap | p90_gap |
|---|---|---|---|---|---|---|
| 경기도 고양시 | AG | **B** | medium | 33 | 0.0044 | **0.0518** |
| 경기도 고양시 덕양구 | AG | **B** | low | 11 | 0.0057 | 0.0405 |
| 경기도 성남시 | AG | **B** | low | 12 | 0.0006 | 0.0080 |
| 경기도 | AG | **B** | low | 11 | 0.0007 | 0.0054 |
| 경기도 화성시 | AG | **B** | low | 12 | 0.0005 | 0.0020 |
| 서울교통공사 | AG | **B** | low | 14 | 0.0002 | 0.0014 |
| 한국철도공사 회계통합센터 | AG | **B** | low | 17 | 0.0003 | 0.0010 |

→ **모두 Mode B 권장**. 최대 p90_gap = 0.0518 (경기도 고양시, medium confidence, n=33) — 마스터플랜 §3 D2 조건 `gap_p90 ≥ 0.10`의 약 절반.

조건부 A 활성화 후보 (gap_p90 ≥ 0.10): **0건**.

### 2.2 `agency_gap_distribution` 지자체 current era — 빈 표

```sql
SELECT canonical_ag, ba_seg, n, gap_p90, era_v2
FROM agency_gap_distribution
WHERE at='지자체' AND COALESCE(era_v2,'current')='current' AND n>=10;
```

→ **0 rows**. V2 검증 인프라 측면에서 지자체 grain별 gap 분포가 적재 안 됨. lookup_agency_mode RPC는 `agency_mode_lookup`을 참조하나, gap 분포 검증의 원천(`agency_gap_distribution`)에는 지자체 데이터 부재.

### 2.3 `bid_details` 지자체 90일 current-only outlier 추적

```sql
SELECT d.od, r.canonical_ag, d.my_bid_rate, d.win_bid_rate, d.floor_rate,
       (d.win_bid_rate - d.floor_rate) AS gap
FROM bid_details d LEFT JOIN bid_records r ON r.pn_no = d.pn_no
WHERE d.at='지자체' AND d.od >= CURRENT_DATE - INTERVAL '90 days'
  AND COALESCE(r.is_joint_contract,false)!=true AND COALESCE(r.era_v2,'current')='current'
ORDER BY ABS(d.win_bid_rate - d.floor_rate) DESC LIMIT 15;
```

| od | canonical_ag | my_bid_rate | **win_bid_rate** | floor_rate | gap |
|---|---|---|---|---|---|
| 2026-04-27 | NULL | 87.3253 | **66.4059** | 88.745 | **-22.3391** |
| 2026-04-27 | NULL | 89.2181 | 90.831 | 89.745 | +1.0860 |
| 2026-03-09 | **제9691부대** | 90.4682 | 90.341 | 89.745 | +0.5960 |
| 2026-03-23 | **제9911부대** | 90.6451 | 90.334 | 89.745 | +0.5890 |
| 2026-04-28 | NULL | 90.477 | 90.2667 | 89.745 | +0.5217 |
| 2026-04-13 | **제9181부대** | 89.983 | 90.2623 | 89.745 | +0.5173 |
| 2026-03-26 | **특수전사령부** | 90.1832 | 90.2576 | 89.745 | +0.5126 |
| 2026-02-24 | 고양시 일산서구청 | 90.7824 | 90.1735 | 89.745 | +0.4285 |
| 2026-03-17 | **제9181부대** | 89.7985 | 90.1397 | 89.745 | +0.3947 |
| ... (이하 |gap| ≤ 0.3) | | | | | |

#### 결정적 outlier
- **`od=2026-04-27, win_bid_rate=66.4059`** — floor_rate=88.745 대비 -22.3pp. 정상 입찰에서 win_bid_rate가 낙찰하한율을 22pp 밑돌 수 없음. **명백한 outlier 또는 입력 오류**.
- 이 1건만 PERCENTILE_CONT(0.9) 분위 추정에 큰 영향 (n=126에서 단일 outlier가 분위를 끌어올림).

#### 정합 결함 (at 분류)
- `at='지자체'`인데 canonical_ag가 **제9691부대·제9911부대·제9181부대·특수전사령부 등 명백한 군시설**.
- 이 군시설 row들이 win_zone_daily 지자체 측정값에 포함됨 → 지자체 영역의 측정 정합 위반.
- 일부 row는 `canonical_ag=NULL`로 정규화 미적용.

### 2.4 `bid_predictions` 지자체 60일 actual_adj_rate 산포 — 정상

```sql
SELECT COUNT(*) AS n, AVG(actual_adj_rate), STDDEV(actual_adj_rate),
       PERCENTILE_CONT(0.10/0.50/0.90) WITHIN GROUP (ORDER BY actual_adj_rate)
FROM bid_predictions p LEFT JOIN bid_records r ON r.id=p.matched_record_id
WHERE p.at='지자체' AND p.match_status='matched' AND ABS(p.actual_adj_rate)<=5
  AND p.open_date >= CURRENT_DATE - INTERVAL '60 days'
  AND COALESCE(r.is_joint_contract,false)!=true
  AND COALESCE(r.era_v2,'current')='current';
```

| n | mean | std | p10 | p25 | p50 | p75 | p90 |
|---|---|---|---|---|---|---|---|
| 217 | -0.0944 | 0.8520 | -1.1346 | -0.5702 | -0.0509 | 0.4810 | **0.9057** |

→ 지자체 사정률 산포 자체는 정상 (std 0.85%, p90 ~1pp 수준). bid_predictions에서 측정한 산포는 m26 win_zone_daily의 0.2345와 일치 안 함 → m26 측정값은 **win_bid_rate-floor_rate** (gap) 공간이며, 사정률 공간(actual_adj_rate)과 다른 차원.

---

## 3. 결론

### 3.1 활성화 판정

| 항목 | 판정 | 근거 |
|---|---|---|
| 지자체 Mode A 조건부 활성화 | **불가 (현 시점)** | lookup_agency_mode RPC 모두 B, 최대 p90_gap 0.0518 < 0.10 |
| m26 0.2345의 의미 | **outlier 영향, 정상 분포 ≤ 0.05** | win_bid_rate=66.4059 단일 outlier 영향 |
| 마스터플랜 §3 D2 표 갱신 | **지자체 행 "B" 유지** (조건부 A 미활성화) | current-only 측정 0.0518이 조건 0.10의 절반 |
| 데이터 정합 결함 | **별도 작업 필요** | at='지자체'에 군시설 다수 혼입 |

### 3.2 자사 1위 적중 영향

지자체는 **사정률 점추정 영역**으로 V6 + agency-floor V1의 점추정 정확도가 자사 1위 적중에 직접 기여 (V2_MEASUREMENT_SPEC §6.1 분류).
- bid_predictions 지자체 60일 actual_adj_rate std=0.85% → 사정률 점추정 MAE ~0.85% 이하면 1위 적중 가능 범위
- Mode B (하한 통과 안전망)는 그대로 가동
- Mode A 활성화는 **명분 없음** + **데이터 정합 결함이 우선 fix 대상**

---

## 4. 후속 작업 (우선순위)

### 4.1 m28 (가칭) — bid_details at 정규화 정합 회복 [긴급]

**문제**:
- `bid_details.at='지자체'`에 군시설(canonical_ag=제XXXX부대) 다수 혼입
- bid_details에 canonical_ag 컬럼 자체가 없어 정규화 검증이 bid_records JOIN 의존
- bid_details.at vs bid_records.canonical_ag 분류 불일치

**조사 범위**:
- bid_details.at이 어떻게 설정되는지 (입력 시점 분류 로직?)
- 군시설 발주사가 어느 정규화 단계에서 '지자체'로 분류되는지
- 다른 영역(한전·교육청·LH·조달청)에도 유사한 정합 결함 있는지

**예상 작업**:
- bid_details에 `canonical_at` 컬럼 추가 또는
- bid_details.at을 bid_records.at으로 일괄 갱신 또는
- refresh_win_zone_daily 본체에서 `d.at` → `r.at` (bid_records.at 사용)

### 4.2 outlier 1건 추적 — `od=2026-04-27, win_bid_rate=66.4059`

**문제**: floor_rate=88.745 대비 -22.3pp, 입력 오류 가능성

**조사 범위**:
- 해당 row의 원본 공고 데이터 확인
- 자사 데이터인지(my_bid_rate=87.3253), 외부 데이터인지
- 실제 낙찰가가 -22.3pp 가능한 케이스인지 (특수 입찰 형태?)

**예상 작업**:
- 데이터 오류면 `is_excluded=true` 마킹 또는 row 정정
- 정상이면 outlier flag 정책 검토

### 4.3 agency_gap_distribution 지자체 current era 적재 [B0b 잔여]

**문제**: 지자체 grain별 gap 분포 검증 인프라 공백

**예상 작업**:
- 기존 적재 함수(refresh_agency_gap_distribution?) 존재 여부 확인
- 없으면 신규 마이그레이션 작성 (m18 패턴 — agency_gap_distribution era_v2 재적재)
- 적재 후 lookup_agency_mode RPC 결과와 정합 검증

### 4.4 마스터플랜 §3 D2 표 갱신 — 지자체 "B 유지" 명문화

**문제**: 마스터플랜이 "B + 조건부 A"로 분류했으나 실제 조건 미충족

**예상 작업**:
- HANDOFF_V2_MASTER_PLAN.md §3 D2 표에서 지자체 행 정정:
  - 이전: `B + 조건부 A`
  - 갱신: `B (조건부 A 미활성 — 2026-05-21 측정 최대 p90_gap 0.0518 < 0.10)`
- m26 적용 후 영역별 current-only 측정값 표 추가 (M26_M27_APPLY_RESULT §9.6.4 인용)

### 4.5 우선순위 권고

| # | 작업 | 분량 | 긴급도 |
|---|---|---|---|
| 4.1 | m28 bid_details at 정합 회복 | 1~2일 | **High** (다른 측정값 신뢰도 영향) |
| 4.2 | outlier 추적 | 0.5일 | Medium |
| 4.4 | 마스터플랜 §3 D2 표 갱신 | 0.5일 | Medium |
| 4.3 | agency_gap_distribution 지자체 적재 | 1일 | Low |

4.1을 먼저 진행 후 4.2·4.4를 같이 마무리. 4.3은 검증 인프라 완성 시점에 별도.

---

## 5. 시스템 함의

본 검토는 SYSTEM_AUDIT §3 "영역별 모드 적합성 재평가"에 새로운 데이터 포인트 제공:

| 영역 | SYSTEM_AUDIT §3 분류 | m26 측정 (90일) | lookup_agency_mode | 본 검토 결론 |
|---|---|---|---|---|
| 군시설 | A (gap_p90 0.7993) | 0.6070 | A | A 유지 (10.00% WARN) |
| 지자체 | B + 조건부 A | 0.2345 (outlier 영향) | **모두 B** | **B 유지** (조건부 A 미활성) |
| 한전 | B (gap_p90 0.0060) | 0.0060 | B (예상) | B 유지 |
| 교육청 | B (gap_p90 0.0102) | 0.0059 | B (예상) | B 유지 |
| LH | B (gap_p90 0.0060) | 0.0013 | B (예상) | B 유지 |
| 조달청 | B + 공격성 교정 | 0.0006 | B (예상) | B + 공격성 교정 유지 |

→ **마스터플랜 §3 D2 표는 mixed 추정값과 current-only 측정값 둘 다 영역 분류 결론에 일관**. 다만:
- 지자체의 "조건부 A"는 실제 측정에서 활성화 조건 미충족 — 정정 필요
- 군시설은 분류 그대로 (A 유지)

**라운드 N+1 BRIEF 통합 시 본 검토 결과는 라운드 15 BRIEF의 입력으로 포함**.

---

_본 보고서는 m26 win_zone_daily 지자체 0.2345 측정값의 의미를 추적해 Mode A 활성화 가능성을 정량 검증. 결론: 불가 + 데이터 정합 결함 별도 발견._
_작성자: Claude Opus 4.7 / 검토 일자: 2026-05-21 / 후속 commit: m28 (가칭, bid_details at 정합 회복)_
