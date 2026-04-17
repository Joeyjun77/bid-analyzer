# 나라장터 OpenAPI 연동 스펙 (G2B API)

> 본 문서는 **bid-analyzer Phase B-2** 에서 실제 운영계정 테스트를 통해 확정한 규격이다.
> 공공데이터포털 문서만으로는 드러나지 않는 함정들이 다수 있어, 실전 검증 결과를 표준으로 삼는다.
>
> 최종 검증일: 2026-04-17 KST

---

## 1. 서비스 개요

| 서비스 ID | 한글명 | 용도 | 활용신청 |
|---|---|---|---|
| `BidPublicInfoService` | 조달청_나라장터 입찰공고정보서비스 | 입찰공고 수집 | 운영계정 승인 완료 |
| `ScsbidInfoService` | 조달청_나라장터 낙찰정보서비스 | 낙찰결과·최종낙찰자 수집 | 운영계정 승인 완료 |

두 서비스는 공공데이터포털에서 **별개로 활용신청** 해야 한다. 다만 발급되는 **serviceKey는 사용자 단위 공용 1개**이다 — 두 서비스 모두 동일 키로 호출한다.

## 2. Base URL

서비스별로 Base URL의 **경로 접두사가 다르다**. 문서에는 드러나지 않으나 운영계정 상세보기의 End Point에 표기되어 있다.

```
입찰공고: https://apis.data.go.kr/1230000/ad/BidPublicInfoService
낙찰정보: https://apis.data.go.kr/1230000/as/ScsbidInfoService
```

⚠️ `/ad/`, `/as/` 접두사를 빠뜨리면 HTTP 500 "Unexpected errors" 를 반환한다. (이것이 Phase B-2 최초 진입 실패의 1차 원인이었음)

## 3. 오퍼레이션 (공사 기준)

### 3.1 BidPublicInfoService

| 오퍼레이션 | 용도 | 응답 주요 필드 |
|---|---|---|
| `getBidPblancListInfoCnstwk` | 공사 입찰공고 목록 | `bidNtceNo`, `bidNtceNm`, `mainCnsttyNm`, `presmptPrce`, `bssamt`, `opengDt`, `cntrctCnclsMthdNm` |
| `getBidPblancListInfoServc` | 용역 입찰공고 목록 | (동일 구조) |
| `getBidPblancListInfoThng` | 물품 입찰공고 목록 | (동일 구조) |
| `getBidPblancListInfoFrgcpt` | 외자 입찰공고 목록 | (동일 구조) |

⚠️ 과거 문서에 나타나는 `PPSSrch01` / `PPSSrch` 접미사 버전(`getBidPblancListInfoCnstwkPPSSrch01`) 은 **404 "API not found"** 를 반환한다. 접미사는 붙이지 않는다.

### 3.2 ScsbidInfoService

| 오퍼레이션 | 용도 | 응답 주요 필드 |
|---|---|---|
| `getOpengResultListInfoCnstwk` | 공사 **개찰결과** 목록 | `bidNtceNo`, `opengCorpInfo`, `opengDt`, `progrsDivCdNm`, `rsrvtnPrceFileExistnceYn` |
| `getScsbidListSttusCnstwk` | 공사 **최종낙찰자** 목록 | `bidwinnrNm`, `bidwinnrBizno`, `bidwinnrCeoNm`, `sucsfbidAmt`, `sucsfbidRate`, `rlOpengDt` |

💡 **두 오퍼레이션은 상호보완 관계이다.** 개찰결과 API는 `opengCorpInfo` 하나의 문자열(`"회사^사업자번호^대표자^입찰번호^사정률"`) 에 1등 사정률만 담고 있고, 최종낙찰자 API는 낙찰사 정보와 금액을 분리된 필드로 제공한다. **두 API를 같은 날짜범위로 차례로 호출해서 `dedup_key`로 병합**하는 게 표준 패턴이다.

### 3.3 복수예비가 15행 상세

❓ 조사 결과, 현재 활용신청 범위의 오퍼레이션들 중 복수예비가 15개 또는 예정가격 상세를 반환하는 API는 **확인되지 않는다**. 시도한 후보 오퍼레이션명은 모두 404 응답:

- `getScsbidListSttusCnstwkRsrvtnPrce`
- `getRsrvtnPrceListInfoCnstwk[PPSSrch]`
- `getPrdprcListInfoCnstwk[PPSSrch]`
- `getBidPblancListInfoCnstwkBssAmt / PrearngPrce`
- `getScsbidListSttusCnstwk` 의 `inqryDiv=3,5` 조합

추정 원인: 복수예비가 상세는 별도 서비스("나라장터 예정가격정보서비스" 등)로 분리되어 있거나, 운영계정 외 별도 활용신청이 필요하다. 필요 시 공공데이터포털에서 추가 신청 진행.

## 4. 공통 요청 파라미터

| 파라미터 | 타입 | 필수 | 비고 |
|---|---|---|---|
| `serviceKey` | string | ✅ | 대소문자 **s**. Decoding 원본값을 `URLSearchParams`에 그대로 넣으면 자동으로 퍼센트 인코딩됨 |
| `type` | `json` / `xml` | ✅ | `json` 사용 권장 |
| `pageNo` | int | ✅ | 1-based |
| `numOfRows` | int | ✅ | 최대 100 |
| `inqryDiv` | int | ✅ | `1`=날짜범위, `2`=공고번호, `4`=공고번호(대체) |
| `inqryBgnDt` | `YYYYMMDDHHMM` | inqryDiv=1일 때 | 12자리 고정. 8자리·14자리 모두 "DATE Format 에러" 반환 |
| `inqryEndDt` | `YYYYMMDDHHMM` | inqryDiv=1일 때 | 동일 |
| `bidNtceNo` | string | inqryDiv=2/4일 때 | 공고번호 (예: `R26BK01419937`) |
| `bidNtceOrd` | string | 선택 | 공고차수 (기본 `000`) |

## 5. 응답 구조

### 5.1 정상 응답

```json
{
  "response": {
    "header": {
      "resultCode": "00",
      "resultMsg": "정상"
    },
    "body": {
      "items": [ { ... }, { ... } ],
      "totalCount": 1243,
      "numOfRows": 100,
      "pageNo": 1
    }
  }
}
```

### 5.2 에러 응답

```json
{
  "nkoneps.com.response.ResponseError": {
    "header": {
      "resultCode": "08",
      "resultMsg": "필수값 입력 에러"
    }
  }
}
```

⚠️ **정상·에러 응답의 최상위 키가 다르다.** 파서는 `body.response ?? body['nkoneps.com.response.ResponseError']` 둘 다를 envelope 후보로 받아야 한다.

### 5.3 resultCode 목록

| Code | 의미 | 비고 |
|---|---|---|
| `00` | 정상 | |
| `06` | DATE Format 에러 | 날짜를 12자리 `YYYYMMDDHHMM` 으로 |
| `07` | 입력범위값 초과 에러 | `inqryDiv` 허용 범위 벗어남 |
| `08` | 필수값 입력 에러 | 필수 파라미터 누락 |
| 404 HTTP | API not found | 오퍼레이션명 오류 |
| 500 HTTP | Unexpected errors | Base URL 경로 누락 또는 인증 문제 |

## 6. 주요 응답 필드 매핑 (공사 입찰공고)

| API 필드 | DB 컬럼 (`bid_notices`) | 설명 |
|---|---|---|
| `bidNtceNo` | `bid_ntce_no`, `pn_no` | 공고번호 (PK 역할) |
| `bidNtceOrd` | `bid_ntce_ord` | 공고차수 (기본 `000`) |
| `bidClsfcNo` | `bid_clsfc_no` | 공고분류번호 |
| `rbidNo` | `rbid_no` | 재입찰번호 |
| `bidNtceNm` | `pn`, `at` | 공고명 |
| `ntceInsttNm` | `ag`, `notice_inst` | 공고기관명 |
| `dminsttNm` | `notice_inst` | 수요기관명 |
| `mainCnsttyNm` | `cat` | **주공종명** (전기공사업/소방시설공사업 등) — 업종 필터 기준 |
| `subsiCnsttyNm1~9` | raw_json | 부공종명 (매칭에는 선택적 사용) |
| `presmptPrce` | `ep` | 추정가격 |
| `bssamt` | `ba` | 기초금액 |
| `cntrctCnclsMthdNm` | `contract_method` | 계약방법 (제한경쟁/일반경쟁 등) |
| `prtcptLmtRgnNm` | `reg` | 참가제한지역 |
| `cnstrtsiteRgnNm` | `reg` (2순위) | 공사현장지역 |
| `opengDt` | `od`, `ba_open_dt` | 개찰일시 |
| `bidBeginDt` / `bidClseDt` | `bid_begin_dt` / `bid_close_dt` | 입찰 접수 시작/마감 |

### 업종 필터 원칙

- **주공종(`mainCnsttyNm`) 기반 매칭**을 디폴트로 한다. `api_collection_rules.main_cat_only = true` 가 기본값.
- 부공종 포함 매칭이 필요한 케이스는 규칙에서 명시적으로 `main_cat_only = false` 설정.
- 예시: "항로표지위탁관리업" 주공종 + "전기공사업" 부공종 → 주공종 기준에선 전기 타깃 아님. (실전에서 오탐 사례 있었음)

## 7. 주요 응답 필드 매핑 (공사 낙찰결과)

### 7.1 `getOpengResultListInfoCnstwk` (개찰결과 목록)

| API 필드 | DB 컬럼 (`bid_records`) | 설명 |
|---|---|---|
| `bidNtceNo` | `pn_no` | 공고번호 |
| `bidNtceNm` | `pn`, `at` | 공고명 |
| `ntceInsttNm` / `dminsttNm` | `ag` | 발주기관 |
| `opengCorpInfo` | 파싱 후 `co`, `co_no`, `br1` | `"회사명^사업자번호^대표자명^입찰번호^사정률"` 형식 |
| `progrsDivCdNm` | — | 진행상태명 (개찰완료/유찰 등) |
| `rsrvtnPrceFileExistnceYn` | — | 예비가격파일 존재여부 Y/N |
| `prtcptCnum` | — | 참가업체수 |
| `opengDt` | `od` | 개찰일시 |

### 7.2 `getScsbidListSttusCnstwk` (최종낙찰자 목록)

| API 필드 | DB 컬럼 (`bid_records`) | 설명 |
|---|---|---|
| `bidNtceNo` | `pn_no` | 공고번호 (조인 키) |
| `bidwinnrNm` | `co` | 낙찰사명 |
| `bidwinnrBizno` | `co_no` | 낙찰사 사업자번호 |
| `bidwinnrCeoNm` | (raw) | 대표자명 |
| `bidwinnrAdrs` | (raw) | 낙찰사 주소 |
| `sucsfbidAmt` | `bp` | 낙찰금액 |
| `sucsfbidRate` | `br1` | 낙찰률 (%) |
| `rlOpengDt` | `od` | 실개찰일시 |

### 수집 순서

```
PASS A: getOpengResultListInfoCnstwk   (날짜범위)  → INSERT
PASS B: getScsbidListSttusCnstwk       (동일 범위) → UPDATE (COALESCE 보강)
```

두 API 모두 날짜범위 기반이므로 건별 상세 호출 없이 호출 수를 선형으로 관리 가능하다.

## 8. 호출 한도

| 계정 | 일일 한도 |
|---|---|
| 개발계정 | 1,000 호출/일 |
| 운영계정 (기본) | 10,000 호출/일 |
| 운영계정 + 활용사례 등록 | 1,000,000 호출/일 (최대) |

30분 주기 공고 수집(5 페이지 한도) = 하루 최대 240 호출  
일 1회 낙찰결과 수집(10 페이지 × 2 API) = 하루 최대 20 호출  
→ 운영계정 기본 한도로도 충분한 여유 확보.

## 9. 실전 트러블슈팅 요약

| 증상 | 원인 | 해결 |
|---|---|---|
| HTTP 500 "Unexpected errors" | Base URL에 `/ad/`·`/as/` 접두사 누락 | `SERVICE_PATH` 맵에서 서비스별 경로 추가 |
| HTTP 404 "API not found" | 오퍼레이션명에 `PPSSrch` 계열 접미사 | 접미사 제거 |
| `resultCode 06 DATE Format 에러` | 날짜 8자리 (`YYYYMMDD`) 사용 | 12자리 `YYYYMMDDHHMM` 고정 |
| `resultCode 08 필수값 입력 에러` | `inqryDiv` 값과 필수 파라미터 불일치 | `inqryDiv=1`엔 날짜, `inqryDiv=2/4`엔 `bidNtceNo` |
| `cat`에 계약방법이 저장됨 | `bsnsDivNm` 필드 부재, 폴백이 `cntrctCnclsMthdNm` 였음 | `mainCnsttyNm` 우선 매핑 |
| 낙찰 레코드에 금액 모두 NULL | 개찰결과 API는 `sucsfbidAmt` 미제공 | 최종낙찰자 API 추가 호출 |

---

## 변경 이력

- 2026-04-17: 초판. Phase B-2 운영계정 승인 후 End Point/오퍼레이션 전수 검증.
