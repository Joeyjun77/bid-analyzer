// 발주기관명 → 기관유형 분류. 순수 함수(Vite/DB 의존 없음)라 node 단위 테스트 가능.
// !! DB classify_agency_type(text) 와 정규식·순서 동일 유지 필수 !!
// 2026-05-23: 군시설 오탐 수정 —
//   (1) 맨앞 '군' 제거: '가평군/군포시' 등 행정구역 오탐 차단
//   (2) '사단법인' 가드: 사단법인 OO 협회가 '사단'에 걸려 군시설로 오분류되던 것 차단
//   '사단' 자체는 유지 (제8기동사단·제1보병사단 등 진짜 군).
const MIL = /사단|여단|군단|국방|국군|육군|해군|공군|해병|사령부|부대|병참|방위사업/;
export function clsAg(n){
  if(!n)return"조달청";
  const s=String(n).trim();
  if(/조달청/.test(s))return"조달청";
  if(/교육/.test(s))return"교육청";
  if(/한국전력|한전/.test(s))return"한전";
  if(/LH|주택공사|토지주택/.test(s))return"LH";
  if(/사단법인/.test(s))return"지자체";   // 군시설 체크보다 먼저 — 사단법인은 군시설 아님
  if(MIL.test(s))return"군시설";
  if(/수자원/.test(s))return"수자원공사";
  return"지자체";
}
export function isMilitaryAgency(n){return clsAg(n)==="군시설";}
