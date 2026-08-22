const MANIFEST: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity
        type="win32"
        name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0"
        processorArchitecture="*"
        publicKeyToken="6595b64144ccf1df"
        language="*"
      />
    </dependentAssembly>
  </dependency>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2, PerMonitor</dpiAwareness>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/PM</dpiAware>
    </windowsSettings>
  </application>
</assembly>
"#;

/// 动态定位 Windows SDK 的 rc.exe，避免硬编码本机 SDK 版本号（如 10.0.26100.0）
/// 导致其他机器构建失败。优先尊重外部注入的 RC 环境变量（发布脚本会设置），
/// 否则在标准安装位置中挑选版本号最新的 SDK。
#[cfg(windows)]
fn find_rc_exe() -> Option<String> {
    if let Ok(rc) = std::env::var("RC") {
        if std::path::Path::new(&rc).exists() {
            return Some(rc);
        }
    }
    for root in [
        r"C:\Program Files (x86)\Windows Kits\10\bin",
        r"C:\Program Files\Windows Kits\10\bin",
    ] {
        let bin_dir = std::path::Path::new(root);
        let Ok(entries) = std::fs::read_dir(bin_dir) else {
            continue;
        };
        let mut versions: Vec<String> = entries
            .flatten()
            .filter_map(|e| e.file_name().into_string().ok())
            .filter(|n| n.starts_with("10."))
            .collect();
        // 字典序倒排即版本号从新到旧
        versions.sort();
        versions.reverse();
        for ver in &versions {
            for arch in ["x64", "x86_64"] {
                let rc = bin_dir.join(ver).join(arch).join("rc.exe");
                if rc.exists() {
                    return rc.to_str().map(|s| s.to_string());
                }
            }
        }
    }
    None
}

fn main() {
    #[cfg(windows)]
    {
        if let Some(rc_exe) = find_rc_exe() {
            let sdk_bin = std::path::Path::new(&rc_exe)
                .parent()
                .map(|p| p.to_string_lossy().to_string());
            std::env::set_var("RC", &rc_exe);
            std::env::set_var("RC_x86_64_pc_windows_msvc", &rc_exe);
            if let Some(bin) = sdk_bin {
                if let Ok(path) = std::env::var("PATH") {
                    if !path.contains(&bin) {
                        std::env::set_var("PATH", format!("{};{}", bin, path));
                    }
                }
            }
        } else {
            println!("cargo:warning=未找到 Windows SDK rc.exe，将依赖构建环境自身的解析");
        }

        let windows = tauri_build::WindowsAttributes::new().app_manifest(MANIFEST);
        let attrs = tauri_build::Attributes::new().windows_attributes(windows);
        tauri_build::try_build(attrs).expect("Failed to run tauri-build");
    }

    #[cfg(not(windows))]
    tauri_build::build();
}
