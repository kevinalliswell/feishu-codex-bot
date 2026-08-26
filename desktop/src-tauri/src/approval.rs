use std::collections::HashMap;
use std::time::{Duration, SystemTime};

use serde::Serialize;
use uuid::Uuid;

const APPROVAL_TTL: Duration = Duration::from_secs(5 * 60);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingApproval {
    pub id: String,
    pub requester: String,
    pub prompt: String,
    pub root_path: String,
    pub expires_at_ms: u128,
    #[serde(skip)]
    expires_at: SystemTime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalDecision {
    Approved,
    Rejected,
    Expired,
    Missing,
}

#[derive(Default)]
pub struct ApprovalStore {
    pending: HashMap<String, PendingApproval>,
}

impl ApprovalStore {
    pub fn insert_external(
        &mut self,
        id: String,
        requester: String,
        prompt: String,
        root_path: String,
        expires_at_ms: u128,
    ) {
        let expires_at = SystemTime::UNIX_EPOCH
            + Duration::from_millis(expires_at_ms.min(u64::MAX as u128) as u64);
        self.pending.insert(
            id.clone(),
            PendingApproval {
                id,
                requester,
                prompt,
                root_path,
                expires_at_ms,
                expires_at,
            },
        );
    }

    pub fn request(
        &mut self,
        requester: String,
        prompt: String,
        root_path: String,
        now: SystemTime,
    ) -> PendingApproval {
        let expires_at = now + APPROVAL_TTL;
        let approval = PendingApproval {
            id: Uuid::new_v4().to_string(),
            requester,
            prompt,
            root_path,
            expires_at_ms: expires_at
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis(),
            expires_at,
        };
        self.pending.insert(approval.id.clone(), approval.clone());
        approval
    }

    pub fn list(&mut self, now: SystemTime) -> Vec<PendingApproval> {
        self.pending
            .retain(|_, approval| approval.expires_at >= now);
        self.pending.values().cloned().collect()
    }

    pub fn resolve(&mut self, id: &str, approved: bool, now: SystemTime) -> ApprovalDecision {
        let Some(approval) = self.pending.remove(id) else {
            return ApprovalDecision::Missing;
        };
        if approval.expires_at < now {
            return ApprovalDecision::Expired;
        }
        if approved {
            ApprovalDecision::Approved
        } else {
            ApprovalDecision::Rejected
        }
    }
}
