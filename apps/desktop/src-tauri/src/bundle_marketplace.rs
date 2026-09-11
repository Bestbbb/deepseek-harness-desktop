//! Deployment paths for the Cordis Bundle marketplace; no package installation runs in Rust.

use serde::Deserialize;
use std::{
    fs::File,
    io::Read,
    path::{Path, PathBuf},
};
use url::Url;

#[derive(Clone)]
pub(crate) struct Paths {
    pub preparation: PathBuf,
    pub gateway: PathBuf,
    pub catalog: PathBuf,
    pub package_manager: PathBuf,
    pub harness_manifest: PathBuf,
}

impl Paths {
    pub(crate) fn packaged(runtime: &Path) -> Self {
        let packages = runtime.join("app/node_modules/@deepseek-ai");
        Self {
            preparation: packages.join("dsh-bundle-preparation/lib/index.js"),
            gateway: packages.join("dsh-bundle-marketplace/lib/index.js"),
            catalog: runtime.join("marketplace/catalog.json"),
            package_manager: runtime.join("tools/pnpm"),
            harness_manifest: packages.join("dsh/package.json"),
        }
    }

    pub(crate) fn development(root: &Path) -> Self {
        Self {
            preparation: root.join("packages/desktop/bundle-preparation/lib/index.js"),
            gateway: root.join("packages/desktop/bundle-marketplace/lib/index.js"),
            catalog: root.join("apps/desktop/resources/marketplace/catalog.json"),
            package_manager: root.join("apps/desktop/node_modules/pnpm"),
            harness_manifest: root.join("package.json"),
        }
    }

    /// Encode deployment values as YAML-compatible JSON scalars, never executable expressions.
    pub(crate) fn render(
        &self,
        template: String,
        home: &Path,
        entry: &Path,
    ) -> Result<String, String> {
        let catalog = absolute(&self.catalog)?;
        let artifacts = catalog
            .parent()
            .ok_or("Bundle catalog has no parent directory")?;
        let home = absolute(home)?;
        let staging = home.join("bundle-marketplace/staging");
        let journal = home.join("bundle-marketplace/operations");
        let manager = absolute(&self.package_manager.join("bin/pnpm.mjs"))?;
        let entry = absolute(entry)?;
        let mut result = template;
        for (placeholder, value) in [
            (
                "__DSH_BUNDLE_PREPARATION_ENTRY__",
                module_url(&self.preparation)?,
            ),
            (
                "__DSH_BUNDLE_MARKETPLACE_ENTRY__",
                module_url(&self.gateway)?,
            ),
            ("__DSH_BUNDLE_CATALOG__", path_text(&catalog)?),
            ("__DSH_BUNDLE_ARTIFACTS__", path_text(artifacts)?),
            ("__DSH_BUNDLE_STAGING__", path_text(&staging)?),
            ("__DSH_BUNDLE_HOME__", path_text(&home)?),
            ("__DSH_BUNDLE_JOURNAL__", path_text(&journal)?),
            ("__DSH_BUNDLE_PNPM_ENTRY__", path_text(&manager)?),
            ("__DSH_BUNDLE_DSH_ENTRY__", path_text(&entry)?),
            ("__DSH_HARNESS_VERSION__", version(&self.harness_manifest)?),
            (
                "__DSH_BUNDLE_PNPM_VERSION__",
                version(&self.package_manager.join("package.json"))?,
            ),
        ] {
            let encoded = serde_json::to_string(&value).map_err(|error| error.to_string())?;
            result = result.replace(placeholder, &encoded);
        }
        Ok(result)
    }
}

fn absolute(path: &Path) -> Result<PathBuf, String> {
    path.canonicalize().map_err(|error| {
        format!(
            "Could not resolve marketplace resource {}: {error}",
            path.display()
        )
    })
}

fn path_text(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| format!("Marketplace path is not UTF-8: {}", path.display()))
}

fn module_url(path: &Path) -> Result<String, String> {
    Url::from_file_path(absolute(path)?)
        .map(String::from)
        .map_err(|_| format!("Invalid marketplace module path: {}", path.display()))
}

fn version(path: &Path) -> Result<String, String> {
    #[derive(Deserialize)]
    struct Manifest {
        version: String,
    }
    let read = || -> Result<String, Box<dyn std::error::Error>> {
        let mut bytes = Vec::new();
        File::open(path)?.take(65537).read_to_end(&mut bytes)?;
        if bytes.len() > 65536 {
            return Err("package manifest exceeds 64 KiB".into());
        }
        let manifest: Manifest = serde_json::from_slice(&bytes)?;
        if manifest.version.trim().is_empty() {
            return Err("package version is empty".into());
        }
        Ok(manifest.version)
    };
    read().map_err(|error| {
        format!(
            "Could not read marketplace package version {}: {error}",
            path.display()
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn renders_relocatable_deployment_values_without_creating_user_state() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("space 中文 # ' folder");
        let paths = Paths::packaged(&root);
        let entry = root.join("app/node_modules/@deepseek-ai/dsh/lib/bin.js");
        let home = root.join("private-home");
        fs::create_dir_all(&home).unwrap();
        for path in [
            &paths.preparation,
            &paths.gateway,
            &paths.catalog,
            &paths.package_manager.join("bin/pnpm.mjs"),
            &entry,
        ] {
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, "").unwrap();
        }
        fs::write(&paths.harness_manifest, r#"{"version":"1.2.3"}"#).unwrap();
        fs::write(
            paths.package_manager.join("package.json"),
            r#"{"version":"11.7.0"}"#,
        )
        .unwrap();
        let rendered = paths
            .render(
                include_str!("../../runtime/desktop.cordis.yml").into(),
                &home,
                &entry,
            )
            .unwrap();
        assert!(!rendered.contains("__DSH_BUNDLE_"));
        assert!(!rendered.contains("__DSH_HARNESS_VERSION__"));
        assert!(rendered.contains("hostVersion: \"1.2.3\""));
        assert!(rendered.contains("packageManagerVersion: \"11.7.0\""));
        assert!(rendered.contains("name: \"file:///"));
        assert!(rendered.contains("nodeExecutable: !!js process.execPath"));
        assert!(rendered.contains(
            &serde_json::to_string(&path_text(&home.canonicalize().unwrap()).unwrap()).unwrap()
        ));
        assert_eq!(fs::read_dir(&home).unwrap().count(), 0);
        fs::remove_file(&paths.gateway).unwrap();
        assert!(paths
            .render(String::new(), &home, &entry)
            .unwrap_err()
            .contains("marketplace resource"));
    }

    #[test]
    fn rejects_unreadable_invalid_empty_and_oversized_package_versions() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("package.json");
        assert!(version(&path).is_err());
        for body in ["{}", "{", r#"{"version":12}"#, r#"{"version":" "}"#] {
            fs::write(&path, body).unwrap();
            assert!(version(&path).is_err());
        }
        fs::write(&path, vec![b' '; 65537]).unwrap();
        assert!(version(&path).unwrap_err().contains("64 KiB"));
    }
}
