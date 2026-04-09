import { useLocation, Link } from "react-router-dom"
import { Folder, Settings, CreditCard, LogOut } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function AppSidebar() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();

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
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname.startsWith("/projects")}>
              <Link to="/projects">
                <Folder className="h-4 w-4" />
                <span>Projects</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname === "/settings"}>
              <Link to="/settings">
                <Settings className="h-4 w-4" />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname === "/settings/billing"}>
              <Link to="/settings/billing">
                <CreditCard className="h-4 w-4" />
                <span>Billing</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
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
