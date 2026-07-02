use apex_lang::acquire::{fetch_apex_symbols, fetch_completions, parse_org_types, parse_stdlib};
use apex_lang::complete_source;
use apex_lang::symbols::Ost;
use sf_core::{ProcessRunner, SfInvoker};
use std::sync::Arc;

#[ignore = "hits the live org; run with --ignored"]
#[tokio::test]
async fn e2e_ost_acquisition_and_completion_against_real_org() {
    let invoker = SfInvoker::new(Arc::new(ProcessRunner));

    let stdlib_raw = fetch_completions(&invoker, "default", "60.0")
        .await
        .unwrap();
    let namespaces = parse_stdlib(&stdlib_raw);
    let system = namespaces.iter().find(|ns| ns.name == "System").unwrap();
    assert!(system.types.iter().any(|ty| ty.name == "String"));
    assert!(system.types.iter().any(|ty| ty.name == "List"));

    let ost = Ost {
        namespaces,
        org_types: Vec::new(),
    };
    assert!(!complete_source("String.val", "String.val".len(), &ost).is_empty());

    let records = fetch_apex_symbols(&invoker, "default").await.unwrap();
    let _org_types = parse_org_types(&records);
}
