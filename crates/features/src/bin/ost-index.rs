//! Headless OST indexer: writes ultraforce-format index.json + rich per-object
//! describe per org into a caller-supplied root. Thin shell over the tested
//! `features::index::{index_org, sync_org}` — no indexing logic of its own.
//!
//! Usage: ost-index --org <alias> --root <dir> [--policy all] [--sync]
use std::path::PathBuf;
use std::sync::Arc;

use features::index::{index_org, sync_org, IndexProgress, NamespacePolicy};
use sf_core::{ProcessRunner, SfInvoker};

struct Args {
    org: String,
    root: PathBuf,
    policy: String,
    sync: bool,
}

fn parse(mut it: impl Iterator<Item = String>) -> Result<Args, String> {
    let mut org = None;
    let mut root = None;
    let mut policy = "all".to_string();
    let mut sync = false;
    while let Some(a) = it.next() {
        match a.as_str() {
            "--org" => org = it.next(),
            "--root" => root = it.next().map(PathBuf::from),
            "--policy" => policy = it.next().ok_or("--policy needs a value")?,
            "--sync" => sync = true,
            other => return Err(format!("unknown arg: {other}")),
        }
    }
    Ok(Args {
        org: org.ok_or("--org required")?,
        root: root.ok_or("--root required")?,
        policy,
        sync,
    })
}

#[tokio::main]
async fn main() {
    let args = match parse(std::env::args().skip(1)) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("ost-index: {e}\nusage: ost-index --org <alias> --root <dir> [--policy all] [--sync]");
            std::process::exit(2);
        }
    };
    // Heaviest call is fetch_apex_symbols' full ApexClass SymbolTable query (~145s on
    // a large managed org); the default 120s invoker timeout flakes on it. 300s matches
    // acquire.rs COMPLETIONS_TIMEOUT. ponytail: bin-level override, not a shared-crate change.
    let invoker = SfInvoker::new(Arc::new(ProcessRunner)).with_timeout(std::time::Duration::from_secs(300));
    let policy = NamespacePolicy::parse(&args.policy);

    let res = if args.sync {
        sync_org(&invoker, args.root.clone(), &args.org, &policy)
            .await
            .map(|(o, _)| eprintln!("sync {}: +{} ~{} -{}", args.org, o.added, o.updated, o.removed))
    } else {
        let mut last = String::new();
        index_org(&invoker, args.root.clone(), &args.org, &policy, &mut |p: IndexProgress| {
            if p.phase != last {
                eprintln!("[{}] {} {}/{}", args.org, p.phase, p.done, p.total);
                last = p.phase.to_string();
            }
        })
        .await
        .map(|_| ())
    };

    if let Err(e) = res {
        eprintln!("ost-index {}: {e:?}", args.org);
        std::process::exit(1);
    }
    eprintln!("ost-index {}: wrote under {}", args.org, args.root.join(&args.org).display());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(v: &[&str]) -> Result<Args, String> {
        parse(v.iter().map(|s| s.to_string()))
    }

    #[test]
    fn parse_full_defaults_policy_all() {
        let a = args(&["--org", "SFDC_Staging", "--root", "/tmp/ost"]).unwrap();
        assert_eq!(a.org, "SFDC_Staging");
        assert_eq!(a.root, PathBuf::from("/tmp/ost"));
        assert_eq!(a.policy, "all");
        assert!(!a.sync);
    }

    #[test]
    fn parse_sync_flag() {
        let a = args(&["--org", "o", "--root", "r", "--sync"]).unwrap();
        assert!(a.sync);
    }

    #[test]
    fn parse_missing_org_errs() {
        assert!(args(&["--root", "r"]).is_err());
    }

    #[test]
    fn parse_unknown_arg_errs() {
        assert!(args(&["--org", "o", "--root", "r", "--bogus"]).is_err());
    }
}
