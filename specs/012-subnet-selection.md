# ICForge — Subnet Selection

**Status:** Draft v0.1
**Parent:** 001-architecture.md
**Milestone:** v0.3

---

## 1. Goal

Let users choose which IC subnet their canisters are created on. This is a power-user feature for latency optimization, compliance requirements, or future Cloud Engine targeting.

## 2. Background

By default, the IC's CMC (Cycles Minting Canister) picks a subnet automatically when creating a canister. But users may want to specify a subnet for:

- **Geographic latency:** Pick a subnet with nodes closer to their users
- **Application subnet type:** Some subnets are optimized for storage, others for compute
- **Compliance:** Future Cloud Engines may be jurisdiction-specific
- **Colocation:** Multiple canisters on the same subnet for faster inter-canister calls

## 3. Current State

- `IcClient::create_canister_mainnet()` already has `CyclesSubnetSelection` in its types
- The `subnet_selection` field is currently set to `None`
- `projects` table has `subnet_id TEXT` column
- `canisters` table has `subnet_id TEXT` column
- `icp.yaml` could support a `subnet` field (not yet parsed)

Most of the plumbing exists. Just need to wire it through.

## 4. Configuration

### 4.1 In `icp.yaml`

```yaml
# Project-level default
subnet: pzp6e-ekpqk-3c5x7-2h6so-njoeq-mt45d-h3h6c-q3mxf-vpeez-fbd5g-vae

canisters:
  - name: backend
    type: rust
    # Per-canister override
    subnet: uzr34-akd3s-xrdag-3ql62-ocgoh-ber6j-od2vf-p6pop-dahu5-fwced-cae
    
  - name: frontend
    type: assets
    # Inherits project-level subnet
```

### 4.2 In dashboard

ProjectDetail → Settings:
```
Subnet: [dropdown or text input with subnet principal]
         [Use default (IC-selected)] ← radio button
         [Specific subnet: _______ ] ← radio button + input
```

### 4.3 Via CLI

```bash
icforge config set subnet pzp6e-ekpqk-...
# or in icp.yaml
```

## 5. How It Works

When `create_canister_mainnet()` is called, pass the subnet selection:

```rust
let subnet_selection = subnet_id.map(|id| {
    let subnet = Principal::from_text(&id).expect("valid subnet principal");
    CyclesSubnetSelection::Subnet { subnet }
});

let args = CyclesCreateCanisterArgs {
    // ...
    creation_args: Some(CmcCreateCanisterArgs {
        settings: Some(/* ... */),
        subnet_selection,
    }),
};
```

This is already structurally supported in `ic_client.rs` — just needs the value threaded through from the deploy request.

## 6. Subnet Discovery

Users need to know what subnets exist. Options:

1. **Link to IC Dashboard:** `https://dashboard.internetcomputer.org/subnets` — lists all subnets with metadata
2. **API endpoint:** `GET /api/v1/subnets` — ICForge queries the IC NNS registry and returns a list of subnets with metadata (node count, type, geographic distribution)
3. **Hardcoded list:** Maintain a curated list of recommended subnets

**Decision: Option 1 for v0.3 (link to IC dashboard), Option 2 for v0.4.** Building a subnet discovery API is nice but not essential — power users who want subnet selection already know what subnet they want.

## 7. Implementation Checklist

### Backend
- [ ] Thread `subnet_id` from deploy request → `create_canister_mainnet()`
- [ ] Accept `subnet_id` in create project / update project endpoints
- [ ] Pass subnet selection to cycles ledger `create_canister` call
- [ ] Validate subnet ID is a valid Principal format

### CLI
- [ ] Parse `subnet` from `icp.yaml` (project-level and per-canister)
- [ ] Send subnet_id in deploy request
- [ ] `icforge config set subnet <principal>` command

### Dashboard
- [ ] Subnet setting on ProjectDetail settings panel
- [ ] Link to IC Dashboard subnet explorer

### icp.yaml
- [ ] Document `subnet` field at project and canister level

## 8. Future (v0.5)

Subnet selection generalizes to **Cloud Engine targeting** — instead of picking a public subnet, users pick a Cloud Engine (which is essentially a private subnet). The `subnet_id` field and plumbing built here will be reused for Cloud Engine support.
