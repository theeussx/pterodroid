import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api, getToken, setToken } from '../lib/api';
import { connectSocket, disconnectSocket } from '../lib/socket';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [setupDone, setSetupDone] = useState(true);
  const [checking, setChecking] = useState(true);

  const bootstrap = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setChecking(false);
      return;
    }
    try {
      const me = await api.me();
      setUser({ username: me.username });
      setSetupDone(me.setupDone);
      connectSocket();
    } catch {
      setToken(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    bootstrap();
    return () => disconnectSocket();
  }, [bootstrap]);

  const login = useCallback(async (username, password) => {
    const res = await api.login(username, password);
    setToken(res.token);
    const me = await api.me();
    setUser({ username: me.username });
    setSetupDone(me.setupDone);
    connectSocket();
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    disconnectSocket();
  }, []);

  const markSetupDone = useCallback(() => setSetupDone(true), []);

  return (
    <AuthContext.Provider value={{ user, checking, setupDone, login, logout, markSetupDone }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
