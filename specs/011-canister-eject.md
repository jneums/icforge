# ICForge — Canister Eject (Control Transfer)

**Status:** Draft v0.2
**Parent:** 001-architecture.md
**Milestone:** v0.3
**Replaces:** Identity Export (v0.1) — per-user custodial identities were removed in favor of a single platform identity model.

---

## 1. Goal

Let users take full ownership of their canisters by transferring controller status to their own IC principal. After ejecting, the user manages their canisters directly with `dfx` or `icp-cli`, independent of ICForge.

## 2. Why This Matters

ICForge's platform identity is the sole controller of all canisters it creates. If a user wants to leave ICForge — or manage their canisters directly — they need a way to take ownership. Eject is the **trust feature** that signals ICForge is a tool, not a walled garden.

Unlike the old identity export model (which required per-user key generation, encryption at rest, and PEM custody), eject is simple: the user provides a principal, we transfer control. No key management on our end.

## 3. How It Works

```
User provides their IC principal
     ↓
ICForge calls update_settings() on each canister:
  - Add user's principal as controller
  - Remove ICForge's principal as controller
     ↓
Canister is now fully owned by the user
ICForge marks the project as "ejected"
```

**This is a one-way operation.** Once ICForge removes itself as controller, it can no longer deploy to, upgrade, or manage those canisters. The user must re-link via `icforge link` if they want ICForge management again (which requires them to add ICForge's principal back as controller).

## 4. User Flow

### Dashboard

Settings → Project Settings → Eject:

```
┌──────────────────────────────────────────────┐
│ Eject Project                                 │
│                                               │
│ ⚠️ This will transfer full control of your   │
│ canister(s) to your IC principal. ICForge     │
│ will no longer be able to deploy or manage    │
│ these canisters.                              │
│                                               │
│ Canisters to transfer:                        │
│   • xh5m6-qyaaa-aaaaj-qrsla-cai (frontend)  │
│                                               │
│ Your IC Principal:                            │
│ ┌──────────────────────────────────────────┐  │
│ │                                          │  │
│ └──────────────────────────────────────────┘  │
│                                               │
│ After ejecting, you can manage with dfx:      │
│ $ dfx canister status xh5m6-qyaaa-...        │
│                                               │
│ [Eject & Transfer Control]                    │
└──────────────────────────────────────────────┘
```

Clicking "Eject & Transfer Control":
1. Validates the provided principal format
2. Requires re-authentication (GitHub OAuth re-consent)
3. Calls `update_settings` on each canister to swap controllers
4. Marks project as ejected in database
5. Logs the event

### CLI

```bash
icforge eject --principal <your-principal>
# → Transferring control of 1 canister(s)...
# → ✓ xh5m6-qyaaa-aaaaj-qrsla-cai → controller: <your-principal>
# → Project "hello-world" ejected from ICForge.
#
# ⚠️  ICForge can no longer deploy to these canisters.
#     To re-link, add ICForge's principal as controller and run:
#     icforge link --canister xh5m6-qyaaa-aaaaj-qrsla-cai
```

Getting your principal (shown in eject help text):
```bash
dfx identity get-principal
# or
icp identity get-principal
```

## 5. API Endpoint

```
POST /api/v1/projects/:id/eject
  Headers: Authorization: Bearer ***
  Body: { "principal": "2vxsx-fae..." }
  Returns: {
    "ejected": true,
    "canisters": [
      { "canister_id": "xh5m6-qyaaa-...", "new_controller": "2vxsx-fae..." }
    ]
  }
```

### Validation
- Principal must be valid IC principal format
- Project must have at least one canister
- Project must not already be ejected
- Require re-authentication token

## 6. IC Management Canister Calls

For each canister in the project:

```rust
// 1. Add user as controller, remove ICForge
let update = UpdateSettingsArgs {
    canister_id: canister_principal,
    settings: CanisterSettings {
        controllers: Some(vec![user_principal]), // user only, ICForge removed
        ..Default::default()
    },
};
management_canister.update_settings(update).await?;
```

**Important:** This must be done as a single `update_settings` call that sets the new controller list — not as separate add/remove operations. The IC management canister replaces the entire controller list atomically.

## 7. Database Changes

No new tables needed. Add status tracking to existing projects:

```sql
-- Add eject status to projects
ALTER TABLE projects ADD COLUMN ejected_at TEXT;
ALTER TABLE projects ADD COLUMN ejected_to_principal TEXT;
```

Ejected projects:
- Remain visible in the dashboard (read-only, historical deploys)
- Cannot receive new deployments
- Show "Ejected" badge with the target principal
- Can be deleted by the user (removes ICForge records, canisters unaffected)

## 8. Audit Log

Use the general audit log (same table as other sensitive actions):

```sql
-- Already defined in 001-architecture
INSERT INTO audit_log (id, user_id, action, metadata, ip_address, user_agent, created_at)
VALUES ($1, $2, 'project_eject', '{"project_id": "...", "canisters": [...], "to_principal": "..."}', ...);
```

## 9. Implementation Checklist

### Backend
- [ ] `POST /api/v1/projects/:id/eject` endpoint
- [ ] Principal format validation
- [ ] Re-authentication flow
- [ ] IC management canister `update_settings` call
- [ ] Mark project as ejected in database
- [ ] Migration: add `ejected_at`, `ejected_to_principal` columns
- [ ] Audit log entry
- [ ] Block deploys to ejected projects

### Dashboard
- [ ] Eject UI on project settings page
- [ ] Principal input with format validation
- [ ] Re-auth redirect flow
- [ ] Confirmation dialog with canister list
- [ ] "Ejected" badge on project card

### CLI
- [ ] `icforge eject --principal <principal>` command
- [ ] Show ICForge's principal in help (so user knows what to re-add for `link`)
- [ ] Confirmation prompt
- [ ] Print post-eject instructions

## 10. Future Considerations

- **Partial eject:** Transfer control of individual canisters within a multi-canister project, keeping others managed by ICForge.
- **Re-link flow:** Streamline the process of adding ICForge back as controller after an eject (currently manual `dfx` + `icforge link`).
- **Shared control:** Instead of full eject, add the user as a co-controller while keeping ICForge — useful for advanced users who want direct canister access without leaving the platform.
