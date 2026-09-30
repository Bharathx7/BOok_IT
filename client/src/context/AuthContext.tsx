import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { reconnectSocket } from "../socket";
import { AuthContext } from "./auth-context";
import {
  onSessionExpired,
  refreshSession,
  setAccessToken,
} from "../services/api";
import {
  loginUser,
  logoutAllDevices,
  logoutUser,
  registerUser,
  type LoginRequest,
  type RegisterRequest,
  type User,
} from "../services/auth.api";

// Tokens used to be kept in localStorage; clear anything left from then.
const LEGACY_KEYS = ["bookit_user", "bookit_access_token", "bookit_refresh_token"];

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({
  children,
}: AuthProviderProps) {
  const [user, setUserState] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUserState(null);
    reconnectSocket();
  }, []);

  // Restore the session from the httpOnly refresh cookie on page load.
  useEffect(() => {
    let cancelled = false;

    for (const key of LEGACY_KEYS) {
      localStorage.removeItem(key);
    }

    const restore = async () => {
      const session = await refreshSession();

      if (cancelled) return;

      setUserState(session?.user ?? null);
      setInitializing(false);
      reconnectSocket();
    };

    restore();

    return () => {
      cancelled = true;
    };
  }, []);

  // A failed silent refresh means the session is gone (expired, revoked,
  // or signed out in another tab).
  useEffect(() => {
    onSessionExpired(clearSession);
    return () => onSessionExpired(null);
  }, [clearSession]);

  const applySession = useCallback((nextUser: User, accessToken: string) => {
    setAccessToken(accessToken);
    setUserState(nextUser);
    reconnectSocket();
  }, []);

  const login = useCallback(
    async (data: LoginRequest) => {
      const session = await loginUser(data);
      applySession(session.user, session.accessToken);
      return session.user;
    },
    [applySession]
  );

  const register = useCallback((data: RegisterRequest) => registerUser(data), []);

  const logout = useCallback(async () => {
    try {
      await logoutUser();
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const logoutEverywhere = useCallback(async () => {
    try {
      await logoutAllDevices();
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: user !== null,
      initializing,
      login,
      register,
      logout,
      logoutEverywhere,
      setUser: setUserState,
      applySession,
    }),
    [user, initializing, login, register, logout, logoutEverywhere, applySession]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
