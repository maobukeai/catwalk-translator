fn main() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "windows" {
        let out_dir = std::env::var("OUT_DIR").unwrap();
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();

        let rc_file = format!("{}/app_icon.rc", out_dir);
        let res_file = format!("{}/app_icon.res", out_dir);

        let rc_content = "1 ICON \"icons/icon.ico\"\n32512 ICON \"icons/icon.ico\"\n";
        let _ = std::fs::write(&rc_file, rc_content);

        let candidate_rc_execs = [
            r"C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\rc.exe",
            r"C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\rc.exe",
            r"C:\Program Files (x86)\Windows Kits\10\bin\10.0.19041.0\x64\rc.exe",
            r"C:\Program Files (x86)\Windows Kits\10\bin\x64\rc.exe",
            r"C:\Users\20269\scoop\apps\gcc\current\bin\windres.exe",
        ];

        let mut compiled_success = false;
        for rc_exe in candidate_rc_execs {
            if std::path::Path::new(rc_exe).exists() {
                let output = if rc_exe.ends_with("windres.exe") {
                    std::process::Command::new(rc_exe)
                        .current_dir(&manifest_dir)
                        .args(&["-i", &rc_file, "-O", "coff", "-o", &res_file])
                        .output()
                } else {
                    std::process::Command::new(rc_exe)
                        .current_dir(&manifest_dir)
                        .args(&["/fo", &res_file, &rc_file])
                        .output()
                };

                if let Ok(out) = output {
                    if out.status.success() {
                        println!("cargo:rustc-link-arg={}", res_file);
                        println!("cargo:rerun-if-changed=icons/icon.ico");
                        compiled_success = true;
                        break;
                    }
                }
            }
        }

        if !compiled_success {
            println!(
                "cargo:warning=Failed to locate rc.exe or windres.exe for custom icon compilation"
            );
        }

        let manifest_file = format!("{}/comctl6.manifest", out_dir);
        let manifest_content = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
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
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false"/>
      </requestedPrivileges>
    </security>
  </trustInfo>
</assembly>
"#;
        if let Ok(_) = std::fs::write(&manifest_file, manifest_content) {
            println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
            println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest_file);
        }
    }
    tauri_build::build();
}
