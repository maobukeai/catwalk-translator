//! Replace JSON files only after a complete, flushed write in the same directory.
use serde::Serialize;
use std::io::Write;
use std::path::Path;

pub fn write_json<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|e| format!("序列化 {} 失败: {e}", path.display()))?;
    write_atomic(path, &bytes)
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("文件缺少父目录")?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("创建目录 {} 失败: {e}", parent.display()))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| format!("创建临时文件失败: {e}"))?;
    temporary.write_all(bytes).and_then(|_| temporary.as_file().sync_all())
        .map_err(|e| format!("写入 {} 失败: {e}", path.display()))?;
    temporary.persist(path)
        .map_err(|e| format!("保存 {} 失败: {e}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_existing_json_and_reports_write_failure() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        write_json(&path, &serde_json::json!({"version": 1})).unwrap();
        write_json(&path, &serde_json::json!({"version": 2})).unwrap();
        let saved: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved["version"], 2);
        let blocked = dir.path().join("directory.json");
        std::fs::create_dir(&blocked).unwrap();
        assert!(write_json(&blocked, &saved).is_err());
        assert!(blocked.is_dir());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
    }
}
