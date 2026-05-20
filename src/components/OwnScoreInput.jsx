// V2_DOMAIN_RULES_CHECK #1 — 자사 비가격 점수 입력
// 0~20 정수, 디폴트 20 (만점=표준 하한율 적용)
export default function OwnScoreInput({ value, onChange }) {
  const handle = (e) => {
    const n = Number(e.target.value);
    if (!Number.isFinite(n)) return;
    onChange(Math.max(0, Math.min(20, Math.round(n))));
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
        value={value}
        onChange={handle}
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
