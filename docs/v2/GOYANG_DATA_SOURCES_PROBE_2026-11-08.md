# 고양 예비가격·참여업체 원천 확인 (goyang-focus issue 02, 2026-11-08)

## 결론
| 원천 | 판정 | 근거 |
|---|---|---|
| 복수예비가격 15개 · 추첨 4개 · 예정가격 | **API로 이미 충분 — 보강 불필요** | `fn-collect-prepc`가 매일 `bid_prelim_sets`에 공사 전 업종을 적재(2024-07-15~, 약 25만 세트). 고양 기록 2024-07 이후 687건 중 672건(97.8%) 연결, 추첨 4개 평균 = 예정가격 일치 621/627 세트(99%) |
| 참여업체 전체 순위 | **업로드로는 부족 — API 후보 1개 실측 필요** | `bid_participants`는 SUCVIEW 업로드 전용(2026-08-20~, 공고 342개). 고양 공고는 25개뿐 |

업로드 행 변경 0건, 마이그레이션 0건. 운영 DB는 가벼운 조회만 사용.

## 1. 예비가격 (`bid_prelim_sets`)
- 수집기: Edge Function `fn-collect-prepc` v4, OP `getOpengResultListInfoCnstwkPreparPcDetail`(ScsbidInfoService, 공사 전용), 일일 range 수집 + 2024-07-15까지 백필 완료(`prepc_backfill_state.active=false`, 246,167세트).
- 칼럼: `bid_ntce_no·bid_ntce_ord·bid_clsfc_no·rbid_no`(자연키), `pn_no`, `bssamt`(기초금액), `plnprc`(예정가격), `prices[15]`, `drwt_yns[15]`(추첨된 4개 표시), `drwt_nums[15]`(번호별 선택 횟수), `openg_dt`. 154 MB.
- **연결 키 주의**: `bid_records.pn_no` 형식이 2025년 `R25BK…-000`, 2026년 `R26BK…`(접미사 없음)로 다르다. `bid_prelim_sets.pn_no`는 `R26BK…-000`. 정확 일치로 붙이면 2026년 고양 390건 중 57건만 붙는다 → **`bid_prelim_sets.bid_ntce_no = split_part(bid_records.pn_no,'-',1)`** 로 붙일 것(자연키 인덱스 사용).
- 고양 커버리지(v_goyang_records, od ≥ 2024-07-15):

| 구간 | 고양 기록 | 예비가격 세트 연결 | 15개 완비 |
|---|---|---|---|
| 2024-07-15~ | 687 | 672 (97.8%) | 665 |
| 2026-01-01~ | 390 | 380 (97.4%) | — |
| 2026-10-01~ | 97 | 90 (92.8%, 최근분 수집 지연 포함) | — |

- 품질: 고양 세트 627개 중 추첨 4개 621개, 그 4개 평균 = `plnprc`(±1원) 621개. 추첨 수가 4가 아닌 6개는 유찰·재입찰 추정(미확인).
- `bid_details`(업로드, 고양 129건)는 이 원천으로 대체 가능 — 추가 확인 불필요.

## 2. 참여업체 (`bid_participants`)
- 업로드 전용: 2026-08-20~11-08, 공고 342개(2026년 189개), 행 97만(공고당 평균 약 2,800 투찰자).
- 고양 연결이 낮은 원인 = **업로드 범위**(+ 형식): `bid_participants.pn_no`는 `R26BK…-000` → 2026년 고양 기록과 정확 일치 0건, 접미사 제거 후 25개 공고.
- API 현황:
  - `getOpengResultListInfoCnstwk`: 낙찰자 1명만(`opengCorpInfo`).
  - 2026-05-22 실측(Z_DETAIL_API_PROBE): 순위 후보 3개(`getBidPrtcptRankListInfoCnstwk`·`getBidRankListInfoCnstwk`·`getOpengResultRankListInfoCnstwk`) 모두 404.
  - **미실측 후보**: `getOpengResultListInfoOpengCompt`(개찰결과 개찰완료 목록 — 업체별 순위·투찰금액 반환으로 알려짐, **미검증**). 실측하려면 테스트 Edge Function 배포(또는 `fn-test-prepc-api` 후보 목록 수정 후 재배포)가 필요 → 운영 배포라 사용자 승인 대상.
- 저장 제안(실측 성공 시): `bid_participants`에 섞지 않고 별도 테이블(예: `api_bid_ranks`), 고양 마스터 include 코드의 개찰 완료 공고만. 업로드 행 UPDATE 금지.

## 3. D1(업종 범위)에 따라 달라지는 수치
현재 수집 범위 = `bid_notices.is_target`(전기·정보통신·전문소방). 고양 공고는 2026-04-17부터 코드로 잡힘(약 7개월).

| 항목 | 대상 업종만 | 고양 전체 업종 | 차이 |
|---|---|---|---|
| 고양 공고(bid_notices, 4/17~11/8) | 29 | 414 | ×14 |
| 그중 예비가격 세트 있음 | 24 | 357 | 추가 호출 0 (prepc는 이미 전 업종 수집) |
| 그중 bid_records 결과 있음 | 20 | 314 | — |
| 참여업체 API 호출(실측 성공 시, 공고당 1~2회) | 하루 약 0.1~0.3회 | 하루 약 2~4회 | 일일 한도 대비 미미 |
| bid_records 고양 4/17 이후 | 전기 43 | 361 (업종 미상 318 포함) | — |

- 핵심: **예비가격은 D1과 무관**(이미 전 업종). D1이 바꾸는 것은 참여업체 수집 대상 수(14배)와 P4 화면·P2 채점 표본의 업종 구성.
- 참고: bid_records의 4/17 이후 고양 행 361건 중 318건이 `cat` 미상(자동 수집분으로 추정, 미확인)이다. 즉 평가 표본은 이미 업종이 섞여 있다 — D1을 "대상 업종만"으로 정하면 P2에서 `cat`/공고 업종으로 거르는 조건이 추가로 필요하다.

### D1 결정 (2026-11-08, 사용자 "Analysis all, collection mine")
- 분석·화면(P4)·P2 채점 표본 = 고양 **전체 업종** (414공고 규모).
- 참여업체 수집(API 실측 성공 시) = **대상 업종만**(전기·정보통신·전문소방, `bid_notices.is_target`) — 하루 약 0.1~0.3회.
- 업종 무관 가정은 미확인 → issue 03 기준선 측정 때 대상 업종 vs 그 외 업종의 사정률 패턴을 나눠 확인.

## 4. 다음 단계 제안
1. ~~D1 결정~~ → 위 결정 반영.
2. 참여업체 API 후보 `getOpengResultListInfoOpengCompt` 실측(테스트 함수 배포 승인 필요). 실패 시 참여업체는 업로드 유지로 확정.
3. P4에서 고양 프로파일은 `bid_prelim_sets`를 `bid_ntce_no`로 붙여 추첨 번호 빈도·예비가격 분포를 표시(새 수집 불필요).

## 하네스
| 게이트 | 결과 |
|---|---|
| 분류 | Neutral (조회만, 저장값 미접촉) |
| 마이그레이션 | 0 |
| 업로드 행 변경 | 0 |
