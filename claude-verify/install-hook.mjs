#!/usr/bin/env node
// Stop 훅을 이 프로젝트의 .claude/settings.json 에 등록합니다. 여러 번 실행해도 한 번만 등록됩니다.
// 사용: 프로젝트 폴더에서  node claude-verify/install-hook.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const settingsPath = join(root, ".claude", "settings.json");
const command = 'node "$CLAUDE_PROJECT_DIR/claude-verify/verify-on-stop.mjs"';

const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {};
settings.$schema ??= "https://json.schemastore.org/claude-code-settings.json";
settings.hooks ??= {};
settings.hooks.Stop ??= [];

const already = settings.hooks.Stop.some((g) => (g.hooks ?? []).some((h) => h.command === command));
if (already) {
  console.log(`이미 등록되어 있습니다: ${settingsPath}`);
} else {
  settings.hooks.Stop.push({ hooks: [{ type: "command", command, timeout: 900 }] });
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  console.log(`Stop 훅을 등록했습니다: ${settingsPath}`);
}
