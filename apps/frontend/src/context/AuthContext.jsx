import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { setAccessToken, setRefresher } from '@/services/api';
import { authApi, refreshSession } from '@/services/auth';

const AuthContext = createContext(null);

/**
 * Holds the signed-in user. On load it tries the refresh cookie once, so a page reload keeps you signed in
 * without storing the access token anywhere persistent.
 */
export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', me: null });

  const loadMe = useCallback(async () => {
    const me = await authApi.me();
    setState({ status: 'authenticated', me });
    return me;
  }, []);

  useEffect(() => {
    setRefresher(refreshSession);
    let cancelled = false;
    (async () => {
      const token = await refreshSession();
      if (cancelled) return;
      if (!token) return setState({ status: 'anonymous', me: null });
      try {
        await loadMe();
      } catch {
        if (!cancelled) setState({ status: 'anonymous', me: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMe]);

  const value = useMemo(
    () => ({
      ...state,
      /** Called after login / MFA / token upgrade with a fresh access token. */
      async signedIn(accessToken) {
        setAccessToken(accessToken);
        return loadMe();
      },
      refreshMe: loadMe,
      async signOut() {
        try {
          await authApi.logout();
        } finally {
          setAccessToken(null);
          setState({ status: 'anonymous', me: null });
        }
      },
      can: (code) => Boolean(state.me?.permissions.some((p) => p.code === code)),
    }),
    [state, loadMe],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
