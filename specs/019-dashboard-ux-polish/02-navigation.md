# 02 — Navigation

**Scope:** shadcn Sidebar + Breadcrumb, responsive mobile nav
**Priority:** P0 — the biggest structural change
**Depends on:** 00-setup, 01-design-system
**Estimated effort:** Medium

---

## 1. Problem

The current Header is a simple horizontal bar (logo + 3 links + user info). This doesn't scale:
- No room for more nav items (billing, domains, API tokens coming in v0.3)
- Users lose context when drilling into project → deploy → no breadcrumbs
- Wastes vertical space on every page

## 2. Target Layout

Use shadcn's `<Sidebar>` and `<Breadcrumb>` components:

```
┌──────────┬──────────────────────────────────────────────┐
│          │ Projects / my-project / Deploy #42           │ ← shadcn Breadcrumb
│  ⬡       │─────────────────────────────────────────────│
│ ICForge  │                                              │
│          │                                              │
│ Projects │              Main Content Area               │
│ Settings │                                              │
│          │              (max-w-[1200px] mx-auto)        │
│          │                                              │
│          │                                              │
│──────────│                                              │
│ jneums   │                                              │
│ Logout   │                                              │
└──────────┴──────────────────────────────────────────────┘
```

### Desktop (≥768px)
- **Left sidebar**: shadcn `<Sidebar>` component, 240px fixed
  - Top: `<SidebarHeader>` — logo + app name
  - Middle: `<SidebarContent>` → `<SidebarMenu>` — nav links
  - Bottom: `<SidebarFooter>` — user info + logout
- **Right panel**: `<SidebarInset>` — scrollable content
  - Top: shadcn `<Breadcrumb>` (sticky)
  - Below: page content (max-w-[1200px], centered)

### Mobile (<768px)
- shadcn Sidebar automatically collapses to a sheet/drawer
- `<SidebarTrigger>` hamburger button shown in breadcrumb bar
- Breadcrumbs remain at top

## 3. Sidebar Nav Items

Using shadcn `<SidebarMenu>` + `<SidebarMenuButton>`:

```tsx
<SidebarMenu>
  <SidebarMenuItem>
    <SidebarMenuButton asChild isActive={pathname.startsWith('/projects')}>
      <Link to="/projects">
        <Folder className="h-4 w-4" />
        <span>Projects</span>
      </Link>
    </SidebarMenuButton>
  </SidebarMenuItem>
  <SidebarMenuItem>
    <SidebarMenuButton asChild isActive={pathname === '/settings'}>
      <Link to="/settings">
        <Settings className="h-4 w-4" />
        <span>Settings</span>
      </Link>
    </SidebarMenuButton>
  </SidebarMenuItem>
</SidebarMenu>
```

The Landing page (`/`) does NOT show the sidebar — it's a full-width marketing page. Sidebar only appears for authenticated routes.

## 4. Breadcrumbs

Using shadcn `<Breadcrumb>`:

```tsx
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink,
  BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

function AppBreadcrumbs() {
  // Dynamic based on route
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to="/projects">Projects</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{project.name}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
```

Route → breadcrumb mapping:

```
/projects                          →  Projects
/projects/:id                      →  Projects / {project.name}
/projects/:id/deploys/:deployId    →  Projects / {project.name} / Deploy #{shortId}
/settings                          →  Settings
```

## 5. Component Structure

### 5.1 `<AppShell>` (new wrapper)

```tsx
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"

function AppShell({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  const isPublicRoute = ['/', '/login'].includes(location.pathname);

  // Public routes: no sidebar
  if (isPublicRoute || !user) {
    return <>{children}</>;
  }

  // Authenticated routes: sidebar + breadcrumbs
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-12 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <AppBreadcrumbs />
        </header>
        <main className="flex-1 p-6">
          <div className="mx-auto max-w-[1200px]">
            {children}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

### 5.2 `<AppSidebar>`

```tsx
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

function AppSidebar() {
  const { user, logout } = useAuth();

  return (
    <Sidebar>
      <SidebarHeader>
        <Link to="/projects" className="flex items-center gap-2 px-2 py-1">
          <span className="text-lg">⬡</span>
          <span className="font-semibold">ICForge</span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarMenu>
          {/* nav items */}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center gap-2 px-2">
          <Avatar className="h-6 w-6">
            <AvatarImage src={user?.avatar_url} />
            <AvatarFallback>{user?.name?.[0]}</AvatarFallback>
          </Avatar>
          <span className="text-sm truncate">{user?.name}</span>
          <Button variant="ghost" size="sm" onClick={logout} className="ml-auto">
            Logout
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
```

## 6. Migration Steps

1. Install shadcn sidebar + breadcrumb components (done in 00-setup)
2. Create `<AppSidebar>` component
3. Create `<AppBreadcrumbs>` component
4. Create `<AppShell>` wrapper
5. Update `App.tsx` to use `<AppShell>` instead of `<Header>`
6. Delete `components/Header.tsx`
7. Remove old header-related styles from CSS
8. Test all routes at desktop and mobile widths

## 7. Checklist

- [x] Create `src/components/app-sidebar.tsx`
- [x] Create `src/components/app-breadcrumbs.tsx`
- [x] Create `src/components/app-shell.tsx`
- [x] Update `App.tsx` routing to use `<AppShell>`
- [x] Delete `src/components/Header.tsx`
- [x] Delete old header styles from `index.css`
- [x] Verify shadcn sidebar collapses on mobile
- [x] Verify breadcrumbs show correct trail for all routes
- [x] Verify Landing + Login pages render without sidebar
- [x] Verify active nav link highlights correctly
