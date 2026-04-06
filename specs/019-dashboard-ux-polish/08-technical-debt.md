# 08 — Technical Debt

**Scope:** Code quality, routing, error handling, accessibility
**Priority:** P2
**Depends on:** 01-design-system, 02-navigation
**Estimated effort:** Small

---

## 1. Problem

The codebase has several structural issues that should be cleaned up during the polish pass. These aren't user-visible bugs but they prevent the dashboard from feeling production-ready.

## 2. Items

### 2.1 Protected Routes

**Current:** Each page individually checks `useAuth()` and renders a login prompt if unauthenticated.

**Target:** A `<ProtectedRoute>` wrapper that redirects to `/login` automatically. The AppShell already handles this partially — make it explicit.

```tsx
function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}
```

Wrap `/projects`, `/projects/:id`, `/projects/:id/deploys/:deployId`, `/settings` in `<ProtectedRoute>`.

### 2.2 Error Boundary

**Current:** No error boundary. React errors crash the whole app with a white screen.

**Target:** A top-level `<ErrorBoundary>` component that catches render errors and shows a friendly error page with a "Reload" button.

```tsx
class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-page">
          <h1>Something went wrong</h1>
          <p>{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

### 2.3 404 Route

**Current:** No catch-all route. Bad URLs show a blank page.

**Target:** A `*` route that renders a simple 404 page:

```tsx
function NotFound() {
  return (
    <div className="not-found-page">
      <h1>404</h1>
      <p>Page not found</p>
      <Link to="/projects">Go to Projects</Link>
    </div>
  );
}
```

### 2.4 Loading States

**Current:** Pages show "Loading..." text during data fetches.

**Target:** Use skeleton components (defined in 01-design-system) for each page. At minimum:
- Projects: 3-4 skeleton project rows
- ProjectDetail: skeleton header + skeleton card + skeleton tab content
- DeployDetail: skeleton summary + skeleton log viewer
- Settings: skeleton profile card + skeleton plan card

### 2.5 API Error Handling

**Current:** `apiFetch()` throws on non-OK responses but pages may not catch gracefully.

**Target:** Each page should have three states: loading, error, and loaded. Error state shows a retry button. Network errors are caught and displayed.

Consider a simple `useApi()` hook:

```tsx
function useApi<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetcher());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [fetcher]);

  useEffect(() => { load(); }, [load]);

  return { data, error, loading, retry: load };
}
```

### 2.6 Relative Time Formatting

**Current:** `timeAgo()` helper exists in ProjectDetail.tsx but is duplicated/inlined.

**Target:** Move to a shared `utils/time.ts` module. Consider using `Intl.RelativeTimeFormat` for proper localization.

### 2.7 Copy to Clipboard Utility

Several places need copy-to-clipboard (canister IDs, deploy URLs, log lines). Add a shared utility:

```tsx
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      className="copy-btn"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? '✓' : '📋'}
    </button>
  );
}
```

## 3. File Structure After Cleanup

```
src/
  components/
    AppShell.tsx          (new — from 02-navigation)
    Sidebar.tsx           (new — from 02-navigation)
    Breadcrumbs.tsx       (new — from 02-navigation)
    Tabs.tsx              (new — from 04-project-detail)
    CopyButton.tsx        (new)
    ErrorBoundary.tsx     (new)
    ProtectedRoute.tsx    (new)
    StatusBadge.tsx       (new — shared status dot + label)
    Skeleton.tsx          (new — skeleton loading primitives)
  contexts/
    AuthContext.tsx        (existing, unchanged)
  pages/
    Landing.tsx           (rewritten)
    Login.tsx             (minor cleanup)
    Projects.tsx          (rewritten)
    ProjectDetail.tsx     (rewritten, decomposed)
    DeployDetail.tsx      (rewritten)
    Settings.tsx          (rewritten)
    NotFound.tsx          (new)
  utils/
    time.ts               (new — timeAgo, formatDuration)
    status.ts             (new — getProjectStatus, status color mapping)
  api.ts                  (existing, add useApi hook)
  main.tsx                (existing, add ErrorBoundary)
  App.tsx                 (rewritten — AppShell + ProtectedRoute)
  index.css               (expanded with design system)
```

## 4. Checklist

- [ ] Create `<ProtectedRoute>` component
- [ ] Wrap authenticated routes in `<ProtectedRoute>`
- [ ] Create `<ErrorBoundary>` component
- [ ] Add `<ErrorBoundary>` to `main.tsx`
- [ ] Create `<NotFound>` page with 404 catch-all route
- [ ] Create `<Skeleton>` component (line, card, row variants)
- [ ] Add skeleton loading states to all pages
- [ ] Create `useApi()` hook with loading/error/retry
- [ ] Create `<CopyButton>` component
- [ ] Create `<StatusBadge>` component (dot + label, shared)
- [ ] Extract `timeAgo()` to `utils/time.ts`
- [ ] Extract `getProjectStatus()` to `utils/status.ts`
- [ ] Add error states with retry buttons to all data-fetching pages
