//! sf-schema: on-demand Salesforce object describe → trimmed model → cache → query.

pub mod model;
pub mod puller;
pub mod query;
pub mod sqlite;
pub mod store;

pub use model::{ChildRelationship, Field, PicklistValue, SObjectSchema};
pub use puller::describe_object;
pub use store::SchemaStore;
