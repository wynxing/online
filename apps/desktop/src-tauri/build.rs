use std::path::PathBuf;

fn main() {
    check_sidecar_freshness();
    tauri_build::build()
}

/// Verify the sidecar binary exists and is up-to-date relative to the PyInstaller spec.
///
/// The sidecar is gitignored and must be built locally via `npm run runtime:sidecar`.
/// If the binary is missing or stale (spec file changed after last build), abort with
/// a clear message so the developer knows exactly what to do.
fn check_sidecar_freshness() {
    let manifest_dir =
        PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".into()));
    let target = std::env::var("TARGET").unwrap_or_default();

    // Resolve sidecar binary path: binaries/ai-interpretation-runtime-{target_triple}[.exe]
    let sidecar_name = format!("ai-interpretation-runtime-{target}");
    let sidecar_path = manifest_dir.join("binaries").join(if target.contains("windows") {
        format!("{sidecar_name}.exe")
    } else {
        sidecar_name
    });

    // Resolve spec file path relative to project root (two levels up from src-tauri)
    let spec_path = manifest_dir
        .parent() // apps/desktop
        .and_then(|p| p.parent()) // apps
        .and_then(|p| p.parent()) // project root
        .map(|root| root.join("runtime").join("ai-interpretation-runtime.spec"))
        .unwrap_or_else(|| PathBuf::from("runtime/ai-interpretation-runtime.spec"));

    // Tell Cargo to re-run this build script when either file changes
    println!("cargo:rerun-if-changed={}", sidecar_path.display());
    println!("cargo:rerun-if-changed={}", spec_path.display());

    // Check 1: binary must exist
    if !sidecar_path.exists() {
        eprintln!("error: Sidecar binary not found: {}", sidecar_path.display());
        eprintln!("       Run: npm run runtime:sidecar");
        std::process::exit(1);
    }

    // Check 2: binary must be newer than spec
    let sidecar_mtime = mtime(&sidecar_path);
    let spec_mtime = mtime(&spec_path);

    if spec_mtime > sidecar_mtime {
        eprintln!(
            "error: Sidecar binary is stale — spec file {} is newer than binary {}",
            spec_path.display(),
            sidecar_path.display()
        );
        eprintln!("       Run: npm run runtime:sidecar");
        std::process::exit(1);
    }
}

/// Read the last-modified time of a file, returning 0 if the file doesn't exist.
fn mtime(path: &PathBuf) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
