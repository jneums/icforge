import { apiFetch, setToken } from './client';
import type { User } from './types';

export async function fetchMe(): Promise<User> {
  const data = await apiFetch<{ user: User }>('/api/v1/auth/me');
  return data.user;
}

export async function devLogin(): Promise<string> {
  const data = await apiFetch<{ token: string }>('/api/v1/auth/dev-token', { method: 'POST' });
  setToken(data.token);
  return data.token;
}
