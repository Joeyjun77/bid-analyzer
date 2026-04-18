import React, { useEffect, useMemo, useState } from 'react';
import { C, SB_URL, getHdrs } from '../lib/constants.js';

const fmtPct = (v) => v == null ? '—' : Number(v).toFixed(3) + '%';
const fmtNum = (v) => v == null ? '—' : Number(v).toFixed(4);

const gateColor = { pass: '#5dca96', warn: '#d4a834', block: '#e24b4a' };
const driftColor = (on) => on ? '#e24b4a' : C.txd;

export default function PredictionFeedback({ modelVersion = 'v6.2' }) {
  const [weekly, setWeekly] = useState([]);
  const [daily, setDaily] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setErr(null);
      try {
        const H = getHdrs();
        const [w, d] = await Promise.all([
          fetch(`${SB_URL}/rest/v1/weekly_quality_report?model_version=eq.${modelVersion}&order=report_week.desc,scope.asc,dimension_value.asc&limit=200`, { headers: H }).then(r => r.json()),
          fetch(`${SB_URL}/rest/v1/prediction_quality_daily?model_version=eq.${modelVersion}&order=measured_on.desc&limit=500`, { headers: H }).then(r => r.json()),
        ]);
        if (cancelled) return;
        setWeekly(Array.isArray(w) ? w : []);
        setDaily(Array.isArray(d) ? d : []);
      } catch (e) { if (!cancelled) setErr(String(e)); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [modelVersion]);

  const latestOverall = useMemo(() =>
    weekly.find(r => r.scope === 'overall') || null, [weekly]);

  const weeksOverall = useMemo(() =>
    weekly.filter(r => r.scope === 'overall').slice(0, 8), [weekly]);

  const routeLatest = useMemo(() =>
    weekly.filter(r => r.scope === 'route' && r.report_week === latestOverall?.report_week), [weekly, latestOverall]);

  const atLatest = useMemo(() =>
    weekly.filter(r => r.scope === 'at' && r.report_week === latestOverall?.report_week), [weekly, latestOverall]);

  const dailyOverall = useMemo(() =>
    daily.filter(r => r.route == null && r.at == null).slice(0, 30), [daily]);

  const cardBox = { background: C.bg2, border: '1px solid ' + C.bdr, borderRadius: 8, padding: '12px 14px' };
  const thS = { padding: '8px 10px', textAlign: 'left', fontSize: 10, color: C.txd, fontWeight: 600, borderBottom: '1px solid ' + C.bdr, whiteSpace: 'nowrap' };
  const tdS = { padding: '7px 10px', fontSize: 11, color: C.txt, borderBottom: '1px solid ' + C.bdr + '33', whiteSpace: 'nowrap' };

  if (loading) return <div style={{ padding: 20, color: C.txm, fontSize: 12 }}>로딩중…</div>;
  if (err) return <div style={{ padding: 20, color: '#e24b4a', fontSize: 12 }}>조회 실패: {err}</div>;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: C.txt }}>낙찰 결과 자동 피드백</div>
          <div style={{ fontSize: 10, color: C.txd, marginTop: 2 }}>
            모델 {modelVersion} · prediction_quality_daily + weekly_quality_report 기반
          </div>
        </div>
        {latestOverall && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: C.txd }}>최근 주</span>
            <span style={{ fontSize: 11, fontFamily: 'monospace', color: C.txt }}>{latestOverall.report_week}</span>
            <span style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 10,
              background: (gateColor[latestOverall.gate_status] || C.txd) + '18',
              border: '1px solid ' + (gateColor[latestOverall.gate_status] || C.txd) + '55',
              color: gateColor[latestOverall.gate_status] || C.txd,
              fontWeight: 600, textTransform: 'uppercase'
            }}>{latestOverall.gate_status || '—'}</span>
          </div>
        )}
      </div>

      {latestOverall && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
          <div style={cardBox}>
            <div style={{ fontSize: 10, color: C.txd }}>표본 수 (주)</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: C.txt, marginTop: 4 }}>{latestOverall.n_week}건</div>
          </div>
          <div style={cardBox}>
            <div style={{ fontSize: 10, color: C.txd }}>MAE (주)</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: C.txt, marginTop: 4 }}>{fmtNum(latestOverall.mae_week)}</div>
            {latestOverall.mae_delta != null && (
              <div style={{ fontSize: 10, color: Number(latestOverall.mae_delta) <= 0 ? '#5dca96' : '#e24b4a', marginTop: 2 }}>
                전주 대비 {Number(latestOverall.mae_delta) > 0 ? '+' : ''}{fmtNum(latestOverall.mae_delta)}
              </div>
            )}
          </div>
          <div style={cardBox}>
            <div style={{ fontSize: 10, color: C.txd }}>MA7 기준선</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: C.txt, marginTop: 4 }}>{fmtNum(latestOverall.ma7_baseline)}</div>
            <div style={{ fontSize: 10, color: driftColor(latestOverall.drift_flag), marginTop: 2 }}>
              {latestOverall.drift_flag ? '⚠ 드리프트 감지' : '안정'}
            </div>
          </div>
          <div style={cardBox}>
            <div style={{ fontSize: 10, color: C.txd }}>명중 / 하한 안전</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.txt, marginTop: 6 }}>
              {fmtPct(latestOverall.hit_0_5_pct_week)} / {fmtPct(latestOverall.floor_safe_pct_week)}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <div style={cardBox}>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.txm, marginBottom: 8 }}>Route별 최근 주 성과</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thS}>Route</th><th style={{ ...thS, textAlign: 'right' }}>n</th><th style={{ ...thS, textAlign: 'right' }}>MAE</th><th style={{ ...thS, textAlign: 'right' }}>Δ전주</th><th style={{ ...thS, textAlign: 'center' }}>Drift</th></tr></thead>
            <tbody>
              {routeLatest.length === 0 && <tr><td colSpan={5} style={{ ...tdS, textAlign: 'center', color: C.txd }}>데이터 없음</td></tr>}
              {routeLatest.map(r => (
                <tr key={r.id}>
                  <td style={tdS}>{r.dimension_value}</td>
                  <td style={{ ...tdS, textAlign: 'right', fontFamily: 'monospace' }}>{r.n_week}</td>
                  <td style={{ ...tdS, textAlign: 'right', fontFamily: 'monospace' }}>{fmtNum(r.mae_week)}</td>
                  <td style={{ ...tdS, textAlign: 'right', fontFamily: 'monospace', color: r.mae_delta == null ? C.txd : Number(r.mae_delta) <= 0 ? '#5dca96' : '#e24b4a' }}>
                    {r.mae_delta == null ? '—' : (Number(r.mae_delta) > 0 ? '+' : '') + fmtNum(r.mae_delta)}
                  </td>
                  <td style={{ ...tdS, textAlign: 'center', color: driftColor(r.drift_flag) }}>{r.drift_flag ? '⚠' : '✓'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={cardBox}>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.txm, marginBottom: 8 }}>발주사 유형(at)별 최근 주 성과</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thS}>AT</th><th style={{ ...thS, textAlign: 'right' }}>n</th><th style={{ ...thS, textAlign: 'right' }}>MAE</th><th style={{ ...thS, textAlign: 'right' }}>Δ전주</th><th style={{ ...thS, textAlign: 'center' }}>Drift</th></tr></thead>
            <tbody>
              {atLatest.length === 0 && <tr><td colSpan={5} style={{ ...tdS, textAlign: 'center', color: C.txd }}>데이터 없음</td></tr>}
              {atLatest.map(r => (
                <tr key={r.id}>
                  <td style={tdS}>{r.dimension_value}</td>
                  <td style={{ ...tdS, textAlign: 'right', fontFamily: 'monospace' }}>{r.n_week}</td>
                  <td style={{ ...tdS, textAlign: 'right', fontFamily: 'monospace' }}>{fmtNum(r.mae_week)}</td>
                  <td style={{ ...tdS, textAlign: 'right', fontFamily: 'monospace', color: r.mae_delta == null ? C.txd : Number(r.mae_delta) <= 0 ? '#5dca96' : '#e24b4a' }}>
                    {r.mae_delta == null ? '—' : (Number(r.mae_delta) > 0 ? '+' : '') + fmtNum(r.mae_delta)}
                  </td>
                  <td style={{ ...tdS, textAlign: 'center', color: driftColor(r.drift_flag) }}>{r.drift_flag ? '⚠' : '✓'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ ...cardBox, marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.txm, marginBottom: 8 }}>주간 전체 성과 추이 (최근 8주)</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={thS}>Week</th>
            <th style={{ ...thS, textAlign: 'right' }}>n</th>
            <th style={{ ...thS, textAlign: 'right' }}>MAE</th>
            <th style={{ ...thS, textAlign: 'right' }}>전주 MAE</th>
            <th style={{ ...thS, textAlign: 'right' }}>Δ</th>
            <th style={{ ...thS, textAlign: 'right' }}>Hit≤0.5%</th>
            <th style={{ ...thS, textAlign: 'right' }}>하한 안전</th>
            <th style={{ ...thS, textAlign: 'center' }}>Gate</th>
          </tr></thead>
          <tbody>
            {weeksOverall.length === 0 && <tr><td colSpan={8} style={{ ...tdS, textAlign: 'center', color: C.txd }}>데이터 없음</td></tr>}
            {weeksOverall.map(r => (
              <tr key={r.id}>
                <td style={{ ...tdS, fontFamily: 'monospace' }}>{r.report_week}</td>
                <td style={{ ...tdS, textAlign: 'right', fontFamily: 'monospace' }}>{r.n_week}</td>
                <td style={{ ...tdS, textAlign: 'right', fontFamily: 'monospace' }}>{fmtNum(r.mae_week)}</td>
                <td style={{ ...tdS, textAlign: 'right', fontFamily: 'monospace', color: C.txd }}>{fmtNum(r.mae_prev_week)}</td>
                <td style={{ ...tdS, textAlign: 'right', fontFamily: 'monospace', color: r.mae_delta == null ? C.txd : Number(r.mae_delta) <= 0 ? '#5dca96' : '#e24b4a' }}>
                  {r.mae_delta == null ? '—' : (Number(r.mae_delta) > 0 ? '+' : '') + fmtNum(r.mae_delta)}
                </td>
                <td style={{ ...tdS, textAlign: 'right', fontFamily: 'monospace' }}>{fmtPct(r.hit_0_5_pct_week)}</td>
                <td style={{ ...tdS, textAlign: 'right', fontFamily: 'monospace' }}>{fmtPct(r.floor_safe_pct_week)}</td>
                <td style={{ ...tdS, textAlign: 'center' }}>
                  <span style={{
                    fontSize: 9, padding: '2px 6px', borderRadius: 4,
                    background: (gateColor[r.gate_status] || C.txd) + '18',
                    border: '1px solid ' + (gateColor[r.gate_status] || C.txd) + '55',
                    color: gateColor[r.gate_status] || C.txd,
                    textTransform: 'uppercase', fontWeight: 600
                  }}>{r.gate_status || '—'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={cardBox}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.txm, marginBottom: 8 }}>일간 전체 MAE (최근 30일)</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={thS}>Date</th>
            <th style={{ ...thS, textAlign: 'right' }}>n</th>
            <th style={{ ...thS, textAlign: 'right' }}>MAE</th>
            <th style={{ ...thS, textAlign: 'right' }}>Hit≤0.5%</th>
            <th style={{ ...thS, textAlign: 'right' }}>하한 안전</th>
          </tr></thead>
          <tbody>
            {dailyOverall.length === 0 && <tr><td colSpan={5} style={{ ...tdS, textAlign: 'center', color: C.txd }}>데이터 없음</td></tr>}
            {dailyOverall.map(r => (
              <tr key={r.id}>
                <td style={{ ...tdS, fontFamily: 'monospace' }}>{r.measured_on}</td>
                <td style={{ ...tdS, textAlign: 'right', fontFamily: 'monospace' }}>{r.n}</td>
                <td style={{ ...tdS, textAlign: 'right', fontFamily: 'monospace' }}>{fmtNum(r.mae)}</td>
                <td style={{ ...tdS, textAlign: 'right', fontFamily: 'monospace' }}>{fmtPct(r.hit_0_5_pct)}</td>
                <td style={{ ...tdS, textAlign: 'right', fontFamily: 'monospace' }}>{fmtPct(r.floor_safe_pct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
