import Conf from "conf";

interface AuthConfig {
  token?: string;
  refreshToken?: string;
  expiresAt?: number;
}

const config = new Conf<AuthConfig>({
  projectName: "icforge",
});

export function getToken(): string | undefined {
  const expiresAt = config.get("expiresAt");
  if (expiresAt && Date.now() > expiresAt) {
    config.clear();
    return undefined;
  }
  return config.get("token");
}

export function saveToken(token: string, refreshToken: string, expiresIn: number) {
  config.set("token", token);
  config.set("refreshToken", refreshToken);
  config.set("expiresAt", Date.now() + expiresIn * 1000);
}

export function clearAuth() {
  config.clear();
}

export function isAuthenticated(): boolean {
  return !!getToken();
}
