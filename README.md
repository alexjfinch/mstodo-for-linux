![GitHub stars](https://img.shields.io/github/stars/alexjfinch/mstodo-for-linux)
![GitHub issues](https://img.shields.io/github/issues/alexjfinch/mstodo-for-linux)
![License](https://img.shields.io/github/license/alexjfinch/mstodo-for-linux)

# Microsoft To Do for Linux

A fast, native Linux desktop client for Microsoft To Do built with [Tauri v2](https://tauri.app/), React, and TypeScript. Syncs with your Microsoft account via the Microsoft Graph API so your tasks stay up to date across all your devices.

Please note I am not a trained app developer and have used AI to help me write this app. This started out as a project for me to learn a little bit of coding and what I could achieve with the help of AI. Feel free to submit PRs to improve the code and if you find anything funny or outside of the norm, I apologise but this was a personal project and I've released this for anyone else to tinker with.

## Why?

Microsoft doesn't offer a native To Do app for Linux. This project fills that gap with a lightweight, fast desktop app that authenticates with your Microsoft account and syncs tasks, lists, attachments, and more -- all through the official Graph API.

## Installation

### Flatpak (recommended)

*Coming soon*

### Fedora / RHEL (RPM)

```bash
sudo dnf install mstodo-for-linux-*.rpm
```

### Debian / Ubuntu (DEB)

```bash
sudo dpkg -i mstodo-for-linux-*.deb
```

### AppImage

Download the `.AppImage` file, make it executable, and run:

```bash
chmod +x mstodo-for-linux-*.AppImage
./mstodo-for-linux-*.AppImage
```

## Getting Started

1. Launch the app
2. Click **Sign In** -- your browser will open to the Microsoft login page
3. Sign in with your Microsoft account and grant the app permission to access your tasks
4. Your tasks, lists, and attachments will sync automatically

No configuration needed. The app uses a pre-registered public client with the Microsoft identity platform, so you just sign in and go.

## Features

- **Full Microsoft account sync** -- tasks, lists, attachments, and checklist items sync via Microsoft Graph API v1.0
- **Offline-capable** -- local SQLite database lets you work offline; changes sync when you reconnect
- **Smart lists** -- My Day, Important, Planned, and Flagged Emails views
- **Task detail panel** -- edit title, notes, due date, importance, recurrence, categories, steps, and attachments from a slide-out panel
- **Subtasks / Steps** -- add, check off, and delete checklist items (steps) on any task, synced with Microsoft To Do
- **File attachments** -- attach files to tasks (up to 3 MB) and download them, using the OS file picker
- **List groups** -- organise lists into collapsible groups with drag-and-drop support
- **Drag-and-drop task reordering** -- reorder tasks within a list by dragging
- **Custom calendar date picker** -- inline calendar for setting due dates directly from the task list
- **Theme support** -- light, dark, and system themes (reads the desktop environment preference via freedesktop portal)
- **Compact mode** -- reduce row spacing for denser task views
- **Font size options** -- small, normal, and large text sizes
- **Auto-sync** -- configurable sync interval (30s, 1m, 5m, or manual only)
- **Online/offline status indicator** -- shows sync state in the sidebar
- **Custom title bar** -- native window controls without OS decorations
- **Context menus** -- right-click tasks for quick actions
- **Multi-select** -- shift-click to select multiple tasks for bulk completion
- **Keyboard shortcuts** -- escape to close panels, Enter to submit, and more
- **User account switching** -- switch between mutliple Microsoft accounts
- **Task search** -- search functionality operates globally
- **Taskbar icon & context menu** -- sync status displayed in the task bar with a context menu to add tasks
- **Customisable notifications for due reminders** -- desktop notifications for due reminders which are customisable in the settings menu
- **Search / filter tasks** -- search across all lists by title, notes, or category
- **Due date reminders / notifications** -- desktop notifications when tasks are due or overdue
- **Sort tasks** -- sort by due date, importance, alphabetical, or creation date
- **Assigned to me view** -- for shared lists, show tasks assigned to the current user
- **Offline queue** -- queue changes made offline and replay them on reconnect
- **System tray** -- minimise to tray with a badge showing overdue/due-today count
- **Account switching** -- allow switching between mutliple Microsoft Accounts
- **Markdown support in notes** -- being able to add notes in Markdown
- **Import / export features from other apps** -- import or export to other apps
- **My Day task suggestion engine** -- Upcoming tasks are suggested on the My Day panel.

## Roadmap

Planned features, roughly in priority order:

- [ ] **Keyboard shortcuts** -- Ctrl+N for new task, Ctrl+D to toggle complete, Delete to remove
- [ ] **Global quick add** -- keyboard shortcut to add task anywhere in the DE
- [ ] **Thunderbird integration** -- integration with Thunderbird to add emails as tasks from other email accounts
- [ ] **Phase parsing** -- parse pharsing to auto add due dates etc
- [ ] **Assign to other users** -- integrate being able to assign tasks to other users. Possisbly not possible without migrating or incorporating Planner API.

## Building from Source

For contributors and developers who want to build the app themselves.

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/) (stable)
- Tauri v2 system dependencies (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/))

### Development

```bash
npm install
npm run tauri dev
```

### Build

```bash
npm run tauri build
```

The built packages (`.deb`, `.rpm`, `.AppImage`) will be in `src-tauri/target/release/bundle/`.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop framework | Tauri v2 (Rust backend) |
| Frontend | React 18 + TypeScript |
| Build tool | Vite |
| Local storage | SQLite (via `@tauri-apps/plugin-sql`) |
| Settings | `@tauri-apps/plugin-store` |
| Auth | OAuth 2.0 PKCE flow (Microsoft identity platform) |
| API | Microsoft Graph API v1.0 |

## Security & Privacy

Authentication uses OAuth 2.0 with PKCE (Proof Key for Code Exchange) — a flow designed for native public clients. Your Microsoft credentials are never seen or stored by this app. The sign-in process opens your browser to Microsoft's own login page, and the resulting tokens are stored exclusively in your system keyring (e.g. GNOME Keyring, KWallet).

No data leaves your machine except for requests made directly to the Microsoft Graph API on your behalf. There is no backend server, no telemetry, and no third-party analytics.

Azure AD app registration — this app uses a publicly registered Azure AD client (ID: 2a0ee15b-0a96-44d2-b30d-3cf604947669). This ID is not a secret, it identifies the app to Microsoft during sign-in so you can review the permissions being requested. 

The permissions requested are:

| Scope | Reason |
|---|---|
| `Tasks.Read` / `Tasks.ReadWrite` | Read and manage your To Do tasks and lists |
| `User.Read` | Fetch your display name and email address |
| `offline_access` | Refresh your session without requiring you to sign in again |

You can review and revoke this app's access at any time from your Microsoft account permissions page.

## Affiliation

This project is not affiliated with or endorsed by Microsoft. "Microsoft To Do" is a trademark of Microsoft Corporation.
