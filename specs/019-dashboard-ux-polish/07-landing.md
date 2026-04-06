# 07 — Landing Page

**Scope:** Refresh the `/` landing page with the new design system
**Priority:** P2
**Depends on:** 00-setup, 01-design-system
**Estimated effort:** Small

---

## 1. Current State

The Landing page is a simple marketing page with:
- Hero section (title + description + CTA)
- Feature grid (3 features)
- Getting started code snippet
- Footer

It works fine but uses inline styles and doesn't match the polished aesthetic of the rest of the new dashboard.

## 2. Target Layout

Keep the same structure, just migrate to Tailwind + polish:

```
┌──────────────────────────────────────────────────────────────┐
│  ⬡ ICForge                              Login with GitHub   │
│──────────────────────────────────────────────────────────────│
│                                                              │
│              Deploy to the Internet Computer                 │
│              in one git push.                                │
│                                                              │
│              Push your code. We build, deploy, and           │
│              manage your canisters automatically.            │
│                                                              │
│              [ Get Started ]    [ View Docs ↗ ]              │
│                                                              │
│  ┌──────────────────┬──────────────────┬────────────────────┐│
│  │ ⚡ Auto Deploy   │ 📦 Zero Config   │ 🔒 You Own It     ││
│  │ Push to main     │ Detects your     │ Eject canisters   ││
│  │ and your app     │ framework and    │ anytime. We never ││
│  │ deploys.         │ builds it.       │ lock you in.      ││
│  └──────────────────┴──────────────────┴────────────────────┘│
│                                                              │
│  $ npx icforge init                                          │
│  $ git push origin main                                      │
│  ✓ Deployed to https://my-app.icforge.dev                    │
│                                                              │
│──────────────────────────────────────────────────────────────│
│  © 2025 ICForge · Built on the Internet Computer             │
└──────────────────────────────────────────────────────────────┘
```

## 3. Key Changes

### Header (Landing-only, no sidebar)

The landing page uses its own simple header — NOT the sidebar:

```tsx
<header className="flex items-center justify-between px-6 py-4 border-b">
  <Link to="/" className="flex items-center gap-2">
    <span className="text-lg">⬡</span>
    <span className="font-semibold">ICForge</span>
  </Link>
  <Button asChild>
    <a href="/api/auth/github">Login with GitHub</a>
  </Button>
</header>
```

### Hero Section

```tsx
<section className="flex flex-col items-center text-center py-24 px-4">
  <h1 className="text-4xl sm:text-5xl font-bold tracking-tight max-w-2xl">
    Deploy to the Internet Computer in one git push.
  </h1>
  <p className="text-lg text-muted-foreground mt-4 max-w-xl">
    Push your code. We build, deploy, and manage your canisters automatically.
  </p>
  <div className="flex gap-3 mt-8">
    <Button size="lg" asChild>
      <a href="/api/auth/github">Get Started</a>
    </Button>
    <Button variant="outline" size="lg" asChild>
      <a href="https://github.com/jneums/icforge" target="_blank">
        View Docs <ExternalLink className="h-4 w-4 ml-1" />
      </a>
    </Button>
  </div>
</section>
```

### Feature Grid

```tsx
<section className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-4xl mx-auto px-4">
  {features.map(f => (
    <Card key={f.title} className="p-6">
      <span className="text-2xl mb-3 block">{f.emoji}</span>
      <h3 className="text-sm font-semibold">{f.title}</h3>
      <p className="text-sm text-muted-foreground mt-1">{f.description}</p>
    </Card>
  ))}
</section>
```

### Code Snippet

```tsx
<section className="max-w-xl mx-auto mt-16 px-4">
  <Card className="bg-popover p-6 font-mono text-sm">
    <div className="text-muted-foreground">$ npx icforge init</div>
    <div className="text-muted-foreground">$ git push origin main</div>
    <div className="text-success mt-2">✓ Deployed to https://my-app.icforge.dev</div>
  </Card>
</section>
```

### Footer

```tsx
<footer className="border-t py-8 text-center text-sm text-muted-foreground mt-24">
  © {new Date().getFullYear()} ICForge · Built on the Internet Computer
</footer>
```

## 4. Checklist

- [ ] Rewrite Landing header (logo + login button) with Tailwind
- [ ] Rewrite hero section with shadcn `<Button>`
- [ ] Rewrite feature grid with shadcn `<Card>`
- [ ] Rewrite code snippet with styled card
- [ ] Rewrite footer with Tailwind
- [ ] Remove all inline style objects
- [ ] Responsive: stack features on mobile (already handled by grid-cols-1 sm:grid-cols-3)
- [ ] Verify landing page does NOT show the sidebar
