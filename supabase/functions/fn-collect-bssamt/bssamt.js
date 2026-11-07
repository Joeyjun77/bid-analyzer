// 기초금액 API(getBidPblancListInfoCnstwkBsisAmount) 응답 해석 — 순수 함수, node 테스트 가능.
// A값 합산·차수 선택은 G2B 양식 수집과 같은 정의를 쓴다(복사하지 않고 가져옴).
import { sumAValue, pickOrd } from "../fn-collect-g2b-sheet/calc.js";

// found=false면 ba·av는 null — 아직 공개 전인 공고의 기존 값을 지우지 않게 한다
export function readBssamt(items, ord) {
  const it = pickOrd(items, ord);
  const ba = it ? Number(it.bssamt) : NaN;
  if (!it || !Number.isFinite(ba) || ba <= 0) return { found: false, ba: null, av: null, aApplies: null, items: null, openDt: null, ord: it?.bidNtceOrd ?? null };
  const a = sumAValue(it);
  // 공개 시각은 'YYYY-MM-DD HH:MM(:SS)' KST만 넘긴다 — 형식이 다른 값 하나가 DB 캐스트에서 묶음 전체를 실패시키지 않게
  const openDt = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(it.bssamtOpenDt || "") ? it.bssamtOpenDt : null;
  return { found: true, ba, av: a.av, aApplies: a.aApplies, items: a.items, openDt, ord: it.bidNtceOrd ?? null };
}
