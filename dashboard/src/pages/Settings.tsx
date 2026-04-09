import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

function SettingsSection({ title, description, children }: {
  title: string; description?: string; children: React.ReactNode;
}) {
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      <Separator className="my-4" />
      {children}
    </Card>
  );
}

export default function Settings() {
  const { user, loading } = useAuth();

  if (loading) return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-48 w-full rounded-lg" />
    </div>
  );

  if (!user) return <p className="text-sm text-muted-foreground text-center py-12">Please sign in.</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <SettingsSection title="Profile">
        <div className="flex items-center gap-4 mb-4">
          <Avatar className="h-14 w-14">
            <AvatarImage src={user.avatar_url ?? undefined} />
            <AvatarFallback>{(user.name ?? "U")[0].toUpperCase()}</AvatarFallback>
          </Avatar>
          <div>
            <div className="font-semibold">{user.name ?? "—"}</div>
            <div className="text-sm text-muted-foreground">{user.email ?? "No email set"}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-xs text-muted-foreground">User ID</span>
            <div className="font-mono text-xs mt-0.5">{user.id}</div>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">GitHub ID</span>
            <div className="font-mono text-xs mt-0.5">{user.github_id}</div>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Member Since</span>
            <div className="mt-0.5">{new Date(user.created_at + "Z").toLocaleDateString()}</div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Plan">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold capitalize">{user.plan} Plan</div>
            <div className="text-sm text-muted-foreground mt-0.5">Up to 3 projects</div>
          </div>
          <Badge variant="outline">{user.plan}</Badge>
        </div>
      </SettingsSection>
    </div>
  );
}
