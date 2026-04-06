# 08 — Technical Debt & Error Handling

**Scope:** Code quality, routing guards, error boundaries, loading patterns
**Priority:** P2
**Depends on:** 00-setup, 01-design-system
**Estimated effort:** Medium

---

## 1. Problem

The dashboard has several technical debt items that cause poor UX or developer experience:
- No error boundary — any uncaught React error crashes the whole app
- No 404 route — invalid URLs show a blank page
- No routing guard — unauthenticated users can navigate to `/projects` and see broken state
- Loading states are inconsistent — some use "Loading...", some use nothing
- No consistent error handling pattern — each page handles errors differently

## 2. Error Boundary

Add a global error boundary that catches React render errors and shows a recovery UI:

```tsx
import { ErrorBoundary } from 'react-error-boundary';

function ErrorFallback({ error, resetErrorBoundary }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
      <AlertCircle className="h-12 w-12 text-destructive mb-4" />
      <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
      <p className="text-sm text-muted-foreground mb-4 max-w-md">
        {error.message}
      </p>
      <div className="flex gap-3">
        <Button onClick={resetErrorBoundary}>Try Again</Button>
        <Button variant="outline" asChild>
          <Link to="/projects">Back to Projects</Link>
        </Button>
      </div>
    </div>
  );
}

// In App.tsx
<ErrorBoundary FallbackComponent={ErrorFallback} onReset={() => navigate('/projects')}>
  <Routes>...</Routes>
</ErrorBoundary>
```

Install: `npm install react-error-boundary`

## 3. Not Found (404) Route

```tsx
function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
      <h1 className="text-6xl font-bold text-muted-foreground">404</h1>
      <p className="text-lg text-muted-foreground mt-2">Page not found</p>
      <Button asChild className="mt-6">
        <Link to="/projects">Back to Projects</Link>
      </Button>
    </div>
  );
}

// In App.tsx routes
<Route path="*" element={<NotFound />} />
```

## 4. Auth Guard

Wrap authenticated routes so unauthenticated users redirect to `/`:

```tsx
function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/" state={{ from: location }} replace />;
  }

  return children;
}

// In App.tsx
<Route path="/projects" element={<RequireAuth><Projects /></RequireAuth>} />
<Route path="/projects/:id" element={<RequireAuth><ProjectDetail /></RequireAuth>} />
<Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
```

## 5. Data Fetching

**Handled by [09-data-layer.md](09-data-layer.md)** — TanStack Query provides loading, error, retry, caching, deduplication, and background refetch out of the box. No custom `useApi` hook needed.

## 6. Sonner Toast Notifications

shadcn's `<Sonner>` for non-intrusive notifications:

```tsx
import { Toaster } from "@/components/ui/sonner"
import { toast } from "sonner"

// In App.tsx root
<Toaster />

// Usage anywhere:
toast.success("Token created");
toast.error("Failed to revoke token");
toast("Canister ID copied to clipboard");
```

## 7. Checklist

- [ ] Install `react-error-boundary`
- [ ] Create `<ErrorFallback>` component with retry + back-to-projects
- [ ] Wrap `<Routes>` in `<ErrorBoundary>` in App.tsx
- [ ] Add catch-all `<Route path="*">` for 404
- [ ] Create `<NotFound>` component
- [ ] Create `<RequireAuth>` component
- [ ] Wrap all authenticated routes in `<RequireAuth>`
- [ ] Add `<Toaster />` (Sonner) to App.tsx root
- [ ] Replace all `alert()` calls with `toast()` calls
- [ ] Add `<Spinner>` to auth loading state
- [ ] Audit all pages for uncaught promise rejections
