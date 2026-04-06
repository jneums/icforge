# 02 — Navigation

**Scope:** Sidebar layout, breadcrumbs, responsive mobile nav
**Priority:** P0 — the biggest structural change
**Depends on:** 01-design-system
**Estimated effort:** Medium

---

## 1. Problem

The current Header is a simple horizontal bar (logo + 3 links + user info). This doesn't scale:
- No room for more nav items (billing, domains, API tokens coming in v0.3)
- Users lose context when drilling into project → deploy → no breadcrumbs
- Wastes vertical space on every page

## 2. Target Layout

Replace the top Header with a Vercel/Render-style sidebar + breadcrumb layout:

```
┌──────────┬──────────────────────────────────────────────┐
│          │ Projects / my-project / Deploy #42           │ ← breadcrumbs
│  ⬡       │─────────────────────────────────────────────│
│ ICForge  │                                              │
│          │                                              │
│ Projects │              Main Content Area               │
│ Settings │                                              │
│          │              (max-width 1200px,              │
│          │               centered in panel)             │
│          │                                              │
│          │                                              │
│──────────│                                              │
│ jneums   │                                              │
│ Logout   │                                              │
└──────────┴──────────────────────────────────────────────┘
```

### Desktop (≥768px)
- **Left sidebar**: fixed 240px, full viewport height
  - Top: logo + app name
  - Middle: nav links (icon + label per item)
  - Bottom: user info + logout
- **Right panel**: flex-grow, scrollable
  - Top: breadcrumb bar (sticky)
  - Below: page content (max-width 1200px, centered)

### Mobile (<768px)
- Sidebar collapses to hidden
- Bottom floating bar with icons (Vercel-style) or hamburger menu
- Breadcrumbs remain at top

## 3. Sidebar Nav Items

```
Icon  Label       Route          Auth Required
──────────────────────────────────────────────
▦     Projects    /projects      Yes
⚙     Settings    /settings      Yes
```

Keep it minimal for now. v0.3 adds: Billing, Domains, API Tokens.

The Landing page (`/`) does NOT show the sidebar — it's a full-width marketing page. Sidebar only appears for authenticated routes.

## 4. Breadcrumbs

Dynamic breadcrumb bar based on current route:

```
/projects                          →  Projects
/projects/:id                      →  Projects / {project.name}
/projects/:id/deploys/:deployId    →  Projects / {project.name} / Deploy #{deployId}
/settings                          →  Settings
```

Each segment is clickable (navigates to that level). Current segment is non-clickable, bold.

Implementation: a `<Breadcrumbs>` component that reads `useLocation()` + `useParams()` and renders the trail. Project names come from a lightweight context or fetched on mount.

## 5. Component Breakdown

### 5.1 `<AppShell>`

New wrapper component that replaces the current `<Header> + <Outlet>` pattern in App.tsx:

```tsx
// Unauthenticated routes (Landing, Login): render children directly, no sidebar
// Authenticated routes: render sidebar + breadcrumb + content panel
function AppShell({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  const isPublicRoute = ['/', '/login'].includes(location.pathname);

  if (isPublicRoute || !user) {
    return <>{children}</>;
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-panel">
        <Breadcrumbs />
        <div className="page-content">
          {children}
        </div>
      </main>
    </div>
  );
}
```

### 5.2 `<Sidebar>`

```tsx
function Sidebar() {
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <nav className="sidebar">
      <div className="sidebar-header">
        <Link to="/projects">⬡ ICForge</Link>
      </div>
      <div className="sidebar-nav">
        <NavLink to="/projects" icon="▦">Projects</NavLink>
        <NavLink to="/settings" icon="⚙">Settings</NavLink>
      </div>
      <div className="sidebar-footer">
        <span className="sidebar-user">{user?.name}</span>
        <button onClick={logout}>Logout</button>
      </div>
    </nav>
  );
}
```

### 5.3 `<Breadcrumbs>`

```tsx
function Breadcrumbs() {
  // Parse location + params into segments
  // Fetch project name for /projects/:id routes
  // Render: segment / segment / current
}
```

## 6. CSS Structure

```css
.app-shell {
  display: flex;
  min-height: 100vh;
}

.sidebar {
  width: var(--sidebar-width);
  background: var(--bg-primary);
  border-right: 1px solid var(--border-default);
  display: flex;
  flex-direction: column;
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 10;
}

.main-panel {
  margin-left: var(--sidebar-width);
  flex: 1;
  min-height: 100vh;
}

.breadcrumb-bar {
  position: sticky;
  top: 0;
  z-index: 5;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-subtle);
  padding: var(--space-3) var(--space-5);
}

.page-content {
  max-width: var(--content-max-width);
  margin: 0 auto;
  padding: var(--space-5);
}

/* Active nav link */
.sidebar-nav a.active {
  background: var(--surface-card-hover);
  color: var(--text-primary);
}

/* Mobile */
@media (max-width: 767px) {
  .sidebar { display: none; }
  .main-panel { margin-left: 0; }
  .mobile-nav { display: flex; }
}
```

## 7. Migration Steps

1. Create `<Sidebar>`, `<Breadcrumbs>`, `<AppShell>` components
2. Update `App.tsx` to use `<AppShell>` instead of `<Header>`
3. Remove `<Header>` component
4. Adjust all page components to remove any top padding that assumed the header
5. Test all routes at desktop and mobile widths

## 8. Checklist

- [ ] Create `components/Sidebar.tsx`
- [ ] Create `components/Breadcrumbs.tsx`
- [ ] Create `components/AppShell.tsx`
- [ ] Add sidebar + layout CSS to `index.css`
- [ ] Update `App.tsx` routing to use `<AppShell>`
- [ ] Remove `components/Header.tsx`
- [ ] Remove old header-related styles from `index.css`
- [ ] Add mobile breakpoint (hide sidebar, show bottom nav or hamburger)
- [ ] Verify all 6 routes render correctly in new layout
- [ ] Verify unauthenticated routes (Landing, Login) skip the sidebar
