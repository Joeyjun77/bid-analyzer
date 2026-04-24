// src/auth.js
// Phase 4-B MVP: 최소 기능 Auth 래퍼
// 기존 supabase.js 옆에 배치. 기존 direct REST 호출과 병행 사용.
//
// 사용법:
//   import { getSession, signIn, signUp, signOut, authedFetch } from './auth';
//   import { useAuth } from './auth'; // Context 훅 (로그인 상태 조회)

import { createContext, useContext } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// 세션 저장 키
const STORAGE_KEY = 'bid-analyzer.session';

// 세션 상태 이벤트 (AuthGate가 구독)
export const AUTH_EVENT_NAME = 'bid-analyzer:auth';
function _emitAuth(type, detail = {}) {
  try { window.dispatchEvent(new CustomEvent(AUTH_EVENT_NAME, { detail: { type, ...detail } })); } catch {}
}

// Phase 4-C: 관리자 이메일 화이트리스트
export const ADMIN_EMAILS = ['lgooa@naver.com'];
export function isAdminEmail(email) {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

// ============================================================================
// React Context (패턴 B: AuthGate가 Provider로 감싸고, 하위에서 useAuth()로 사용)
// ============================================================================

export const AuthContext = createContext({ user: null, isAdmin: false, signOut: () => {} });
export const useAuth = () => useContext(AuthContext);

// ============================================================================
// 세션 관리
// ============================================================================

let _refreshing = false;
function _scheduleRefresh() {
  if (_refreshing) return;
  _refreshing = true;
  refreshSession().finally(() => { _refreshing = false; });
}

export function getSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (session.expires_at) {
      const expiresMs = session.expires_at * 1000;
      const now = Date.now();
      if (expiresMs < now) {
        // refresh_token 있으면 만료 경과시간에 관계없이 유지하며 백그라운드 갱신
        // (refresh_token의 유효기간은 일반적으로 30일로, access_token 만료 후에도 복구 가능)
        if (session.refresh_token) {
          _scheduleRefresh();
          return session;
        }
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      // 만료 5분 전: 미리 백그라운드 갱신
      if (expiresMs - now < 5 * 60_000 && session.refresh_token) {
        _scheduleRefresh();
      }
    }
    return session;
  } catch {
    return null;
  }
}

export function setSession(session) {
  if (!session) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function getUser() {
  const s = getSession();
  return s?.user || null;
}

export function isAuthenticated() {
  return !!getSession();
}

// ============================================================================
// Auth API 호출
// ============================================================================

export async function signUp(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.msg || data.error_description || data.error || '회원가입 실패');
  }
  // Supabase 설정에 따라 session이 바로 오거나, email confirmation 기다리는 상태
  if (data.access_token) {
    setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
      user: data.user,
    });
  }
  return data;
}

export async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.msg || data.error || '로그인 실패');
  }
  setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
    user: data.user,
  });
  return data.user;
}

export async function signOut() {
  const session = getSession();
  if (session?.access_token) {
    // 서버에도 토큰 무효화 요청 (실패해도 로컬은 지움)
    try {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
      });
    } catch {}
  }
  setSession(null);
}

export async function refreshSession() {
  // 재귀 방지: getSession()은 _scheduleRefresh를 부르므로 localStorage 직접 조회
  let refreshToken = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) refreshToken = JSON.parse(raw).refresh_token || null;
  } catch {}
  if (!refreshToken) return null;

  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch (e) {
    // 네트워크 오류는 세션 유지 (online 이벤트·다음 타이머에서 재시도)
    return null;
  }
  if (!res.ok) {
    // 서버가 refresh_token을 거부 → 복구 불가, 재로그인 필요
    setSession(null);
    _emitAuth('expired', { reason: 'refresh-rejected', status: res.status });
    return null;
  }
  const data = await res.json();
  setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
    user: data.user,
  });
  _emitAuth('refreshed');
  return data.user;
}

// ============================================================================
// 자동 세션 유지 (keepalive + visibilitychange + online)
// ============================================================================

let _autoRefreshInstalled = false;
let _keepaliveTimer = null;

function _checkAndRefresh() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (!s?.expires_at) return;
    const expiresMs = s.expires_at * 1000;
    const now = Date.now();
    // 이미 만료됐거나 5분 미만 남음 → 즉시 갱신 시도
    if (expiresMs - now < 5 * 60_000 && s.refresh_token) {
      _scheduleRefresh();
    }
  } catch {}
}

// AuthGate 마운트 시 1회 호출. 탭이 열려 있는 동안 세션을 자동 유지하고,
// 복구 불가 상태가 되면 AUTH_EVENT_NAME 이벤트로 로그인 화면 복귀 신호를 보낸다.
export function installAutoRefresh() {
  if (_autoRefreshInstalled) return;
  if (typeof window === 'undefined') return;
  _autoRefreshInstalled = true;

  // 1) 탭 포커스 복귀(절전·백그라운드 후 복귀) 시 즉시 체크
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') _checkAndRefresh();
  });

  // 2) 네트워크 복귀 시 체크
  window.addEventListener('online', _checkAndRefresh);

  // 3) 다른 탭의 로그아웃·로그인 동기화
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    if (!e.newValue) _emitAuth('expired', { reason: 'storage-cleared' });
    else _emitAuth('refreshed', { reason: 'storage-sync' });
  });

  // 4) 60초 주기 keepalive — 타이머는 절전 시 멈추지만 visibilitychange가 보완
  if (_keepaliveTimer) clearInterval(_keepaliveTimer);
  _keepaliveTimer = setInterval(_checkAndRefresh, 60_000);

  // 설치 직후 1회 체크
  _checkAndRefresh();
}

// ============================================================================
// 인증된 REST 호출 헬퍼
// 기존 supabase.js의 fetch 호출을 점진적으로 이걸로 교체
// ============================================================================

export async function authedFetch(path, options = {}) {
  const session = getSession();
  const url = path.startsWith('http') ? path : `${SUPABASE_URL}${path}`;
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    ...options.headers,
  };
  // 로그인한 경우 JWT 사용, 아니면 anon 키만 (기존 호환)
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  let res = await fetch(url, { ...options, headers });

  // 401이고 refresh_token 있으면 갱신 후 1회 재시도
  if (res.status === 401 && session?.refresh_token) {
    const refreshed = await refreshSession();
    if (refreshed) {
      const newSession = getSession();
      headers.Authorization = `Bearer ${newSession.access_token}`;
      res = await fetch(url, { ...options, headers });
    }
  }
  return res;
}
