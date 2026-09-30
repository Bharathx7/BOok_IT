import api from "./api";

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  status: "ACTIVE" | "SUSPENDED" | "BANNED";
  emailVerified: boolean;
  phone: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export interface SessionResponse {
  user: User;
  accessToken: string;
}

export interface UpdateProfileRequest {
  name?: string;
  phone?: string;
  avatarUrl?: string;
}

export async function registerUser(data: RegisterRequest): Promise<User> {
  const response = await api.post<{ user: User }>("/auth/register", data);
  return response.data.user;
}

export async function loginUser(data: LoginRequest): Promise<SessionResponse> {
  const response = await api.post<SessionResponse>("/auth/login", data);
  return response.data;
}

export async function logoutUser(): Promise<void> {
  await api.post("/auth/logout");
}

export async function logoutAllDevices(): Promise<void> {
  await api.post("/auth/logout-all");
}

export async function verifyEmail(token: string): Promise<User> {
  const response = await api.post<{ user: User }>("/auth/verify-email", { token });
  return response.data.user;
}

export async function resendVerificationEmail(): Promise<void> {
  await api.post("/auth/resend-verification");
}

export async function requestPasswordReset(email: string): Promise<string> {
  const response = await api.post<{ message: string }>("/auth/forgot-password", { email });
  return response.data.message;
}

export async function resetPassword(token: string, password: string): Promise<string> {
  const response = await api.post<{ message: string }>("/auth/reset-password", {
    token,
    password,
  });
  return response.data.message;
}

export async function getMe(): Promise<User> {
  const response = await api.get<{ user: User }>("/users/me");
  return response.data.user;
}

export async function updateMe(data: UpdateProfileRequest): Promise<User> {
  const response = await api.patch<{ user: User }>("/users/me", data);
  return response.data.user;
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<SessionResponse> {
  const response = await api.post<SessionResponse>("/users/me/password", {
    currentPassword,
    newPassword,
  });
  return response.data;
}
