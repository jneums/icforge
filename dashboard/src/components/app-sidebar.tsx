import { useLocation, Link } from "react-router-dom"
import { Folder, CreditCard, LogOut, Plus, Box } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { useProjects } from "@/hooks/use-projects"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@/components/ui/sidebar"

export function AppSidebar() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const { data: projects, isLoading } = useProjects();

  return (
    <Sidebar>
      <SidebarHeader>
        <Link to="/projects" className="flex items-center gap-2 px-2 py-1">
          <span className="text-lg">⬡</span>
          <span className="font-semibold">ICForge</span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/projects"}>
                  <Link to="/projects">
                    <Folder className="h-4 w-4" />
                    <span>All Projects</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/billing"}>
                  <Link to="/billing">
                    <CreditCard className="h-4 w-4" />
                    <span>Billing</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <SidebarGroupAction asChild title="New Project">
            <Link to="/projects/new">
              <Plus className="h-4 w-4" />
              <span className="sr-only">New Project</span>
            </Link>
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu>
              {isLoading ? (
                <>
                  <SidebarMenuItem><SidebarMenuSkeleton /></SidebarMenuItem>
                  <SidebarMenuItem><SidebarMenuSkeleton /></SidebarMenuItem>
                </>
              ) : (
                (projects ?? []).map((p) => (
                  <SidebarMenuItem key={p.id}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname.startsWith(`/projects/${p.id}`)}
                    >
                      <Link to={`/projects/${p.id}`}>
                        <Box className="h-4 w-4" />
                        <span className="truncate">{p.name}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center gap-2 px-2">
          <Avatar className="h-6 w-6">
            <AvatarImage src={user?.avatar_url ?? undefined} />
            <AvatarFallback>{user?.name?.[0] ?? "U"}</AvatarFallback>
          </Avatar>
          <span className="text-sm truncate flex-1">{user?.name ?? "User"}</span>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={logout} title="Logout">
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
