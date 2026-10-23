import { TOP_TABS, SUB_TABS, DEFAULT_TAB, REF_ONLY_TABS, REF_ONLY_BANNER } from "../src/lib/tabs.js";

let bad = 0;
const eq = (got, exp, msg) => { if (got !== exp) { console.error(`XX ${msg}: got ${got} expect ${exp}`); bad++; } };

eq(TOP_TABS.map(t => t.id).join(), "notices,predict,performance,g2b_sheet,data", "상단 탭 순서");
eq(SUB_TABS.some(t => t.id === "v2_preview"), false, "V2 미리보기 삭제");
eq(SUB_TABS.some(t => t.id === "dash") || TOP_TABS.some(t => t.id === "dash"), false, "대시보드 삭제");
eq(SUB_TABS.map(t => t.id).includes("analysis") && SUB_TABS.map(t => t.id).includes("chat"), true, "분석·AI 상담은 보조");
eq(SUB_TABS.map(t => t.id).join(), "analysis,chat,feedback,quality,agency_predict_v6,agency_floor", "보조 순서");
eq(DEFAULT_TAB, "notices", "첫 화면");
eq(REF_ONLY_TABS.has("agency_predict_v6") && REF_ONLY_TABS.has("agency_floor") && REF_ONLY_TABS.has("chat"), true, "참고용 배너 대상");
eq(REF_ONLY_TABS.has("analysis"), false, "분석은 배너 없음");
eq(REF_ONLY_BANNER, "참고용 — 공식 추천 아님 (공식 추천은 오늘의 공고·투찰 카드)", "배너 문구");

console.log(bad === 0 ? "OK tabs" : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
