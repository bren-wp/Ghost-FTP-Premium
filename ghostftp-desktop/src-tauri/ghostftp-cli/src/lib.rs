use anyhow::{bail, Result};

/// Parse a semantic version core into a comparable tuple. Pre-release/build
/// metadata is ignored; short forms default missing minor/patch components to 0.
pub fn parse_semver(s: &str) -> Option<(u64, u64, u64)> {
    let core = s.trim().split(['-', '+']).next().unwrap_or(s);
    let mut it = core.split('.');
    let major = it.next()?.parse().ok()?;
    let minor = it.next().unwrap_or("0").parse().ok()?;
    let patch = it.next().unwrap_or("0").parse().ok()?;
    Some((major, minor, patch))
}

/// True when a path starts with a Windows drive prefix such as C:\\ or C:/.
pub fn is_windows_drive_path(p: &str) -> bool {
    let b = p.as_bytes();
    b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'/' || b[2] == b'\\')
}

fn is_collapsed_windows_path(p: &str) -> bool {
    let b = p.as_bytes();
    b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && b[2] != b'/' && b[2] != b'\\'
}

/// Pure remote-path safety rule shared by the CLI runtime and its platform-safe
/// unit tests. Keeping it independent of ghostftp_lib lets Windows execute these
/// tests without linking Tauri/WebView2 into the CLI test harness.
pub fn check_mangled_remote_path(remote_path: &str, is_windows_target: bool) -> Result<()> {
    if is_collapsed_windows_path(remote_path) {
        bail!(
            "`{remote_path}` is missing its path separators — your shell ate the backslashes \
             (in bash, `C:\\Users\\User` collapses to `C:UsersUser`). Windows would resolve that \
             against the server's current directory and put the file somewhere you didn't mean. \
             Use forward slashes (`C:/Users/User`) or single-quote the path ('C:\\Users\\User')."
        );
    }
    if !is_windows_drive_path(remote_path) || is_windows_target {
        return Ok(());
    }
    bail!(
        "that remote path looks like Git Bash rewrote it (MSYS path conversion turned a \
         POSIX path such as /var/www into `{remote_path}`). Re-run with `MSYS_NO_PATHCONV=1`, \
         prefix the path with `//` (e.g. `//var/www`), or drop text straight in with \
         `ghostftp-cli agent write`."
    )
}

#[cfg(test)]
mod tests {
    use super::{check_mangled_remote_path, is_windows_drive_path, parse_semver};

    #[test]
    fn mangled_path_rejected_only_on_non_windows_target() {
        let err = check_mangled_remote_path("C:/Program Files/Git/var/www", false)
            .expect_err("should reject a mangled path on a POSIX target");
        let msg = err.to_string();
        assert!(msg.contains("MSYS_NO_PATHCONV=1"));
        assert!(msg.contains("agent write"));
        assert!(check_mangled_remote_path("C:/Users/me/app", true).is_ok());
        assert!(check_mangled_remote_path("/var/www/html", false).is_ok());
        assert!(check_mangled_remote_path("//var/www", false).is_ok());
    }

    #[test]
    fn collapsed_windows_path_is_rejected_on_any_target() {
        for target_is_windows in [true, false] {
            let err = check_mangled_remote_path("C:UsersUser", target_is_windows)
                .expect_err("collapsed drive path should be rejected");
            assert!(err.to_string().contains("missing its path separators"));
        }
        assert!(check_mangled_remote_path(r"C:\Users\User", true).is_ok());
        assert!(check_mangled_remote_path("C:/Users/User", true).is_ok());
        assert!(check_mangled_remote_path("public_html/wp-content", false).is_ok());
    }

    #[test]
    fn detects_windows_drive_paths() {
        assert!(is_windows_drive_path("C:/Program Files/Git/var/www"));
        assert!(is_windows_drive_path(r"C:\Users\me"));
        assert!(is_windows_drive_path("D:/data"));
        assert!(!is_windows_drive_path("/var/www/html"));
        assert!(!is_windows_drive_path("//var/www"));
        assert!(!is_windows_drive_path("./rel"));
        assert!(!is_windows_drive_path("home/user"));
        assert!(!is_windows_drive_path("C:"));
    }

    #[test]
    fn semver_parses_and_orders() {
        assert_eq!(parse_semver("1.3.19"), Some((1, 3, 19)));
        assert_eq!(parse_semver("1.4.0"), Some((1, 4, 0)));
        assert_eq!(parse_semver("2.0.0-rc1"), Some((2, 0, 0)));
        assert_eq!(parse_semver("2.0.0+build.7"), Some((2, 0, 0)));
        assert_eq!(parse_semver("3"), Some((3, 0, 0)));
        assert_eq!(parse_semver("3.2"), Some((3, 2, 0)));
        assert_eq!(parse_semver("nightly"), None);
    }

    #[test]
    fn stale_when_cli_older_than_app() {
        assert!(parse_semver("1.3.10") < parse_semver("1.3.19"));
        assert!(parse_semver("1.2.99") < parse_semver("1.3.0"));
        assert!(!(parse_semver("1.3.19") < parse_semver("1.3.19")));
        assert!(!(parse_semver("1.4.0") < parse_semver("1.3.19")));
    }
}
