// V2 미리보기 탭 (U0 Phase 2)
// 안전 격리 — 기존 UI 영향 zero. 사용자가 명시적으로 탭 클릭 시만 노출.
// 6개 at별 데모 + 사용자 입력으로 resolveMode 실시간 호출 + RecommendPanel/WhyPanel 표시.

import { useEffect, useState } from "react";
import RecommendPanel from "./RecommendPanel.jsx";
import WhyPanel from "./WhyPanel.jsx";
import { resolveMode } from "../lib/modeResolver.js";

const C = {
  bg: "#0f0f1f",
  bg2: "#1a1a30",
  bdr: "#252540",
  txt: "#e4e4e7",
  txm: "#999",
  txd: "#666",
  gold: "#d4a834",
};

const AT_OPTIONS = ["군시설", "지자체", "교육청", "한전", "조달청", "LH"];

// Mode A·B 메인 메트릭 데모 값 (실제 B2/B3 엔진 가동 전 mock)
const DEMO_METRIC = {
  A: 0.24,  // 군시설 예상 낙찰 확률 24%
  B: 0.87,  // 안착 모드 하한 통과 확률 87%
};

export default function V2PreviewTab() {
  const [at, setAt] = useState("한전");
  const [agencyName, setAgencyName] = useState("한국전력공사 경기북부본부");
  const [ba, setBa] = useState("500000000");
  const [resolution, setResolution] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    resolveMode({ at, canonicalAg: agencyName, ba: Number(ba) || null })
      .then(res => { if (!cancelled) setResolution(res); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [at, agencyName, ba]);

  const mode = resolution?.mode_recommend || "B";
  const confidence = resolution?.confidence || "low";
  const mainMetric = DEMO_METRIC[mode] ?? 0.5;
  // 데모용 사정률·투찰금액 (실제 엔진 미연결)
  const demoAdj = mode === "A" ? -0.0634 : -0.2119;
  const demoBidAmount = Number(ba) * (1 + demoAdj / 100) * 0.87745;

  return (
    <div style={{ padding: "20px 24px", color: C.txt }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>🧪 V2 미리보기</h2>
        <div style={{ fontSize: 12, color: C.txm, lineHeight: 1.5 }}>
          V2 재설계의 UI 모드 분기를 미리 확인합니다. <b>안착(Mode B)</b>은 한전·LH·교육청·조달청·지자체 대다수 — 메인 숫자 = 하한 통과 확률. <b>공략(Mode A)</b>은 군시설 — 메인 숫자 = 예상 낙찰 확률. 본 패널은 <b>mock 추천값</b> 표시이며 실제 엔진(B2/B3)은 미연결 상태입니다.
        </div>
      </div>

      {/* 입력 폼 */}
      <div style={{ background: C.bg2, border: `1px solid ${C.bdr}`, borderRadius: 8, padding: 14, marginBottom: 16, display: "grid", gridTemplateColumns: "auto 1fr auto 1fr auto 1fr", gap: 10, alignItems: "center" }}>
        <label style={{ fontSize: 12, color: C.txm }}>발주유형</label>
        <select value={at} onChange={e => setAt(e.target.value)} style={{ padding: "6px 10px", background: C.bg, color: C.txt, border: `1px solid ${C.bdr}`, borderRadius: 4, fontSize: 13 }}>
          {AT_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
        <label style={{ fontSize: 12, color: C.txm }}>발주사명</label>
        <input value={agencyName} onChange={e => setAgencyName(e.target.value)} style={{ padding: "6px 10px", background: C.bg, color: C.txt, border: `1px solid ${C.bdr}`, borderRadius: 4, fontSize: 13 }} />
        <label style={{ fontSize: 12, color: C.txm }}>기초금액</label>
        <input type="number" value={ba} onChange={e => setBa(e.target.value)} style={{ padding: "6px 10px", background: C.bg, color: C.txt, border: `1px solid ${C.bdr}`, borderRadius: 4, fontSize: 13, fontFamily: "monospace" }} />
      </div>

      {/* 결과 패널 — RecommendPanel + WhyPanel 2단 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 16 }}>
        <RecommendPanel
          agencyName={agencyName}
          workCat="전기"
          mode={mode}
          confidence={confidence}
          adj={demoAdj}
          bidAmount={demoBidAmount}
          mainMetric={mainMetric}
        />
        <WhyPanel resolution={resolution} agencyName={agencyName} />
      </div>

      {loading && <div style={{ marginTop: 12, fontSize: 11, color: C.txd }}>RPC 조회 중...</div>}

      {/* 영역별 1줄 비교 표 */}
      <div style={{ marginTop: 24, background: C.bg2, border: `1px solid ${C.bdr}`, borderRadius: 8, padding: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>영역별 at-level 모드 판정 요약</div>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ color: C.txm, borderBottom: `1px solid ${C.bdr}` }}>
              <th style={{ textAlign: "left", padding: "6px 8px" }}>at</th>
              <th style={{ textAlign: "right", padding: "6px 8px" }}>n</th>
              <th style={{ textAlign: "right", padding: "6px 8px" }}>gap p90</th>
              <th style={{ textAlign: "center", padding: "6px 8px" }}>mode</th>
              <th style={{ textAlign: "center", padding: "6px 8px" }}>confidence</th>
              <th style={{ textAlign: "left", padding: "6px 8px" }}>1차 KPI</th>
            </tr>
          </thead>
          <tbody>
            {AT_OPTIONS.map(opt => <AtRow key={opt} at={opt} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AtRow({ at }) {
  const [row, setRow] = useState(null);
  useEffect(() => {
    let cancelled = false;
    resolveMode({ at, canonicalAg: null, ba: null }).then(r => { if (!cancelled) setRow(r); });
    return () => { cancelled = true; };
  }, [at]);
  if (!row) return <tr><td colSpan={6} style={{ padding: "6px 8px", color: C.txd }}>...</td></tr>;
  return (
    <tr style={{ borderBottom: `1px solid ${C.bdr}33` }}>
      <td style={{ padding: "6px 8px", color: C.txt }}>{at}</td>
      <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "monospace" }}>{row.n}</td>
      <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "monospace" }}>{row.p90_gap?.toFixed?.(4) ?? "—"}</td>
      <td style={{ padding: "6px 8px", textAlign: "center" }}>
        <span style={{ padding: "2px 8px", borderRadius: 3, fontSize: 11, fontWeight: 700, background: row.mode_recommend === "A" ? "#fff3cd" : "#e6f4ec", color: row.mode_recommend === "A" ? "#8a6d3b" : "#236b3f" }}>
          {row.mode_recommend}
        </span>
      </td>
      <td style={{ padding: "6px 8px", textAlign: "center", color: C.txm }}>{row.confidence}</td>
      <td style={{ padding: "6px 8px", color: C.txm }}>
        {row.mode_recommend === "A" ? "WIN-zone 진입률" : "하한 통과율"}
      </td>
    </tr>
  );
}
