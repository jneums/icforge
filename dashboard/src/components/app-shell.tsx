import { type ReactNode } from "react"
import { useLocation, Link } from "react-router-dom"
import { useAuth } from "@/hooks/use-auth"
import { useBillingBalance } from "@/hooks/use-billing"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "./app-sidebar"
import { AppBreadcrumbs } from "./app-breadcrumbs"
import { CreditCard } from "lucide-react"

/** Format cents as USD — e.g. 350 → "$3.50" */
function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

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
  const { data: billing } = useBillingBalance();

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-12 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <AppBreadcrumbs />
          <div className="ml-auto flex items-center gap-3">
            {billing != null && (
              <Link
                to="/billing"
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <CreditCard className="h-3.5 w-3.5" />
                {formatUsd(billing.compute_balance_cents)}
              </Link>
            )}
          </div>
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
