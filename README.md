# pi-session-exporter

Export your Pi session as clean Markdown for sharing in PRs, issues, docs, and Slack.

## What it produces

```markdown
# Pi Session Export

**Exported:** 2026-05-22 14:30:00
**Directory:** `~/my-project`
**Session:** refactoring-auth
**Entries:** 24

---

### 👤 You

Refactor the auth middleware to use JWT instead of sessions

### 🤖 Assistant

I'll refactor the auth middleware. Let me start by reading the current implementation.

### 🔧 Tool: `read`

```json
{
  "path": "src/middleware/auth.ts"
}
```

<details>
<summary>📋 Result: `read`</summary>

```
export function authMiddleware(req, res, next) {
  ...
}
```

</details>
...
```

## Features

- **Clean Markdown** with roles (👤 You, 🤖 Assistant, 🔧 Tool, 📋 Result)
- **Tool calls shown as code blocks** with JSON args
- **Tool results collapsed** in `<details>` for readability
- **Thinking sections** collapsed when present
- **Plaintext export** — one-line summary per entry
- **JSON export** — structured data for automation
- **Image indicators** — shows 🖼️ when user messages have attachments

## Install

```bash
# npm
pi install npm:pi-session-exporter

# GitHub
pi install git:github.com/Jaraxxxx/pi-session-exporter
```

## Usage

| Method | Action |
|--------|--------|
| `/export` | Export as Markdown |
| `/export json` | Export as JSON |
| `/export plaintext` | Export as plaintext |
| `Ctrl+E` | Quick export as Markdown |

The LLM can also call the `export_session` tool.

Files are saved to `.pi-exports/` in your working directory.

## Output location

```
your-project/
└── .pi-exports/
    └── pi-session-20260522-143000.md
```

## Requirements

- Pi coding agent