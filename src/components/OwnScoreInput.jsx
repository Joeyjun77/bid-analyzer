// V2_DOMAIN_RULES_CHECK #1 — 자사 비가격 점수 입력
// 0~20 정수, 디폴트 20 (만점=표준 하한율 적용)
import { useState, useEffect } from "react";
import { parseOwnScore } from "../lib/effectiveFloor.js";

export default function OwnScoreInput({ value, onChange }) {
  // 입력 중인 값(빈칸·중간 자릿수)은 draft에만 두고 blur/Enter에서 한 번만 반영한다.
  // 키 입력마다 반영하면 빈칸이 0점, "14"의 "1"이 1점으로 저장되고 대기 예측이 그 점수로 재계산된다.
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    const n = parseOwnScore(draft, null);
    if (n == null || n === value) { setDraft(String(value)); return; }
    onChange(n);
  };
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      padding: "4px 10px", border: "1px solid #ccc", borderRadius: 6,
      background: "#fafafa", fontSize: 13
    }}>
      <label style={{ fontWeight: 600 }}>자사 비가격 점수</label>
      <input
        type="number"
        min={0} max={20} step={1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        style={{ width: 56, padding: "2px 4px", textAlign: "right" }}
      />
      <span style={{ color: "#666" }}>/ 20</span>
      <span
        title="시공경험 5 + 경영상태 15. 만점 20점일 때 표준 하한율 적용. 1점 부족당 +0.05%p"
        style={{ cursor: "help", color: "#999" }}
      >?</span>
    </div>
  );
}
