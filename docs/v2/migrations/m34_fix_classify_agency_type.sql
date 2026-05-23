-- m34: classify_agency_type 군시설 오탐 교정 (JS src/lib/agencyClass.js 와 동기)
-- 2026-05-23 / 군부대 Mode A Phase 0
-- 변경:
--   (1) 맨앞 '군' 제거 — '가평군/군포시' 등 행정구역 오탐 차단 (DROPPED ~291 기관 → 지자체)
--   (2) '사단법인' 가드 — 사단법인 OO협회가 '사단'에 걸려 군시설 오분류되던 것 차단
--   (3) '부대' → '[0-9]부대|군부대' 앵커링 — '중부대학교'(대학교) 오분류 차단,
--       진짜 군 부대(제2136부대 등 NEW_CAPTURE ~78 기관) 정상 포착
--   '사단' 자체는 유지 (제8기동사단·제1보병사단 등 진짜 군).
-- !! JS agencyClass.js 의 MIL 정규식과 항상 동기 유지 !!
CREATE OR REPLACE FUNCTION public.classify_agency_type(p_ag text)
 RETURNS text LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_ag ~ '조달청'                THEN '조달청'
    WHEN p_ag ~ '교육'                  THEN '교육청'
    WHEN p_ag ~ '한국전력|한전'         THEN '한전'
    WHEN p_ag ~ 'LH|주택공사|토지주택'  THEN 'LH'
    WHEN p_ag ~ '사단법인'              THEN '지자체'
    WHEN p_ag ~ '사단|여단|군단|국방|국군|육군|해군|공군|해병|사령부|[0-9]부대|군부대|병참|방위사업' THEN '군시설'
    WHEN p_ag ~ '수자원'                THEN '수자원공사'
    ELSE '지자체'
  END;
$function$;
