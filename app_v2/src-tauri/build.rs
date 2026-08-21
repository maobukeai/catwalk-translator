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

fn main() {
    #[cfg(windows)]
    {
        let sdk_bin = r"C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64";
        if let Ok(path) = std::env::var("PATH") {
            std::env::set_var("PATH", format!("{};{}", sdk_bin, path));
        }

        let mut res = tauri_winres::WindowsResource::new();
        res.set_manifest(MANIFEST);
        res.set_icon("icons/icon.ico");
        if let Err(e) = res.compile() {
            println!("cargo:warning=winres error: {:?}", e);
        } else {
            println!("cargo:warning=winres compiled manifest successfully");
        }

        let windows = tauri_build::WindowsAttributes::new().app_manifest(MANIFEST);
        let attrs = tauri_build::Attributes::new().windows_attributes(windows);
        let _ = tauri_build::try_build(attrs);
    }

    #[cfg(not(windows))]
    tauri_build::build();
}
