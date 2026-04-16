import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  GitBranch,
  RefreshCw,
  Activity,
  Shield,
  Zap,
  ArrowRight,
} from "lucide-react";

export default function Landing() {
  const { user } = useAuth();
  const ctaLink = user ? "/projects" : "/login";
  const apiUrl = import.meta.env.VITE_API_URL ?? "";
  const loginHref = user
    ? "/projects"
    : `${apiUrl}/api/v1/auth/login?redirect=${encodeURIComponent(window.location.origin + "/login")}`;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b">
        <Link to="/" className="flex items-center gap-2">
          <span className="text-lg">⬡</span>
          <span className="font-semibold">ICForge</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link to="/skill" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Agent Skill
          </Link>
          <Button asChild>
            {user ? (
              <Link to="/projects">Dashboard</Link>
            ) : (
              <a href={loginHref}>Login with GitHub</a>
            )}
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="flex flex-col items-center text-center py-24 px-4">
        <span className="inline-block text-xs font-medium text-primary border border-primary/30 rounded-full px-3 py-1 mb-6">
          Push to deploy on the Internet Computer
        </span>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight max-w-3xl">
          Link your repo.{" "}
          <span className="text-muted-foreground">We handle the rest.</span>
        </h1>
        <p className="text-lg text-muted-foreground mt-4 max-w-xl">
          Connect a GitHub repo and every push to main automatically builds,
          deploys, and manages your Internet Computer canisters.
        </p>
        <div className="flex gap-3 mt-8">
          <Button asChild size="lg">
            {user ? (
              <Link to="/projects">
                Go to Dashboard <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            ) : (
              <a href={loginHref}>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="mr-2"
                >
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                </svg>
                Get Started with GitHub
              </a>
            )}
          </Button>
          <Button variant="outline" size="lg" asChild>
            <a
              href="https://github.com/jneums/icforge"
              target="_blank"
              rel="noopener noreferrer"
            >
              View on GitHub
            </a>
          </Button>
        </div>
        <p className="text-sm text-muted-foreground mt-4">
          $25 free compute credits · No credit card required
        </p>
      </section>

      {/* How it works */}
      <section className="max-w-3xl mx-auto px-4 pb-20">
        <h2 className="text-xl font-bold text-center mb-10">How it works</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
          {[
            {
              step: "1",
              title: "Connect your repo",
              desc: "Install the ICForge GitHub App and link any repo containing canisters.",
            },
            {
              step: "2",
              title: "Push to main",
              desc: "Every commit triggers a Docker-based build and deploys your canisters to the IC.",
            },
            {
              step: "3",
              title: "Monitor & scale",
              desc: "Track cycles, view canister logs, and manage auto-topups from one dashboard.",
            },
          ].map((s) => (
            <div key={s.step}>
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-primary/30 text-primary font-semibold text-sm mb-3">
                {s.step}
              </div>
              <h3 className="text-sm font-semibold mb-1">{s.title}</h3>
              <p className="text-sm text-muted-foreground">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="border-t py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-xl font-bold text-center mb-10">
            Everything you need to ship on the IC
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                icon: GitBranch,
                title: "Git-Driven Deploys",
                desc: "Push to main and your canisters update automatically. Branch previews coming soon.",
              },
              {
                icon: RefreshCw,
                title: "Automatic Cycles",
                desc: "We monitor your canisters and top up cycles before they run out. Set it and forget it.",
              },
              {
                icon: Activity,
                title: "Canister Logs",
                desc: "Stream real-time logs from your canisters. Filter, search, and debug from the dashboard.",
              },
              {
                icon: Zap,
                title: "Reproducible Builds",
                desc: "Docker-based builds ensure your canisters compile identically every time.",
              },
              {
                icon: Shield,
                title: "You Own It",
                desc: "Your canisters, your controllers. Eject anytime — we never lock you in.",
              },
              {
                title: "CLI + Dashboard",
                desc: "Use the web dashboard or the icforge CLI — your workflow, your choice.",
              },
            ].map((f) => (
              <Card key={f.title} className="p-5">
                <div className="flex items-center gap-2 mb-2">
                  {f.icon && <f.icon className="h-4 w-4 text-primary" />}
                  <h3 className="text-sm font-semibold">{f.title}</h3>
                </div>
                <p className="text-sm text-muted-foreground">{f.desc}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="text-center py-16 border-t">
        <h2 className="text-2xl font-bold mb-2">
          Start deploying in under a minute
        </h2>
        <p className="text-muted-foreground mb-6">
          Sign up with GitHub and get $25 in free compute credits.
        </p>
        <Button asChild size="lg">
          <Link to={ctaLink}>Get Started → </Link>
        </Button>
      </section>

      {/* Footer */}
      <footer className="text-center py-6 text-xs text-muted-foreground border-t">
        © {new Date().getFullYear()} ICForge · Built on the Internet Computer
      </footer>
    </div>
  );
}
