import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import type { User } from "./auth.api";

// In development Vite proxies /api to the backend, and in production Vercel
// does, so the refresh-token cookie is always first-party.
const baseURL = import.meta.env.VITE_API_URL || "/api/v1";

const api = axios.create({
  baseURL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

// Bare client for the refresh call itself, so it never loops through the
// retry interceptor below.
const sessionClient = axios.create({ baseURL, withCredentials: true });

// The access token lives only in memory; a page reload gets a new one from
// the httpOnly refresh cookie.
let accessToken: string | null = null;

export const getAccessToken = () => accessToken;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

export interface RefreshedSession {
  user: User;
  accessToken: string;
}

let refreshInFlight: Promise<RefreshedSession | null> | null = null;

async function requestRefresh(): Promise<RefreshedSession | null> {
  // A second attempt covers another tab having just rotated the same cookie.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await sessionClient.post<RefreshedSession | "">("/auth/refresh");

      // 204: no session cookie, i.e. signed out.
      if (response.status === 204 || !response.data) {
        break;
      }

      setAccessToken(response.data.accessToken);
      return response.data;
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;

      if (status !== 401 || attempt === 1) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  setAccessToken(null);
  return null;
}

/** Gets a fresh access token from the refresh cookie (one request at a time). */
export function refreshSession(): Promise<RefreshedSession | null> {
  refreshInFlight ??= requestRefresh().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

let sessionExpiredHandler: (() => void) | null = null;

/** AuthContext registers this to sign the user out when refreshing fails. */
export const onSessionExpired = (handler: (() => void) | null) => {
  sessionExpiredHandler = handler;
};

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }

  return config;
});

// Endpoints where a 401 means "wrong credentials", not "token expired".
const NO_REFRESH_PATHS = ["/auth/login", "/auth/register", "/auth/refresh", "/auth/logout"];

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

api.interceptors.response.use(undefined, async (error: AxiosError) => {
  const config = error.config as RetriableConfig | undefined;

  if (
    error.response?.status !== 401 ||
    !config ||
    config._retried ||
    NO_REFRESH_PATHS.some((path) => config.url?.startsWith(path))
  ) {
    throw error;
  }

  config._retried = true;
  const session = await refreshSession();

  if (!session) {
    sessionExpiredHandler?.();
    throw error;
  }

  config.headers.Authorization = `Bearer ${session.accessToken}`;
  return api(config);
});

export default api;
