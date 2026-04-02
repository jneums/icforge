use candid::{CandidType, Decode, Encode, Principal};
use ic_agent::agent::http_transport::reqwest_transport::ReqwestTransport;
use ic_agent::identity::BasicIdentity;
use ic_agent::Agent;
use serde::Deserialize;

use crate::error::AppError;

const IC_URL: &str = "https://ic0.app";
const MANAGEMENT_CANISTER_ID: &str = "aaaaa-aa";

/// Wrapper around ic-agent for IC management canister interactions.
pub struct IcClient {
    agent: Agent,
}

// -- Candid types for management canister calls --

#[derive(CandidType)]
struct CreateCanisterArgs {
    settings: Option<CanisterSettings>,
}

#[derive(CandidType)]
struct CanisterSettings {
    controllers: Option<Vec<Principal>>,
    compute_allocation: Option<candid::Nat>,
    memory_allocation: Option<candid::Nat>,
    freezing_threshold: Option<candid::Nat>,
}

#[derive(CandidType, Deserialize)]
struct CreateCanisterResult {
    canister_id: Principal,
}

#[derive(CandidType)]
struct InstallCodeArgs {
    mode: InstallMode,
    canister_id: Principal,
    wasm_module: Vec<u8>,
    arg: Vec<u8>,
}

#[derive(CandidType)]
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
    pub memory_size: candid::Nat,
    pub cycles: candid::Nat,
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

impl IcClient {
    /// Create a new IcClient from a PEM-encoded identity.
    pub async fn new(identity_pem: &str) -> Result<Self, AppError> {
        let identity = BasicIdentity::from_pem(identity_pem.as_bytes())
            .map_err(|e| AppError::Internal(format!("Failed to parse PEM identity: {e}")))?;

        let transport = ReqwestTransport::create(IC_URL)
            .map_err(|e| AppError::Internal(format!("Failed to create transport: {e}")))?;

        let agent = Agent::builder()
            .with_transport(transport)
            .with_identity(identity)
            .build()
            .map_err(|e| AppError::Internal(format!("Failed to build IC agent: {e}")))?;

        // Do NOT call agent.fetch_root_key() on mainnet

        Ok(Self { agent })
    }

    /// Create a new canister on the IC via the management canister.
    /// Returns the canister ID as a text string.
    pub async fn create_canister(&self) -> Result<String, AppError> {
        let management = Principal::from_text(MANAGEMENT_CANISTER_ID)
            .map_err(|e| AppError::Internal(format!("Invalid management canister ID: {e}")))?;

        let args = CreateCanisterArgs { settings: None };
        let arg_bytes = Encode!(&args)
            .map_err(|e| AppError::Internal(format!("Failed to encode create_canister args: {e}")))?;

        let response = self
            .agent
            .update(&management, "create_canister")
            .with_arg(arg_bytes)
            .call_and_wait()
            .await
            .map_err(|e| AppError::Internal(format!("create_canister call failed: {e}")))?;

        let result = Decode!(&response, CreateCanisterResult)
            .map_err(|e| AppError::Internal(format!("Failed to decode create_canister response: {e}")))?;

        Ok(result.canister_id.to_text())
    }

    /// Install or upgrade code on a canister.
    pub async fn install_code(
        &self,
        canister_id_text: &str,
        wasm: Vec<u8>,
        is_upgrade: bool,
    ) -> Result<(), AppError> {
        let management = Principal::from_text(MANAGEMENT_CANISTER_ID)
            .map_err(|e| AppError::Internal(format!("Invalid management canister ID: {e}")))?;

        let canister_id = Principal::from_text(canister_id_text)
            .map_err(|e| AppError::Internal(format!("Invalid canister ID '{}': {e}", canister_id_text)))?;

        let mode = if is_upgrade {
            InstallMode::Upgrade
        } else {
            InstallMode::Install
        };

        let args = InstallCodeArgs {
            mode,
            canister_id,
            wasm_module: wasm,
            arg: Encode!()
                .map_err(|e| AppError::Internal(format!("Failed to encode empty arg: {e}")))?,
        };

        let arg_bytes = Encode!(&args)
            .map_err(|e| AppError::Internal(format!("Failed to encode install_code args: {e}")))?;

        self.agent
            .update(&management, "install_code")
            .with_arg(arg_bytes)
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
            .map_err(|e| AppError::Internal(format!("Invalid canister ID '{}': {e}", canister_id_text)))?;

        let args = CanisterIdRecord { canister_id };
        let arg_bytes = Encode!(&args)
            .map_err(|e| AppError::Internal(format!("Failed to encode canister_status args: {e}")))?;

        let response = self
            .agent
            .update(&management, "canister_status")
            .with_arg(arg_bytes)
            .call_and_wait()
            .await
            .map_err(|e| AppError::Internal(format!("canister_status call failed: {e}")))?;

        let result = Decode!(&response, CanisterStatusResult)
            .map_err(|e| AppError::Internal(format!("Failed to decode canister_status response: {e}")))?;

        Ok(result)
    }
}
