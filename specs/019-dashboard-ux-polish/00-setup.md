# 00 — Setup: Tailwind CSS v4 + shadcn/ui

**Scope:** Install tooling, configure themes, remove old CSS
**Priority:** P0 — must be done before anything else
**Estimated effort:** Small

---

## 1. Goal

Replace the hand-rolled CSS custom properties + inline style objects with Tailwind CSS v4 and shadcn/ui. After this step, the app should look identical (or very close) to the current state — this is a tooling migration, not a visual change.

## 2. Install Tailwind CSS v4

Tailwind v4 uses a Vite plugin (no PostCSS config, no `tailwind.config.js`).

```bash
cd ~/icforge/dashboard
npm install tailwindcss @tailwindcss/vite
```

Update `vite.config.ts`:

```ts
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
})
```

Replace `index.css` content with:

```css
@import "tailwindcss";
```

Tailwind v4 uses CSS-first configuration — theme customizations go in the CSS file via `@theme`.

## 3. Install shadcn/ui

```bash
cd ~/icforge/dashboard
npx shadcn@latest init
```

When prompted:
- Style: **Default** (or **New York** — both work, Default is cleaner)
- Base color: **Neutral** (matches our current near-black dark theme)
- CSS variables: **Yes**
- TypeScript: **Yes**
- Components directory: `src/components/ui`
- Utils: `src/lib/utils.ts`

This creates:
- `src/components/ui/` — where shadcn components will live
- `src/lib/utils.ts` — `cn()` utility (clsx + tailwind-merge)
- Updates CSS with shadcn's CSS variable theme
- `components.json` — shadcn config

## 4. Install Components We Need

Install all shadcn components we'll use across the spec files:

```bash
npx shadcn@latest add sidebar breadcrumb card badge tabs skeleton \
  button avatar separator collapsible tooltip sonner spinner alert \
  scroll-area
```

This copies component source files into `src/components/ui/`. They're ours to customize.

## 5. Dark Mode Configuration

shadcn/ui supports dark mode via a `dark` class on the root element. Since ICForge is dark-mode-only:

Add `class="dark"` to `<html>` in `index.html`:

```html
<html lang="en" class="dark">
```

The shadcn CSS variables will automatically apply the dark palette.

## 6. Theme Overrides

Customize the shadcn CSS variables to match our current brand colors. In `index.css` (after the `@import "tailwindcss"` line), override the dark theme:

```css
@layer base {
  .dark {
    /* Keep our current aesthetic: near-black bg, blue accent */
    --background: 0 0% 4%;           /* #0a0a0a */
    --foreground: 0 0% 90%;          /* #e5e5e5 */
    --card: 0 0% 7%;                 /* #111111 */
    --card-foreground: 0 0% 90%;
    --popover: 0 0% 10%;             /* #1a1a1a */
    --popover-foreground: 0 0% 90%;
    --primary: 217 91% 60%;          /* #3b82f6 — our accent blue */
    --primary-foreground: 0 0% 100%;
    --secondary: 0 0% 10%;
    --secondary-foreground: 0 0% 90%;
    --muted: 0 0% 10%;
    --muted-foreground: 0 0% 40%;    /* #666666 */
    --accent: 0 0% 10%;
    --accent-foreground: 0 0% 90%;
    --destructive: 0 84% 60%;        /* #ef4444 */
    --destructive-foreground: 0 0% 100%;
    --border: 0 0% 16%;              /* #2a2a2a */
    --input: 0 0% 16%;
    --ring: 217 91% 60%;             /* matches primary */

    /* Custom semantic colors (not in shadcn default) */
    --success: 142 71% 45%;          /* #22c55e */
    --warning: 48 96% 53%;           /* #eab308 */
  }
}
```

## 7. Custom Utilities

Add Tailwind utilities for our semantic status colors (since shadcn doesn't include success/warning):

```css
@theme {
  --color-success: oklch(72% 0.19 142);    /* #22c55e */
  --color-warning: oklch(80% 0.18 85);     /* #eab308 */
}
```

This lets us use `text-success`, `bg-success`, `text-warning`, `bg-warning` in Tailwind classes.

## 8. Font Configuration

Keep Inter (body) + monospace (code). In `index.css`:

```css
@theme {
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", "Fira Code", ui-monospace, monospace;
}
```

## 9. Migration: Remove Old Styles

After shadcn is configured:

1. **Delete** all CSS custom properties from the old `index.css` (replaced by shadcn theme vars)
2. **Delete** all global utility classes (`.container`, `.btn-primary`, `.badge-*`, etc.)
3. **Keep** any animation keyframes that shadcn doesn't provide (e.g., pulse for streaming indicator)
4. **Keep** the old component inline styles temporarily — they'll be removed file-by-file in subsequent specs

The goal is: after this step, the app still works with old inline styles, but Tailwind + shadcn are available for new code.

## 10. Verify

After setup:
- `npm run dev` — app starts without errors
- Pages render (may look slightly different due to CSS reset — that's fine)
- `cn()` utility works: `import { cn } from "@/lib/utils"`
- shadcn components import: `import { Button } from "@/components/ui/button"`
- Tailwind classes work: `<div className="flex gap-4 text-sm">`
- Dark theme applied globally

## 11. Checklist

- [ ] Install `tailwindcss` + `@tailwindcss/vite`
- [ ] Update `vite.config.ts` with Tailwind plugin
- [ ] Run `npx shadcn@latest init` and configure
- [ ] Install shadcn components (sidebar, breadcrumb, card, badge, tabs, skeleton, button, avatar, separator, collapsible, tooltip, sonner, spinner, alert, scroll-area)
- [ ] Add `class="dark"` to `<html>` in `index.html`
- [ ] Override shadcn CSS variables to match ICForge brand colors
- [ ] Add custom `--color-success` and `--color-warning` theme tokens
- [ ] Configure font families (Inter + JetBrains Mono)
- [ ] Clean up old `index.css` (remove old custom properties and global classes)
- [ ] Verify `npm run dev` works, app renders, no console errors
- [ ] Verify a shadcn component renders correctly (e.g., drop a `<Button>` in Landing)
