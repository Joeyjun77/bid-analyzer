import { useState, useEffect } from "react";
import { C } from "../lib/constants.js";
import { sbFetchGoyangProfile } from "../lib/supabase.js";
import { GOYANG_GRP_LABEL, drawExpected, rebin, withShare, summarize, binVals } from "../lib/goyang.js";

// ─── 고양 집중 탭 (goyang-focus P4, issue 04 · m80 초보자용 개편) ─────────────────────
// 정보 표시 전용: 사정률은 기술 통계(100% 기준)만, 승률·WIN-zone·확정/제출 없음. 모든 수치에 n.
// 투찰금액은 여기서 계산하지 않는다 — 낙찰하한율·A값이 반영된 값은 투찰 카드에만 있다.
// 데이터는 goyang_profile RPC 한 번 호출 — 선택이 바뀔 때만 다시 부른다.
// 불러오는 동안: 로딩바 표시, 이전 내용은 흐리게 두고 클릭·키보드 조작을 막는다(inert), 선택줄도 잠근다.

const GREEN = "#5dca96", RED = "#e24b4a";
const box = { background: C.bg2, border: "1px solid " + C.bdr, borderRadius: 8, padding: 14, marginBottom: 12 };
const h = { fontSize: 13, fontWeight: 700, color: C.txt, marginBottom: 8 };
const note = { fontSize: 11, color: C.txd };
const key = { fontSize: 12, color: C.txt, lineHeight: 1.8, marginBottom: 8 };
const sel = { padding: "6px 10px", fontSize: 12, background: C.bg3, border: "1px solid " + C.bdr, borderRadius: 5, color: C.txt };
const th = { padding: "4px 8px", fontSize: 11, color: C.txm, textAlign: "right", borderBottom: "1px solid " + C.bdr, whiteSpace: "nowrap" };
const td = { padding: "4px 8px", fontSize: 12, color: C.txt, textAlign: "right", whiteSpace: "nowrap" };
const tdL = { ...td, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 0 };
const sum = { fontSize: 12, color: C.txm, cursor: "pointer", padding: "4px 0" };
const f4 = (v) => (v == null || !isFinite(Number(v)) ? "-" : Number(v).toFixed(4));
const f2 = (v) => (v == null || !isFinite(Number(v)) ? "-" : Number(v).toFixed(2));
const n0 = (v) => (v == null ? "-" : Number(v).toLocaleString());
const pc1 = (v) => v.toFixed(1) + "%";
const won = (v) => { // 5억 3,560만
  if (v == null || !(Number(v) > 0)) return "-";
  const man = Math.round(Number(v) / 1e4), eok = Math.floor(man / 1e4), rest = man % 1e4;
  return (eok ? eok + "억 " : "") + (rest || !eok ? rest.toLocaleString() + "만" : "");
};

// 세로 막대 + 막대 위 건수. every: x축 라벨 간격
function Bars({ bins, color, xLabel, tip, every = 1, height = 130 }) {
  const max = Math.max(1, ...bins.map((b) => b.n));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, marginTop: 4 }}>
      {bins.map((b, i) => (
        <div key={b.lo} title={tip(b)} style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
          <div style={{ fontSize: 9, color: C.txm, whiteSpace: "nowrap" }}>{b.n || ""}</div>
          <div style={{ height: b.n ? Math.max(2, (b.n / max) * height) : 0, background: color(b), borderRadius: "2px 2px 0 0" }} />
          <div style={{ fontSize: 9, color: C.txd, marginTop: 2, height: 12, whiteSpace: "nowrap" }}>{i % every === 0 ? xLabel(b) : ""}</div>
        </div>
      ))}
    </div>
  );
}

// 잘게 나눈 구간용: 값 위치에 세로선을 세운다(구간이 수백~수만 개라 막대를 나란히 놓을 수 없다). 빈 구간은 그리지 않는다
function Stems({ bins, w, color, tip, height = 130 }) {
  const lo = bins[0].lo, hi = bins[bins.length - 1].lo + w, span = hi - lo || 1;
  const max = Math.max(...bins.map((b) => b.n));
  const ticks = [];
  for (let t = Math.ceil(lo * 2) / 2; t <= hi; t += 0.5) ticks.push(t);
  return (
    <div style={{ marginTop: 4 }}>
      <svg viewBox={"0 0 1000 " + height} preserveAspectRatio="none" style={{ width: "100%", height, display: "block", background: C.bg3, borderRadius: 4 }}>
        {bins.map((b) => {
          const hgt = (b.n / max) * (height - 6);
          return <rect key={b.lo} x={((b.lo - lo) / span) * 1000} y={height - hgt} width={Math.max(1.2, (w / span) * 1000)} height={hgt} fill={color(b)}><title>{tip(b)}</title></rect>;
        })}
      </svg>
      <div style={{ position: "relative", height: 14 }}>
        {ticks.map((t) => <span key={t} style={{ position: "absolute", left: ((t - lo) / span) * 100 + "%", transform: "translateX(-50%)", fontSize: 9, color: C.txd }}>{t.toFixed(1)}</span>)}
      </div>
    </div>
  );
}

// 구간·건수·비율·누적 표. 길어서 3단으로 나눠 놓는다. cum=false면 누적 열을 뺀다(건수순 정렬일 때)
function ShareTable({ rows, label, cum = true }) {
  const per = Math.ceil(rows.length / 3) || 1;
  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start", marginTop: 6 }}>
      {[0, 1, 2].map((c) => rows.slice(c * per, (c + 1) * per)).filter((part) => part.length).map((part) => (
        <table key={part[0].lo} style={{ borderCollapse: "collapse", flex: "1 1 220px" }}>
          <thead><tr><th style={{ ...th, textAlign: "left" }}>구간</th><th style={th}>건수</th><th style={th}>비율</th>{cum && <th style={th}>누적</th>}</tr></thead>
          <tbody>{part.map((r) => (
            <tr key={r.lo}><td style={{ ...td, textAlign: "left" }}>{label(r)}</td><td style={td}>{n0(r.n)}</td><td style={td}>{pc1(r.pct)}</td>{cum && <td style={{ ...td, color: C.txm }}>{pc1(r.cum)}</td>}</tr>
          ))}</tbody>
        </table>
      ))}
    </div>
  );
}

const Card = ({ label, value, sub }) => (
  <div style={{ flex: "1 1 150px", background: C.bg3, borderRadius: 6, padding: "10px 12px" }}>
    <div style={{ fontSize: 11, color: C.txm }}>{label}</div>
    <div style={{ fontSize: 20, fontWeight: 700, color: C.txt, margin: "2px 0" }}>{value}</div>
    <div style={note}>{sub}</div>
  </div>
);

// 사정률 구간 단위: [0.0001 단위 개수, 표시]
const UNITS = [[2000, "0.2"], [1000, "0.1"], [100, "0.01"], [10, "0.001"], [1, "0.0001"]];

const BR1_KIND = {
  exact: { mark: "", tip: "업로드 기록의 값" },
  rank: { mark: "≈", tip: "순위 수집분으로 계산(낙찰선이 0.01%p 안팎으로 잡힘)" },
  est: { mark: "추정", tip: "A값이 없어 정확히 계산할 수 없음. 발주처사정율 + 0.007(업로드 기록 413건의 차이 중앙값)" },
};

export default function GoyangTab() {
  const [scope, setScope] = useState("all"); // all | G1..G5 | code:<ag_code>
  const [targetOnly, setTargetOnly] = useState(false);
  const [at, setAt] = useState("");
  const [data, setData] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [unit, setUnit] = useState(2000); // 사정률 구간 폭(0.0001 단위 개수)
  const [recentN, setRecentN] = useState(30);
  const [baIn, setBaIn] = useState("100000000");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const grp = scope.startsWith("G") ? scope : null;
    const agCode = scope.startsWith("code:") ? scope.slice(5) : null;
    const load = () => sbFetchGoyangProfile({ grp, agCode, targetOnly, at: at || null });
    // DB 자료가 메모리에 없을 때 첫 호출이 8초 제한에 걸릴 수 있다(11/10 실측). 그 호출이 자료를 올려 두므로 한 번만 다시 부른다.
    load().then((d) => d || new Promise((r) => setTimeout(r, 1500)).then(load)).then((d) => {
      if (!alive) return;
      setData(d);
      if (d?.orgs && !orgs.length) setOrgs(d.orgs);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [scope, targetOnly, at]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = data?.summary;
  const d24 = (data?.dist || []).find((r) => r.label === "최근 24개월");
  const q = d24?.pct; // [p10, p25, 중앙, p75, p90]
  const coarse = unit >= 1000; // 0.2·0.1은 막대, 그보다 잘면 세로선
  const dec = coarse ? 1 : unit === 100 ? 2 : unit === 10 ? 3 : 4;
  const w = unit / 1e4;
  const adjBins = withShare(binVals(data?.vals, unit, coarse));
  const adjLabel = (b) => (dec <= 2 ? b.lo.toFixed(dec) + "~" + (b.lo + w).toFixed(dec) : b.lo.toFixed(dec));
  const adjTip = (b) => adjLabel(b) + ": " + b.n + "건 (" + pc1(b.pct) + ", 누적 " + pc1(b.cum) + ")";
  const adjColor = (b) => (b.lo + w > q[1] && b.lo < q[3] ? C.gold : "#6b5a2a");
  const adjUsed = adjBins.filter((b) => b.n > 0);
  const adjMax = Math.max(0, ...adjBins.map((b) => b.n));
  const adjDup = adjUsed.filter((b) => b.n >= 2);
  const adjTop = [...adjDup].sort((a, b) => b.n - a.n || a.lo - b.lo).slice(0, 30); // 1건짜리는 순서에 의미가 없어 뺀다

  const bids = data?.bids;
  const bidRaw = rebin(bids?.hist, 1);
  const bidBins = withShare(bidRaw, bids?.lo || 0, (bids?.lo || 0) + (bids?.hi || 0) + bidRaw.reduce((a, b) => a + b.n, 0));
  const sign = (x) => (x > 0 ? "+" : "") + x.toFixed(1);
  const bidLabel = (b) => sign(b.lo) + "~" + sign(b.lo + 0.1);
  const belowPct = bids?.n ? (bids.n_below / bids.n) * 100 : null;
  const anchor = data?.anchor;

  const recent = (data?.recent || []).slice(0, recentN);
  const rs = summarize(recent.map((r) => r.ar1));
  const open = data?.open || [];
  const ba = Number(baIn);

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
        <select value={scope} disabled={loading} onChange={(e) => setScope(e.target.value)} style={{ ...sel, minWidth: 260 }}>
          <option value="all">고양 전체</option>
          {Object.entries(GOYANG_GRP_LABEL).map(([g, l]) => <option key={g} value={g}>{g} {l}</option>)}
          <optgroup label="개별 기관 (기록 건수)">
            {orgs.filter((o) => o.n > 0).map((o) => <option key={o.code} value={"code:" + o.code}>{o.name} ({o.n})</option>)}
          </optgroup>
        </select>
        <span style={note}>업종</span>
        <label style={{ fontSize: 12, color: C.txt }}><input type="radio" disabled={loading} checked={!targetOnly} onChange={() => setTargetOnly(false)} /> 전체</label>
        <label style={{ fontSize: 12, color: C.txt }}><input type="radio" disabled={loading} checked={targetOnly} onChange={() => setTargetOnly(true)} /> 대상 업종(전기·통신·소방)</label>
        <span style={note}>계약유형</span>
        <select value={at} disabled={loading} onChange={(e) => setAt(e.target.value)} style={sel}>
          <option value="">전체</option>
          {["지자체", "교육청", "조달청", "기타"].map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {loading && <div role="status" style={{ ...box, borderColor: C.gold, textAlign: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.gold }}>고양 자료를 불러오는 중…</div>
        <div style={{ height: 4, background: C.bg3, borderRadius: 2, overflow: "hidden", marginTop: 8 }}>
          <div style={{ width: "40%", height: "100%", background: C.gold, borderRadius: 2, animation: "goyangLoad 1.1s ease-in-out infinite alternate" }} />
        </div>
        <style>{`@keyframes goyangLoad{from{margin-left:0}to{margin-left:60%}}`}</style>
      </div>}

      {!loading && !data && <div style={{ ...box, color: RED, fontSize: 12 }}>고양 데이터를 불러오지 못했습니다(로그인·권한 확인).</div>}

      {data && s && <div inert={loading ? "" : undefined} aria-busy={loading} style={{ opacity: loading ? 0.3 : 1, pointerEvents: loading ? "none" : "auto", transition: "opacity 0.15s" }}>
        <div style={box}>
          <div style={h}>한눈에 보기</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Card label="공고당 경쟁 업체" value={bids?.n_notices ? "약 " + n0(bids.bidders_med) + "곳" : "-"}
              sub={bids?.n_notices ? `${n0(bids.bidders_min)}~${n0(bids.bidders_max)}곳 · n=${bids.n_notices}공고` : "순위 수집 공고 없음"} />
            <Card label="하한 미달로 탈락" value={belowPct == null ? "-" : pc1(belowPct)}
              sub={bids?.n ? `${n0(bids.n_below)} / ${n0(bids.n)}건` : "순위 수집 공고 없음"} />
            <Card label="낙찰선 바로 위 0.05%p 안" value={bids?.near_med == null ? "-" : "약 " + n0(bids.near_med) + "곳"}
              sub="공고당 중앙값 · 이 중 1곳이 낙찰" />
            <Card label="안착안 하한 통과 (고양 전체)" value={anchor?.n ? pc1((anchor.pass / anchor.n) * 100) : "-"}
              sub={anchor?.n ? `${n0(anchor.pass)} / ${n0(anchor.n)}건 · 나중에 채운 값 포함` : "매칭된 예측 없음"} />
          </div>
          <div style={{ ...note, color: C.gold, marginTop: 10, lineHeight: 1.7 }}>
            1순위는 하한선 바로 위에 쓴 업체입니다. 예정가격이 추첨으로 정해져 하한선을 미리 알 수 없으므로, 하한 미달로 탈락하지 않게 투찰하고 꾸준히 참여하는 것이 기본입니다. 투찰금액은 예측 기록 탭의 투찰 카드(안착안)에서 확인합니다.
          </div>
        </div>

        <div style={box}>
          <div style={h}>개찰 전 고양 공고 ({n0(open.length)}건 · 우리 업종 {n0(open.filter((o) => o.tgt).length)}건)</div>
          {open.length === 0 ? <div style={note}>개찰 전 공고가 없습니다.</div> :
            <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
              <thead><tr><th style={{ ...th, textAlign: "left", width: 90 }}>개찰일</th><th style={{ ...th, textAlign: "left", width: "24%" }}>발주처</th><th style={{ ...th, textAlign: "left" }}>공고명</th><th style={{ ...th, width: 150 }}>금액</th><th style={{ ...th, width: 150 }}>구분</th></tr></thead>
              <tbody>{open.map((o, i) => (
                <tr key={i} style={{ background: o.tgt ? "rgba(93,202,150,0.08)" : "transparent" }}>
                  <td style={{ ...td, textAlign: "left" }}>{o.od}</td>
                  <td style={tdL} title={o.ag}>{o.ag}</td>
                  <td style={tdL} title={o.pn}>{o.pn}</td>
                  <td style={td}>{won(o.amt)} <span style={note}>{o.ba_known ? "기초" : "추정가격"}</span></td>
                  <td style={{ ...td, color: o.tgt ? GREEN : C.txd }}>{o.tgt ? "우리 업종" : "업종 외"}{o.pred ? " · 예측 있음" : ""}</td>
                </tr>
              ))}</tbody>
            </table>}
          <div style={{ ...note, marginTop: 6 }}>'예측 있음' 공고의 투찰금액은 예측 기록 탭에서 '고양만'을 켜고 투찰 카드를 확인합니다.</div>
        </div>

        <div style={box}>
          <div style={h}>그래프 1 · 예정가격은 기초금액의 몇 %에서 정해졌나 (사정률 100% 기준, 최근 24개월 n={n0(d24?.n)})</div>
          {q ? <>
            <div style={key}>
              중앙 <b>{f2(q[2])}</b> · 10건 중 5건이 <b>{f2(q[1])}~{f2(q[3])}</b> · 10건 중 8건이 {f2(q[0])}~{f2(q[4])} · 100 미만 <b>{pc1(Number(d24.lt100))}</b>
              <span style={{ marginLeft: 12 }}>
                <span style={note}>구간 단위 </span>
                {UNITS.map(([v, l]) => <label key={v} style={{ fontSize: 12, color: C.txt, marginLeft: 6 }}><input type="radio" checked={unit === v} onChange={() => setUnit(v)} /> {l}</label>)}
              </span>
            </div>
            {adjBins.length > 0 && (coarse
              ? <Bars bins={adjBins} every={unit === 2000 ? 1 : 2} xLabel={(b) => b.lo.toFixed(1)} tip={adjTip} color={adjColor} />
              : <Stems bins={adjBins} w={w} tip={adjTip} color={adjColor} />)}
            <div style={note}>
              밝은 색 = 10건 중 5건이 들어가는 구간. {coarse ? "막대 위 숫자 = 건수." : "세로선 하나 = 값이 있는 구간 하나, 가장 높은 선 = " + adjMax + "건(선에 마우스를 올리면 값이 보입니다)."} 예정가격은 매번 추첨으로 정해지므로 다음 공고의 값을 알려 주지는 않습니다.
            </div>
            <div style={{ ...key, marginTop: 6, marginBottom: 0 }}>
              구간 단위 {w.toFixed(dec)} · 값이 있는 구간 <b>{n0(adjUsed.length)}개</b> · 한 구간 최대 <b>{adjMax}건</b> · 2건 이상 겹친 구간 <b>{n0(adjDup.length)}개</b>({n0(adjDup.reduce((a, b) => a + b.n, 0))}건)
            </div>
            {coarse ? <ShareTable rows={adjBins} label={adjLabel} /> : <>
              <div style={note}>2건 이상 겹친 구간{adjDup.length > adjTop.length ? " 상위 " + adjTop.length + "개" : ""}(건수 많은 순){dec >= 3 ? " · 소수 " + dec + "자리 절삭 값" : ""}. 나머지 {n0(adjUsed.length - adjDup.length)}개 구간은 모두 1건입니다. 같은 값이 다시 나온 것은 추첨의 우연이며, 다음에도 나온다는 뜻이 아닙니다.</div>
              {adjTop.length > 0 && <ShareTable rows={adjTop} label={adjLabel} cum={false} />}
            </>}
            <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 720, marginTop: 12 }}>
              <thead><tr><th style={{ ...th, textAlign: "left" }}>기간</th><th style={th}>n</th>{["하위 10%", "하위 25%", "중앙", "상위 25%", "상위 10%", "평균", "100 미만"].map((k) => <th key={k} style={th}>{k}</th>)}</tr></thead>
              <tbody>{(data.dist || []).map((r) => (
                <tr key={r.label}><td style={{ ...td, textAlign: "left" }}>{r.label}</td><td style={td}>{n0(r.n)}</td>
                  {(r.pct || [null, null, null, null, null]).map((v, i) => <td key={i} style={td}>{f4(v)}</td>)}<td style={td}>{f4(r.mean)}</td><td style={td}>{r.lt100 == null ? "-" : pc1(Number(r.lt100))}</td></tr>
              ))}</tbody>
            </table>
            <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 12, color: C.txt }}>
              <span style={note}>금액으로 보기 · 기초금액(원)</span>
              <input type="number" value={baIn} onChange={(e) => setBaIn(e.target.value)} style={{ ...sel, width: 150 }} />
              {ba > 0
                ? <span>예정가격 보통 범위 <b>{won(ba * q[1] / 100)} ~ {won(ba * q[3] / 100)}</b> · 넓게 {won(ba * q[0] / 100)} ~ {won(ba * q[4] / 100)}</span>
                : <span style={{ color: RED }}>기초금액을 입력하세요</span>}
            </div>
            <div style={note}>예정가격의 범위일 뿐 투찰금액이 아닙니다. 투찰금액은 낙찰하한율·A값이 반영된 투찰 카드에서 확인합니다.</div>
          </> : <div style={note}>최근 24개월 사정률 기록이 없습니다.</div>}
        </div>

        <div style={box}>
          <div style={h}>그래프 2 · 업체들은 낙찰선에서 얼마나 떨어져 투찰했나 (n={n0(bids?.n_notices)}공고 · {n0(bids?.n)}건)</div>
          {bidBins.length ? <>
            <div style={key}>
              하한 미달 탈락 <b>{pc1(belowPct)}</b> ({n0(bids.n_below)}건) · 낙찰선 바로 위 0.05%p 안에 공고당 약 <b>{n0(bids.near_med)}곳</b> · 그래프 밖: 낙찰선 −1.5%p 아래 {n0(bids.lo)}건, +2.0%p 위 {n0(bids.hi)}건
            </div>
            <Bars bins={bidBins} every={5} xLabel={(b) => sign(b.lo)}
              tip={(b) => `낙찰선 ${bidLabel(b)}%p: ${b.n.toLocaleString()}건 (${pc1(b.pct)})`}
              color={(b) => (b.lo < 0 ? C.txd : GREEN)} />
            <div style={note}>
              <span style={{ color: C.txd }}>■</span> 낙찰선 아래 = 하한 미달 탈락 · <span style={{ color: GREEN }}>■</span> 낙찰선 위 = 유효 투찰(0에 가장 가까운 1곳이 낙찰).
              가로축 = 예정가격 대비 투찰률 − 그 공고의 낙찰선(%p). 비율은 그래프 밖 건수를 포함한 전체 기준입니다. 순위를 수집한 대상 업종 공고만 포함합니다.
            </div>
            <details><summary style={sum}>구간별 건수·비율·누적 표</summary><ShareTable rows={bidBins} label={(b) => bidLabel(b) + "%p"} /></details>
          </> : <div style={note}>이 선택에는 순위를 수집한 공고가 없습니다(대상 업종, 2026-04 이후만 수집).</div>}
        </div>

        <div style={box}>
          <div style={{ ...h, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span>최근 낙찰 기록</span>
            <select value={recentN} onChange={(e) => setRecentN(Number(e.target.value))} style={sel}>
              {[20, 30, 50].map((v) => <option key={v} value={v}>{v}건</option>)}
            </select>
          </div>
          {recent.length === 0 ? <div style={note}>낙찰 기록이 없습니다.</div> : <>
            <div style={key}>
              발주처사정율(100%) {rs.n ? <>중앙 <b>{f4(rs.med)}</b> · 최소 {f4(rs.min)} · 최대 {f4(rs.max)} · 100 미만 {rs.lt100}/{rs.n}건</> : "값 없음"}
              <span style={note}> · 표시 {recent.length}건 중 사정률 있음 {rs.n}건</span>
            </div>
            <table style={{ borderCollapse: "collapse", width: "100%", tableLayout: "fixed" }}>
              <thead><tr>
                <th style={{ ...th, textAlign: "left", width: 86 }}>개찰일</th><th style={{ ...th, textAlign: "left" }}>공고명</th><th style={{ ...th, textAlign: "left", width: "13%" }}>발주처</th>
                <th style={{ ...th, width: 110 }}>기초금액</th><th style={{ ...th, width: 96 }}>발주처사정율</th><th style={{ ...th, width: 118 }}>1위사정율</th>
                <th style={{ ...th, width: 84 }} title="1순위 투찰금액 ÷ 예정가격">1위 투찰률</th><th style={{ ...th, textAlign: "left", width: "13%" }}>1순위 업체</th><th style={{ ...th, width: 60 }}>참여</th>
              </tr></thead>
              <tbody>{recent.map((r, i) => {
                const k = BR1_KIND[r.br1_kind];
                return (
                  <tr key={i}>
                    <td style={{ ...td, textAlign: "left" }}>{r.od}</td>
                    <td style={tdL} title={r.pn}>{r.pn}</td>
                    <td style={tdL} title={r.ag}>{r.ag}</td>
                    <td style={td}>{won(r.ba)}</td>
                    <td style={{ ...td, fontWeight: 700, color: r.ar1 == null ? C.txd : r.ar1 < 100 ? "#7fb2ff" : "#ffb37f" }}>{f4(r.ar1)}</td>
                    <td style={{ ...td, color: r.br1_kind === "est" ? C.txd : C.txt }} title={k?.tip}>{f4(r.br1)}{k?.mark ? <span style={note}> {k.mark}</span> : null}</td>
                    <td style={td}>{r.r1_rate == null ? "-" : Number(r.r1_rate).toFixed(3)}</td>
                    <td style={tdL} title={r.co}>{r.co || "-"}</td>
                    <td style={td}>{n0(r.bidders)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
            <div style={{ ...note, marginTop: 6, lineHeight: 1.7 }}>
              발주처사정율 = 예정가격 ÷ 기초금액 × 100 (<span style={{ color: "#7fb2ff" }}>100 미만</span> · <span style={{ color: "#ffb37f" }}>100 이상</span>). 값이 없는 줄은 예비가격이 아직 수집되지 않은 공고입니다.<br />
              1위사정율 = 발주처사정율 × 1위 금액 ÷ 낙찰하한가. 표시 없음 = 업로드 기록의 값, ≈ = 순위 수집분으로 계산, 추정 = A값이 없어 발주처사정율 + 0.007로 표시(업로드 기록에서 두 값의 차이는 중앙 0.007, 10건 중 9건이 0.046 이내).<br />
              1위 투찰률은 예정가격 대비입니다. 같은 공고가 업로드분과 자동 수집분으로 겹치면 업로드분 한 줄만 보여 줍니다.
            </div>
          </>}
        </div>

        <div style={box}>
          <details>
            <summary style={sum}>월별 사정률 중앙값 (최근 24개월)</summary>
            {months.length > 0 && <div style={{ marginTop: 8 }}>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 110 }}>
                {months.map((m) => {
                  const hgt = 10 + ((m.p50 - pMin) / Math.max(pMax - pMin, 0.01)) * 80;
                  return <div key={m.ym} title={`${m.ym} 중앙 ${f4(m.p50)} (n=${m.n})`} style={{ flex: 1, textAlign: "center" }}>
                    <div style={{ fontSize: 9, color: C.txd }}>{m.n}</div>
                    <div style={{ height: hgt, background: m.n < 5 ? C.txd : C.gold, opacity: m.n < 5 ? 0.5 : 0.85, borderRadius: 2 }} />
                    <div style={{ fontSize: 8, color: C.txd, marginTop: 2 }}>{m.ym.slice(2)}</div>
                  </div>;
                })}
              </div>
              <div style={note}>막대 위 숫자 = 건수, 회색 막대 = n&lt;5(해석 주의). 범위 {f4(pMin)} ~ {f4(pMax)}</div>
            </div>}
          </details>
          <details>
            <summary style={sum}>추첨 번호 빈도 (투찰금액에 영향 없음 · n={n0(draws?.n_sets)}공고)</summary>
            <div style={{ display: "flex", flexDirection: "column", gap: 3, maxWidth: 520, marginTop: 8 }}>
              {(draws?.counts || []).map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                  <span style={{ width: 18, textAlign: "right", color: C.txm }}>{i + 1}</span>
                  <div style={{ position: "relative", flex: 1, height: 12, background: C.bg3, borderRadius: 2 }}>
                    <div style={{ width: (c / maxDraw) * 100 + "%", height: "100%", background: GREEN, opacity: 0.8, borderRadius: 2 }} />
                    <div style={{ position: "absolute", left: (exp / maxDraw) * 100 + "%", top: -2, bottom: -2, width: 1, background: C.txt, opacity: 0.6 }} />
                  </div>
                  <span style={{ width: 34, textAlign: "right", color: C.txt }}>{c}</span>
                </div>
              ))}
            </div>
            <div style={note}>세로선 = 고르게 뽑힐 때의 기댓값 {exp.toFixed(1)}. 번호는 투찰 업체들이 많이 고른 4개가 뽑히는데, 예비가격은 번호 순서와 무관해 어느 번호가 뽑혀도 예정가격이 높아지거나 낮아지지 않습니다.</div>
          </details>
          <details>
            <summary style={sum}>용어 풀이</summary>
            <div style={{ fontSize: 12, color: C.txt, lineHeight: 1.9, marginTop: 6 }}>
              <b>기초금액</b> — 발주처가 공고에 밝히는 기준 금액입니다.<br />
              <b>예정가격</b> — 기초금액 근처의 예비가격 15개 중 투찰 업체들이 많이 고른 4개의 평균입니다. 개찰할 때 정해집니다.<br />
              <b>사정률(발주처사정율)</b> — 예정가격 ÷ 기초금액 × 100. 100이면 기초금액과 같습니다.<br />
              <b>낙찰하한선</b> — 이보다 낮게 쓰면 탈락하는 금액입니다. 예정가격에 낙찰하한율을 적용해 정해집니다.<br />
              <b>1위사정율</b> — 1순위 업체의 투찰금액이 하한선이 되는 사정률입니다. 발주처사정율보다 조금 높습니다.<br />
              <b>안착안</b> — 하한 미달 탈락을 피하도록 여유를 둔 투찰금액으로, 투찰 카드에 표시됩니다.
            </div>
          </details>
          <div style={{ ...note, marginTop: 8, lineHeight: 1.7 }}>
            자료{s.as_of ? " (" + new Date(s.as_of).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) + " 기준, 3시간마다 갱신)" : ""}: 기록 {n0(s.n)}건({s.first_od || "-"} ~ {s.last_od || "-"}, 최근 180일 {n0(s.n_180)}건, 사정률 있음 {n0(s.n_ar1)}건, 대상 업종 {n0(s.n_target)}건) · 예비가격 세트 {n0(s.prelim_sets)}공고 · 순위 수집 {n0(s.rank_notices)}공고.
            고양 정의: 기관 마스터(include) 기준. 학교 2곳(저동고·자운학교)은 소재 미확인이나 포함.
          </div>
        </div>
      </div>}
    </div>
  );
}
