//! sf-core: async, testable orchestration over the Salesforce `sf` CLI.

pub mod error;
pub mod runner;
pub mod json;
pub mod invoker;
pub mod models;
pub mod org;
pub mod version;

pub use error::SfError;
pub use runner::{CommandRunner, ProcessRunner, RawOutput};
pub use json::{parse_envelope, SfEnvelope};
pub use invoker::SfInvoker;
pub use models::{ApexLogRef, ApexRunResult, QueryResult};
pub use org::{OrgRef, OrgRegistry};
pub use version::SfVersion;
