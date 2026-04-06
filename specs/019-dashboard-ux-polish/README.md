# ICForge — Dashboard UX Polish

**Status:** Draft v0.1
**Parent:** 001-architecture.md, 006-dashboard.md
**Milestone:** v0.2.1 (polish pass before v0.3)

---

## 1. Goal

Polish the ICForge dashboard to match the UX conventions of Vercel and Render — the two platforms our users are most familiar with. A developer who has used Vercel or Render should feel immediately at home. This is not a redesign — it's a systematic cleanup of layout, navigation, information hierarchy, and interaction patterns.

## 2. Design Philosophy

- **Familiar > Novel** — copy proven patterns, don't invent new ones
- **Dense but clear** — show useful information without clutter
- **Dark mode first** — keep the existing dark aesthetic (matches Vercel)
- **Progressive disclosure** — show summary, expand for detail
- **Keyboard-friendly** — shortcuts for power users

## 3. Reference Platforms

| Pattern | Vercel | Render | ICForge Target |
|---------|--------|--------|----------------|
| Navigation | Left sidebar (collapsible) | Left sidebar + breadcrumbs | Left sidebar + breadcrumbs |
| Project list | Vertical list rows | Table rows | Vertical list rows (Vercel-style) |
| Project detail | Production deploy card + tabs | Service detail + contextual sidebar | Production deploy card + tabs |
| Deploy detail | Status dot + tabbed logs | Timeline feed + log viewer | Status header + streaming log viewer |
| Settings | Card sections, Entity pattern | Card sections, danger zone | Card sections with danger zone |
| Quick navigation | Cmd+K command menu | Cmd+K command palette | Cmd+K (future, not in this spec) |

## 4. Spec Files

This spec is split into focused implementation files:

| File | Scope | Priority |
|------|-------|----------|
| [01-design-system.md](01-design-system.md) | CSS variables, typography, spacing, component primitives | P0 — do first |
| [02-navigation.md](02-navigation.md) | Sidebar layout, breadcrumbs, responsive nav | P0 |
| [03-project-list.md](03-project-list.md) | Projects page redesign | P1 |
| [04-project-detail.md](04-project-detail.md) | Project detail page redesign | P1 |
| [05-deploy-detail.md](05-deploy-detail.md) | Deploy/build log viewer improvements | P1 |
| [06-settings.md](06-settings.md) | Settings page layout + placeholders | P2 |
| [07-landing.md](07-landing.md) | Landing page refresh | P2 |
| [08-technical-debt.md](08-technical-debt.md) | Code quality, routing guards, error handling | P2 |

## 5. Current State (Problems)

1. **No sidebar navigation** — top-only horizontal nav wastes vertical space, doesn't scale
2. **No breadcrumbs** — users lose context when drilling into project → deploy
3. **Inline styles everywhere** — ~6 different style objects per file, impossible to maintain consistency
4. **960px max-width** — too narrow for information-dense pages
5. **No responsive design** — grids break on mobile, no breakpoints
6. **Table-heavy layout** — projects page uses HTML tables instead of cards/rows
7. **No loading skeletons** — just "Loading..." text, feels slow
8. **No empty states** — missing illustrations/CTAs for zero-data pages
9. **No error boundary** — uncaught errors crash the whole app
10. **No 404 route** — bad URLs show blank page

## 6. Implementation Order

```
Phase 1 (foundation):  01-design-system → 02-navigation
Phase 2 (core pages):  03-project-list → 04-project-detail → 05-deploy-detail
Phase 3 (secondary):   06-settings → 07-landing → 08-technical-debt
```

Each file is independently implementable after Phase 1 is complete. Phase 2 files can be parallelized.
