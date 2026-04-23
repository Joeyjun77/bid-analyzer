import React from 'react';
import { C } from '../lib/constants.js';
import { WIN_OPT_GAP, tc } from '../lib/utils.js';
import { sbPredictNotice } from '../lib/supabase.js';

const AT_COLOR = {
  "지자체": "#a8b4ff", "교육청": "#ffb86c", "군시설": "#ff79c6",
  "한전": "#f1fa8c", "조달청": "#8be9fd", "LH": "#50fa7b", "수자원공사": "#bd93f9"
};

const fmtOd = (iso) => {
  if (!iso) return "-";
  const d = new Date(iso);
  return (d.getMonth() + 1) + "/" + d.getDate() + " " +
    d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0");
};

const fmtRelTime = (iso) => {
  if (!iso) return null;
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return "방금";
  if (m < 60) return m + "분 전";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "시간 전";
  return new Date(iso).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

export default function NoticesTab({
  notices, setNotices,
  noticeFilter, setNoticeFilter,
  predMap,
  noticeLoadingIds, setNoticeLoadingIds,
  setFocusedPredId, setTab,
  refreshPredictions,
}) {
  const today = new Date().toISOString().slice(0, 10);
  const allSorted = [...notices].sort((a, b) => a.od > b.od ? 1 : -1);
  const filtered =
    noticeFilter === "upcoming" ? allSorted.filter(n => n.od && n.od.slice(0, 10) >= today) :
      noticeFilter === "registered" ? allSorted.filter(n => n.prediction_id) :
        allSorted;
  const regCnt = notices.filter(n => n.prediction_id).length;
  const predDoneCnt = notices.filter(n => n.prediction_id && predMap[n.prediction_id]?.pred_adj_rate != null).length;

  const handlePredictNotice = async (notice) => {
    if (noticeLoadingIds.has(notice.id)) return;
    setNoticeLoadingIds(prev => { const s = new Set(prev); s.add(notice.id); return s; });
    try {
      const result = await sbPredictNotice(notice.id);
      setNotices(prev => prev.map(n => n.id === notice.id ? { ...n, prediction_id: result?.pred_id || n.prediction_id, is_target: true } : n));
      await refreshPredictions();
    } catch (e) { }
    finally { setNoticeLoadingIds(prev => { const s = new Set(prev); s.delete(notice.id); return s; }); }
  };

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px 20px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 14 }}>
        {[
          { l: "전체 수집", v: notices.length + "건", c: C.txm },
          { l: "예측 등록", v: regCnt + "건", c: C.gold },
          { l: "예측 완료", v: predDoneCnt + "건", c: "#5dca96" },
          { l: "최근 수집", v: notices.length > 0 ? fmtRelTime(notices.reduce((a, b) => a.api_fetched_at > b.api_fetched_at ? a : b).api_fetched_at) : "—", c: C.txd }
        ].map((c, i) => (
          <div key={i} style={{ background: C.bg2, border: "1px solid " + C.bdr, borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 10, color: C.txd, marginBottom: 3 }}>{c.l}</div>
            <div style={{ fontSize: i === 3 ? 12 : 18, fontWeight: 600, color: c.c }}>{c.v}</div>
          </div>
        ))}
      </div>
      <div style={{ marginBottom: 12, padding: "10px 14px", background: "rgba(91,157,217,0.06)", border: "1px solid rgba(91,157,217,0.2)", borderRadius: 8, fontSize: 11, color: "#5b9dd9" }}>
        💡 나라장터에서 자동 수집된 공고입니다. 입찰 참여할 공고의 <strong>[예측 등록]</strong> 버튼을 클릭하면 예측탭에 즉시 반영됩니다.
        군부대(UMM)·민간 발주처 공고는 기존처럼 엑셀 업로드를 이용하세요.<br />
        <span style={{ fontSize: 10, color: C.txd }}>※ 과거 샘플 3건 미만 발주사는 "⚠ 데이터 부족"으로 표시 (배지 Hover 시 상세 안내)</span>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center" }}>
        {[{ k: "upcoming", l: "개찰 예정" }, { k: "all", l: "전체 공고" }, { k: "registered", l: "예측 등록됨" }].map(f => (
          <button key={f.k} onClick={() => setNoticeFilter(f.k)}
            style={{ padding: "5px 12px", fontSize: 11, borderRadius: 6, border: "1px solid " + (noticeFilter === f.k ? C.gold : C.bdr), background: noticeFilter === f.k ? "rgba(212,168,52,0.12)" : C.bg3, color: noticeFilter === f.k ? C.gold : C.txm, cursor: "pointer", fontWeight: noticeFilter === f.k ? 600 : 400 }}>
            {f.l}{f.k === "upcoming" ? ` (${allSorted.filter(n => n.od && n.od.slice(0, 10) >= today).length})` : f.k === "registered" ? ` (${regCnt})` : `(${notices.length})`}
          </button>
        ))}
        <span style={{ fontSize: 10, color: C.txd, marginLeft: 4 }}>30분마다 자동 업데이트</span>
      </div>
      <div style={{ border: "1px solid " + C.bdr, borderRadius: 8, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, minWidth: 900 }}>
          <thead><tr style={{ background: C.bg3 }}>
            {["개찰일시", "공고명", "발주기관", "유형", "추정가격", "예측 사정률", "추천 투찰금", "🎯 벤치마크", "액션"].map((h, i) => (
              <th key={i} style={{ padding: "8px 10px", textAlign: i >= 4 && i <= 7 ? "right" : "left", color: h === "🎯 벤치마크" ? "#a8b4ff" : C.txd, fontWeight: 600, borderBottom: "1px solid " + C.bdr, whiteSpace: "nowrap", fontSize: 10 }} title={h === "🎯 벤치마크" ? "SUCVIEW 기반 1위 투찰 추정 (n≥5)" : ""}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={9} style={{ padding: "24px", textAlign: "center", color: C.txd, fontSize: 12 }}>공고 없음</td></tr>}
            {filtered.map(n => {
              const p = n.prediction_id ? predMap[n.prediction_id] : null;
              const hasPred = p?.pred_adj_rate != null;
              const noPred = n.prediction_id && !hasPred;
              const isLoading = noticeLoadingIds.has(n.id);
              const isUmm = n.pn_no && (n.pn_no.startsWith("UMM") || n.pn_no.startsWith("E0"));
              const atClr = AT_COLOR[n.at] || "#a8a8ff";
              const bid1st = hasPred && p.pred_bid_amount && p.pred_floor_rate ?
                Math.round(Number(p.pred_bid_amount) * Number(p.pred_floor_rate) / (Number(p.pred_floor_rate) + (WIN_OPT_GAP[n.at] || 0.3))) : null;
              const msToOd = n.od ? (new Date(n.od).getTime() - Date.now()) : null;
              const urgent2h = msToOd != null && msToOd > 0 && msToOd <= 2 * 3600 * 1000;
              const near24h = msToOd != null && msToOd > 2 * 3600 * 1000 && msToOd <= 24 * 3600 * 1000;
              const leftBar = urgent2h ? "3px solid #e24b4a" : near24h ? "3px solid #d4a834" : "3px solid transparent";
              return (
                <tr key={n.id} style={{ borderBottom: "1px solid " + C.bdr + "33", opacity: n.od && n.od.slice(0, 10) < today ? 0.55 : 1, transition: "background .1s", borderLeft: leftBar }}
                  onMouseEnter={e => e.currentTarget.style.background = C.bg3}
                  onMouseLeave={e => e.currentTarget.style.background = ""}>
                  <td style={{ padding: "8px 10px", color: urgent2h ? "#e24b4a" : near24h ? "#d4a834" : C.txt, whiteSpace: "nowrap", fontFamily: "monospace", fontSize: 10, fontWeight: urgent2h || near24h ? 700 : 400 }}
                    title={urgent2h ? "⏰ 2시간 내 개찰 긴급" : near24h ? "⏰ 24시간 내 개찰 임박" : ""}>{urgent2h ? "⏰ " : near24h ? "⏰ " : ""}{fmtOd(n.od)}</td>
                  <td style={{ padding: "8px 10px", color: C.txt, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={n.pn}>{n.pn}</td>
                  <td style={{ padding: "8px 10px", color: C.txm, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={n.ag}>{n.ag}</td>
                  <td style={{ padding: "8px 10px" }}><span style={{ fontSize: 9, padding: "1px 5px", background: atClr + "18", border: "1px solid " + atClr + "44", borderRadius: 4, color: atClr }}>{n.at}</span></td>
                  <td style={{ padding: "8px 10px", color: C.txt, textAlign: "right", fontFamily: "monospace", fontSize: 10 }}>{n.ep ? Number(n.ep).toLocaleString() : "-"}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: hasPred ? "#5dca96" : C.txd, fontFamily: "monospace", fontWeight: hasPred ? 700 : 400, fontSize: 10 }}>
                    {hasPred ? (100 + Number(p.pred_adj_rate)).toFixed(4) + "%" : "—"}
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: hasPred ? C.gold : C.txd, fontFamily: "monospace", fontWeight: hasPred ? 700 : 400, fontSize: 10 }}>
                    {hasPred && bid1st ? tc(bid1st) : (hasPred && p.pred_bid_amount ? tc(Number(p.pred_bid_amount)) : "—")}
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "right", color: p?.benchmark_bid ? "#a8b4ff" : C.txd, fontFamily: "monospace", fontWeight: p?.benchmark_bid ? 600 : 400, fontSize: 10 }}
                      title={p?.benchmark_n ? "n=" + p.benchmark_n + (p.benchmark_rate != null ? " · " + Number(p.benchmark_rate).toFixed(4) + "%" : "") : ""}>
                    {p?.benchmark_bid ? tc(Number(p.benchmark_bid)) : "—"}
                  </td>
                  <td style={{ padding: "8px 10px", textAlign: "center", whiteSpace: "nowrap" }}>
                    {isUmm ? <span style={{ fontSize: 9, color: C.txd }}>엑셀 업로드</span> :
                      hasPred ? <button onClick={() => {
                        if (p) setFocusedPredId(p.id);
                        setTab("predict");
                      }} style={{ fontSize: 9, padding: "3px 8px", background: "rgba(93,202,150,.1)", border: "1px solid rgba(93,202,150,.3)", borderRadius: 4, color: "#5dca96", cursor: "pointer" }}>✅ 예측완료 →</button> :
                        noPred ? <span title={"⚠ 데이터 부족\n이 발주사의 과거 낙찰 샘플이 3건 미만입니다.\n신규/민간/소형 기관이거나 학습 데이터가 누적되지 않았습니다.\nSUCVIEW 파일(인포21c)을 업로드해 수동 예측을 보강하세요."} style={{ fontSize: 9, padding: "2px 6px", background: "rgba(168,168,255,.08)", border: "1px solid rgba(168,168,255,.2)", borderRadius: 4, color: "#a8a8ff", cursor: "help" }}>⚠ 데이터부족</span> :
                          isLoading ? <span style={{ fontSize: 9, color: C.txd }}>처리중...</span> :
                            <button onClick={() => handlePredictNotice(n)}
                              style={{ fontSize: 10, padding: "4px 10px", background: "rgba(91,157,217,0.1)", border: "1px solid rgba(91,157,217,0.4)", borderRadius: 5, color: "#5b9dd9", cursor: "pointer", fontWeight: 600 }}>
                              📋 예측 등록
                            </button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: C.txd }}>
        UMM(군부대)·민간 공고는 나라장터 API 미제공 — 기존 엑셀 업로드 사용 |
        나라장터 공고는 예측 등록 버튼으로 즉시 처리
      </div>
    </div>
  );
}
