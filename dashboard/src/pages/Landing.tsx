import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function Landing() {
  const { user } = useAuth();
  const ctaLink = user ? "/projects" : "/login";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b">
        <Link to="/" className="flex items-center gap-2">
          <span className="text-lg">⬡</span>
          <span className="font-semibold">ICForge</span>
        </Link>
        <Button asChild>
          {user ? (
            <Link to="/projects">Dashboard</Link>
          ) : (
            <a href={`${import.meta.env.VITE_API_URL ?? ""}/api/v1/auth/login?redirect=${encodeURIComponent(window.location.origin + "/login")}`}>
              Login with GitHub
            </a>
          )}
        </Button>
      </header>

      {/* Hero */}
      <section className="flex flex-col items-center text-center py-24 px-4">
        <span className="inline-block text-xs font-medium text-primary border border-primary/30 rounded-full px-3 py-1 mb-6">
          Open Source CI/CD for the Internet Computer
        </span>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight max-w-2xl">
          Deploy to the Internet Computer in one git push.
        </h1>
        <p className="text-lg text-muted-foreground mt-4 max-w-xl">
          Push your code. We build, deploy, and manage your canisters automatically.
        </p>
        <div className="flex gap-3 mt-8">
          <Button asChild size="lg"><Link to={ctaLink}>Get Started</Link></Button>
          <Button variant="outline" size="lg" asChild>
            <a href="https://github.com/jneums/icforge" target="_blank" rel="noopener noreferrer">
              View on GitHub
            </a>
          </Button>
        </div>
      </section>

      {/* Code Snippet */}
      <section className="text-center pb-12 px-4">
        <h2 className="text-xl font-bold mb-4">Ship canisters in three commands</h2>
        <div className="bg-popover border rounded-lg p-6 text-left max-w-lg mx-auto font-mono text-sm leading-relaxed">
          <span className="text-muted-foreground"># Install the CLI</span>{`\n`}
          <span className="text-primary">npm</span> i -g @icforge/cli{`\n\n`}
          <span className="text-muted-foreground"># Initialize your project</span>{`\n`}
          <span className="text-primary">icforge</span> init{`\n\n`}
          <span className="text-muted-foreground"># Deploy to the IC</span>{`\n`}
          <span className="text-primary">icforge</span> deploy{`\n\n`}
          <span className="text-success">✓ Deployed to myapp.icforge.dev</span>
        </div>
      </section>

      {/* Features */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-4xl mx-auto px-4 pb-16">
        {[
          { title: "⚡ Git-Driven Deploys", desc: "Connect your GitHub repo. Every push to main triggers a canister deployment." },
          { title: "📦 Reproducible Builds", desc: "Docker-based builds ensure your canisters compile identically every time." },
          { title: "🔒 You Own It", desc: "Eject canisters anytime. We never lock you in." },
        ].map((f) => (
          <Card key={f.title} className="p-5">
            <h3 className="text-sm font-semibold mb-1">{f.title}</h3>
            <p className="text-sm text-muted-foreground">{f.desc}</p>
          </Card>
        ))}
      </section>

      {/* CTA */}
      <section className="text-center py-12 border-t">
        <h2 className="text-xl font-bold mb-2">Ready to deploy?</h2>
        <p className="text-muted-foreground mb-6">Get started for free. No credit card required.</p>
        <Button asChild size="lg"><Link to={ctaLink}>Get Started →</Link></Button>
      </section>

      {/* Footer */}
      <footer className="text-center py-6 text-xs text-muted-foreground border-t">
        © {new Date().getFullYear()} ICForge · Built on the Internet Computer
      </footer>
    </div>
  );
}
