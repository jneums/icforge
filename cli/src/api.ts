import { getToken } from './auth.js';

const API_URL = process.env.ICFORGE_API_URL ?? 'https://icforge-backend.onrender.com';

export function getApiUrl(): string {
    return API_URL;
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
    const token = getToken();
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...((options.headers as Record<string, string>) ?? {}),
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return fetch(`${API_URL}${path}`, { ...options, headers });
}
