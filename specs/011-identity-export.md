# ICForge — Identity Export

**Status:** Draft v0.1
**Parent:** 001-architecture.md
**Milestone:** v0.3

---

## 1. Goal

Let users export their IC identity (private key) so they can manage their canisters directly with `dfx` or `icp` CLI, independent of ICForge. This is critical for trust — users must never feel locked in.

## 2. Why This Matters

ICForge generates and stores an Ed25519 keypair per user (in `identity.rs`). This identity is the controller of all canisters created for that user. If ICForge disappeared tomorrow, users would lose access to their canisters unless they have the private key.

Identity export is a **trust feature** — it signals that ICForge is a tool, not a walled garden.

## 3. Security Considerations

The PEM-encoded private key is stored in the `users.ic_identity_pem` column. Exporting it is high-risk:

1. **Anyone with the PEM controls all the user's canisters**
2. **The export endpoint must be heavily protected**
3. **The key should only be transmitted once, then the user is responsible**

### Mitigations

- Require re-authentication before export (GitHub OAuth re-auth or password confirmation)
- Rate limit: 1 export per hour per user
- Log all export events
- Show a warning: "This key controls all your ICForge canisters. Store it securely."
- Optionally: require email confirmation before revealing the key

## 4. Export Formats

| Format | Use With | Notes |
|--------|----------|-------|
| **PEM file** | `dfx identity import`, `icp` CLI, ic-agent | Standard PKCS#8 PEM, most compatible |
| **Seed phrase** | Not applicable | Ed25519 keys don't have BIP39 seeds (unless we switch to secp256k1 + derivation) |

**Decision: PEM export only.** It's what IC tooling expects.

## 5. User Flow

### Dashboard

Settings → Security → Export Identity:

```
┌──────────────────────────────────────────────┐
│ Export IC Identity                             │
│                                               │
│ ⚠️ This private key controls ALL canisters    │
│ deployed through ICForge. Store it securely.  │
│                                               │
│ Principal: 2vxsx-fae...                       │
│                                               │
│ To export, you'll need to re-verify your      │
│ GitHub account.                               │
│                                               │
│ [Export Private Key]                           │
│                                               │
│ After exporting, you can import it into dfx:  │
│ $ dfx identity import icforge ./identity.pem  │
│ $ icp identity import icforge ./identity.pem  │
└──────────────────────────────────────────────┘
```

Clicking "Export Private Key":
1. Triggers GitHub OAuth re-auth (same flow as login, but with `prompt=consent`)
2. On success, displays the PEM in a copy-able text box + download button
3. PEM is shown ONCE — user must copy or download immediately
4. Log the export event

### CLI

```bash
icforge identity export
# → Re-authenticate with GitHub...
# → Opening browser for verification...
# → Identity exported to ./icforge-identity.pem
# → Principal: 2vxsx-fae...
#
# ⚠️  This key controls all your ICForge canisters.
#     Store it securely and never share it.
```

## 6. API Endpoint

```
POST /api/v1/identity/export
  Headers: Authorization: Bearer <jwt>
  Body: { verification_token: "..." }  -- from re-auth flow
  Returns: { pem: "-----BEGIN PRIVATE KEY-----\n...", principal: "2vxsx-fae..." }
```

The `verification_token` is a short-lived token issued after successful re-authentication, proving the user just verified their identity.

## 7. Audit Log

Track all identity exports:

```sql
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,  -- 'identity_export', etc.
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);
```

This table is useful beyond identity export — it's a general audit trail for sensitive actions.

## 8. Implementation Checklist

### Backend
- [ ] `POST /api/v1/identity/export` endpoint
- [ ] Re-authentication flow (GitHub OAuth with `prompt=consent`)
- [ ] Verification token generation + validation
- [ ] Rate limiting (1 export/hour)
- [ ] Audit log table + migration
- [ ] Log export events
- [ ] Return PEM + principal

### Dashboard
- [ ] Export Identity UI on Settings page
- [ ] Re-auth redirect flow
- [ ] PEM display with copy + download buttons
- [ ] Warning text

### CLI
- [ ] `icforge identity export` command
- [ ] Re-auth browser flow
- [ ] Save PEM to file
- [ ] Print warning

## 9. Future Considerations

- **Key rotation:** Let users generate a new identity and migrate canister controllers. Complex but important for key compromise scenarios.
- **Multi-key:** Support multiple IC identities per user (e.g., separate keys for different projects).
- **Hardware key support:** If IC supports hardware security keys (WebAuthn), ICForge could generate keys on a hardware token instead of software PEM.
