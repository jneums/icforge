import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useDevLogin } from "@/hooks/use-login";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export default function Login() {
  const navigate = useNavigate();
  const { user, loading: authLoading, login } = useAuth();
  const devLoginMutation = useDevLogin();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const params = new URLSearchParams(window.location.search);
  const tokenFromUrl = params.get("token");

  useEffect(() => {
    if (tokenFromUrl) {
      login(tokenFromUrl);
      window.history.replaceState({}, "", "/login");
    }
  }, [tokenFromUrl]);

  useEffect(() => {
    if (!authLoading && user) navigate("/projects", { replace: true });
  }, [user, authLoading]);

  if (authLoading || user || tokenFromUrl) return null;

  const handleGitHubLogin = () => {
    const apiUrl = import.meta.env.VITE_API_URL ?? "";
    window.location.href = `${apiUrl}/api/v1/auth/login?redirect=${encodeURIComponent(window.location.origin + "/login")}`;
  };

  const handleDevLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await devLoginMutation.mutateAsync();
      login(token);
      navigate("/projects");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <Card className="p-8 text-center max-w-sm w-full">
        <div className="text-3xl text-primary mb-4">⬡</div>
        <h1 className="text-xl font-bold mb-1">Sign in to ICForge</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Connect your GitHub account to start deploying canisters.
        </p>

        {error && <p className="text-sm text-destructive mb-4">{error}</p>}

        <Button className="w-full" onClick={handleGitHubLogin}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="mr-2">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
          </svg>
          Login with GitHub
        </Button>

        {import.meta.env.DEV && (
          <>
            <div className="relative my-6">
              <Separator />
              <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
                or
              </span>
            </div>
            <Button variant="outline" className="w-full" onClick={handleDevLogin} disabled={loading}>
              {loading ? "Signing in..." : "🔧 Dev Mode Login"}
            </Button>
            <p className="text-xs text-muted-foreground mt-4">
              Dev login creates a test account — no GitHub needed.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
