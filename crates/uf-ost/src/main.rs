//! `uf-ost` — one binary, three subcommands:
//!   uf-ost serve                                  MCP server over stdio
//!   uf-ost index --org <alias> [--sync] [--root <dir>] [--policy all]
//!   uf-ost status [--org <alias>] [--root <dir>]
//!
//! Snapshot root resolves `--root` > `UF_OST_ROOT` > the app's default cache.

mod detail;
mod index_cmd;
mod lock;
mod query;
mod root;
mod server;
mod soql;
mod status_cmd;

use std::path::PathBuf;

use rmcp::transport::stdio;
use rmcp::ServiceExt;

struct Flags {
    org: Option<String>,
    root: Option<PathBuf>,
    policy: String,
    sync: bool,
}

fn parse_flags(mut it: impl Iterator<Item = String>) -> Result<Flags, String> {
    let mut f = Flags {
        org: None,
        root: None,
        policy: "all".to_string(),
        sync: false,
    };
    while let Some(a) = it.next() {
        match a.as_str() {
            "--org" => f.org = Some(it.next().ok_or("--org needs a value")?),
            "--root" => f.root = Some(PathBuf::from(it.next().ok_or("--root needs a value")?)),
            "--policy" => f.policy = it.next().ok_or("--policy needs a value")?,
            "--sync" => f.sync = true,
            other => return Err(format!("unknown arg: {other}")),
        }
    }
    Ok(f)
}

fn usage() -> ! {
    eprintln!(
        "usage:\n  uf-ost serve [--root <dir>]\n  uf-ost index --org <alias> [--sync] [--root <dir>] [--policy all]\n  uf-ost status [--org <alias>] [--root <dir>]"
    );
    std::process::exit(2);
}

fn flags_or_exit(it: impl Iterator<Item = String>) -> Flags {
    parse_flags(it).unwrap_or_else(|e| {
        eprintln!("uf-ost: {e}");
        usage();
    })
}

#[tokio::main]
async fn main() {
    let mut args = std::env::args().skip(1);
    let Some(cmd) = args.next() else { usage() };
    match cmd.as_str() {
        "serve" => {
            let f = flags_or_exit(args);
            serve(root::resolve_root(f.root)).await;
        }
        "index" => {
            let f = flags_or_exit(args);
            let Some(org) = f.org else {
                eprintln!("uf-ost index: --org required");
                usage();
            };
            let root = root::resolve_root(f.root);
            if let Err(e) = index_cmd::run(org.clone(), root, f.policy, f.sync).await {
                eprintln!("uf-ost index {org}: {e}");
                std::process::exit(1);
            }
        }
        "status" => {
            let f = flags_or_exit(args);
            status_cmd::run(&root::resolve_root(f.root), f.org);
        }
        _ => usage(),
    }
}

async fn serve(root: PathBuf) -> ! {
    let service = match server::OstServer::new(root).serve(stdio()).await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("uf-ost serve: {e}");
            std::process::exit(1);
        }
    };
    if let Err(e) = service.waiting().await {
        eprintln!("uf-ost serve: {e}");
        std::process::exit(1);
    }
    std::process::exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flags(v: &[&str]) -> Result<Flags, String> {
        parse_flags(v.iter().map(|s| s.to_string()))
    }

    #[test]
    fn parses_index_flags() {
        let f = flags(&["--org", "SFDC_Staging", "--sync", "--root", "/tmp/ost"]).unwrap();
        assert_eq!(f.org.as_deref(), Some("SFDC_Staging"));
        assert!(f.sync);
        assert_eq!(f.root, Some(PathBuf::from("/tmp/ost")));
        assert_eq!(f.policy, "all");
    }

    #[test]
    fn rejects_unknown_flag() {
        assert!(flags(&["--bogus"]).is_err());
    }
}
