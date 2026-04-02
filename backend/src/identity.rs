use crate::error::AppError;
use ic_agent::identity::BasicIdentity;
use ic_agent::Identity;
use ring::signature::Ed25519KeyPair;

/// Generates an Ed25519 keypair and returns (pem_string, principal_text).
pub fn generate_identity() -> Result<(String, String), AppError> {
    // Generate Ed25519 keypair using ring
    let rng = ring::rand::SystemRandom::new();
    let pkcs8_bytes = Ed25519KeyPair::generate_pkcs8(&rng)
        .map_err(|e| AppError::Internal(format!("Failed to generate Ed25519 keypair: {e}")))?;

    // Encode as PEM
    let pem_obj = pem::Pem::new("PRIVATE KEY", pkcs8_bytes.as_ref().to_vec());
    let pem_string = pem::encode(&pem_obj);

    // Derive principal using ic-agent's BasicIdentity
    let identity = BasicIdentity::from_pem(pem_string.as_bytes())
        .map_err(|e| AppError::Internal(format!("Failed to create BasicIdentity: {e}")))?;

    let principal = identity.sender()
        .map_err(|e| AppError::Internal(format!("Failed to get principal: {e}")))?;
    let principal_text = principal.to_text();

    Ok((pem_string, principal_text))
}
