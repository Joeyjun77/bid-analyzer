import React, { useState, useEffect, useMemo, useTransition } from "react";
import { C } from "../lib/constants.js";
import { INTENSITY_STYLE } from "../lib/g2bFrequency.js";
import { buildMatrix, buildCompanyOverlay, matrixLevel } from "../lib/participantMatrix.js";
import { sbFetchParticipantDistribution, sbFetchParticipantCompanyTrace } from "../lib/supabase.js";

// 참여업체 사정율 분포 — 공유축 매트릭스 모달. 발주처(canonical_ag) 최근 N건 × 사정율 버킷.
// 셀 = 그 버킷에 베팅한 참여사 수(컬럼별 최대 대비 강조). ★ = 1순위 버킷. 자리수 토글 0.1/0.05/0.01.
// 경쟁사 검색(등록번호/업체명) → 그 업체가 각 건에서 베팅한 사정율 셀 하이라이트 + 추이.

const RATE_CAVEAT = "업체별사정율(=가정사정율) 100기준 절대값. 추첨 결과 관측 분포 — 의도적 선택 아님.";
const BUCKETS = [
  { v: 0.1,    label: "0.1" },
  { v: 0.05,   label: "0.05" },
  { v: 0.01,   label: "0.01" },
  { v: 0.001,  label: "0.001" },
  { v: 0.0001, label: "0.0001" },
];

// 개찰일 연도 글씨색 (G2BSheetTab odYearColor 축약본) — 최근일수록 빨강, 과거는 흐려짐.
function odColor(od){
  if (!od) return "#666680";
  const y = Number(String(od).slice(0, 4));
  if (!y) return "#cdd2de";
  const off = new Date().getFullYear() - y;
  if (off <= 0) return "#ff6363";
  if (off <= 1) return "#ff9a9a";
  if (off <= 3) return "#ffd02e";
  return "rgba(220,225,235,0.6)";
}

export default function ParticipantMatrixModal({ ag, highlightPnno, onClose }){
  const [bucket, setBucket] = useState(0.01);
  const [view, setView] = useState("dot");   // "dot"=점표분포 / "matrix"=숫자
  const [axisFit, setAxisFit] = useState(true);  // true=밀집 구간만(양 끝 희소 이상치 절단) / false=전체 범위
  const [dist, setDist] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [isPending, startTransition] = useTransition();   // 토글/버킷 변경 시 무거운 표 렌더를 논블로킹 처리

  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");   // 실제 제출된 검색어
  const [trace, setTrace] = useState([]);
  const [searching, setSearching] = useState(false);

  // 배경 스크롤 잠금
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // 분포 페치 — ag / bucket 변경 시
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(false);
    sbFetchParticipantDistribution(ag, 30, bucket).then(d => {
      if (!alive) return;
      if (!d) { setError(true); setDist(null); }
      else setDist(d);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [ag, bucket]);

  // 경쟁사 trace 페치 — 검색어 제출 시
  useEffect(() => {
    if (!search){ setTrace([]); return; }
    let alive = true;
    setSearching(true);
    sbFetchParticipantCompanyTrace(ag, search, 30).then(t => {
      if (!alive) return;
      setTrace(Array.isArray(t) ? t : []);
      setSearching(false);
    });
    return () => { alive = false; };
  }, [ag, search]);

  const matrix = useMemo(() => dist ? buildMatrix(dist) : null, [dist]);
  const overlay = useMemo(() => buildCompanyOverlay(trace, bucket), [trace, bucket]);

  // 표시 버킷 산출. ① 축 자동맞춤: 양 끝의 희소한 꼬리(각 tailFrac 미만 질량)를 잘라 밀집 구간만 노출
  //   — 단발 이상치(예 1명짜리 110%)가 축을 길게 늘려 본 덩어리가 안 보이는 문제 해소. ★1순위 버킷은 항상 보존.
  // ② 세밀 버킷(특히 0.0001) 과다 시 밀집 상위 MAX_ROWS개만(전 컬럼 합 기준) → 프리즈 방지. 참여합 행은 전체 기준.
  const MAX_ROWS = 600;
  const renderBuckets = useMemo(() => {
    if (!matrix) return [];
    let buckets = matrix.buckets;   // 사정율 내림차순
    if (axisFit && buckets.length > 5) {
      // 밀도 기반 절단: 양 끝에서 "희소한"(피크 대비 미달) 행을 연속으로 잘라낸다.
      // 하한처럼 빽빽한 끝은 임계 미달이 아니라 바로 멈춰 보존됨 → 비대칭 분포(긴 윗꼬리)에 적합.
      // 과도 절단 방지: 각 끝에서 최대 MASS_CAP 질량까지만 잘라낸다.
      const totals = buckets.map(b => matrix.bucketTotalOf(b));
      const grand = totals.reduce((s, c) => s + c, 0);
      const peak = totals.reduce((m, c) => c > m ? c : m, 0);
      if (grand > 0 && peak > 0) {
        const thr = Math.max(2, peak * 0.05);   // 피크의 5% 미만 = 희소 꼬리
        const massCap = grand * 0.20;
        let hi = 0, accH = 0;
        while (hi < buckets.length - 1 && totals[hi] < thr && accH + totals[hi] <= massCap) { accH += totals[hi]; hi++; }
        let lo = buckets.length - 1, accL = 0;
        while (lo > hi && totals[lo] < thr && accL + totals[lo] <= massCap) { accL += totals[lo]; lo--; }
        // ★1순위 버킷이 잘려나가지 않도록 범위 확장
        let hiVal = buckets[hi], loVal = buckets[lo];
        for (const c of matrix.columns) {
          const k = matrix.winBucketKey(c.pn_no);
          if (k == null) continue;
          const w = Number(k);
          if (!isFinite(w)) continue;
          if (w > hiVal) hiVal = w;
          if (w < loVal) loVal = w;
        }
        buckets = buckets.filter(b => b <= hiVal && b >= loVal);
      }
    }
    if (buckets.length > MAX_ROWS) {
      return [...buckets]
        .sort((a, b) => matrix.bucketTotalOf(b) - matrix.bucketTotalOf(a))
        .slice(0, MAX_ROWS)
        .sort((a, b) => b - a);
    }
    return buckets;
  }, [matrix, axisFit]);
  const hiddenRows = matrix ? matrix.buckets.length - renderBuckets.length : 0;
  const truncated = hiddenRows > 0;
  const denseCapped = matrix ? renderBuckets.length >= MAX_ROWS && matrix.buckets.length > MAX_ROWS : false;

  const fmtBucket = (b) => Number(b).toFixed(matrix ? matrix.decimals : 2);
  const colCount = matrix ? matrix.columns.length : 0;

  const headerBtn = { padding: "4px 10px", fontSize: 12, background: C.bg3, color: C.txt, border: "1px solid " + C.bdr, borderRadius: 5, cursor: "pointer" };

  // 셀 스타일 (강조 단계 → INTENSITY_STYLE), 1순위(★)·검색업체 하이라이트 합성
  const cellStyle = (lvl, isWin, isCompany) => {
    const st = INTENSITY_STYLE[lvl];
    const s = { ...st, padding: "2px 4px", textAlign: "center", whiteSpace: "nowrap", borderLeft: "1px solid " + C.bdr };
    if (isWin) s.background = "rgba(255,209,46,0.14)";
    if (isCompany){ s.outline = "2px solid #5dca96"; s.outlineOffset = "-2px"; }
    return s;
  };

  // 점표 뷰 — 강조 단계(0 최강 … 7 약)별 점 지름. 셀 숫자 대신 크기로 참여수 표현.
  // 최소 점 크기 7px 보장 — 1~2명 버킷도 또렷이 보이도록(예전 4~5px는 거의 안 보임).
  const DOT_SIZE = [13, 12, 11, 10, 9, 8, 7];
  const DOT_MIN = 7;
  const dotEl = (cnt, lvl, isWin, isCompany) => {
    const size = cnt > 0 ? (DOT_SIZE[lvl] != null ? DOT_SIZE[lvl] : DOT_MIN) : 0;
    // 검색사인데 그 버킷 참여 0 → 빈 초록 링만
    if (size === 0) return isCompany
      ? <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", border: "2px solid #5dca96", boxSizing: "border-box" }} />
      : null;
    return <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", background: isWin ? C.gold : "#8a93a6", outline: isCompany ? "2px solid #5dca96" : "none", outlineOffset: 1 }} />;
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.bg2, border: "1px solid " + C.bdr, borderRadius: 10, padding: 16, maxWidth: 1500, width: "98%", maxHeight: "92vh", overflow: "hidden", display: "flex", flexDirection: "column" }}>

        {/* 헤더 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, color: C.gold, fontSize: 14 }}>
            참여업체 사정율 분포 — <span style={{ color: C.txt }}>{ag}</span>
            {matrix && <span style={{ color: C.txm, fontWeight: 400, fontSize: 12, marginLeft: 8 }}>최근 {colCount}건 · 버킷 {bucket}</span>}
          </span>
          <button onClick={onClose} style={headerBtn}>닫기 ✕</button>
        </div>

        {/* 컨트롤바 */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8, flexWrap: "wrap", fontSize: 12 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: C.txm }}>
            버킷 자리수
            <span style={{ display: "inline-flex", border: "1px solid " + C.bdr, borderRadius: 6, overflow: "hidden" }}>
              {BUCKETS.map(b => (
                <button key={b.v} onClick={() => startTransition(() => setBucket(b.v))} title={`사정율 ${b.label} 단위로 묶기`}
                  style={{ padding: "3px 10px", fontSize: 11, border: "none", cursor: "pointer", background: bucket === b.v ? C.gold : C.bg3, color: bucket === b.v ? C.bg : C.txm, fontWeight: bucket === b.v ? 700 : 400 }}>
                  {b.label}
                </button>
              ))}
            </span>
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: C.txm }}>
            보기
            <span style={{ display: "inline-flex", border: "1px solid " + C.bdr, borderRadius: 6, overflow: "hidden" }}>
              {[{ v: "dot", label: "점표" }, { v: "matrix", label: "숫자" }].map(o => (
                <button key={o.v} onClick={() => startTransition(() => setView(o.v))} title={o.v === "dot" ? "점 크기로 분포 — 모든 건 한눈에" : "버킷별 참여사 수 숫자"}
                  style={{ padding: "3px 10px", fontSize: 11, border: "none", cursor: "pointer", background: view === o.v ? C.gold : C.bg3, color: view === o.v ? C.bg : C.txm, fontWeight: view === o.v ? 700 : 400 }}>
                  {o.label}
                </button>
              ))}
            </span>
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: C.txm }}>
            축
            <span style={{ display: "inline-flex", border: "1px solid " + C.bdr, borderRadius: 6, overflow: "hidden" }}>
              {[{ v: true, label: "자동맞춤" }, { v: false, label: "전체" }].map(o => (
                <button key={String(o.v)} onClick={() => startTransition(() => setAxisFit(o.v))} title={o.v ? "양 끝 희소 이상치 잘라 밀집 구간만 — 덩어리가 또렷이 보임" : "전체 사정율 범위(이상치 포함)"}
                  style={{ padding: "3px 10px", fontSize: 11, border: "none", cursor: "pointer", background: axisFit === o.v ? C.gold : C.bg3, color: axisFit === o.v ? C.bg : C.txm, fontWeight: axisFit === o.v ? 700 : 400 }}>
                  {o.label}
                </button>
              ))}
            </span>
          </span>
          {isPending && <span style={{ color: C.txd, fontSize: 11 }}>그리는 중…</span>}
          <form onSubmit={e => { e.preventDefault(); setSearch(query.trim()); }} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="경쟁사 검색 (등록번호/업체명)"
              style={{ padding: "4px 8px", fontSize: 12, background: C.bg3, color: C.txt, border: "1px solid " + C.bdr, borderRadius: 5, minWidth: 220 }} />
            <button type="submit" style={headerBtn}>검색</button>
            {search && <button type="button" onClick={() => { setQuery(""); setSearch(""); }} style={{ ...headerBtn, color: C.txd }}>해제</button>}
          </form>
          {search && <span style={{ color: searching ? C.txd : "#5dca96", fontSize: 11 }}>
            {searching ? "검색 중…" : `"${search}" ${overlay.size}건 매칭`}
          </span>}
        </div>

        {/* 축 자동맞춤 / 세밀 버킷 절단 안내 */}
        {!loading && !error && truncated && (
          <div style={{ fontSize: 11, color: "#e0b84a", background: "rgba(255,209,46,0.10)", border: "1px solid " + C.bdr, borderRadius: 5, padding: "5px 8px", marginBottom: 6 }}>
            {axisFit && `축 자동맞춤: 양 끝 희소 이상치 ${hiddenRows.toLocaleString()}행 숨김(밀집 구간만, 참여합은 전체 기준). 전체 범위는 축 [전체]. `}
            {denseCapped && `${bucket} 단위는 과도하게 세밀합니다 — 밀집 상위 ${MAX_ROWS}행만 표시. 더 큰 단위 권장.`}
          </div>
        )}

        {/* 본문 */}
        <div style={{ flex: 1, overflow: "auto", overscrollBehavior: "contain", border: "1px solid " + C.bdr, borderRadius: 6 }}>
          {loading && <div style={{ padding: 40, textAlign: "center", color: C.txd, fontSize: 13 }}>분포 불러오는 중…</div>}
          {error && <div style={{ padding: 40, textAlign: "center", color: "#e07a7a", fontSize: 13 }}>분포를 불러오지 못했습니다.</div>}
          {!loading && !error && matrix && colCount === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: C.txd, fontSize: 13 }}>이 발주처의 참여업체 데이터가 없습니다.</div>
          )}
          {!loading && !error && matrix && colCount > 0 && (
            <table style={{ borderCollapse: "collapse", fontSize: 11, tableLayout: "fixed", width: "100%" }}>
              <colgroup>
                <col style={{ width: 52 }} />
                {matrix.columns.map(c => <col key={c.pn_no} style={{ width: view === "dot" ? 22 : 40 }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th style={{ position: "sticky", left: 0, top: 0, zIndex: 3, background: C.bg3, color: C.txd, padding: "4px 6px", textAlign: "right", borderBottom: "1px solid " + C.bdr, fontWeight: 600 }}>사정율 \ 건</th>
                  {matrix.columns.map(c => {
                    const isHi = c.pn_no === highlightPnno;
                    return (
                      <th key={c.pn_no} title={`${c.pn || ""}\n개찰일 ${c.od || "—"} · 참여 ${c.n}건 · 1순위 ${c.win_rate != null ? Number(c.win_rate).toFixed(4) : "—"}`}
                        style={{ position: "sticky", top: 0, zIndex: 2, background: isHi ? "rgba(255,209,46,0.18)" : C.bg3, padding: "3px 2px", textAlign: "center", borderBottom: "1px solid " + C.bdr, borderLeft: "1px solid " + C.bdr, verticalAlign: "bottom" }}>
                        <div style={{ color: odColor(c.od), fontWeight: 700, fontSize: 10 }}>{c.od ? String(c.od).slice(5) : "—"}</div>
                        {view !== "dot" && <div style={{ color: isHi ? C.gold : C.txm, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 9 }}>{c.pn || c.pn_no}</div>}
                        <div style={{ color: "#ffd02e", fontSize: 9 }}>★{c.win_rate != null ? Number(c.win_rate).toFixed(2) : "—"}</div>
                      </th>
                    );
                  })}
                </tr>
                {/* 검색업체 추이 행 */}
                {search && (
                  <tr>
                    <th style={{ position: "sticky", left: 0, zIndex: 2, background: C.bg2, color: "#5dca96", padding: "2px 6px", textAlign: "right", fontWeight: 700, fontSize: 9, borderBottom: "1px solid " + C.bdr }}>검색사 사정율</th>
                    {matrix.columns.map(c => {
                      const ov = overlay.get(c.pn_no);
                      return <td key={c.pn_no} style={{ background: C.bg2, color: ov ? "#5dca96" : C.txd, textAlign: "center", fontSize: 9, padding: "2px", borderLeft: "1px solid " + C.bdr, borderBottom: "1px solid " + C.bdr }}>{ov ? ov.adj_rate.toFixed(2) : "·"}</td>;
                    })}
                  </tr>
                )}
              </thead>
              <tbody>
                {renderBuckets.map(b => {
                  const bk = matrix.bkey(b);
                  return (
                    <tr key={bk}>
                      <td style={{ position: "sticky", left: 0, zIndex: 1, background: C.bg2, color: C.txm, padding: "2px 6px", textAlign: "right", fontWeight: 600, borderTop: "1px solid " + C.bdr }}>{fmtBucket(b)}</td>
                      {matrix.columns.map(c => {
                        const cell = matrix.cell(c.pn_no, b);
                        const ov = overlay.get(c.pn_no);
                        const isCompany = !!(ov && ov.bucketKey === bk);
                        if (!cell && !isCompany) {
                          return <td key={c.pn_no} style={{ borderLeft: "1px solid " + C.bdr, borderTop: "1px solid " + C.bdr }} />;
                        }
                        const cnt = cell ? cell.cnt : 0;
                        const lvl = matrixLevel(cnt, matrix.colMax(c.pn_no));
                        const isWin = matrix.isWinCell(c.pn_no, b);
                        const title = `${c.od || ""} · 사정율 ${fmtBucket(b)} · ${cnt}개사${isWin ? " · ★1순위" : ""}${isCompany ? " · 검색사" : ""}`;
                        if (view === "dot") {
                          return (
                            <td key={c.pn_no} title={title}
                              style={{ padding: "1px 0", textAlign: "center", lineHeight: 0, borderLeft: "1px solid " + C.bdr, borderTop: "1px solid " + C.bdr, background: isWin ? "rgba(255,209,46,0.10)" : undefined }}>
                              {dotEl(cnt, lvl, isWin, isCompany)}
                            </td>
                          );
                        }
                        return (
                          <td key={c.pn_no} title={title}
                            style={{ ...cellStyle(lvl, isWin, isCompany), borderTop: "1px solid " + C.bdr }}>
                            {isWin ? "★" : ""}{cnt || (isCompany ? "·" : "")}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {/* 참여합 행 */}
                <tr>
                  <td style={{ position: "sticky", left: 0, zIndex: 1, background: C.bg3, color: C.txd, padding: "3px 6px", textAlign: "right", fontWeight: 700, borderTop: "2px solid " + C.bdr }}>참여합</td>
                  {matrix.columns.map(c => (
                    <td key={c.pn_no} style={{ background: C.bg3, color: C.txm, textAlign: "center", fontWeight: 600, padding: "3px 2px", borderLeft: "1px solid " + C.bdr, borderTop: "2px solid " + C.bdr }}>{matrix.colTotal(c.pn_no)}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          )}
        </div>

        <div style={{ fontSize: 10, color: C.txd, marginTop: 8, lineHeight: 1.5 }}>
          {RATE_CAVEAT} <span style={{ color: C.txm }}>세로=사정율 버킷(높을수록 위), 셀=그 버킷 참여사 수(건별 최다 대비 밝기), ★=1순위 버킷. 80~120 범위만 표시.</span>
        </div>
      </div>
    </div>
  );
}
