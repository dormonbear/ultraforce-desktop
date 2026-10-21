use std::{ffi::OsStr, path::PathBuf};

/// Resolve npm's canonical Salesforce entry point without evaluating a batch shim. / 查找 npm 标准 Salesforce 入口，不解释批处理包装器。
pub(crate) fn npm_command(path: &OsStr) -> Option<(PathBuf, PathBuf)> {
    let directories: Vec<_> = std::env::split_paths(path)
        .filter(|directory| !directory.as_os_str().is_empty())
        .collect();
    for directory in &directories {
        let script = directory.join("node_modules/@salesforce/cli/bin/run.js");
        if !directory.join("sf.cmd").is_file() || !script.is_file() {
            continue;
        }
        let adjacent_node = directory.join("node.exe");
        let node = if adjacent_node.is_file() {
            Some(adjacent_node)
        } else {
            directories
                .iter()
                .map(|entry| entry.join("node.exe"))
                .find(|candidate| candidate.is_file())
        };
        if let Some(node) = node {
            return Some((node, script));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(PathBuf);
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn requires_npm_shim_payload_and_node_and_preserves_path_order() {
        let root = std::env::temp_dir().join(format!(
            "uf npm resolver {} {}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _cleanup = Fixture(root.clone());
        let npm = root.join("npm bin");
        let node = root.join("node bin");
        let unrelated = root.join("unrelated bin");
        let script = npm.join("node_modules/@salesforce/cli/bin/run.js");
        std::fs::create_dir_all(script.parent().unwrap()).unwrap();
        std::fs::create_dir_all(&node).unwrap();
        std::fs::create_dir_all(&unrelated).unwrap();
        let path = std::env::join_paths([&unrelated, &npm, &node]).unwrap();
        std::fs::write(&script, "").unwrap();
        std::fs::write(node.join("node.exe"), "").unwrap();
        assert!(npm_command(&path).is_none());
        std::fs::write(npm.join("sf.cmd"), "").unwrap();
        std::fs::write(unrelated.join("sf.cmd"), "").unwrap();
        assert_eq!(
            npm_command(&path),
            Some((node.join("node.exe"), script.clone()))
        );
        std::fs::write(npm.join("node.exe"), "").unwrap();
        assert_eq!(
            npm_command(&path),
            Some((npm.join("node.exe"), script.clone()))
        );
        std::fs::remove_file(script).unwrap();
        assert!(npm_command(&path).is_none());
    }
}
