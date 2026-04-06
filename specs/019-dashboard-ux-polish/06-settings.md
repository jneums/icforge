# 06 — Settings

**Scope:** Layout the `/settings` page using shadcn card sections
**Priority:** P2
**Depends on:** 00-setup, 01-design-system, 02-navigation
**Estimated effort:** Small

---

## 1. Current State

The Settings page currently shows:
- Profile (read-only: name, avatar from GitHub)
- Plan (hardcoded "free")
- API Tokens (CRUD table)
- Canister Eject (transfer ownership)

It uses the same inline-styles-with-CSS-vars pattern as the rest of the dashboard.

## 2. Target Layout

Use shadcn `<Card>` + `<Separator>` for a vertical stack of settings sections (Vercel/Render pattern):

```
┌──────────────────────────────────────────────────────────────┐
│  Settings                                                    │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Profile                                                │ │
│  │  ──────────────────────                                 │ │
│  │  Avatar    Name    Email    GitHub                      │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Plan                                                   │ │
│  │  ──────────────────────                                 │ │
│  │  Free Plan            Manage billing (coming soon)      │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  API Tokens                                             │ │
│  │  ──────────────────────                                 │ │
│  │  token-1  icf_abc...   Created 5d ago       [Revoke]   │ │
│  │  token-2  icf_xyz...   Created 1d ago       [Revoke]   │ │
│  │                                                         │ │
│  │  [Create Token]                                         │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Danger Zone                                 (border-red)│ │
│  │  ──────────────────────                                 │ │
│  │  Eject Canisters — Transfer ownership to your           │ │
│  │  own controller. This removes ICForge access.           │ │
│  │                                           [Eject →]     │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

## 3. Component Structure

### Settings Section Card

Reusable wrapper for each settings section:

```tsx
function SettingsSection({ title, description, children, danger = false }) {
  return (
    <Card className={cn("p-6", danger && "border-destructive/30")}>
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && (
        <p className="text-sm text-muted-foreground mt-1">{description}</p>
      )}
      <Separator className="my-4" />
      {children}
    </Card>
  );
}
```

### Profile Section

```tsx
<SettingsSection title="Profile">
  <div className="flex items-center gap-4">
    <Avatar className="h-12 w-12">
      <AvatarImage src={user.avatar_url} />
      <AvatarFallback>{user.name?.[0]}</AvatarFallback>
    </Avatar>
    <div>
      <div className="text-sm font-semibold">{user.name}</div>
      <div className="text-sm text-muted-foreground">{user.email}</div>
      {user.github_username && (
        <a
          href={`https://github.com/${user.github_username}`}
          target="_blank"
          className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"
        >
          @{user.github_username}
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  </div>
</SettingsSection>
```

### Plan Section

```tsx
<SettingsSection title="Plan">
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-2">
      <Badge variant="outline">Free</Badge>
      <span className="text-sm text-muted-foreground">
        You're on the free plan
      </span>
    </div>
    <Button variant="outline" size="sm" disabled>
      Manage billing (coming soon)
    </Button>
  </div>
</SettingsSection>
```

### API Tokens Section

```tsx
<SettingsSection
  title="API Tokens"
  description="Tokens are used to authenticate CLI commands."
>
  <div className="space-y-2">
    {tokens.map(token => (
      <div key={token.id} className="flex items-center gap-3 rounded-md bg-muted/30 px-3 py-2">
        <span className="text-sm font-medium">{token.name}</span>
        <span className="font-mono text-xs text-muted-foreground">{token.prefix}...</span>
        <span className="ml-auto text-xs text-muted-foreground">{timeAgo(token.created_at)}</span>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => revokeToken(token.id)}
        >
          Revoke
        </Button>
      </div>
    ))}
  </div>
  <Button variant="outline" size="sm" className="mt-4" onClick={createToken}>
    Create Token
  </Button>
</SettingsSection>
```

### Danger Zone — Eject

```tsx
<SettingsSection
  title="Danger Zone"
  description="These actions are destructive and cannot be undone."
  danger
>
  <div className="flex items-center justify-between">
    <div>
      <div className="text-sm font-medium">Eject Canisters</div>
      <div className="text-sm text-muted-foreground">
        Transfer canister ownership to your own controller.
        ICForge will lose access.
      </div>
    </div>
    <Button variant="destructive" size="sm" onClick={() => setShowEjectDialog(true)}>
      Eject
    </Button>
  </div>
</SettingsSection>
```

## 4. Checklist

- [ ] Extract `<SettingsSection>` reusable card wrapper
- [ ] Rewrite Profile section with shadcn `<Avatar>`
- [ ] Rewrite Plan section with shadcn `<Badge>` + disabled billing button
- [ ] Rewrite API Tokens section with token list + create/revoke
- [ ] Rewrite Danger Zone with destructive card border + eject button
- [ ] Stack sections vertically with `space-y-6`
- [ ] Delete old inline style objects
- [ ] Keep existing API token CRUD logic, just restyle
- [ ] Keep existing eject dialog logic, just restyle
