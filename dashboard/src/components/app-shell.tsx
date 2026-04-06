import { type ReactNode } from "react"
import { useLocation } from "react-router-dom"
import { useAuth } from "@/hooks/use-auth"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "./app-sidebar"
import { AppBreadcrumbs } from "./app-breadcrumbs"

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const isPublicRoute = ["/", "/login"].includes(location.pathname);

  // Public routes: no sidebar
  if (isPublicRoute || (!loading && !user)) {
    return <>{children}</>;
  }

  // Auth loading
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner className="h-6 w-6" />
      </div>
    );
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
          <div className="mx-auto max-w-[var(--content-max-width)]">
            {children}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
