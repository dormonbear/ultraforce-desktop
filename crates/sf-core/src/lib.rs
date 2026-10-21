//! sf-core: async, testable orchestration over the Salesforce `sf` CLI.

pub mod error;
pub mod invoker;
pub mod json;
pub mod models;
pub mod org;
pub mod runner;
pub mod version;
#[cfg(any(windows, test))]
mod windows_cli;

pub use error::SfError;
pub use invoker::SfInvoker;
pub use json::{parse_envelope, SfEnvelope};
pub use models::{ApexLogRef, QueryResult};
pub use org::{AuthInfo, OrgRef, OrgRegistry};
pub use runner::{CommandRunner, ProcessRunner, RawOutput};
pub use version::SfVersion;
