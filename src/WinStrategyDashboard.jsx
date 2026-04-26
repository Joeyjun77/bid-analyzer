// ===========================================================================
// Phase 20: 작전 대시보드 (App.jsx 다크 테마 통합 버전)
// ===========================================================================
// 설치 방법:
//   1. 이 파일을 src/ 디렉토리에 복사 (예: src/WinStrategyDashboard.jsx)
//   2. App.jsx 3번째 줄 근처 import에 추가:
//        import { WinStrategyDashboard } from "./WinStrategyDashboard.jsx";
//   3. App.jsx 674번 줄의 탭 리스트에 신규 탭 추가:
//        <Tb id="winstrat" ch="🎯 작전"/>
//   4. chat 탭 렌더링 직전(1729번 줄 근처)에 블록 추가:
//        {tab==="winstrat"&&<WinStrategyDashboard/>}
// ===========================================================================

import React, { useState, useEffect, useMemo } from 'react';
import { C } from './lib/constants.js';
import { authedFetch } from './auth.js';

const TIER_STYLE = {
  A_high: { bg: '#1a4c2d', txt: '#4ade80', badge: 'A', full: '🎯 A등급 (최우선)' },
  B_med:  { bg: '#1e3a5f', txt: '#60a5fa', badge: 'B', full: '⚡ B등급 (추천)' },
  C_low:  { bg: '#2a2a3a', txt: '#9ca3af', badge: 'C', full: '⏸️ C등급 (보류)' },
  D_skip: { bg: '#4a1d1d', txt: '#f87171', badge: 'D', full: '❌ D등급 (회피)' }
};

const scoreColor = (s) => s >= 80 ? '#4ade80' : s >= 65 ? '#60a5fa' : s >= 50 ? '#fbbf24' : '#f87171';
const fmt = (n) => n == null ? '-' : Math.round(n).toLocaleString();
const fmtPct = (n) => n == null ? '-' : Number(n).toFixed(3) + '%';
const fmtAdj = (n) => {
  if (n == null) return '-';
  return (100 + Number(n)).toFixed(3) + '%';
};

function BidCard({ label, emoji, adj, bid, highlighted }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(String(bid));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div style={{
      padding: '8px 10px',
      background: highlighted ? C.bg3 : C.bg2,
      border: `1px solid ${highlighted ? C.gold : C.bdr}`,
      borderRadius: 6,
      fontSize: 12
    }}>
      <div style={{ fontWeight: 600, marginBottom: 4, color: highlighted ? C.gold : C.txt }}>
        {emoji} {label}
      </div>
      <div style={{ color: C.txm, fontSize: 11 }}>사정률 {fmtAdj(adj)}</div>
      <div style={{ fontWeight: 700, fontSize: 13, marginTop: 2, color: C.txt }}>
        {fmt(bid)}원
      </div>
      <button
        onClick={handleCopy}
        style={{
          marginTop: 4,
          padding: '3px 8px',
          fontSize: 10,
          border: `1px solid ${copied ? '#4ade80' : C.bdr}`,
          background: copied ? '#1a4c2d' : C.bg2,
          color: copied ? '#4ade80' : C.txm,
          borderRadius: 4,
          cursor: 'pointer',
          width: '100%'
        }}
      >
        {copied ? '✅ 복사됨' : '📋 복사'}
      </button>
    </div>
  );
}

function StrategyRow({ row, rank }) {
  const [expanded, setExpanded] = useState(rank <= 5);
  const tier = TIER_STYLE[row.tier] || TIER_STYLE.C_low;
  const baBillion = (row.ba / 1e8).toFixed(1);
  const hasWarning = row.competitor_warning && row.competitor_warning !== '✅ 일반';

  return (
    <div style={{
      border: `1px solid ${C.bdr}`,
      borderRadius: 8,
      padding: 12,
      marginBottom: 8,
      background: C.bg2
    }}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
          <span style={{
            padding: '3px 9px',
            background: tier.bg,
            color: tier.txt,
            borderRadius: 4,
            fontWeight: 700,
            fontSize: 12
          }}>
            #{rank} {tier.badge}
          </span>
          <span style={{ fontWeight: 600, fontSize: 13, color: C.txt }}>{row.ag}</span>
          <span style={{ color: C.gold, fontSize: 13 }}>{baBillion}억</span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: C.txm }}>{row.open_date}</span>
          <span style={{ fontSize: 11, color: C.txm }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      <div style={{ margin: '8px 0' }}>
        <div style={{ height: 6, background: C.bg3, borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: 6, background: scoreColor(row.score), width: `${row.score}%` }} />
        </div>
        <div style={{ fontSize: 11, color: C.txm, marginTop: 2 }}>
          점수 <strong style={{ color: C.txt }}>{row.score}</strong>/100
          {' · '}권장분산 {row.recommend_split}개
          {row.dispersion_pct != null && ` · 분산도 ${row.dispersion_pct}%`}
        </div>
      </div>

      {hasWarning && (
        <div style={{
          fontSize: 12,
          background: '#3a2a0a',
          color: '#fbbf24',
          padding: '6px 10px',
          borderRadius: 4,
          marginBottom: 8,
          border: '1px solid #78350f'
        }}>
          {row.competitor_warning}
        </div>
      )}

      {expanded && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 8 }}>
            <BidCard label="적극" emoji="🔴" adj={row.band_aggressive_adj} bid={row.band_aggressive_bid} />
            <BidCard label="기본" emoji="⚖️" adj={row.band_default_adj} bid={row.band_default_bid} highlighted />
            <BidCard label="안전" emoji="🛡️" adj={row.band_safe_adj} bid={row.band_safe_bid} />
          </div>

          <div style={{ fontSize: 11, color: C.txm, marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <span>공고: {row.pn_no}</span>
            {row.cat && <span>공종: {row.cat}</span>}
            {row.av > 0 && <span>A값: {fmt(row.av)}원</span>}
            <span>하한율: {row.floor_rate}%</span>
            {row.competitor3_recent > 0 && (
              <span style={{ color: '#fbbf24' }}>⚠️ 경쟁3사 {row.competitor3_recent}건</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function WinStrategyDashboard() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshedAt, setRefreshedAt] = useState(null);
  const [filterTier, setFilterTier] = useState('ALL');

  const loadData = async () => {
    try {
      setLoading(true);
      // 1차: view 직접 호출 (가장 단순, 빠름)
      let res = await authedFetch('/rest/v1/win_strategy_cache?select=*&order=priority_rank.asc');

      // view 실패 시 RPC fallback (캐시 자동 갱신 포함)
      if (!res.ok) {
        console.warn(`View 호출 실패(HTTP ${res.status}), RPC로 재시도`);
        res = await authedFetch('/rest/v1/rpc/get_win_strategy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
      }
      
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 100)}`);
      }
      const json = await res.json();
      setData(Array.isArray(json) ? json : []);
      setRefreshedAt(new Date());
      setError(null);
    } catch (e) {
      setError(e.message);
      console.error('WinStrategyDashboard loadData error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const iv = setInterval(loadData, 60000);
    return () => clearInterval(iv);
  }, []);

  const summary = useMemo(() => {
    const g = { A_high: [], B_med: [], C_low: [], D_skip: [] };
    data.forEach(d => { if (g[d.tier]) g[d.tier].push(d); });
    return g;
  }, [data]);

  const filtered = useMemo(() => {
    if (filterTier === 'ALL') return data;
    const map = { A: 'A_high', B: 'B_med', C: 'C_low', D: 'D_skip' };
    return data.filter(d => d.tier === map[filterTier]);
  }, [data, filterTier]);

  if (loading && data.length === 0) {
    return <div style={{ padding: 20, color: C.txm }}>⏳ 작전 대시보드 로딩 중...</div>;
  }
  if (error) {
    return (
      <div style={{ padding: 20, color: '#f87171' }}>
        ❌ 에러: {error}
        <button onClick={loadData} style={{ marginLeft: 10, padding: '4px 10px', background: C.bg3, color: C.txt, border: `1px solid ${C.bdr}`, borderRadius: 4, cursor: 'pointer' }}>
          🔄 재시도
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16, color: C.gold }}>🎯 작전 대시보드 (Phase 20)</h3>
        <div style={{ fontSize: 11, color: C.txm }}>
          {refreshedAt && `갱신: ${refreshedAt.toLocaleTimeString()}`}
          <button
            onClick={loadData}
            style={{
              marginLeft: 8, padding: '3px 8px', fontSize: 11,
              border: `1px solid ${C.bdr}`, background: C.bg3, color: C.txm,
              borderRadius: 4, cursor: 'pointer'
            }}
          >
            🔄
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
        {['A', 'B', 'C', 'D'].map(letter => {
          const fullKey = { A: 'A_high', B: 'B_med', C: 'C_low', D: 'D_skip' }[letter];
          const group = summary[fullKey];
          const style = TIER_STYLE[fullKey];
          const totalBillion = group.reduce((s, d) => s + d.ba, 0) / 1e8;
          const isActive = filterTier === letter;
          return (
            <div
              key={letter}
              onClick={() => setFilterTier(isActive ? 'ALL' : letter)}
              style={{
                padding: 12,
                background: isActive ? style.bg : C.bg2,
                border: `2px solid ${isActive ? style.txt : C.bdr}`,
                borderRadius: 8,
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              <div style={{ fontSize: 11, color: C.txm }}>{style.full}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: style.txt }}>
                {group.length}<span style={{ fontSize: 14, color: C.txm }}>건</span>
              </div>
              <div style={{ fontSize: 11, color: C.txm }}>
                합계 {totalBillion.toFixed(1)}억
              </div>
            </div>
          );
        })}
      </div>

      {filterTier !== 'ALL' && (
        <div style={{ marginBottom: 8, fontSize: 12, color: C.txm }}>
          필터: {filterTier}등급만
          <button
            onClick={() => setFilterTier('ALL')}
            style={{
              marginLeft: 6, padding: '2px 6px', fontSize: 11,
              background: C.bg3, border: `1px solid ${C.bdr}`, color: C.txm,
              borderRadius: 3, cursor: 'pointer'
            }}
          >
            전체 보기
          </button>
        </div>
      )}

      <div style={{ fontSize: 12, color: C.txm, marginBottom: 8 }}>
        {filtered.length}건 표시 중
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: C.txm, background: C.bg2, borderRadius: 8 }}>
          📭 표시할 입찰건이 없습니다
        </div>
      ) : (
        filtered.map((row, idx) => <StrategyRow key={row.pred_id} row={row} rank={idx + 1} />)
      )}

      <div style={{
        marginTop: 16, padding: 12, background: C.bg2, borderRadius: 6,
        fontSize: 11, color: C.txm, border: `1px solid ${C.bdr}`
      }}>
        💡 <strong style={{ color: C.txt }}>사용법</strong>: 카드 클릭으로 펼치기 ·
        투찰금액 복사 후 나라장터 붙여넣기 ·
        기본 밴드가 v6.2 추천 · 1분마다 자동 갱신 ·
        <span style={{ color: '#fbbf24' }}> 투찰금액은 A값 공식이 정확히 적용됨</span>
      </div>
    </div>
  );
}
