// 투찰 카드 (P3) — 공고 하나의 추천·경쟁 구도·1위 이력 3블록. 표시 전용.
// 추천값(rec)은 App의 recOf(=bidCard.js recOfPred)에서 받는다 — 오늘의 공고 표와 같은 값.
// 스펙: docs/superpowers/specs/2026-10-22-bid-ops-funnel-redesign-design.md §6.3
import React, { useState } from "react";
import { C } from "../lib/constants.js";
import { tc, normalizeAgencyName } from "../lib/utils.js";
import { floorPassLabel } from "../lib/floorLabels.js";
import { calcEffectiveFloorRate, formatFloorDual } from "../lib/effectiveFloor.js";
import { resolvePcDist, pcWinRateOf, PC_GRAIN_LABELS } from "../lib/participantCount.js";
import { predConfidenceV2 } from "../lib/predConfidence.js";
import { agencyRecentHistory } from "../lib/bidCard.js";
import ParticipantMatrixModal from "./ParticipantMatrixModal.jsx";

const RED = "#e24b4a", GREEN = "#5dca96", GOLD = C.gold;
const PASS_OK = 90;
const pct4 = (adj) => adj == null ? "—" : (100 + Number(adj)).toFixed(4) + "%";
const won = (v) => v ? tc(Math.round(Number(v))) + "원" : "—";
const box = { background: C.bg3, border: "1px solid " + C.bdr, borderRadius: 8, padding: "12px 14px", marginBottom: 10 };
const h = { fontSize: 11, color: C.txm, fontWeight: 600, marginBottom: 8 };
const big = (color) => ({ fontSize: 22, fontWeight: 700, fontFamily: "monospace", color, lineHeight: 1.2 });
const lbl = { fontSize: 10, color: C.txd, marginBottom: 2 };
const row = { display: "flex", justifyContent: "space-between", fontSize: 11, padding: "3px 0", color: C.txm };
const mono = { fontFamily: "monospace", color: C.txt };

export default function BidCard({ pred: d, rec, recs, pcDistMap, ownScore, accuracyMap, onClose, onOpenG2B }) {
  const [showWhy, setShowWhy] = useState(false);
  const [showMatrix, setShowMatrix] = useState(false);
  if (!d) return null;
  const r = rec || {};
  const ag = d.canonical_ag || normalizeAgencyName(d.ag);
  const ba = Number(d.ba) || 0, av = Number(d.av) || 0, fr = Number(d.pred_floor_rate) || 0;
  const modeA = r.mode === "A";
  const passColor = r.passPct == null ? C.txd : r.passPct < PASS_OK ? RED : GREEN;
  const floorBid = ba > 0 && fr > 0 ? (av > 0 ? Math.ceil(av + (ba - av) * fr / 100) : Math.ceil(ba * fr / 100)) : null;
  const conf = predConfidenceV2(d.pred_source, accuracyMap, { at: d.at, ag: d.ag, ba: d.ba });
  const pc = pcDistMap && d.at && ba ? resolvePcDist(pcDistMap, { at: d.at, canonicalAg: ag, ba }) : null;
  const winRate = pc && d.at === "지자체" && pc.grain !== "AT_BA" ? pcWinRateOf(pc.p50) : null;
  const hist = agencyRecentHistory(recs, ag, 20);
  const recP100 = r.adj != null ? 100 + Number(r.adj) : null;
  const inRange = recP100 != null && hist.p25 != null ? recP100 >= hist.p25 && recP100 <= hist.p75 : null;
  // 개찰 후 결과 — 옛 상세 모달과 같은 판정(추천 투찰금 vs 실제 1위 금액·하한선)
  const ab = Number(d.actual_bid_amount) || null, axp = Number(d.actual_expected_price) || null;
  const floorLine = axp ? (av > 0 ? av + (axp - av) * fr / 100 : axp * fr / 100) : null;
  const result = d.match_status === "matched" && ab && r.bid ? (r.bid > ab ? "1위보다 높음" : floorLine && r.bid < floorLine ? "하한 미달" : "1위 가능 금액") : null;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.bg2, border: "1px solid " + C.bdr, borderRadius: 12, padding: "18px 22px", maxWidth: 720, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.pn}>{d.pn || "—"}</div>
            <div style={{ fontSize: 11, color: C.txm, marginTop: 3 }}>
              공고번호 <span style={{ fontFamily: "monospace", color: C.txt }}>{d.pn_no || "—"}</span> · {d.ag} · {d.at} · 개찰 {d.open_date || "—"} · 기초금액 {ba ? tc(ba) + "원" : "—"}{r.estimated ? " (추정)" : ""}
              <span style={{ marginLeft: 8, fontSize: 10, padding: "1px 6px", borderRadius: 4, border: "1px solid " + (modeA ? GOLD : GREEN), color: modeA ? GOLD : GREEN }}>{modeA ? "공략 모드" : "안착 모드"}</span>
            </div>
          </div>
          <button onClick={onClose} aria-label="닫기" style={{ background: "transparent", border: "none", color: C.txd, fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        {result && (
          <div style={{ ...box, borderColor: result === "1위 가능 금액" ? GREEN : RED, fontSize: 11, color: C.txm }}>
            개찰 결과 — 실제 사정률 <span style={mono}>{pct4(d.actual_adj_rate)}</span> · 실제 1위 <span style={mono}>{won(ab)}</span> · 추천 투찰금 판정 <b style={{ color: result === "1위 가능 금액" ? GREEN : RED }}>{result}</b>
          </div>
        )}

        {/* 블록 1 — 추천 */}
        <div style={box}>
          <div style={h}>추천</div>
          {r.jongsim ? (
            <div style={{ fontSize: 12, color: RED }}>종심제·순심제 대형 공사 — 예측을 지원하지 않습니다. 나라장터의 과거 낙찰률 분포를 직접 참고하세요.</div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
                <div><div style={lbl}>추천 사정률</div><div style={big(r.floorSafe === false ? RED : GREEN)}>{pct4(r.adj)}</div></div>
                <div><div style={lbl}>투찰금액</div><div style={big(r.floorSafe === false ? RED : GOLD)}>{won(r.bid)}</div></div>
                <div><div style={lbl}>하한 통과 확률</div><div style={big(passColor)}>{r.passPct == null ? "—" : floorPassLabel(100 - r.passPct)}</div></div>
              </div>
              {r.floorSafe === false && <div style={{ marginTop: 8, fontSize: 11, color: RED, fontWeight: 600 }}>자격 미달 — 그대로 투찰 시 자동 탈락</div>}
              {r.adj == null && d.source !== "file_upload" && <div style={{ marginTop: 6, fontSize: 11, color: C.txd }}>자동 예측에는 이 공고의 추천값이 없습니다(군시설 공략안은 엑셀 업로드 예측에서만 계산). 입찰서류함 엑셀을 올리면 채워집니다.</div>}
              {r.estimated && <div style={{ marginTop: 6, fontSize: 10, color: C.txd }}>추정 기초금액(추정가격×1.1) 기준 — 기초금액 공개 후 입찰서류함 엑셀을 올리면 확정됩니다.</div>}
              <div style={{ marginTop: 6, fontSize: 11, color: C.txm }}>{modeA ? "군시설은 1위 가능 구간이 있습니다. 하한 통과 확률로 안전 여부를 함께 보세요." : "목표는 하한 미달 탈락 방지입니다. 1위는 추첨에 가깝습니다."}</div>
            </>
          )}
          <button onClick={() => setShowWhy(v => !v)} style={{ marginTop: 8, background: "transparent", border: "none", color: C.txd, fontSize: 11, cursor: "pointer", padding: 0 }}>{showWhy ? "▾" : "▸"} 근거</button>
          {showWhy && (
            <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid " + C.bdr }}>
              <div style={row}><span>통과 확률 표본</span><span style={mono}>{r.distN != null ? `${r.distN}건 · ${r.distGrain === "AG" ? "이 발주기관" : "기관유형"}` : "과거 기록 부족"}</span></div>
              <div style={row}><span>신뢰도</span><span style={mono}>{conf.level === "high" ? "높음" : conf.level === "med" ? "보통" : "데이터 부족"}{conf.srcLabel ? ` · ${conf.srcLabel}` : ""}</span></div>
              <div style={row}><span>2순위 안 (보수)</span><span style={mono}>{d.rec_adj_p75 != null ? `${pct4(d.rec_adj_p75)} · ${won(d.rec_bid_p75)}` : "—"}</span></div>
              <div style={row}><span>자사 유효 하한율</span><span style={mono}>{fr ? formatFloorDual(fr, calcEffectiveFloorRate(d.at, fr, ownScore)) : "—"}</span></div>
              <div style={row}><span>최소 하한금액 (이하 투찰 시 무효)</span><span style={mono}>{won(floorBid)}</span></div>
              {modeA && d.b_pred_adj != null && Number(d.b_pred_adj) !== Number(r.adj) && (
                <div style={row}><span>V2 공략안</span><span style={mono}>{pct4(d.b_pred_adj)} · {won(d.b_pred_bid_amount)}</span></div>
              )}
            </div>
          )}
        </div>

        {/* 블록 2 — 경쟁 구도 */}
        <div style={box}>
          <div style={h}>경쟁 구도</div>
          {pc ? (
            <div style={{ fontSize: 12, color: C.txm }}>
              예상 참가자 <b style={mono}>~{tc(pc.p50)}개사</b> (p25~p75 {tc(pc.p25)}~{tc(pc.p75)}) · {PC_GRAIN_LABELS[pc.grain] || pc.grain} 직전 1년 {pc.n}건
              {winRate != null && <span> · 이 구간 실측 1순위율 <b style={mono}>{winRate.toFixed(1)}%</b></span>}
            </div>
          ) : <div style={{ fontSize: 12, color: C.txd }}>과거 참가자 기록이 부족합니다.</div>}
          <button onClick={() => setShowMatrix(true)} style={{ marginTop: 8, fontSize: 11, padding: "4px 10px", background: "transparent", border: "1px solid " + C.bdr, borderRadius: 5, color: C.txm, cursor: "pointer" }}>참여사 분포 보기</button>
          {showMatrix && <ParticipantMatrixModal ag={ag} highlightPnno={d.pn_no} onClose={() => setShowMatrix(false)} />}
        </div>

        {/* 블록 3 — 1위 사정률 이력 */}
        <div style={{ ...box, marginBottom: 0 }}>
          <div style={{ ...h, display: "flex", justifyContent: "space-between" }}>
            <span>이 발주처의 1위 사정률 이력 (최근 {hist.count}건{hist.autoCount > 0 ? ` · 자동 ${hist.autoCount}건 포함` : ""})</span>
            <button onClick={() => onOpenG2B?.(ag)} style={{ background: "transparent", border: "none", color: GOLD, fontSize: 11, cursor: "pointer", padding: 0 }}>G2B 양식에서 전체 보기 →</button>
          </div>
          {hist.count === 0 ? <div style={{ fontSize: 12, color: C.txd }}>이 발주처의 1위 기록이 없습니다.</div> : (
            <>
              <div style={{ fontSize: 12, color: C.txm, marginBottom: 8 }}>
                1위 사정률 P25 <span style={mono}>{hist.p25.toFixed(4)}%</span> · P50 <span style={mono}>{hist.p50.toFixed(4)}%</span> · P75 <span style={mono}>{hist.p75.toFixed(4)}%</span>
                {inRange != null && <span> — 추천 사정률은 이 범위 <b style={{ color: inRange ? GREEN : GOLD }}>{inRange ? "안" : "밖"}</b></span>}
              </div>
              <div style={{ maxHeight: 220, overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead><tr>{["개찰일", "1위 사정률", "발주처 사정률", "공고명"].map((t, i) => <th key={t} style={{ textAlign: i === 3 ? "left" : i === 0 ? "left" : "right", color: C.txd, fontWeight: 600, padding: "4px 6px", borderBottom: "1px solid " + C.bdr }}>{t}</th>)}</tr></thead>
                  <tbody>{hist.rows.map((h2, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid " + C.bdr + "55" }}>
                      <td style={{ padding: "3px 6px", ...mono }}>{h2.auto && <span title="나라장터 자동 수집 · 계산값 · 엑셀 대조 중" style={{ fontSize: 9, padding: "0 4px", marginRight: 4, borderRadius: 3, border: "1px solid " + C.bdr, color: C.txm }}>자동</span>}{h2.od}</td>
                      <td style={{ padding: "3px 6px", textAlign: "right", ...mono }}>{h2.br1.toFixed(4)}%</td>
                      <td style={{ padding: "3px 6px", textAlign: "right", ...mono }}>{h2.ar1 != null ? h2.ar1.toFixed(4) + "%" : "—"}</td>
                      <td style={{ padding: "3px 6px", color: C.txm, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={h2.pn}>{h2.pn}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
