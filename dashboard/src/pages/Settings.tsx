import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useTokens, useCreateToken, useRevokeToken } from "@/hooks/use-tokens";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton } from "@/components/copy-button";

function SettingsSection({ title, description, children, danger = false }: {
  title: string; description?: string; children: React.ReactNode; danger?: boolean;
}) {
  return (
    <Card className={danger ? "p-6 border-destructive/30" : "p-6"}>
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      <Separator className="my-4" />
      {children}
    </Card>
  );
}

function TokensSection() {
  const { data: tokens, isLoading } = useTokens();
  const createToken = useCreateToken();
  const revokeToken = useRevokeToken();
  const [name, setName] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);

  return (
    <SettingsSection title="API Tokens" description="Create tokens for CI/CD and CLI authentication.">
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : (
        <div className="space-y-2">
          {tokens?.map((t) => (
            <div key={t.id} className="flex items-center gap-3 text-sm py-1.5">
              <span className="font-medium">{t.name}</span>
              <span className="font-mono text-xs text-muted-foreground">{t.prefix}...</span>
              <span className="text-xs text-muted-foreground ml-auto">
                {new Date(t.created_at + "Z").toLocaleDateString()}
              </span>
              <Button variant="ghost" size="sm" className="text-destructive h-7"
                onClick={() => revokeToken.mutate(t.id)} disabled={revokeToken.isPending}>
                Revoke
              </Button>
            </div>
          ))}
          {tokens?.length === 0 && <p className="text-sm text-muted-foreground">No tokens yet.</p>}
        </div>
      )}
      <Separator className="my-4" />
      {newToken && (
        <div className="mb-4 p-3 rounded-md bg-success/10 border border-success/20">
          <p className="text-xs text-success mb-1">Token created — copy it now, it won't be shown again:</p>
          <div className="flex items-center gap-2">
            <code className="font-mono text-xs flex-1 truncate">{newToken}</code>
            <CopyButton text={newToken} />
          </div>
        </div>
      )}
      <form className="flex gap-2" onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        createToken.mutate(name.trim(), {
          onSuccess: (data) => { setNewToken(data.token); setName(""); },
        });
      }}>
        <Input placeholder="Token name" value={name} onChange={(e) => setName(e.target.value)} className="max-w-[200px]" />
        <Button type="submit" size="sm" disabled={createToken.isPending || !name.trim()}>
          {createToken.isPending ? "Creating..." : "Create Token"}
        </Button>
      </form>
    </SettingsSection>
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

      <TokensSection />

      <SettingsSection title="Danger Zone" description="Transfer canister ownership away from ICForge." danger>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Eject Canisters</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Transfer full control to your own principal. Coming in v0.3.
            </div>
          </div>
          <Button variant="destructive" size="sm" disabled>Eject</Button>
        </div>
      </SettingsSection>
    </div>
  );
}
