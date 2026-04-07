# 01 — Design System

**Scope:** Theme tokens, color overrides, custom Tailwind utilities, shared component patterns
**Priority:** P0 — everything else builds on this
**Depends on:** 00-setup
**Estimated effort:** Small

---

## 1. Problem

With Tailwind + shadcn installed (00-setup), we need to establish the conventions for how we use them across the dashboard. This file defines the patterns — not new code, but rules for consistency.

## 2. Color Usage Conventions

### Status Colors (used everywhere)

| Status | Tailwind Class | Hex | Usage |
|--------|---------------|-----|-------|
| Deployed / Running / Live | `text-success` / `bg-success` | #22c55e | Canister running, deploy succeeded |
| Building / Pending / Deploying | `text-warning` / `bg-warning` | #eab308 | Deploy in progress |
| Failed / Error | `text-destructive` | #ef4444 | Deploy failed, build error |
| Stopped / Unknown | `text-muted-foreground` | #666 | Inactive, unknown state |

### Surface Hierarchy

| Level | shadcn Variable | Tailwind Class | Usage |
|-------|----------------|---------------|-------|
| Page background | `--background` | `bg-background` | Body, main content area |
| Card/panel | `--card` | `bg-card` | Project rows, deploy cards, settings sections |
| Inset/code | `--popover` | `bg-popover` | Log viewer, code blocks, terminal-style areas |
| Border | `--border` | `border-border` | Card borders, separators |

### Text Hierarchy

| Level | Tailwind Class | Usage |
|-------|---------------|-------|
| Primary | `text-foreground` | Headings, project names, important text |
| Secondary | `text-muted-foreground` | Descriptions, metadata, timestamps |
| Link / Accent | `text-primary` | Clickable links, active states |

## 3. Typography Patterns

Use Tailwind's built-in size classes consistently:

| Element | Classes | Example |
|---------|---------|---------|
| Page heading | `text-2xl font-semibold tracking-tight` | "Projects", "Settings" |
| Section heading | `text-lg font-semibold` | "Production Deployment", "Canisters" |
| Card title | `text-sm font-semibold` | Project name in list row |
| Body text | `text-sm text-foreground` | Descriptions |
| Secondary text | `text-sm text-muted-foreground` | Timestamps, metadata |
| Tiny text | `text-xs text-muted-foreground` | Labels, helper text |
| Monospace | `font-mono text-sm` | Canister IDs, commit SHAs, URLs |

## 4. Shared Component Patterns

These aren't new components — they're usage patterns for shadcn components:

### Status Badge

Use shadcn `<Badge>` with variant based on status:

```tsx
import { Badge } from "@/components/ui/badge"

function StatusBadge({ status }: { status: string }) {
  const config = {
    deployed: { label: "Deployed", className: "bg-success/15 text-success border-success/20" },
    running:  { label: "Running",  className: "bg-success/15 text-success border-success/20" },
    building: { label: "Building", className: "bg-warning/15 text-warning border-warning/20" },
    pending:  { label: "Pending",  className: "bg-warning/15 text-warning border-warning/20" },
    failed:   { label: "Failed",   className: "bg-destructive/15 text-destructive border-destructive/20" },
    stopped:  { label: "Stopped",  className: "bg-muted text-muted-foreground" },
  }[status] ?? { label: status, className: "bg-muted text-muted-foreground" };

  return <Badge variant="outline" className={config.className}>{config.label}</Badge>
}
```

### Status Dot

A simple colored dot for inline status indicators:

```tsx
function StatusDot({ status, pulse = false }: { status: string; pulse?: boolean }) {
  const color = {
    deployed: "bg-success", running: "bg-success",
    building: "bg-warning", pending: "bg-warning",
    failed: "bg-destructive",
  }[status] ?? "bg-muted-foreground";

  return (
    <span className={cn(
      "inline-block h-2 w-2 rounded-full",
      color,
      pulse && "animate-pulse"
    )} />
  );
}
```

### Copy Button

Reusable clipboard button using shadcn `<Button>` + `<Tooltip>`:

```tsx
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => {
            navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied!" : "Copy"}</TooltipContent>
    </Tooltip>
  );
}
```

### Icons

Use **Lucide React** (already a shadcn dependency):

```bash
npm install lucide-react  # if not already installed via shadcn
```

Key icons we'll use:
- `Folder` — projects
- `Settings` — settings
- `ExternalLink` — visit site
- `Copy` / `Check` — clipboard
- `GitCommit` — deploy commits
- `GitBranch` — branch names
- `Clock` — timestamps
- `AlertCircle` — errors
- `Loader2` — spinning loader

## 5. Layout Tokens

Define consistent layout values as Tailwind `@theme` extensions:

```css
@theme {
  --sidebar-width: 240px;
  --content-max-width: 1200px;
}
```

Use in components:
- `w-[var(--sidebar-width)]` for sidebar
- `max-w-[var(--content-max-width)]` for main content

## 6. Migration Strategy: Inline Styles → Tailwind

When rewriting each page:
1. Delete the `const styles: Record<string, React.CSSProperties> = { ... }` block
2. Replace `style={styles.foo}` with Tailwind className strings
3. Replace raw `<div>`, `<button>`, `<table>` with shadcn equivalents where appropriate
4. Use `cn()` from `@/lib/utils` for conditional classes

## 7. Checklist

- [x] Define `StatusBadge` component in `src/components/status-badge.tsx`
- [x] Define `StatusDot` component in `src/components/status-dot.tsx`
- [x] Define `CopyButton` component in `src/components/copy-button.tsx`
- [x] Install `lucide-react`
- [x] Add `--sidebar-width` and `--content-max-width` to `@theme` in CSS
- [x] Document color/typography conventions (this file serves as the reference)
