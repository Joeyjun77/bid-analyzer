#!/usr/bin/env node
// PostToolUse hook for bid-analyzer Phase 23-3 Generator/Evaluator separation rule.
// Detects edits to Generator code (predict_v6, getFinalRecommendation, opt_adj,
// pred_bias_map, getFloorRate) and reminds Claude to run /evaluate or deploy-gate
// before pushing.

import fs from 'fs';
import path from 'path';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    if (!raw.trim()) return;
    const payload = JSON.parse(raw);
    const ti = payload.tool_input || {};
    const tr = payload.tool_response || {};
    const filePath = ti.file_path || tr.filePath || tr.file_path || '';
    if (!filePath) return;

    const norm = filePath.replace(/\\/g, '/');
    const isTarget = /\/src\/(App\.jsx|utils[^/]*\.js)$/.test(norm);
    if (!isTarget) return;

    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (_) {
      return;
    }

    const keywords = /(getFinalRecommendation|opt_adj|pred_bias_map|getFloorRate)/;
    if (!keywords.test(content)) return;

    const out = {
      systemMessage:
        '⚠ Generator 코드 변경 감지: Phase 23-3 규칙에 따라 /evaluate 슬래시 커맨드 또는 deploy-gate 서브에이전트로 회귀 검증이 필요합니다. 검증 없이 push 금지.',
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext:
          'Phase 23-3 Generator 변경 감지됨 (' +
          path.basename(filePath) +
          '). 다음 단계: 1) npx vite build 통과 확인 2) /evaluate 또는 Agent(subagent_type=deploy-gate) 호출 3) PASS/WARN 판정 후 push.',
      },
    };
    process.stdout.write(JSON.stringify(out));
  } catch (_) {
    // Silent failure: hook must never block the tool.
  }
});
