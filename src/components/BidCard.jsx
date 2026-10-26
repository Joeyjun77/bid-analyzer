// 투찰 카드 (P3) — 공고 하나의 추천·경쟁 구도·1위 이력 3블록. 표시 전용.
// 추천값(rec)은 App의 recOf(=bidCard.js recOfPred)에서 받는다 — 오늘의 공고 표와 같은 값.
// 스펙: docs/superpowers/specs/2026-10-22-bid-ops-funnel-redesign-design.md §6.3
import React, { useState, useMemo } from "react";
import { C } from "../lib/constants.js";
import { tc, normalizeAgencyName } from "../lib/utils.js";
import { floorPassLabel } from "../lib/floorLabels.js";
import { calcEffectiveFloorRate, formatFloorDual } from "../lib/effectiveFloor.js";
import { resolvePcDist, pcWinRateOf, PC_GRAIN_LABELS } from "../lib/participantCount.js";
import { predConfidenceV2 } from "../lib/predConfidence.js";
import { agencyRecentHistory, agencyTrend, capSigmaOfSrc, isLargeTender, distOfSrc, candidateBacktest, refDateOf } from "../lib/bidCard.js";
import { roundExpectedPrice } from "../lib/fmtAdj.js";
import { bidVerdict } from "../lib/rec1stPossible.js";
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
// 카드 안 보조 동작 버튼(근거·참여사 분포) — 어두운 배경에서도 눈에 띄게
const CELL = { padding: "3px 6px", borderBottom: "1px solid " + C.bdr + "55" };
const actBtn = { marginTop: 10, fontSize: 12, fontWeight: 600, padding: "6px 14px", background: "rgba(212,168,52,0.10)", border: "1px solid " + GOLD, borderRadius: 6, color: GOLD, cursor: "pointer" };

export default function BidCard({ pred: d, rec, attack, recs, pcDistMap, ownScore, accuracyMap, onClose, onOpenG2B }) {
  const [showWhy, setShowWhy] = useState(false);
  const [showMatrix, setShowMatrix] = useState(false);
  const [showCmp, setShowCmp] = useState(false);
  // 후보 비교표 과거 성적 — 펼칠 때만 계산(기관 행 정렬·누적). 훅이라 early return 위에 둔다
  const cmp = useMemo(() => !showCmp || !d ? null : candidateBacktest(recs, {
    canonicalAg: d.canonical_ag || normalizeAgencyName(d.ag), at: d.at, ref: refDateOf(d.open_date, new Date().toLocaleDateString("sv-SE")), ownScore,
  }), [showCmp, recs, d, ownScore]);
  if (!d) return null;
  const r = rec || {};
  const ag = d.canonical_ag || normalizeAgencyName(d.ag);
  const ba = Number(d.ba) || 0, av = Number(d.av) || 0, fr = Number(d.pred_floor_rate) || 0;
  const modeA = r.mode === "A";
  const passColor = r.passPct == null ? C.txd : r.passPct < PASS_OK ? RED : GREEN;
  const effFr = fr ? calcEffectiveFloorRate(d.at, fr, ownScore) : 0;
  // 사정률 100%(예정가격=기초금액) 가정의 자사 하한금액 참고값 — 실제 하한가는 개찰 때 예정가격으로 정해진다
  const floorBid = ba > 0 && effFr > 0 ? (av > 0 ? Math.ceil(av + (ba - av) * effFr / 100) : Math.ceil(ba * effFr / 100)) : null;
  const conf = predConfidenceV2(d.pred_source, accuracyMap, { at: d.at, ag: d.ag, ba: d.ba });
  const pc = pcDistMap && d.at && ba ? resolvePcDist(pcDistMap, { at: d.at, canonicalAg: ag, ba }) : null;
  const winRate = pc && d.at === "지자체" && pc.grain !== "AT_BA" ? pcWinRateOf(pc.p50) : null;
  const trend = agencyTrend(recs, ag, { openDate: d.open_date, today: new Date().toLocaleDateString("sv-SE") });
  const hist = agencyRecentHistory(recs, ag, 20, trend.ref); // 동향 줄과 같은 기준일 — 개찰 후 카드에 개찰 이후 결과가 섞이지 않게
  const mainSrc = d.source === "file_upload" ? d.bid1st_v2_src : d.b_pred_src;
  const capSigma = modeA ? null : capSigmaOfSrc(mainSrc);
  // 후보 비교표 값 열 — 메인 추천과 같은 저장 분포(μ·σ), 투찰금은 카드와 같은 식(자사 유효 하한율·LH 예정가격 절상)
  const cmpDist = modeA || r.adj == null ? null : distOfSrc(mainSrc);
  const bidOfAdj = (x) => Math.ceil(av + (roundExpectedPrice(d.at, ba * (1 + x / 100)) - av) * effFr / 100);
  const cands = cmpDist ? [
    { key: "safe", label: "현재 추천 (안전선)", adj: Number(r.adj), bid: r.bid },
    { key: "p75", label: "평균+0.67σ (1위 분포 상위 25% 지점)", adj: cmpDist.mu + 0.6745 * cmpDist.sigma },
    { key: "p50", label: "1위 분포 평균" + (attack ? " (공격안과 같은 기준 — 공격안은 오늘까지 전체 분포)" : ""), adj: cmpDist.mu },
  ].map(c => ({ ...c, bid: c.bid ?? (ba > 0 && effFr > 0 ? bidOfAdj(c.adj) : null) })) : null;
  const recP100 = r.adj != null ? 100 + Number(r.adj) : null;
  const inRange = recP100 != null && hist.p25 != null ? recP100 >= hist.p25 && recP100 <= hist.p75 : null;
  // 개찰 후 결과 — 매칭된 낙찰 기록의 실제 1위 금액·하한가로 판정(서버 rec_1st_possible과 같은 정의, 동액은 1위 아님)
  const matched = d.match_status === "matched";
  const matchedRec = matched ? (recs || []).find(x => x.id === d.matched_record_id) : null;
  const ab = Number(d.actual_bid_amount) || Number(matchedRec?.bp) || null; // 예측 행에 1위 금액이 없으면 낙찰 기록 값(표의 판정과 같은 출처)
  const verdict = r.bid ? bidVerdict(r.bid, matchedRec) : null;
  const result = verdict ? { possible: "1위 가능 금액", above: "1위 이상", below_floor: "하한 미달" }[verdict] : null;

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

        {matched && (
          <div style={{ ...box, borderColor: !result ? C.bdr : result === "1위 가능 금액" ? GREEN : RED, fontSize: 11, color: C.txm }}>
            개찰 결과 — 실제 사정률 <span style={mono}>{pct4(d.actual_adj_rate)}</span> · 실제 1위 <span style={mono}>{won(ab)}</span>{result && <> · 추천 투찰금 판정 <b style={{ color: result === "1위 가능 금액" ? GREEN : RED }}>{result}</b></>}
          </div>
        )}

        {/* 블록 1 — 추천 */}
        <div style={box}>
          <div style={h}>추천</div>
          {r.jongsim ? (
            <div style={{ fontSize: 12, color: RED }}>종심제·순심제 대형 공사 — 예측을 지원하지 않습니다. 나라장터의 과거 낙찰률 분포를 직접 참고하세요.</div>
          ) : (
            <>
              {isLargeTender(d) && <div style={{ marginBottom: 8, fontSize: 11, color: RED, fontWeight: 600 }}>추정가격 300억 이상 — 종합심사·종합평가 낙찰제 대상일 수 있어, 적격심사 하한율로 계산한 이 추천 투찰금은 근거가 없을 수 있습니다. 공고문의 낙찰자 결정 방법을 확인하세요.</div>}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
                <div><div style={lbl}>추천 사정률</div><div style={big(r.floorSafe === false ? RED : GREEN)}>{pct4(r.adj)}</div></div>
                <div><div style={lbl}>투찰금액</div><div style={big(r.floorSafe === false ? RED : GOLD)}>{won(r.bid)}</div></div>
                <div><div style={lbl}>하한 통과 확률</div><div style={big(passColor)}>{r.passPct == null ? "—" : floorPassLabel(100 - r.passPct)}</div></div>
              </div>
              {r.floorSafe === false && <div style={{ marginTop: 8, fontSize: 11, color: RED, fontWeight: 600 }}>자격 미달 — 그대로 투찰 시 자동 탈락</div>}
              {r.adj == null && d.source !== "file_upload" && <div style={{ marginTop: 6, fontSize: 11, color: C.txd }}>자동 예측에는 이 공고의 추천값이 없습니다(군시설 공략안은 엑셀 업로드 예측에서만 계산). 입찰서류함 엑셀을 올리면 채워집니다.</div>}
              {capSigma != null && <div style={{ marginTop: 6, fontSize: 11, color: GOLD }}>분포 폭(σ {capSigma.toFixed(2)})이 커서 상한(평균+1.5%p)을 적용했습니다 — 모형상 하한 통과 95%에 못 미칩니다. 위 하한 통과 확률(과거 기록 기준)을 확인하세요.</div>}
              {r.estimated && <div style={{ marginTop: 6, fontSize: 10, color: C.txd }}>추정 기초금액(추정가격×1.1) 기준 — 기초금액 공개 후 입찰서류함 엑셀을 올리면 확정됩니다.</div>}
              {attack && (
                <div style={{ marginTop: 10, padding: "8px 10px", border: "1px dashed " + C.bdr, borderRadius: 6, fontSize: 11, color: C.txm }}>
                  <div><b style={{ color: C.txt }}>공격안 (참고 · 메인 아님)</b> — 사정률 <span style={mono}>{pct4(attack.adj)}</span> · 투찰금 <span style={mono}>{won(attack.bid)}</span> · 하한 통과 <span style={{ ...mono, color: RED }}>{attack.passPct == null ? "—" : floorPassLabel(100 - attack.passPct)}</span></div>
                  <div style={{ marginTop: 4, color: RED }}>1위 분포 평균을 겨냥한 값이라 하한 미달 탈락 위험이 큽니다. 2025~ 경기·경기북부 본부 452건 백테스트: 1위 가능 3→13건, 하한 미달 6→203건 (같은 기간에서 고른 후보 — 독립 검증 아님).</div>
                </div>
              )}
              <div style={{ marginTop: 6, fontSize: 11, color: C.txm }}>{modeA ? "군시설은 1위 가능 구간이 있습니다. 하한 통과 확률로 안전 여부를 함께 보세요." : "목표는 하한 미달 탈락 방지입니다. 1위는 추첨에 가깝습니다."}</div>
              {cands && (
                <div style={{ marginTop: 4 }}>
                  <button onClick={() => setShowCmp(v => !v)} style={actBtn}>{showCmp ? "▾" : "▸"} 과거 기록 비교 (투찰 기준별)</button>
                  {showCmp && cmp && (
                    <div style={{ marginTop: 6, fontSize: 11, color: C.txm }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                        <thead><tr>{["투찰 기준", "이 공고 사정률 · 투찰금", "과거 하한 미달", "과거 1위 가능"].map((t, i) => <th key={t} style={{ textAlign: i === 0 ? "left" : "right", color: C.txd, fontWeight: 600, padding: "4px 6px", borderBottom: "1px solid " + C.bdr }}>{t}</th>)}</tr></thead>
                        <tbody>{cands.map(c => {
                          const st = cmp.rows[c.key], pr = cmp.pairs[c.key];
                          return (
                            <tr key={c.key}>
                              <td style={CELL}>{c.label}</td>
                              <td style={{ ...CELL, ...mono, textAlign: "right", whiteSpace: "nowrap" }}>{pct4(c.adj)} · {won(c.bid)}</td>
                              {cmp.n < 30 ? <td colSpan={2} style={{ ...CELL, textAlign: "right", color: C.txd }}>표본 부족 (평가 {cmp.n}건)</td> : <>
                                <td style={{ ...CELL, ...mono, textAlign: "right" }}>{(st.below / cmp.n * 100).toFixed(0)}%</td>
                                <td style={{ ...CELL, textAlign: "right" }}><span style={mono}>{st.wins}/{cmp.n}건</span>{pr && <div style={{ fontSize: 10, color: C.txd }}>{pr.p >= 0.05 ? `안전선과 차이는 우연 범위(p=${pr.p.toFixed(2)})` : `안전선과 차이 p=${pr.p.toFixed(3)} — 여러 기관을 보다 보면 우연히도 나옴`}</div>}</td>
                              </>}
                            </tr>
                          );
                        })}</tbody>
                      </table>
                      <div style={{ marginTop: 6, fontSize: 10, color: C.txd, lineHeight: 1.5 }}>
                        평가: 이 기관 2025~ 개찰 {cmp.n}건(평가 불가 {cmp.skipped}건) — 공고마다 개찰 전날까지의 1위 기록(기관×금액대→기관)으로 다시 계산, 현재 자사 점수 반영(단 '현재 추천' 줄의 투찰금은 저장값).<br />
                        1위 가능 = 그 금액이 실제 1위보다 낮고 자사 하한 이상이었던 공고 수 · 낙찰 보장 아님(추첨) · 결과가 개찰 전날까지 모두 올라왔다고 가정(실제 업로드는 늦음) · 같은 기간 기록에서 골라도 앞으로 재현되지 않을 수 있음.<br />
                        참고: 2025~ 전체 운영 재현 5,170건 — 하한 미달 4.5 / 24.8 / 48.1%, 1위 가능 105 / 110 / 101건(차이 구분 안 됨, p=0.73) · 2026-10-26 계산.
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          <button onClick={() => setShowWhy(v => !v)} style={actBtn}>{showWhy ? "▾" : "▸"} 근거</button>
          {showWhy && (
            <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid " + C.bdr }}>
              <div style={row}><span>통과 확률 표본</span><span style={mono}>{r.distN != null ? `${r.distN}건 · ${r.distGrain === "AG" ? "이 발주기관" : "기관유형"}` : "과거 기록 부족"}</span></div>
              <div style={row}><span>신뢰도</span><span style={mono}>{conf.level === "high" ? "높음" : conf.level === "med" ? "보통" : "데이터 부족"}{conf.srcLabel ? ` · ${conf.srcLabel}` : ""}</span></div>
              <div style={row}><span>옛 엔진 보수안 (참고)</span><span style={mono}>{d.rec_adj_p75 != null ? `${pct4(d.rec_adj_p75)} · ${won(d.rec_bid_p75)}` : "—"}</span></div>
              <div style={row}><span>자사 유효 하한율</span><span style={mono}>{fr ? formatFloorDual(fr, effFr) : "—"}</span></div>
              <div style={row}><span>자사 하한금액 참고값 (자사 유효 하한율·사정률 100% 가정 — 실제 하한가는 개찰 때 예정가격으로 정해짐)</span><span style={{ ...mono, whiteSpace: "nowrap", marginLeft: 8 }}>{won(floorBid)}</span></div>
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
          <button onClick={() => setShowMatrix(true)} style={actBtn}>참여사 분포 보기</button>
          {showMatrix && <ParticipantMatrixModal ag={ag} highlightPnno={d.pn_no} onClose={() => setShowMatrix(false)} />}
        </div>

        {/* 블록 3 — 1위 사정률 이력 */}
        <div style={{ ...box, marginBottom: 0 }}>
          <div style={{ ...h, display: "flex", justifyContent: "space-between" }}>
            <span>이 발주처의 1위 사정률 이력 (최근 {hist.count}건{hist.autoCount > 0 ? ` · 자동 ${hist.autoCount}건 포함` : ""})</span>
            <button onClick={() => onOpenG2B?.(ag)} style={{ background: "transparent", border: "none", color: GOLD, fontSize: 11, cursor: "pointer", padding: 0 }}>G2B 양식에서 전체 보기 →</button>
          </div>
          <div style={{ fontSize: 11, color: C.txm, marginBottom: 10, padding: "6px 8px", border: "1px solid " + C.bdr, borderRadius: 6 }}>
            <div style={{ color: C.txt, fontWeight: 600 }}>최근 90일 동향 <span style={{ color: C.txd, fontWeight: 400 }}>(기준 {trend.ref}{trend.refFromOpen ? " · 개찰 전날" : ""}{trend.lastOd ? ` · 최근 마지막 개찰 ${trend.lastOd}` : ""}{trend.autoExcluded ? ` · 자동 수집 ${trend.autoExcluded}건 제외` : ""})</span></div>
            <div style={{ marginTop: 3 }}>발주처 사정률(추첨 결과): {trend.ar.status !== "ok" ? `표본 부족 (최근 ${trend.ar.nRecent}건 · 직전 9개월 ${trend.ar.nPrior}건)` : <>
              최근 <span style={mono}>{(100 + trend.ar.meanRecent).toFixed(3)}%</span> ({trend.ar.nRecent}건) · 직전 9개월 <span style={mono}>{(100 + trend.ar.meanPrior).toFixed(3)}%</span> ({trend.ar.nPrior}건) · Δ <span style={mono}>{(trend.ar.delta >= 0 ? "+" : "") + trend.ar.delta.toFixed(3)}%p</span> — {trend.ar.shift === "none"
                ? `구분되는 변화 없음 (이 표본으로는 ±${trend.ar.detect.toFixed(2)}%p 이내 변화는 구분 불가)`
                : <b style={{ color: C.txt }}>직전 9개월과 다름(z={trend.ar.z.toFixed(1)}) · 원인 미상 — 추천값에 반영하지 않음</b>}</>}</div>
            <div style={{ marginTop: 3 }}>1위가 하한선에서 0.05%p 이상 떨어진 공고: {trend.gap.status !== "ok" ? `표본 부족 (최근 ${trend.gap.nRecent}건 · 직전 9개월 ${trend.gap.nPrior}건)` : <>
              직전 9개월 <span style={mono}>{trend.gap.pctPrior.toFixed(0)}%</span> → 최근 <span style={mono}>{trend.gap.pctRecent.toFixed(0)}%</span> ({trend.gap.nPrior}→{trend.gap.nRecent}건) — {trend.gap.shift === "none"
                ? "구분되는 변화 없음"
                : <b style={{ color: C.txt }}>1위가 하한선에 {trend.gap.shift === "wider" ? "덜" : "더"} 붙음(z={trend.gap.z.toFixed(1)})</b>}</>}</div>
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
                      <td style={{ padding: "3px 6px", ...mono }}>{h2.auto && <span title="나라장터 자동 수집 · 계산값(엑셀 대조 합격 2026-10-25)" style={{ fontSize: 9, padding: "0 4px", marginRight: 4, borderRadius: 3, border: "1px solid " + C.bdr, color: C.txm }}>자동</span>}{h2.od}</td>
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
