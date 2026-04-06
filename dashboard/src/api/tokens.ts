import { apiFetch } from './client';
import type { ApiToken } from './types';

export async function listTokens(): Promise<ApiToken[]> {
  const data = await apiFetch<{ tokens: ApiToken[] }>('/api/v1/auth/tokens');
  return data.tokens ?? [];
}

export async function createToken(name: string): Promise<{ token: string; prefix: string }> {
  return apiFetch('/api/v1/auth/tokens', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function revokeToken(tokenId: string): Promise<void> {
  await apiFetch(`/api/v1/auth/tokens/${tokenId}`, { method: 'DELETE' });
}
