// src/components/AuthGate.jsx
// Phase 4-B MVP: 로그인 관문 컴포넌트
// 패턴 B: Context 로 user/signOut 을 하위 트리에 제공.
// 로그인 후 UI는 App.jsx 헤더에서 useAuth() 로 렌더링.
//
// 사용법:
//   import AuthGate from './components/AuthGate';
//   function App() {
//     return (
//       <AuthGate>
//         <YourExistingApp />
//       </AuthGate>
//     );
//   }

import { useState, useEffect } from 'react';
import { getSession, signIn, signUp, signOut, getUser, refreshSession, AuthContext, isAdminEmail, installAutoRefresh, AUTH_EVENT_NAME } from '../auth';

export default function AuthGate({ children }) {
  const [user, setUser] = useState(getUser());
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  // 세션 자동 유지 (keepalive + visibilitychange + online) 설치
  // 세션 만료 이벤트 수신 시 로그인 화면으로 복귀하여 "데이터 0" 현상 방지
  useEffect(() => {
    installAutoRefresh();

    // 마운트 시 만료 임박이면 즉시 갱신
    const session = getSession();
    if (session?.expires_at) {
      const timeLeft = session.expires_at * 1000 - Date.now();
      if (timeLeft < 5 * 60 * 1000) {
        refreshSession().then((u) => u && setUser(u));
      }
    }

    const onAuth = (e) => {
      const type = e?.detail?.type;
      if (type === 'expired') {
        // 세션 복구 불가 → 사용자 상태를 null로 되돌려 로그인 화면 표시
        // (자식 트리가 unmount되어 stale 데이터/빈 배열 표시 방지)
        setUser(null);
        setError('장시간 미사용으로 세션이 만료되어 다시 로그인이 필요합니다.');
      } else if (type === 'refreshed') {
        // 갱신 성공: 기존 user가 있으면 유지, 없으면 로컬에서 재조회
        setUser((prev) => prev || getUser());
      }
    };
    window.addEventListener(AUTH_EVENT_NAME, onAuth);
    return () => window.removeEventListener(AUTH_EVENT_NAME, onAuth);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      if (mode === 'signin') {
        const u = await signIn(email.trim(), password);
        setUser(u);
      } else {
        const data = await signUp(email.trim(), password);
        if (data.user && !data.access_token) {
          // 이메일 확인 대기 상태
          setInfo('확인 이메일을 보냈습니다. 이메일의 링크를 클릭한 뒤 로그인하세요.');
          setMode('signin');
        } else if (data.user) {
          setUser(data.user);
        }
      }
    } catch (err) {
      setError(err.message || '오류가 발생했습니다');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    setUser(null);
  };

  // 로그인 상태면 Context 로 user/signOut 제공 → 하위(App.jsx 헤더)에서 useAuth()
  if (user) {
    return (
      <AuthContext.Provider value={{ user, isAdmin: isAdminEmail(user.email), signOut: handleSignOut }}>
        {children}
      </AuthContext.Provider>
    );
  }

  // 로그인 화면
  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>bid-analyzer</h1>
        <p style={styles.subtitle}>
          {mode === 'signin' ? '로그인' : '회원가입'}
        </p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label}>
            이메일
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              style={styles.input}
              disabled={loading}
            />
          </label>
          <label style={styles.label}>
            비밀번호
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              minLength={6}
              style={styles.input}
              disabled={loading}
            />
          </label>

          {error && <div style={styles.error}>{error}</div>}
          {info && <div style={styles.info}>{info}</div>}

          <button type="submit" disabled={loading} style={styles.submitBtn}>
            {loading ? '처리 중...' : (mode === 'signin' ? '로그인' : '회원가입')}
          </button>
        </form>

        <div style={styles.toggleRow}>
          {mode === 'signin' ? (
            <>
              계정이 없으신가요?{' '}
              <button onClick={() => { setMode('signup'); setError(''); setInfo(''); }} style={styles.toggleBtn}>
                회원가입
              </button>
            </>
          ) : (
            <>
              이미 계정이 있으신가요?{' '}
              <button onClick={() => { setMode('signin'); setError(''); setInfo(''); }} style={styles.toggleBtn}>
                로그인
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f5f7fa',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    background: 'white',
    borderRadius: 12,
    padding: 32,
    boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
  },
  title: {
    margin: 0,
    fontSize: 24,
    fontWeight: 700,
    color: '#1a202c',
  },
  subtitle: {
    margin: '4px 0 24px',
    color: '#718096',
    fontSize: 14,
  },
  form: { display: 'flex', flexDirection: 'column', gap: 16 },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: 13,
    color: '#4a5568',
    fontWeight: 500,
  },
  input: {
    padding: '10px 12px',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    fontSize: 14,
    outline: 'none',
  },
  submitBtn: {
    marginTop: 8,
    padding: '12px 16px',
    background: '#3182ce',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
  },
  toggleRow: {
    marginTop: 24,
    textAlign: 'center',
    fontSize: 13,
    color: '#718096',
  },
  toggleBtn: {
    background: 'none',
    border: 'none',
    color: '#3182ce',
    cursor: 'pointer',
    fontWeight: 600,
    padding: 0,
    fontSize: 13,
  },
  error: {
    padding: '10px 12px',
    background: '#fed7d7',
    color: '#c53030',
    borderRadius: 6,
    fontSize: 13,
  },
  info: {
    padding: '10px 12px',
    background: '#c6f6d5',
    color: '#22543d',
    borderRadius: 6,
    fontSize: 13,
  },
};
