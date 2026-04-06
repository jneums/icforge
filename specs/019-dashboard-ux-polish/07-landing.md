# 07 — Landing Page

**Scope:** Refresh the marketing landing page at `/`
**Priority:** P2
**Depends on:** 01-design-system
**Estimated effort:** Small

---

## 1. Problem

The current landing page is functional (hero + code snippet + 3 feature cards + CTA) but feels like a prototype:
- Feature cards are in a 3-column grid that doesn't explain what ICForge actually does
- No social proof or ecosystem context
- No visual demo/screenshot
- Code snippet is good but could be more prominent

## 2. Target Layout

Keep it simple — one page, no scrolljacking, fast to scan.

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                   ⬡ ICForge                                  │
│                                                              │
│            Deploy to the Internet Computer                   │
│              in one command.                                 │
│                                                              │
│     ┌──────────────────────────────────────────────┐         │
│     │  $ npx icforge init                          │         │
│     │  $ git push origin main                      │         │
│     │  ✓ Deployed → my-dapp.icforge.dev            │         │
│     └──────────────────────────────────────────────┘         │
│                                                              │
│            [ Get Started ]    [ View on GitHub ]             │
│                                                              │
│──────────────────────────────────────────────────────────────│
│                                                              │
│  Git Push to Deploy          Multi-Canister Projects         │
│  Push to main and ICForge    Frontend + backend canisters,   │
│  builds and deploys           linked with environment        │
│  automatically via            variables, deployed together.  │
│  GitHub webhooks.                                            │
│                                                              │
│  Instant Preview URLs        Canister Eject                  │
│  Every project gets a        Your canisters, your keys.      │
│  {name}.icforge.dev URL      Transfer ownership anytime      │
│  immediately.                with one command.               │
│                                                              │
│──────────────────────────────────────────────────────────────│
│                                                              │
│     Deploy your first canister in under a minute.            │
│                 [ Get Started ]                              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## 3. Changes from Current

| Current | New |
|---------|-----|
| "⬡ ICForge" + subtitle | Same, keep it |
| 3-step code block (npm install, icforge init, icforge deploy) | Simplify to 2 lines: init + git push (emphasize GitHub flow) |
| 3 feature cards (Git-Driven, Reproducible, Canister Mgmt) | 4 feature cards with clearer copy (Push to Deploy, Multi-Canister, Preview URLs, Eject) |
| 1 CTA button | 2 buttons: Get Started (primary) + GitHub (secondary) |
| No footer CTA | Add a bottom CTA section |

## 4. Design Notes

- Hero section: full viewport height (100vh), centered vertically
- Code snippet: terminal-style block (existing `--surface-inset` bg, monospace)
- Feature cards: 2x2 grid on desktop, 1 column on mobile
- No sidebar on this page (handled by AppShell — unauthenticated routes skip sidebar)
- "Get Started" routes to `/projects` if logged in, `/login` if not

## 5. Checklist

- [ ] Update hero copy (2-line code snippet: init + git push)
- [ ] Add "View on GitHub" secondary button linking to github.com/jneums/icforge
- [ ] Update feature cards (4 cards: Push to Deploy, Multi-Canister, Preview URLs, Eject)
- [ ] Add bottom CTA section
- [ ] Switch feature grid to 2x2 on desktop, 1-col on mobile
- [ ] Migrate from inline styles to CSS classes
- [ ] Verify landing page renders without sidebar
