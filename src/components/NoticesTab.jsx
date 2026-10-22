// 오늘의 공고 (P2) — 공고(bid_notices)와 예측(bid_predictions)을 공고번호로 합친 작업 목록.
// 표시 전용: 추천 3열은 App.jsx의 todayRecMap(예측 리스트와 같은 계산)을 읽기만 한다.
// 스펙: docs/superpowers/specs/2026-10-22-bid-ops-funnel-redesign-design.md §6.2
import React, { useMemo, useRef, useState } from 'react';
import { C } from '../lib/constants.js';
import { tc, normalizeAgencyName } from '../lib/utils.js';
import { sbPredictNotice } from '../lib/supabase.js';
import { resolvePcDist, pcWinRateOf, PC_GRAIN_LABELS } from '../lib/participantCount.js';
import { loadKeywords } from '../lib/eligibility.js';
import { buildTodayRows, filterRows, STATUS } from '../lib/todayNotices.js';

const RED = "#e24b4a", YEL = "#d4a834", GREEN = "#5dca96", BLUE = "#5b9dd9";
const PASS_OK = 90;
const PAGE = 50;
const STATUS_LABEL = { [STATUS.OPENED]: "개찰 완료", [STATUS.CLOSED]: "마감", [STATUS.BID]: "투찰 기록", [STATUS.PRED_FILE]: "예측(엑셀)", [STATUS.PRED_AUTO]: "예측(자동)", [STATUS.NONE]: "예측 없음" };

const pad2 = (n) => String(n).padStart(2, "0");
const fmtDt = (iso) => { if (!iso) return "—"; const d = new Date(iso); return (d.getMonth() + 1) + "/" + d.getDate() + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()); };
const fmtDay = (iso) => { if (!iso) return "—"; const d = new Date(iso); return (d.getMonth() + 1) + "/" + d.getDate(); };
const td = (extra) => ({ padding: "7px 9px", fontSize: 11, color: C.txt, whiteSpace: "nowrap", ...extra });
const mono = { fontFamily: "monospace", textAlign: "right" };
const badge = (color) => ({ fontSize: 9, padding: "1px 6px", borderRadius: 4, border: "1px solid " + color + "66", background: color + "18", color, whiteSpace: "nowrap" });
const btn = (active, color) => ({ padding: "5px 12px", fontSize: 11, borderRadius: 6, border: "1px solid " + (active ? color : C.bdr), background: active ? color + "1f" : C.bg3, color: active ? color : C.txm, cursor: "pointer" });

export default function NoticesTab({
  notices, setNotices,
  noticeFilter, setNoticeFilter,
  todayRecMap, predictions, loadPredFiles,
  noticeLoadingIds, setNoticeLoadingIds,
  setFocusedPredId, setTab,
  refreshPredictions,
  pcDistMap,
}) {
  const keywords = useMemo(() => loadKeywords(), []);
  const [includeDone, setIncludeDone] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const fileRef = useRef(null);
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);

  const pcOf = ({ at, ag, amount }) => pcDistMap && at && amount ? resolvePcDist(pcDistMap, { at, canonicalAg: normalizeAgencyName(ag), ba: amount }) : null;
  const rows = useMemo(() => buildTodayRows({ notices, predictions: predictions || [], keywords, pcOf, nowIso }), [notices, predictions, pcDistMap, keywords]); // eslint-disable-line react-hooks/exhaustive-deps
  const view = noticeFilter === "all" ? "all" : "target";
  const visible = filterRows(rows, view, includeDone);
  const targetUpcoming = filterRows(rows, "target", false);
  const dueToday = targetUpcoming.filter(r => r.closeAt && String(new Date(r.closeAt).toISOString()).slice(0, 10) === today).length;
  const noPred = targetUpcoming.filter(r => r.status === STATUS.NONE).length;

  const handlePredictNotice = async (noticeId) => {
    if (noticeLoadingIds.has(noticeId)) return;
    setNoticeLoadingIds(prev => { const s = new Set(prev); s.add(noticeId); return s; });
    try {
      const result = await sbPredictNotice(noticeId);
      setNotices(prev => prev.map(n => n.id === noticeId ? { ...n, prediction_id: result?.pred_id || n.prediction_id, is_target: true } : n));
      await refreshPredictions();
    } catch (e) { }
    finally { setNoticeLoadingIds(prev => { const s = new Set(prev); s.delete(noticeId); return s; }); }
  };

  const recOf = (r) => (r.predId != null && todayRecMap) ? todayRecMap[r.predId] : null;

  return (
    <div style={{ padding: "16px 20px", boxSizing: "border-box", maxWidth: "100%" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 12 }}>
        {[["관내·소경쟁 예정", targetUpcoming.length + "건", C.gold], ["오늘 마감", dueToday + "건", dueToday ? RED : C.txm], ["예측 없음", noPred + "건", noPred ? YEL : C.txm]].map(([l, v, c]) => (
          <div key={l} style={{ background: C.bg2, border: "1px solid " + C.bdr, borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 10, color: C.txd, marginBottom: 3 }}>{l}</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: c }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={() => setNoticeFilter("target")} style={btn(view === "target", C.gold)}>관내·소경쟁 ({targetUpcoming.length})</button>
        <button onClick={() => setNoticeFilter("all")} style={btn(view === "all", BLUE)}>전체 예정 ({filterRows(rows, "all", false).length})</button>
        <button onClick={() => setIncludeDone(v => !v)} style={btn(includeDone, C.txm)}>마감·개찰 지난 것 포함</button>
        <span style={{ flex: 1 }} />
        <input ref={fileRef} type="file" accept=".xls,.xlsx" multiple style={{ display: "none" }} onChange={e => { if (e.target.files?.length) loadPredFiles(e.target.files); e.target.value = ""; }} />
        <button onClick={() => fileRef.current?.click()} style={btn(true, GREEN)}>입찰서류함 엑셀 업로드</button>
        <span style={{ fontSize: 10, color: C.txd }}>키워드 "{keywords.join(", ")}" · 참가자 300개사 미만 · 마감 임박순</span>
      </div>
      <div style={{ border: "1px solid " + C.bdr, borderRadius: 8, overflowX: "auto", maxWidth: "100%" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
          <thead><tr style={{ background: C.bg3 }}>
            {["구분", "마감", "발주처", "공고명", "기초금액", "예상참가", "추천 사정률", "투찰금액", "통과 확률", "상태"].map((h, i) => (
              <th key={h} style={{ padding: "8px 9px", textAlign: i >= 4 && i <= 8 ? "right" : "left", color: C.txd, fontWeight: 600, borderBottom: "1px solid " + C.bdr, whiteSpace: "nowrap", fontSize: 10 }}
                title={h === "예상참가" ? "같은 발주기관·금액대의 직전 1년 개찰 실측 참가자수 중앙값 (지자체는 실측 1순위율 병기)" : h === "통과 확률" ? "발주기관의 과거 발주처 사정율 대비 투찰금이 하한가 위에 안착할 확률 (예측 탭과 같은 계산)" : h === "기초금액" ? "공고에 기초금액이 없으면 추정가격×1.1 (추정 배지)" : ""}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {visible.length === 0 && <tr><td colSpan={10} style={{ padding: 24, textAlign: "center", color: C.txd, fontSize: 12 }}>표시할 공고가 없습니다</td></tr>}
            {visible.slice(0, shown).map(r => {
              const rec = recOf(r);
              const msToClose = r.closeAt ? new Date(r.closeAt).getTime() - Date.now() : null;
              const urgent = msToClose != null && msToClose > 0 && msToClose <= 2 * 3600e3;
              const soon = msToClose != null && msToClose > 2 * 3600e3 && msToClose <= 24 * 3600e3;
              const dtColor = urgent ? RED : soon ? YEL : C.txt;
              const passColor = rec?.passPct == null ? C.txd : rec.passPct < PASS_OK ? RED : GREEN;
              const winRate = r.at === "지자체" && r.p50 != null && r.grain !== "AT_BA" ? pcWinRateOf(r.p50) : null;
              const done = r.status === STATUS.OPENED || r.status === STATUS.CLOSED;
              const isLoading = r.noticeId != null && noticeLoadingIds.has(r.noticeId);
              return (
                <tr key={r.key} style={{ borderBottom: "1px solid " + C.bdr + "55", opacity: done ? 0.55 : 1, borderLeft: "3px solid " + (urgent ? RED : soon ? YEL : "transparent") }}
                  onMouseEnter={e => e.currentTarget.style.background = C.bg3} onMouseLeave={e => e.currentTarget.style.background = ""}>
                  <td style={td({})}><span style={badge(r.group === "target" ? C.gold : C.txd)}>{r.group === "target" ? "관내·소경쟁" : "일반"}</span></td>
                  <td style={td({ ...mono, textAlign: "left", color: dtColor, fontWeight: urgent || soon ? 700 : 400 })} title={r.closeAt ? "투찰 마감 " + r.closeAt + "\n개찰 " + (r.openAt || "—") : "마감일시 없음(엑셀 업로드 예측) — 개찰일 " + (r.openAt || "—")}>
                    {r.closeAt ? fmtDt(r.closeAt) : "개찰 " + fmtDay(r.openAt)}
                  </td>
                  <td style={td({ color: C.txm, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis" })} title={r.ag}>{r.ag || "—"}</td>
                  <td style={td({ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" })} title={r.pn}>{r.pn || "—"}</td>
                  <td style={td({ ...mono, fontSize: 10 })} title={r.amountEstimated ? "추정가격×1.1 — 기초금액 공개 후 엑셀 업로드로 확정" : "기초금액"}>
                    {r.amount ? tc(Math.round(r.amount)) : "—"}{r.amountEstimated && r.amount ? <span style={{ ...badge(C.txd), marginLeft: 4 }}>추정</span> : null}
                  </td>
                  <td style={td({ ...mono, fontSize: 10, color: r.p50 != null && r.grain !== "AT_BA" && r.p50 < 300 ? C.gold : C.txm })}
                    title={r.p50 != null ? `예상 참가자수 ~${tc(r.p50)}개 · ${PC_GRAIN_LABELS[r.grain] || r.grain || ""}` : "과거 기록 부족"}>
                    {r.p50 != null ? tc(r.p50) + (winRate != null ? ` (1순위율 ${winRate.toFixed(1)}%)` : "") : "—"}
                  </td>
                  <td style={td({ ...mono, color: rec?.adj != null ? (rec.estimated ? C.txm : GREEN) : C.txd, fontWeight: rec?.adj != null ? 700 : 400 })}>
                    {rec?.adj != null ? (100 + Number(rec.adj)).toFixed(4) + "%" : "—"}
                  </td>
                  <td style={td({ ...mono, color: rec?.bid ? (rec.estimated ? C.txm : C.gold) : C.txd, fontWeight: rec?.bid ? 700 : 400 })}>
                    {rec?.bid ? tc(Math.round(Number(rec.bid))) + "원" : "—"}
                  </td>
                  <td style={td({ ...mono, color: passColor, fontWeight: rec?.passPct != null ? 700 : 400 })}>
                    {rec?.passPct != null ? Math.round(rec.passPct) + "%" : rec?.jongsim ? "종심제" : "—"}
                  </td>
                  <td style={td({ textAlign: "left" })}>
                    {r.status === STATUS.NONE && r.noticeId != null ? (
                      isLoading ? <span style={{ fontSize: 10, color: C.txd }}>처리 중</span> :
                        <button onClick={() => handlePredictNotice(r.noticeId)} style={{ fontSize: 10, padding: "3px 9px", background: BLUE + "1a", border: "1px solid " + BLUE + "66", borderRadius: 5, color: BLUE, cursor: "pointer", fontWeight: 600 }}>예측 등록</button>
                    ) : (r.status === STATUS.PRED_FILE || r.status === STATUS.PRED_AUTO) && r.predId != null ? (
                      <button onClick={() => { setFocusedPredId(r.predId); setTab("predict"); }} style={{ fontSize: 10, padding: "3px 9px", background: "transparent", border: "1px solid " + C.bdr, borderRadius: 5, color: C.txm, cursor: "pointer" }}>{STATUS_LABEL[r.status]}</button>
                    ) : <span style={{ fontSize: 10, color: C.txd }}>{STATUS_LABEL[r.status]}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {visible.length > shown && <div style={{ textAlign: "center", marginTop: 8 }}><button onClick={() => setShown(s => s + PAGE)} style={btn(false, C.txm)}>더 보기 ({visible.length - shown}건 남음)</button></div>}
      <div style={{ marginTop: 8, fontSize: 10, color: C.txd, lineHeight: 1.6 }}>
        군부대(UMM)·민간 공고는 나라장터 API에 없어 엑셀 업로드 예측이 단독 행으로 표시됩니다. 자동 예측의 추천은 추정 기초금액 기준이며 예측 탭과 같은 산식입니다.
      </div>
    </div>
  );
}
