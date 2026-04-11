use candid::{CandidType, Decode, Encode, Nat, Principal};
use ic_agent::identity::{BasicIdentity, Secp256k1Identity};
use ic_agent::Agent;
use serde::Deserialize;

use crate::error::AppError;

const MANAGEMENT_CANISTER_ID: &str = "aaaaa-aa";
const CYCLES_LEDGER_ID: &str = "um5iw-rqaaa-aaaaq-qaaba-cai";

// -- Management canister types --

#[derive(CandidType)]
struct CanisterIdRecord {
    canister_id: Principal,
}

#[derive(CandidType, Deserialize, Debug, Clone, serde::Serialize)]
pub struct EnvironmentVariableResult {
    pub name: String,
    pub value: String,
}

#[derive(CandidType, Deserialize, Debug)]
pub struct QueryStats {
    pub num_calls_total: Nat,
    pub num_instructions_total: Nat,
    pub request_payload_bytes_total: Nat,
    pub response_payload_bytes_total: Nat,
}

#[derive(CandidType, Deserialize, Debug)]
pub struct MemoryMetrics {
    pub wasm_memory_size: Nat,
    pub stable_memory_size: Nat,
    pub global_memory_size: Nat,
    pub canister_history_size: Nat,
    pub snapshots_size: Nat,
}

#[derive(CandidType, Deserialize, Debug)]
pub struct CanisterStatusResult {
    pub status: CanisterStatus,
    pub settings: CanisterStatusSettings,
    pub module_hash: Option<Vec<u8>>,
    pub memory_size: Nat,
    pub cycles: Nat,
    pub reserved_cycles: Nat,
    pub idle_cycles_burned_per_day: Nat,
    pub query_stats: QueryStats,
    pub memory_metrics: Option<MemoryMetrics>,
}

#[derive(CandidType, Deserialize, Debug)]
pub struct CanisterStatusSettings {
    pub controllers: Vec<Principal>,
    pub compute_allocation: Nat,
    pub memory_allocation: Nat,
    pub freezing_threshold: Nat,
    pub reserved_cycles_limit: Nat,
    pub wasm_memory_limit: Nat,
    pub wasm_memory_threshold: Nat,
    pub log_visibility: CandidLogVisibility,
    pub environment_variables: Option<Vec<EnvironmentVariableResult>>,
}

#[derive(CandidType, Deserialize, Debug)]
pub enum CandidLogVisibility {
    #[serde(rename = "controllers")]
    Controllers,
    #[serde(rename = "public")]
    Public,
    #[serde(rename = "allowed_viewers")]
    AllowedViewers(Vec<Principal>),
}

#[derive(CandidType, Deserialize, Debug)]
pub enum CanisterStatus {
    #[serde(rename = "running")]
    Running,
    #[serde(rename = "stopping")]
    Stopping,
    #[serde(rename = "stopped")]
    Stopped,
}

// -- Cycles Ledger types --

#[derive(CandidType)]
struct CyclesAccount {
    owner: Principal,
    subaccount: Option<Vec<u8>>,
}

/// deposit_cycles arg: specify the canister to receive cycles.
#[derive(CandidType)]
struct DepositCyclesArg {
    canister_id: Principal,
}

// -- IcClient --

pub struct IcClient {
    agent: Agent,
    is_local: bool,
}

impl IcClient {
    /// Create a new IcClient from a PEM-encoded identity.
    /// Supports both Ed25519 (BasicIdentity) and secp256k1 key types.
    pub async fn new(identity_pem: &str, ic_url: &str) -> Result<Self, AppError> {
        // Try Ed25519 first, then secp256k1 — icp CLI generates secp256k1 by default
        let agent = if let Ok(identity) = BasicIdentity::from_pem(identity_pem.as_bytes()) {
            tracing::info!("IC identity parsed as Ed25519 (BasicIdentity)");
            Agent::builder()
                .with_url(ic_url)
                .with_identity(identity)
                .build()
                .map_err(|e| AppError::Internal(format!("Failed to build IC agent: {e}")))?
        } else if let Ok(identity) = Secp256k1Identity::from_pem(identity_pem.as_bytes()) {
            tracing::info!("IC identity parsed as secp256k1");
            Agent::builder()
                .with_url(ic_url)
                .with_identity(identity)
                .build()
                .map_err(|e| AppError::Internal(format!("Failed to build IC agent: {e}")))?
        } else {
            return Err(AppError::Internal(
                "Failed to parse PEM identity: not a valid Ed25519 or secp256k1 key".to_string(),
            ));
        };

        let is_local = !ic_url.contains("ic0.app") && !ic_url.contains("icp0.io");
        if is_local {
            agent.fetch_root_key().await
                .map_err(|e| AppError::Internal(format!("Failed to fetch root key from {ic_url}: {e}")))?;
        }

        let principal = agent.get_principal().expect("agent has identity");
        tracing::info!(principal = %principal, is_local = is_local, ic_url = ic_url, "IcClient initialized");

        Ok(Self { agent, is_local })
    }

    /// Get the principal of the identity this client is using.
    pub fn identity_principal(&self) -> Principal {
        self.agent.get_principal().expect("agent has identity")
    }

    /// Check cycles balance on the cycles ledger for the agent's principal.
    pub async fn cycles_balance(&self) -> Result<u128, AppError> {
        let ledger = Principal::from_text(CYCLES_LEDGER_ID)
            .map_err(|e| AppError::Internal(format!("Invalid cycles ledger ID: {e}")))?;

        let account = CyclesAccount {
            owner: self.identity_principal(),
            subaccount: None,
        };
        let arg_bytes = Encode!(&account)
            .map_err(|e| AppError::Internal(format!("Failed to encode icrc1_balance_of args: {e}")))?;

        let response = self.agent
            .query(&ledger, "icrc1_balance_of")
            .with_arg(arg_bytes)
            .call()
            .await
            .map_err(|e| AppError::Internal(format!("icrc1_balance_of query failed: {e}")))?;

        let balance = Decode!(&response, Nat)
            .map_err(|e| AppError::Internal(format!("Failed to decode balance: {e}")))?;

        // Convert candid::Nat to u128
        Ok(balance.0.try_into().unwrap_or(u128::MAX))
    }

    /// Check the status of a canister.
    pub async fn canister_status(
        &self,
        canister_id_text: &str,
    ) -> Result<CanisterStatusResult, AppError> {
        let management = Principal::from_text(MANAGEMENT_CANISTER_ID)
            .map_err(|e| AppError::Internal(format!("Invalid management canister ID: {e}")))?;

        let canister_id = Principal::from_text(canister_id_text)
            .map_err(|e| AppError::Internal(format!("Invalid canister ID '{canister_id_text}': {e}")))?;

        let args = CanisterIdRecord { canister_id };
        let arg_bytes = Encode!(&args)
            .map_err(|e| AppError::Internal(format!("Failed to encode canister_status args: {e}")))?;

        let response = self.agent
            .update(&management, "canister_status")
            .with_arg(arg_bytes)
            .with_effective_canister_id(canister_id)
            .call_and_wait()
            .await
            .map_err(|e| AppError::Internal(format!("canister_status call failed: {e}")))?;

        let result = Decode!(&response, CanisterStatusResult)
            .map_err(|e| AppError::Internal(format!("Failed to decode canister_status response: {e}")))?;

        Ok(result)
    }

    /// Deposit cycles from the caller (platform identity) into a target canister.
    /// Uses the management canister `deposit_cycles` method.
    /// The caller must hold enough cycles in its account.
    pub async fn deposit_cycles(
        &self,
        canister_id_text: &str,
        amount: u128,
    ) -> Result<(), AppError> {
        let management = Principal::from_text(MANAGEMENT_CANISTER_ID)
            .map_err(|e| AppError::Internal(format!("Invalid management canister ID: {e}")))?;

        let canister_id = Principal::from_text(canister_id_text)
            .map_err(|e| AppError::Internal(format!("Invalid canister ID '{canister_id_text}': {e}")))?;

        let args = DepositCyclesArg { canister_id };
        let arg_bytes = Encode!(&args)
            .map_err(|e| AppError::Internal(format!("Failed to encode deposit_cycles args: {e}")))?;

        self.agent
            .update(&management, "deposit_cycles")
            .with_arg(arg_bytes)
            .with_effective_canister_id(canister_id)
            // Attach cycles to the call
            .call_and_wait()
            .await
            .map_err(|e| AppError::Internal(format!("deposit_cycles call failed: {e}")))?;

        tracing::info!(
            canister_id = canister_id_text,
            amount = amount,
            "Deposited cycles into canister"
        );

        Ok(())
    }
}
