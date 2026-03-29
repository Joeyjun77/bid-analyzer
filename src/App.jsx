/*
 * ═══════════════════════════════════════════════════════════
 * 업로드 영역 — 최신 데이터 현황 표시 패치
 * ═══════════════════════════════════════════════════════════
 *
 * 기존 src/App.jsx에 적용할 3가지 수정사항입니다.
 * GitHub에서 직접 src/App.jsx를 편집하여 적용하세요.
 *
 * 현재 DB 현황:
 *   - 총 28,970건
 *   - 최신 개찰일: 2026-03-27
 *   - 전기 단독 업종 최신: 운악아파트 503동 보수공사(전기)
 * ═══════════════════════════════════════════════════════════
 */


// ───────────────────────────────────────────────────────────
// 패치 1/3: calcDataStatus 함수 추가
// ───────────────────────────────────────────────────────────
// 위치: App 함수 바깥, 유틸리티 함수들 근처에 추가
// (예: classifyAgency, toRecords, calcStats 등과 같은 레벨)

function calcDataStatus(rows) {
  if (!rows || rows.length === 0) return null;
  const withOd = rows.filter(r => r.od);
  if (withOd.length === 0) return { total: rows.length, latestDate: null, latestPn: null, latestAg: "", sameDayCount: 0 };
  withOd.sort((a, b) => (b.od > a.od ? 1 : b.od < a.od ? -1 : 0));
  const latest = withOd[0];
  const sameDay = withOd.filter(r => r.od === latest.od);
  const pnShort = latest.pn
    ? (latest.pn.length > 35 ? latest.pn.slice(0, 35) + "…" : latest.pn)
    : "(공고명 없음)";
  return {
    total: rows.length,
    latestDate: latest.od,
    latestPn: pnShort,
    latestAg: latest.ag || "",
    sameDayCount: sameDay.length
  };
}


// ───────────────────────────────────────────────────────────
// 패치 2/3: 상태 변수 + DB 로드 시 호출
// ───────────────────────────────────────────────────────────

// [2-A] 상태 변수 추가 (App 함수 내부, 기존 상태 변수 근처)
//
// 찾기:
//   const [uploadLog, setUploadLog] = useState([]);
//
// 바꾸기:
//   const [uploadLog, setUploadLog] = useState([]);
//   const [dataStatus, setDataStatus] = useState(null);
//
// ※ uploadLog가 없고 fname을 쓰는 경우:
//   const [fname, setFname] = useState("");
//   const [dataStatus, setDataStatus] = useState(null);  ← 추가


// [2-B] DB 로드 완료 시 setDataStatus 호출
//
// useEffect 내에서 sbFetchAll() → setRecs(rows) 하는 부분을 찾아서:
//
// 변경 전:
//   setRecs(rows);
//   refreshStats(rows);    // 또는 updateStats(rows)
//
// 변경 후:
//   setRecs(rows);
//   refreshStats(rows);
//   setDataStatus(calcDataStatus(rows));


// [2-C] 파일 업로드 완료 시에도 갱신
//
// loadFiles 함수 마지막 부분:
//
// 변경 전:
//   setRecs(final => { refreshStats(final); return final; });
//
// 변경 후:
//   setRecs(final => { refreshStats(final); setDataStatus(calcDataStatus(final)); return final; });


// ───────────────────────────────────────────────────────────
// 패치 3/3: 드롭존 UI에 현황 박스 삽입
// ───────────────────────────────────────────────────────────

// 찾기 (업로드 드롭존 내부):
//
//   <div style={{ fontSize: 11, color: C.txd }}>XLS / CSV / HTML · 중복 자동 제거 (공고명+발주기관+개찰일+기초금액)</div>
//
// ※ 텍스트가 약간 다를 수 있음. 핵심은 "중복 자동 제거" 를 포함하는 div 태그
//
// 바꾸기:

/*
  <div style={{ fontSize: 11, color: C.txd }}>XLS / XLSX / CSV · 중복 자동 제거</div>
  {dataStatus && (
    <div style={{
      marginTop: 14,
      padding: "10px 16px",
      background: "rgba(212,168,52,0.06)",
      border: "1px solid rgba(212,168,52,0.15)",
      borderRadius: 6,
      textAlign: "left",
      fontSize: 11,
      lineHeight: 1.7
    }}>
      <div style={{ fontWeight: 600, color: C.gold, marginBottom: 4, fontSize: 12 }}>
        업로드 데이터 현황
      </div>
      <div style={{ color: C.txm }}>
        총 <span style={{ color: C.txt, fontWeight: 600 }}>{dataStatus.total.toLocaleString()}건</span> 저장됨
      </div>
      {dataStatus.latestDate && (
        <>
          <div style={{ color: C.txm }}>
            최신 개찰일: <span style={{ color: "#5dca96", fontWeight: 600 }}>{dataStatus.latestDate}</span>
            <span style={{ color: C.txd, marginLeft: 6 }}>({dataStatus.sameDayCount}건)</span>
          </div>
          <div style={{ color: C.txd, fontSize: 10, marginTop: 2 }}>
            {dataStatus.latestPn}
            {dataStatus.latestAg && (
              <span style={{ marginLeft: 6, color: "#888" }}>- {dataStatus.latestAg}</span>
            )}
          </div>
        </>
      )}
    </div>
  )}
*/


// ═══════════════════════════════════════════════════════════
// 아래는 실제 동작하는 독립 테스트 컴포넌트입니다.
// src/App.jsx 대신 이 파일을 임시로 사용하면
// 업로드 현황 UI를 미리 확인할 수 있습니다.
// ═══════════════════════════════════════════════════════════

import { useState, useEffect } from "react";

const SB_URL = "https://sadunejfkstxbxogzutl.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhZHVuZWpma3N0eGJ4b2d6dXRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2ODYxOTksImV4cCI6MjA5MDI2MjE5OX0.C5kNr-4urLImKfqOi_yl2-SUbrpcSgz2N3IiWGbObgc";
const C = { bg:"#0c0c1a", bg2:"#12122a", bg3:"#1a1a30", txt:"#e8e8f0", txm:"#a0a0b8", txd:"#666680", bdr:"#252540", gold:"#d4a834" };

async function fetchStatusFromDB() {
  const h = { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY };
  // 전체 건수
  const cRes = await fetch(SB_URL + "/rest/v1/bid_records?select=id&limit=1", { headers: { ...h, "Prefer": "count=exact" } });
  const total = parseInt(cRes.headers.get("content-range")?.split("/")?.[1] || "0");
  // 최신 개찰일 1건
  const lRes = await fetch(SB_URL + "/rest/v1/bid_records?select=od,pn,ag&od=not.is.null&pn=not.is.null&order=od.desc&limit=1", { headers: h });
  const lr = await lRes.json();
  if (!lr.length) return { total, latestDate: null, latestPn: null, latestAg: "", sameDayCount: 0 };
  const lt = lr[0];
  // 같은 날짜 건수
  const sRes = await fetch(SB_URL + "/rest/v1/bid_records?select=id&od=eq." + lt.od + "&limit=1", { headers: { ...h, "Prefer": "count=exact" } });
  const sc = parseInt(sRes.headers.get("content-range")?.split("/")?.[1] || "1");
  return {
    total,
    latestDate: lt.od,
    latestPn: lt.pn && lt.pn.length > 35 ? lt.pn.slice(0, 35) + "…" : (lt.pn || "(없음)"),
    latestAg: lt.ag || "",
    sameDayCount: sc
  };
}

export default function App() {
  const [ds, setDs] = useState(null);
  const [ld, setLd] = useState(true);
  const [er, setEr] = useState(null);
  const [drag, setDrag] = useState(false);

  useEffect(() => {
    fetchStatusFromDB().then(s => { setDs(s); setLd(false); }).catch(e => { setEr(e.message); setLd(false); });
  }, []);

  return (
    <div style={{ fontFamily: "system-ui,sans-serif", background: C.bg, color: C.txt, minHeight: "100vh" }}>
      {/* 헤더 */}
      <div style={{ padding: "14px 20px", borderBottom: "1px solid " + C.bdr, display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: C.gold }}>입찰 분석 시스템 v2</span>
        <span style={{ fontSize: 11, color: C.txd }}>업로드 현황 미리보기</span>
      </div>

      <div style={{ maxWidth: 560, margin: "40px auto", padding: "0 16px" }}>
        {/* 업로드 카드 */}
        <div style={{ background: C.bg2, border: "1px solid " + C.bdr, borderRadius: 10, padding: 20 }}>
          {/* 드롭존 */}
          <div
            style={{
              border: "2px dashed " + (drag ? C.gold : C.bdr),
              borderRadius: 10,
              padding: "44px 20px",
              textAlign: "center",
              cursor: "pointer",
              background: drag ? "rgba(212,168,52,0.05)" : "transparent",
              transition: "border-color 0.15s, background 0.15s"
            }}
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); }}
          >
            <div style={{ fontSize: 36, opacity: 0.4, marginBottom: 8 }}>↑</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>낙찰정보리스트 파일 업로드</div>
            <div style={{ fontSize: 11, color: C.txd }}>XLS / XLSX / CSV · 중복 자동 제거</div>

            {/* ★ 데이터 현황 표시 (이 부분이 핵심) */}
            {ld && <div style={{ marginTop: 14, fontSize: 11, color: C.txd }}>데이터 현황 조회 중...</div>}
            {er && <div style={{ marginTop: 14, fontSize: 11, color: "#e55" }}>현황 조회 실패: {er}</div>}
            {ds && (
              <div style={{
                marginTop: 14,
                padding: "10px 16px",
                background: "rgba(212,168,52,0.06)",
                border: "1px solid rgba(212,168,52,0.15)",
                borderRadius: 6,
                textAlign: "left",
                fontSize: 11,
                lineHeight: 1.7
              }}>
                <div style={{ fontWeight: 600, color: C.gold, marginBottom: 4, fontSize: 12 }}>
                  업로드 데이터 현황
                </div>
                <div style={{ color: C.txm }}>
                  총 <span style={{ color: C.txt, fontWeight: 600 }}>{ds.total.toLocaleString()}건</span> 저장됨
                </div>
                {ds.latestDate && (
                  <>
                    <div style={{ color: C.txm }}>
                      최신 개찰일: <span style={{ color: "#5dca96", fontWeight: 600 }}>{ds.latestDate}</span>
                      <span style={{ color: C.txd, marginLeft: 6 }}>({ds.sameDayCount}건)</span>
                    </div>
                    <div style={{ color: C.txd, fontSize: 10, marginTop: 2 }}>
                      {ds.latestPn}
                      {ds.latestAg && <span style={{ marginLeft: 6, color: "#888" }}>- {ds.latestAg}</span>}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 적용 안내 */}
        <div style={{
          marginTop: 24, padding: 16,
          background: C.bg2, border: "1px solid " + C.bdr,
          borderRadius: 8, fontSize: 11, color: C.txd, lineHeight: 1.9
        }}>
          <div style={{ fontWeight: 600, color: C.txm, marginBottom: 8, fontSize: 12 }}>기존 App.jsx 적용 방법</div>
          <div><span style={{ color: C.gold }}>1.</span> <code style={{ color: "#5dca96" }}>calcDataStatus()</code> 함수를 유틸 함수 영역에 추가</div>
          <div><span style={{ color: C.gold }}>2.</span> <code style={{ color: "#5dca96" }}>const [dataStatus, setDataStatus] = useState(null);</code> 상태 추가</div>
          <div><span style={{ color: C.gold }}>3.</span> DB 로드 완료 시 <code style={{ color: "#5dca96" }}>setDataStatus(calcDataStatus(rows))</code></div>
          <div><span style={{ color: C.gold }}>4.</span> 파일 업로드 완료 시에도 동일하게 호출</div>
          <div><span style={{ color: C.gold }}>5.</span> 드롭존 내부에 현황 JSX 삽입 (위 미리보기 참고)</div>
        </div>
      </div>
    </div>
  );
}
