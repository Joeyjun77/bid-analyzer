// src/auth.js
// Phase 4-B MVP: 최소 기능 Auth 래퍼
// 기존 supabase.js 옆에 배치. 기존 direct REST 호출과 병행 사용.
//
// 사용법:
//   import { getSession, signIn, signUp, signOut, authedFetch } from './auth';
//   import { useAuth } from './auth'; // Context 훅 (로그인 상태 조회)

import { createContext, useContext } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://sadunejfkstxbxogzutl.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'YOUR_ANON_KEY';

// 세션 저장 키
const STORAGE_KEY = 'bid-analyzer.session';

// ============================================================================
// React Context (패턴 B: AuthGate가 Provider로 감싸고, 하위에서 useAuth()로 사용)
// ============================================================================

export const AuthContext = createContext({ user: null, signOut: () => {} });
export const useAuth = () => useContext(AuthContext);

// ============================================================================
// 세션 관리
// ============================================================================

export function getSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    // 만료 체크
    if (session.expires_at && session.expires_at * 1000 < Date.now()) {
      // 자동 갱신 시도 (refresh_token 있으면)
      if (session.refresh_token) {
        // 비동기 갱신은 나중에. 일단 null 반환.
        return null;
      }
      localStorage.removeItem(STORAGE_KEY);
      return null;
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
  const session = getSession();
  if (!session?.refresh_token) return null;

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  if (!res.ok) {
    setSession(null);
    return null;
  }
  const data = await res.json();
  setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
    user: data.user,
  });
  return data.user;
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
