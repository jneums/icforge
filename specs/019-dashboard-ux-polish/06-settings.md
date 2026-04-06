# 06 — Settings

**Scope:** Polish the `/settings` page
**Priority:** P2
**Depends on:** 01-design-system, 02-navigation
**Estimated effort:** Small

---

## 1. Problem

The current Settings page is minimal: profile info, plan badge, and two "Coming soon" placeholders. The layout is functional but needs polish for the new design system and better placeholder states for features coming in v0.3.

## 2. Target Layout

Follow Render's card-based settings pattern: stacked sections, each in a card.

```
┌──────────────────────────────────────────────────────────────┐
│  Settings                                                    │
│                                                              │
│  ┌─ Profile ────────────────────────────────────────────────┐│
│  │                                                          ││
│  │  🟣 JN     Jesse Neumann                                ││
│  │            jesse@example.com                             ││
│  │                                                          ││
│  │  GitHub     jneums ↗                                     ││
│  │  Member     Since March 2025                             ││
│  │  User ID    usr_abc123                                   ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌─ Plan ───────────────────────────────────────────────────┐│
│  │                                                          ││
│  │  Current Plan     Free ▪                                 ││
│  │  Canisters        3 / unlimited                          ││
│  │                                                          ││
│  │  Billing coming in v0.3                                  ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌─ API Tokens ─────────────────────────────────────────────┐│
│  │                                                          ││
│  │  🔑  Manage API tokens for CI/CD integrations            ││
│  │      Coming in v0.3                                      ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌─ Canister Eject ─── danger ──────────────────────────────┐│
│  │                                                          ││
│  │  Transfer canister ownership to your own controller.     ││
│  │  This removes ICForge's ability to manage the canister.  ││
│  │                                                          ││
│  │  Coming in v0.3                          [ Eject... ]    ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

## 3. Section Details

### 3.1 Profile Card
- Avatar: letter-based placeholder (existing), or GitHub avatar if available
- Name + email (primary + secondary text)
- Key-value pairs: GitHub username (linked), member since, user ID (mono, copyable)

### 3.2 Plan Card
- Current plan name + badge
- Usage summary (canister count)
- Muted note about billing coming in v0.3
- No upgrade button yet — just informational

### 3.3 API Tokens Card
- Icon + description
- "Coming in v0.3" badge
- Disabled state — card is slightly dimmed

### 3.4 Canister Eject Card (Danger Zone)
- Render-style danger zone at bottom
- Red-tinted border (`var(--error)` at low opacity)
- Description of what ejecting does
- Disabled "Eject" button with "Coming in v0.3" label
- This will eventually list each canister with an individual eject button

## 4. Danger Zone CSS

```css
.card--danger {
  border-color: rgba(239, 68, 68, 0.3);
}

.card--danger .card-title {
  color: var(--error);
}
```

## 5. Checklist

- [ ] Rewrite Settings.tsx using card sections
- [ ] Style profile section with avatar + key-value pairs
- [ ] Style plan section with badge + usage info
- [ ] Style API tokens section as disabled placeholder
- [ ] Style canister eject section as danger zone placeholder
- [ ] Add GitHub avatar URL to profile (if available from API)
- [ ] Link GitHub username to github.com profile
- [ ] Migrate from inline styles to CSS classes
