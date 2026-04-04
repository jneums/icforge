use candid::{CandidType, Decode, Encode, Nat, Principal};
use ic_agent::identity::{BasicIdentity, Secp256k1Identity};
use ic_agent::Agent;
use serde::Deserialize;

use crate::error::AppError;

const MANAGEMENT_CANISTER_ID: &str = "aaaaa-aa";
const CYCLES_LEDGER_ID: &str = "um5iw-rqaaa-aaaaq-qaaba-cai";

/// Default cycles to spend per canister creation (1.3T — covers 1T creation + 0.2T buffer + 0.1T fee)
const DEFAULT_CREATE_CYCLES: u128 = 1_300_000_000_000;

/// Cycles ledger transfer fee
const CYCLES_LEDGER_FEE: u128 = 100_000_000; // 100M cycles

// -- Management canister types --

#[derive(CandidType)]
struct MgmtCanisterSettings {
    controllers: Option<Vec<Principal>>,
    compute_allocation: Option<Nat>,
    memory_allocation: Option<Nat>,
    freezing_threshold: Option<Nat>,
}

#[derive(CandidType, Deserialize)]
struct CreateCanisterResult {
    canister_id: Principal,
}

#[derive(CandidType)]
struct ProvisionalCreateArgs {
    amount: Option<Nat>,
    settings: Option<MgmtCanisterSettings>,
}

#[derive(CandidType)]
struct InstallCodeArgs {
    mode: InstallMode,
    canister_id: Principal,
    wasm_module: Vec<u8>,
    arg: Vec<u8>,
}

#[derive(CandidType, serde::Serialize)]
enum InstallMode {
    #[serde(rename = "install")]
    Install,
    #[serde(rename = "upgrade")]
    Upgrade,
    #[serde(rename = "reinstall")]
    Reinstall,
}

#[derive(CandidType)]
struct CanisterIdRecord {
    canister_id: Principal,
}

#[derive(CandidType, Deserialize, Debug)]
pub struct CanisterStatusResult {
    pub status: CanisterStatus,
    pub module_hash: Option<Vec<u8>>,
    pub memory_size: Nat,
    pub cycles: Nat,
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

// -- Cycles Ledger types (ICRC-1 + extensions) --

#[derive(CandidType)]
struct CyclesAccount {
    owner: Principal,
    subaccount: Option<Vec<u8>>,
}

#[derive(CandidType)]
struct CyclesCreateCanisterArgs {
    from_subaccount: Option<Vec<u8>>,
    created_at_time: Option<u64>,
    amount: Nat,
    creation_args: Option<CmcCreateCanisterArgs>,
}

#[derive(CandidType)]
struct CmcCreateCanisterArgs {
    settings: Option<CyclesCanisterSettings>,
    subnet_selection: Option<CyclesSubnetSelection>,
}

#[derive(CandidType)]
struct CyclesCanisterSettings {
    controllers: Option<Vec<Principal>>,
    compute_allocation: Option<Nat>,
    memory_allocation: Option<Nat>,
    freezing_threshold: Option<Nat>,
}

#[derive(CandidType)]
enum CyclesSubnetSelection {
    Subnet { subnet: Principal },
    Filter(CyclesSubnetFilter),
}

#[derive(CandidType)]
struct CyclesSubnetFilter {
    subnet_type: Option<String>,
}

#[derive(CandidType, Deserialize, Debug)]
struct CyclesCreateSuccess {
    block_id: Nat,
    canister_id: Principal,
}

#[derive(CandidType, Deserialize, Debug)]
enum CyclesRejectionCode {
    NoError,
    CanisterError,
    SysTransient,
    DestinationInvalid,
    Unknown,
    SysFatal,
    CanisterReject,
}

#[derive(CandidType, Deserialize, Debug)]
enum CyclesCreateError {
    InsufficientFunds { balance: Nat },
    TooOld,
    CreatedInFuture { ledger_time: u64 },
    TemporarilyUnavailable,
    Duplicate { duplicate_of: Nat, canister_id: Option<Principal> },
    FailedToCreate { fee_block: Option<Nat>, refund_block: Option<Nat>, error: String },
    GenericError { message: String, error_code: Nat },
}

// Withdraw (top-up existing canister)
#[derive(CandidType)]
struct WithdrawArgs {
    amount: Nat,
    from_subaccount: Option<Vec<u8>>,
    to: Principal,
    created_at_time: Option<u64>,
}

#[derive(CandidType, Deserialize, Debug)]
enum WithdrawError {
    GenericError { message: String, error_code: Nat },
    TemporarilyUnavailable,
    FailedToWithdraw { fee_block: Option<Nat>, rejection_code: CyclesRejectionCode, rejection_reason: String },
    Duplicate { duplicate_of: Nat },
    BadFee { expected_fee: Nat },
    InvalidReceiver { receiver: Principal },
    CreatedInFuture { ledger_time: u64 },
    TooOld,
    InsufficientFunds { balance: Nat },
}

// -- IcClient --

pub struct IcClient {
    agent: Agent,
    is_local: bool,
}

impl IcClient {
    /// Get a reference to the inner Agent.
    pub fn agent(&self) -> &Agent {
        &self.agent
    }

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

    /// Create a new canister on the IC.
    /// On local: uses provisional_create_canister_with_cycles (free).
    /// On mainnet: calls cycles ledger's create_canister (deducts cycles from pool).
    pub async fn create_canister(&self) -> Result<String, AppError> {
        if self.is_local {
            self.create_canister_local().await
        } else {
            self.create_canister_mainnet(DEFAULT_CREATE_CYCLES).await
        }
    }

    async fn create_canister_local(&self) -> Result<String, AppError> {
        let management = Principal::from_text(MANAGEMENT_CANISTER_ID)
            .map_err(|e| AppError::Internal(format!("Invalid management canister ID: {e}")))?;
        let effective = Principal::from_text("rwlgt-iiaaa-aaaaa-aaaaa-cai")
            .map_err(|e| AppError::Internal(format!("Invalid effective canister ID: {e}")))?;

        let args = ProvisionalCreateArgs { amount: None, settings: None };
        let arg_bytes = Encode!(&args)
            .map_err(|e| AppError::Internal(format!("Failed to encode args: {e}")))?;

        let response = self.agent
            .update(&management, "provisional_create_canister_with_cycles")
            .with_arg(arg_bytes)
            .with_effective_canister_id(effective)
            .call_and_wait()
            .await
            .map_err(|e| AppError::Internal(format!("provisional_create failed: {e}")))?;

        let result = Decode!(&response, CreateCanisterResult)
            .map_err(|e| AppError::Internal(format!("Failed to decode response: {e}")))?;

        Ok(result.canister_id.to_text())
    }

    /// Create canister via cycles ledger (mainnet).
    /// The cycles ledger deducts `amount` + 100M fee from the caller's balance,
    /// then sends `amount` cycles to the CMC to create the canister.
    async fn create_canister_mainnet(&self, amount: u128) -> Result<String, AppError> {
        let ledger = Principal::from_text(CYCLES_LEDGER_ID)
            .map_err(|e| AppError::Internal(format!("Invalid cycles ledger ID: {e}")))?;

        let controller = self.identity_principal();
        tracing::info!(
            principal = %controller,
            amount = amount,
            ledger = %ledger,
            "Calling cycles ledger create_canister"
        );

        let args = CyclesCreateCanisterArgs {
            from_subaccount: None,
            created_at_time: None,
            amount: Nat::from(amount),
            creation_args: Some(CmcCreateCanisterArgs {
                settings: Some(CyclesCanisterSettings {
                    controllers: Some(vec![controller]),
                    compute_allocation: None,
                    memory_allocation: None,
                    freezing_threshold: None,
                }),
                subnet_selection: None,
            }),
        };
        let arg_bytes = Encode!(&args)
            .map_err(|e| AppError::Internal(format!("Failed to encode create_canister args: {e}")))?;

        let response = self.agent
            .update(&ledger, "create_canister")
            .with_arg(arg_bytes)
            .call_and_wait()
            .await
            .map_err(|e| AppError::Internal(format!("cycles ledger create_canister failed: {e}")))?;

        // Decode Result variant: Ok(CreateCanisterSuccess) | Err(CreateCanisterError)
        let result = Decode!(&response, Result<CyclesCreateSuccess, CyclesCreateError>)
            .map_err(|e| AppError::Internal(format!("Failed to decode create_canister response: {e}")))?;

        match result {
            Ok(success) => Ok(success.canister_id.to_text()),
            Err(err) => Err(AppError::Internal(format!("Cycles ledger create_canister error: {err:?}"))),
        }
    }

    /// Install or upgrade code on a canister.
    /// If `init_arg` is Some, it is used as the raw candid arg bytes;
    /// otherwise an empty arg is sent.
    pub async fn install_code(
        &self,
        canister_id_text: &str,
        wasm: Vec<u8>,
        is_upgrade: bool,
        init_arg: Option<Vec<u8>>,
    ) -> Result<(), AppError> {
        let management = Principal::from_text(MANAGEMENT_CANISTER_ID)
            .map_err(|e| AppError::Internal(format!("Invalid management canister ID: {e}")))?;

        let canister_id = Principal::from_text(canister_id_text)
            .map_err(|e| AppError::Internal(format!("Invalid canister ID '{canister_id_text}': {e}")))?;

        let mode = if is_upgrade { InstallMode::Upgrade } else { InstallMode::Install };

        let arg = match init_arg {
            Some(bytes) => bytes,
            None => Encode!()
                .map_err(|e| AppError::Internal(format!("Failed to encode empty arg: {e}")))?,
        };

        let args = InstallCodeArgs {
            mode,
            canister_id,
            wasm_module: wasm,
            arg,
        };

        let arg_bytes = Encode!(&args)
            .map_err(|e| AppError::Internal(format!("Failed to encode install_code args: {e}")))?;

        self.agent
            .update(&management, "install_code")
            .with_arg(arg_bytes)
            .with_effective_canister_id(canister_id)
            .call_and_wait()
            .await
            .map_err(|e| AppError::Internal(format!("install_code call failed: {e}")))?;

        Ok(())
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

    /// Top up an existing canister with cycles via the cycles ledger's withdraw endpoint.
    /// `amount` is the number of cycles to send (fee of 100M is deducted separately).
    pub async fn top_up_canister(
        &self,
        canister_id_text: &str,
        amount: u128,
    ) -> Result<(), AppError> {
        let ledger = Principal::from_text(CYCLES_LEDGER_ID)
            .map_err(|e| AppError::Internal(format!("Invalid cycles ledger ID: {e}")))?;

        let to = Principal::from_text(canister_id_text)
            .map_err(|e| AppError::Internal(format!("Invalid canister ID '{canister_id_text}': {e}")))?;

        let args = WithdrawArgs {
            amount: Nat::from(amount),
            from_subaccount: None,
            to,
            created_at_time: None,
        };
        let arg_bytes = Encode!(&args)
            .map_err(|e| AppError::Internal(format!("Failed to encode withdraw args: {e}")))?;

        let response = self.agent
            .update(&ledger, "withdraw")
            .with_arg(arg_bytes)
            .call_and_wait()
            .await
            .map_err(|e| AppError::Internal(format!("cycles ledger withdraw failed: {e}")))?;

        let result = Decode!(&response, Result<Nat, WithdrawError>)
            .map_err(|e| AppError::Internal(format!("Failed to decode withdraw response: {e}")))?;

        match result {
            Ok(_block_index) => Ok(()),
            Err(err) => Err(AppError::Internal(format!("Cycles ledger withdraw error: {err:?}"))),
        }
    }
}
