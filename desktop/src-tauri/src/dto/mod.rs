//! Serde-serializable DTOs for the IPC boundary, split by domain. Each submodule
//! owns its DTOs plus the `From` / map functions that build them from the
//! `log_parser` / `features` model types (which are not serde-aware). Everything
//! is re-exported flat so call sites stay `crate::dto::X` regardless of which
//! submodule a DTO lives in.

mod completion;
mod config;
mod log;
mod misc;
mod schema;
mod soql;

pub use completion::*;
pub use config::*;
pub use log::*;
pub use misc::*;
pub use schema::*;
pub use soql::*;

#[cfg(test)]
mod contract;
