// CLAUDE.md 금기: bid_records·bid_details DELETE 금지 — 앱 어디에서도 두 테이블로 DELETE를 보내지 않는다.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const files = [];
const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : /\.(js|jsx)$/.test(f) && files.push(p); } };
walk(fileURLToPath(new URL("../src", import.meta.url)));

let bad = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  // 한 줄(또는 '{'로 시작하는 이어진 인자 줄)에 금기 테이블 경로와 DELETE가 함께 있는지
  const lines = src.split(/\r?\n/);
  lines.forEach((ln, i) => {
    const next = (lines[i + 1] || "").trim();
    const win = ln + (next.startsWith("{") ? next : "");
    if (/\/rest\/v1\/bid_(records|details)\b/.test(ln) && /DELETE/.test(win)) { console.error(`XX ${f}:${i + 1}`); bad++; }
  });
  if (/sbDeleteIds/.test(src)) { console.error(`XX ${f}: sbDeleteIds 남음`); bad++; }
}
console.log(bad === 0 ? `OK noRecordDelete (${files.length} files)` : `FAIL ${bad}`);
process.exit(bad === 0 ? 0 : 1);
