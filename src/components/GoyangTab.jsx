import { useState, useEffect } from "react";
import { C } from "../lib/constants.js";
import { sbFetchGoyangProfile } from "../lib/supabase.js";
import { GOYANG_GRP_LABEL, drawExpected } from "../lib/goyang.js";

// ─── 고양 집중 탭 (goyang-focus P4, issue 04) ─────────────────────
// 정보 표시 전용: 사정률은 기술 통계(100% 기준)만, 승률·WIN-zone·확정/제출 없음. 모든 수치에 n.
// 데이터는 goyang_profile RPC(m78) 한 번 호출 — 선택이 바뀔 때만 다시 부른다.

const box = { background: C.bg2, border: "1px solid " + C.bdr, borderRadius: 8, padding: 14, marginBottom: 12 };
const h = { fontSize: 13, fontWeight: 700, color: C.txt, marginBottom: 8 };
const note = { fontSize: 11, color: C.txd };
const sel = { padding: "6px 10px", fontSize: 12, background: C.bg3, border: "1px solid " + C.bdr, borderRadius: 5, color: C.txt };
const th = { padding: "4px 8px", fontSize: 11, color: C.txm, textAlign: "right", borderBottom: "1px solid " + C.bdr };
const td = { padding: "4px 8px", fontSize: 12, color: C.txt, textAlign: "right" };
const f4 = (v) => (v == null || !isFinite(Number(v)) ? "-" : Number(v).toFixed(4));
const n0 = (v) => (v == null ? "-" : Number(v).toLocaleString());

export default function GoyangTab() {
  const [scope, setScope] = useState("all"); // all | G1..G5 | code:<ag_code>
  const [targetOnly, setTargetOnly] = useState(false);
  const [at, setAt] = useState("");
  const [data, setData] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const grp = scope.startsWith("G") ? scope : null;
    const agCode = scope.startsWith("code:") ? scope.slice(5) : null;
    sbFetchGoyangProfile({ grp, agCode, targetOnly, at: at || null }).then((d) => {
      if (!alive) return;
      setData(d);
      if (d?.orgs && !orgs.length) setOrgs(d.orgs);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [scope, targetOnly, at]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = data?.summary;
  const draws = data?.draws;
  const maxDraw = Math.max(1, ...(draws?.counts || [0]));
  const exp = draws ? drawExpected(draws.n_sets) : 0;
  const months = data?.monthly || [];
  const p50s = months.map((m) => Number(m.p50));
  const pMin = p50s.length ? Math.min(...p50s) : 0, pMax = p50s.length ? Math.max(...p50s) : 0;

  return (
    <div style={{ padding: "4px 0" }}>
      <div style={{ ...box, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span style={note}>기관</span>
        <select value={scope} onChange={(e) => setScope(e.target.value)} style={{ ...sel, minWidth: 260 }}>
          <option value="all">고양 전체</option>
          {Object.entries(GOYANG_GRP_LABEL).map(([g, l]) => <option key={g} value={g}>{g} {l}</option>)}
          <optgroup label="개별 기관 (기록 건수)">
            {orgs.filter((o) => o.n > 0).map((o) => <option key={o.code} value={"code:" + o.code}>{o.name} ({o.n})</option>)}
          </optgroup>
        </select>
        <span style={note}>업종</span>
        <label style={{ fontSize: 12, color: C.txt }}><input type="radio" checked={!targetOnly} onChange={() => setTargetOnly(false)} /> 전체</label>
        <label style={{ fontSize: 12, color: C.txt }}><input type="radio" checked={targetOnly} onChange={() => setTargetOnly(true)} /> 대상 업종(전기·통신·소방)</label>
        <span style={note}>계약유형</span>
        <select value={at} onChange={(e) => setAt(e.target.value)} style={sel}>
          <option value="">전체</option>
          {["지자체", "교육청", "조달청", "기타"].map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        {loading && <span style={note}>불러오는 중…</span>}
      </div>

      {!loading && !data && <div style={{ ...box, color: "#e24b4a", fontSize: 12 }}>고양 데이터를 불러오지 못했습니다(로그인·권한 확인).</div>}

      {data && s && <>
        <div style={box}>
          <div style={h}>요약</div>
          <div style={{ fontSize: 12, color: C.txt, lineHeight: 1.8 }}>
            기록 <b>{n0(s.n)}</b>건 (최근 180일 {n0(s.n_180)}건 · 사정률 있음 {n0(s.n_ar1)}건 · 대상 업종 {n0(s.n_target)}건)
            · 기간 {s.first_od || "-"} ~ {s.last_od || "-"}<br />
            예비가격 세트 {n0(s.prelim_sets)}공고 · 순위 수집 {n0(s.rank_notices)}공고
          </div>
          <div style={note}>고양 정의: 기관 마스터(include) 기준. 학교 2곳(저동고·자운학교)은 소재 미확인이나 포함.</div>
        </div>

        <div style={box}>
          <div style={h}>사정률 분포 (100% 기준, 기술 통계)</div>
          <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 640 }}>
            <thead><tr><th style={{ ...th, textAlign: "left" }}>구간</th><th style={th}>n</th>{["p10", "p25", "중앙", "p75", "p90", "평균"].map((k) => <th key={k} style={th}>{k}</th>)}</tr></thead>
            <tbody>{(data.dist || []).map((r) => (
              <tr key={r.label}><td style={{ ...td, textAlign: "left" }}>{r.label}</td><td style={td}>{n0(r.n)}</td>
                {(r.pct || [null, null, null, null, null]).map((v, i) => <td key={i} style={td}>{f4(v)}</td>)}<td style={td}>{f4(r.mean)}</td></tr>
            ))}</tbody>
          </table>
          {months.length > 0 && <div style={{ marginTop: 12 }}>
            <div style={note}>월별 중앙값 (최근 24개월, 막대 위 n)</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 110, marginTop: 6 }}>
              {months.map((m) => {
                const hgt = 10 + ((m.p50 - pMin) / Math.max(pMax - pMin, 0.01)) * 80;
                return <div key={m.ym} title={`${m.ym} 중앙 ${f4(m.p50)} (n=${m.n})`} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ fontSize: 9, color: C.txd }}>{m.n}</div>
                  <div style={{ height: hgt, background: m.n < 5 ? C.txd : C.gold, opacity: m.n < 5 ? 0.5 : 0.85, borderRadius: 2 }} />
                  <div style={{ fontSize: 8, color: C.txd, marginTop: 2 }}>{m.ym.slice(2)}</div>
                </div>;
              })}
            </div>
            <div style={note}>회색 막대 = n&lt;5(해석 주의). 범위 {f4(pMin)} ~ {f4(pMax)}</div>
          </div>}
        </div>

        <div style={box}>
          <div style={h}>추첨 번호 빈도 (예비가격 1~15 중 추첨된 번호, n={n0(draws?.n_sets)}공고)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, maxWidth: 520 }}>
            {(draws?.counts || []).map((c, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                <span style={{ width: 18, textAlign: "right", color: C.txm }}>{i + 1}</span>
                <div style={{ position: "relative", flex: 1, height: 12, background: C.bg3, borderRadius: 2 }}>
                  <div style={{ width: (c / maxDraw) * 100 + "%", height: "100%", background: "#5dca96", opacity: 0.8, borderRadius: 2 }} />
                  <div style={{ position: "absolute", left: (exp / maxDraw) * 100 + "%", top: -2, bottom: -2, width: 1, background: C.txt, opacity: 0.6 }} />
                </div>
                <span style={{ width: 34, textAlign: "right", color: C.txt }}>{c}</span>
              </div>
            ))}
          </div>
          <div style={note}>세로선 = 균등 기댓값 {exp.toFixed(1)} (공고당 4개 추첨). 추첨은 무작위 — 빈도 차이는 참고용.</div>
        </div>

        <div style={box}>
          <div style={h}>반복 참여 업체 상위 10 (대상 업종만 수집, 2026-04~, n={n0(data.firms?.n_notices)}공고)</div>
          {(data.firms?.top || []).length === 0 ? <div style={note}>순위 수집 공고가 없습니다.</div> :
            <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 720 }}>
              <thead><tr><th style={{ ...th, textAlign: "left" }}>업체명</th><th style={th}>사업자번호</th><th style={th}>참여 공고</th><th style={th}>1순위</th><th style={th}>평균 투찰률(예정가격 대비)</th></tr></thead>
              <tbody>{data.firms.top.map((f) => (
                <tr key={f.bizno}><td style={{ ...td, textAlign: "left" }}>{f.name}</td><td style={td}>{f.bizno}</td><td style={td}>{f.notices}</td><td style={td}>{f.rank1}</td><td style={td}>{Number(f.avg_rate_vs_plnprc).toFixed(3)}%</td></tr>
              ))}</tbody>
            </table>}
          <div style={note}>원천: 나라장터 개찰결과(개찰완료 목록). 투찰률은 예정가격 대비로 업로드 참여업체 표의 투찰률과 기준이 다릅니다.</div>
        </div>
      </>}
    </div>
  );
}
