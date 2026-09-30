import { createContext } from "react";

import type {
  LoginRequest,
  RegisterRequest,
  User,
} from "../services/auth.api";

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  /** True while the saved session is being restored on page load. */
  initializing: boolean;
  login: (data: LoginRequest) => Promise<User>;
  register: (data: RegisterRequest) => Promise<User>;
  logout: () => Promise<void>;
  logoutEverywhere: () => Promise<void>;
  /** Replaces the cached user after a profile change or email verification. */
  setUser: (user: User) => void;
  /** Stores a new session (e.g. after changing the password). */
  applySession: (user: User, accessToken: string) => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(
  undefined
);
