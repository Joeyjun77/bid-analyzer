#!/usr/bin/env node
// Stop 훅 — "검증 없이 완료 금지" (Verification Before Completion 강제)
//
// Claude가 응답을 끝내려 할 때 실행됩니다.
// 1) 감시 경로의 파일이 지난 검사 이후 바뀌었는지 확인하고 (안 바뀌었으면 바로 통과)
// 2) 바뀐 파일과 관련된 검사(claude-verify/verify.json)만 실행합니다.
// 3) 하나라도 실패하면 exit 2 로 완료를 막고, 실패 출력을 Claude에게 돌려줍니다.
// 같은 파일 상태로는 한 번만 막습니다(무한 루프 방지). 설정 파일이 없으면 아무것도 하지 않습니다.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const here = join(root, "claude-verify");
const cfgPath = join(here, "verify.json");
const statePath = join(here, ".verify-state.json");

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  input = {};
}
if (input.stop_hook_active) process.exit(0);
if (!existsSync(cfgPath)) process.exit(0);

const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
const skipDirs = new Set([
  "node_modules", ".git", ".next", ".venv", "venv", "dist", "build", "out", "coverage",
  "__pycache__", ".pytest_cache", ".ruff_cache", ".vercel", ".turbo", ".claude", "claude-verify",
  ...(cfg.skipDirs ?? []),
]);
const exts = new Set(cfg.extensions ?? [".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", ".sql", ".json"]);

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!skipDirs.has(e.name)) walk(join(dir, e.name), out);
      continue;
    }
    const dot = e.name.lastIndexOf(".");
    if (dot < 0 || !exts.has(e.name.slice(dot))) continue;
    const full = join(dir, e.name);
    try {
      const st = statSync(full);
      out[relative(root, full).replaceAll("\\", "/")] = `${Math.round(st.mtimeMs)}:${st.size}`;
    } catch {
      // 검사 도중 지워진 파일은 무시
    }
  }
}

const files = {};
for (const p of cfg.watch ?? ["."]) walk(join(root, p), files);

let prev;
try {
  prev = JSON.parse(readFileSync(statePath, "utf8"));
} catch {
  prev = null;
}

let changed = null; // null = 기준 상태 없음 → 전체 검사
if (prev?.files) {
  changed = Object.keys(files).filter((f) => files[f] !== prev.files[f]);
  for (const f of Object.keys(prev.files)) if (!(f in files)) changed.push(f);
  if (changed.length === 0) process.exit(0);
}

const toRun = (cfg.checks ?? []).filter(
  (c) => !c.paths || changed === null || changed.some((f) => c.paths.some((p) => f.startsWith(p))),
);

const failures = [];
for (const c of toRun) {
  try {
    execSync(c.cmd, {
      cwd: join(root, c.cwd ?? "."),
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      timeout: (c.timeoutSec ?? cfg.timeoutSec ?? 240) * 1000,
      env: { ...process.env, CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" },
    });
  } catch (e) {
    const out = `${e.stdout ?? ""}\n${e.stderr ?? ""}`
      // eslint-disable-next-line no-control-regex -- 터미널 색상 코드 제거
      .replace(/\x1b\[[0-9;]*m/g, "")
      .trim().split(/\r?\n/).slice(-40).join("\n");
    const why = e.signal === "SIGTERM" ? "시간 초과" : `exit ${e.status ?? "?"}`;
    failures.push(`### ${c.name} 실패 (${why})\n$ ${c.cmd}\n${out}`);
  }
}

writeFileSync(
  statePath,
  JSON.stringify({ at: new Date().toISOString(), ok: failures.length === 0, ran: toRun.map((c) => c.name), files }),
);

if (failures.length === 0) process.exit(0);

process.stderr.write(
  [
    "[verify-on-stop] 코드가 바뀐 상태에서 검증이 실패했습니다. 아직 '완료'라고 보고하지 마세요.",
    ...failures,
    "",
    "다음 중 하나를 하세요:",
    "1) 이번 변경 때문이면 고친 뒤 같은 명령을 다시 실행하고, 실제 출력을 근거로 보고한다.",
    "2) 이번 변경과 무관한 기존 오류이거나 환경 문제(도구 미설치·네트워크 등)면 고치려 하지 말고, 실패한 명령과 원인을 사용자에게 그대로 보고한다.",
  ].join("\n"),
);
process.exit(2);
