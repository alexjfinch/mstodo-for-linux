# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in mstodo-for-linux, please report it responsibly.

**Do not open a public issue.** Instead, please report vulnerabilities by emailing the maintainer directly or by using [GitHub's private vulnerability reporting](https://github.com/alexjfinch/mstodo-for-linux/security/advisories/new).

### What to include

- A description of the vulnerability and its potential impact
- Steps to reproduce the issue
- Any relevant logs or screenshots (redact sensitive data)

### What to expect

- **Acknowledgement** within 72 hours of your report
- **Status update** within 7 days with an assessment and remediation timeline
- **Credit** in the release notes (unless you prefer to remain anonymous)

If the vulnerability is accepted, a fix will be prioritised and released as soon as possible. If declined, you will receive an explanation of why.

## Scope

The following areas are in scope for security reports:

- **Authentication & token handling** — OAuth flows, access token storage, and refresh logic
- **Local data storage** — SQLite database, Tauri keyring, and settings persistence
- **Network communication** — API requests to Microsoft Graph
- **Desktop integration** — Tauri IPC commands, system tray, and quick-add window

### Out of scope

- Vulnerabilities in upstream dependencies (please report these to the respective projects)
- Attacks requiring physical access to an unlocked machine
- Social engineering

## Security Practices

- Access tokens are stored in the system keyring, not in plain-text files
- All API communication uses HTTPS
- The application does not run a local web server or expose any network ports
- Tauri's IPC layer restricts command access to the application's own webview
