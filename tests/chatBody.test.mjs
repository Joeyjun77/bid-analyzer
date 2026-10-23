// AI 상담 API 요청 본문 — 고정 시스템 프롬프트·대화 기록은 캐시 접두로, 질문마다 바뀌는 DB 조회 결과는 마지막 사용자 메시지 뒤로.
import { buildClaudeBody } from "../api/chat.js";

let bad = 0;
const eq = (got, exp, msg) => { const g = JSON.stringify(got), e = JSON.stringify(exp); if (g !== e) { console.error(`XX ${msg}: got ${g} expect ${e}`); bad++; } };
const CC = { type: "ephemeral" };

const msgs = [
  { role: "user", content: "고양시 사정률?" },
  { role: "assistant", content: "평균 99.8%입니다." },
  { role: "user", content: "한전은?" },
];

// DB 결과 있음
const b1 = buildClaudeBody({ systemBase: "BASE", messages: msgs, dbContext: "DB행" });
eq(b1.system, [{ type: "text", text: "BASE", cache_control: CC }], "시스템 = 고정 블록 하나 + 캐시");
eq(JSON.stringify(b1.system).includes("DB행"), false, "DB 결과는 시스템에 없음");
eq(b1.messages[1].content, [{ type: "text", text: "평균 99.8%입니다.", cache_control: CC }], "직전 메시지에 캐시 표시");
eq(b1.messages[0].content, "고양시 사정률?", "앞선 메시지는 그대로");
eq(b1.messages[2].content[0], { type: "text", text: "한전은?" }, "마지막 질문 원문이 먼저");
eq(b1.messages[2].content[1].text.includes("DB행") && b1.messages[2].content[1].text.includes("v7.2 모델 가이드"), true, "DB 결과·가이드는 마지막 질문 뒤");
eq(b1.messages[2].content.some(c => c.cache_control), false, "질문별 블록에는 캐시 표시 없음");

// DB 결과 없음 — 마지막 메시지는 원래 문자열 그대로
const b2 = buildClaudeBody({ systemBase: "BASE", messages: msgs, dbContext: null });
eq(b2.messages[2].content, "한전은?", "DB 없으면 마지막 메시지 불변");
eq(JSON.stringify(b2).includes("v7.2 모델 가이드"), false, "DB 없으면 가이드도 없음(기존 조건 유지)");

// 첫 질문(메시지 1개) — 직전 메시지 없음
const b3 = buildClaudeBody({ systemBase: "BASE", messages: [msgs[0]], dbContext: null });
eq(b3.messages, [{ role: "user", content: "고양시 사정률?" }], "메시지 1개면 그대로");

// 21개 이상이면 최근 20개만, 입력 배열은 바꾸지 않음
const many = Array.from({ length: 23 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "m" + i }));
const b4 = buildClaudeBody({ systemBase: "BASE", messages: many, dbContext: null });
eq(b4.messages.length, 20, "최근 20개");
eq(many[21].content, "m21", "입력 불변");

// systemBase 비면 system 생략(빈 텍스트 블록은 API 400)
eq("system" in buildClaudeBody({ systemBase: "", messages: [msgs[0]], dbContext: null }), false, "빈 시스템 생략");

eq(b1.model, "claude-opus-4-7", "모델 유지"); eq(b1.max_tokens, 2000, "max_tokens 유지");

console.log(bad === 0 ? "OK chatBody" : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
