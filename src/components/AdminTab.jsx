// src/components/AdminTab.jsx
// Phase 4-C: 관리자 페이지 — 회원가입/로그인 현황 조회 (읽기 전용)
// admin_list_users RPC 호출 결과를 테이블로 렌더링.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { sbAdminListUsers } from '../lib/supabase.js';
import { useAuth } from '../auth.js';

function fmt(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return String(ts); }
}

function daysSince(ts) {
  if (!ts) return null;
  const ms = Date.now() - new Date(ts).getTime();
  return Math.floor(ms / 86400000);
}

export default function AdminTab({ C }) {
  const { user, isAdmin } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const rows = await sbAdminListUsers();
      setUsers(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setError(e.message || '조회 실패');
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const stats = useMemo(() => {
    const total = users.length;
    const confirmed = users.filter(u => u.email_confirmed_at).length;
    const active7 = users.filter(u => {
      const d = daysSince(u.last_sign_in_at);
      return d !== null && d <= 7;
    }).length;
    const banned = users.filter(u => u.banned_until && new Date(u.banned_until) > new Date()).length;
    return { total, confirmed, active7, banned };
  }, [users]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u => (u.email || '').toLowerCase().includes(q));
  }, [users, query]);

  if (!isAdmin) {
    return (
      <div style={{ padding: 24, color: C?.txm || '#888', fontSize: 13 }}>
        관리자 권한이 필요합니다.
      </div>
    );
  }

  const bg = C?.bg || '#0e0e1a';
  const bg2 = C?.bg2 || '#14142a';
  const bg3 = C?.bg3 || '#1a1a30';
  const bdr = C?.bdr || '#252540';
  const txt = C?.txt || '#e8e8f0';
  const txm = C?.txm || '#888';
  const txd = C?.txd || '#666';
  const gold = C?.gold || '#d4a834';

  const cardS = {
    background: bg2, border: '1px solid ' + bdr, borderRadius: 8,
    padding: '12px 14px', minWidth: 120,
  };

  return (
    <div style={{ padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: gold }}>👤 관리자 — 회원/로그인 현황</div>
          <div style={{ fontSize: 11, color: txd, marginTop: 2 }}>현재 로그인: {user?.email}</div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{
            padding: '6px 14px', fontSize: 12, fontWeight: 500,
            background: bg3, color: gold, border: '1px solid ' + bdr,
            borderRadius: 6, cursor: loading ? 'default' : 'pointer',
          }}
        >
          {loading ? '조회 중…' : '새로고침'}
        </button>
      </div>

      {/* 요약 카드 4종 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(120px,1fr))', gap: 10, marginBottom: 16 }}>
        <div style={cardS}>
          <div style={{ fontSize: 10, color: txd }}>총 사용자</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: txt, fontFamily: 'monospace' }}>{stats.total}</div>
        </div>
        <div style={cardS}>
          <div style={{ fontSize: 10, color: txd }}>이메일 확인</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#5dca96', fontFamily: 'monospace' }}>{stats.confirmed}</div>
          <div style={{ fontSize: 9, color: txd }}>미확인 {stats.total - stats.confirmed}</div>
        </div>
        <div style={cardS}>
          <div style={{ fontSize: 10, color: txd }}>7일 내 로그인</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#a8b4ff', fontFamily: 'monospace' }}>{stats.active7}</div>
        </div>
        <div style={cardS}>
          <div style={{ fontSize: 10, color: txd }}>정지 계정</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: stats.banned > 0 ? '#e24b4a' : txd, fontFamily: 'monospace' }}>{stats.banned}</div>
        </div>
      </div>

      {error && (
        <div style={{
          padding: '10px 12px', marginBottom: 12,
          background: 'rgba(226,75,74,0.1)', color: '#e24b4a',
          border: '1px solid rgba(226,75,74,0.3)', borderRadius: 6, fontSize: 12,
        }}>⚠ {error}</div>
      )}

      {/* 검색 */}
      <div style={{ marginBottom: 10 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이메일 검색…"
          style={{
            padding: '7px 10px', fontSize: 12, width: 260,
            background: bg, color: txt, border: '1px solid ' + bdr, borderRadius: 6, outline: 'none',
          }}
        />
        <span style={{ fontSize: 11, color: txd, marginLeft: 10 }}>
          {filtered.length} / {users.length}건
        </span>
      </div>

      {/* 사용자 테이블 */}
      <div style={{ background: bg2, border: '1px solid ' + bdr, borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: bg3 }}>
              <th style={{ padding: '10px 12px', textAlign: 'left', color: txm, fontWeight: 500, borderBottom: '1px solid ' + bdr }}>이메일</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', color: txm, fontWeight: 500, borderBottom: '1px solid ' + bdr }}>가입일</th>
              <th style={{ padding: '10px 12px', textAlign: 'left', color: txm, fontWeight: 500, borderBottom: '1px solid ' + bdr }}>마지막 로그인</th>
              <th style={{ padding: '10px 12px', textAlign: 'center', color: txm, fontWeight: 500, borderBottom: '1px solid ' + bdr }}>이메일 확인</th>
              <th style={{ padding: '10px 12px', textAlign: 'center', color: txm, fontWeight: 500, borderBottom: '1px solid ' + bdr }}>상태</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && !loading && (
              <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: txd }}>
                {query ? '검색 결과 없음' : '등록된 사용자가 없습니다'}
              </td></tr>
            )}
            {filtered.map((u) => {
              const isBanned = u.banned_until && new Date(u.banned_until) > new Date();
              const lastDays = daysSince(u.last_sign_in_at);
              return (
                <tr key={u.id} style={{ borderBottom: '1px solid ' + bdr }}>
                  <td style={{ padding: '10px 12px', color: txt, fontFamily: 'monospace' }}>
                    {u.email}
                    {u.email === user?.email && (
                      <span style={{ marginLeft: 6, fontSize: 9, color: gold, padding: '1px 5px', background: 'rgba(212,168,52,0.12)', borderRadius: 3 }}>나</span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', color: txm, fontFamily: 'monospace', fontSize: 11 }}>{fmt(u.created_at)}</td>
                  <td style={{ padding: '10px 12px', color: txm, fontFamily: 'monospace', fontSize: 11 }}>
                    {fmt(u.last_sign_in_at)}
                    {lastDays !== null && (
                      <span style={{ marginLeft: 6, fontSize: 9, color: lastDays <= 7 ? '#5dca96' : txd }}>
                        {lastDays === 0 ? '오늘' : lastDays + '일 전'}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 11 }}>
                    {u.email_confirmed_at
                      ? <span style={{ color: '#5dca96' }}>✓ 확인</span>
                      : <span style={{ color: '#e2a84b' }}>⏳ 대기</span>}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: 11 }}>
                    {isBanned
                      ? <span style={{ color: '#e24b4a' }}>● 정지</span>
                      : <span style={{ color: '#5dca96' }}>● 활성</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, fontSize: 10, color: txd }}>
        · 읽기 전용 — 정지/삭제 기능은 별도 요청 시 추가 가능.
      </div>
    </div>
  );
}
