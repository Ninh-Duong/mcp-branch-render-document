# Automatic PR Branch Context Renderer (Branch Render Context MCP)

[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![MCP Protocol](https://img.shields.io/badge/MCP-Protocol%20Compliant-purple.svg)](https://modelcontextprotocol.io/)

**Branch Render Context** is a specialized Model Context Protocol (MCP) server and CLI tool designed to automatically analyze and render complete Git Pull Request / Target Branch contexts relative to a base or checkout branch. It delivers cached, incremental Markdown and JSON documents directly to AI agents with zero branch switching, working tree isolation, automatic `.gitignore` management, and flexible storage cleanup options.

---

## 🎯 Key Highlights & Architecture

1. **Target Branch Resolution Without Branch Switching**:
   - When your working tree is currently on `main` or `develop` and you specify a target branch like `feature/user-auth`, the tool automatically determines:
     - `baseBranch`: `main` (from current checkout or configured default)
     - `targetBranch`: `feature/user-auth`
     - Comparison: `main..feature/user-auth`
2. **Zero Working Tree Disruption**:
   - Developer working trees remain completely untouched. Commands like `git checkout` or `git switch` are **never** executed.
3. **Independent Commit & Ref Resolution**:
   - Target branch commits are resolved directly from local refs or remote tracking refs (`origin/<branch>`) without relying on the current HEAD.
4. **Clean Working Tree Isolation**:
   - Uncommitted dirty changes on your current checkout branch will never contaminate the rendered PR context of the target branch.
5. **Git-Like Hierarchical Storage & Automatic `.gitignore`**:
   - Persists documents in structured paths: `.branch-render-context/repositories/<repo-id>/branches/<branch-path>/document.json`.
   - Automatically and idempotently adds `.branch-render-context/` to `.gitignore` without altering other user rules.
6. **Built-in Secret Redaction & Token Optimization**:
   - Detects and masks credentials, `.env` files, `.pem` certificates, and API tokens.
   - Generates compact, token-efficient Markdown summaries optimized for LLM context windows.
7. **Granular Cleanup & Concurrency Locking**:
   - Safe multi-process locking (`.storage.lock` and `.branch.lock`).
   - Supports 3 distinct cleanup scopes: single branch, repository-wide, and complete storage wipe.

---

## 🛠️ CLI Guide

### 1. Render / Refresh Target Branch Context
```bash
# Analyze target branch relative to the currently checked-out base branch
npm run branch-render:refresh -- --branch feature/user-auth

# Specify explicit base branch and force a full rebuild
npm run branch-render:refresh -- --branch feature/user-auth --base develop --force
```

**Example Output:**
```text
=================================================================
Target branch:   feature/user-auth
Checkout branch: main
Base branch:     main
Comparison:      main..feature/user-auth
Target commit:   8f3b2a1c
Base commit:     1e4d9c7b
Strategy:        full
─────────────────────────────────────────────────────────────────
Metrics:
- Commits:        3
- Changed files:  4
- Insertions:     +142
- Deletions:      -18
- Worktree dirty: ignored (clean isolation)
─────────────────────────────────────────────────────────────────
Document path:
.branch-render-context/repositories/r_9a2b4c1d/branches/feature/user-auth/document.json
=================================================================
```

### 2. Interactive Terminal Wizard
```bash
npm run branch-render:start
```
The wizard detects your current checkout branch, displays existing rendered contexts, and guides you through rendering or clearing options.

### 3. Check Freshness Status
```bash
npm run branch-render:status -- --branch feature/user-auth
```

### 4. List Registered Contexts
```bash
npm run branch-render:list
```

### 5. Context & Storage Cleanup
```bash
# Scope 1: Clear context for a specific branch
npm run branch-render:clear -- --branch feature/user-auth

# Scope 2: Clear all branch contexts in the current repository
npm run branch-render:clear -- --all

# Scope 3: Completely clear ENTIRE storage (all repositories, catalog, config, indexes)
npm run branch-render:clear -- --all-storage --yes
```

---

## 🤖 MCP Server Integration

Configure the MCP server in your AI editor or client (Claude Desktop, Cursor, Cline, Roo Code):

```json
{
  "mcpServers": {
    "branch-render-context": {
      "command": "node",
      "args": ["<path-to-mcp-branch-render-document>/dist/index.js"]
    }
  }
}
```

### Available MCP Tools

| Tool Name | Parameters | Description |
| :--- | :--- | :--- |
| `branch_context_start` | `repo_path?`, `target_branch?`, `base_ref?`, `storage_path?` | Initializes session, discovers repository, and inspects branch state. |
| `branch_context_list` | `repo_path?`, `storage_path?` | Lists all registered repositories and cached branch documents. |
| `branch_context_status` | `repo_path?`, `branch?`, `base_ref?`, `storage_path?` | Evaluates Git freshness between target and base ref without rendering. |
| `branch_context_get` | `repo_path?`, `branch?`, `freshness_mode?`, `storage_path?` | Retrieves `document.json` using specified freshness policy (`required`, `auto`, `check_only`, `allow_stale`). |
| `branch_context_refresh` | `repo_path?`, `branch?`, `base_ref?`, `force?`, `storage_path?` | Triggers deterministic incremental update or full rebuild. |
| `branch_context_clear` | `repo_path?`, `branch?`, `all?`, `storage_path?` | Clears rendered context for a single branch or all branches in a repository. |
| `branch_context_clear_storage` | `confirm: boolean`, `storage_path?` | Wipes the entire storage across all repositories (requires `confirm: true`). |

---

## 📄 Rendered Document Structure

Each rendered branch document contains both a structured JSON object (`document.json`) and an AI-friendly Markdown representation (`document.md`):

- **Repository & Branch Metadata**: Unique IDs, remote URLs, comparison refs, and commit hashes.
- **Commit History**: Full list of commits with authors, dates, subjects, and commit bodies (with secret filtering).
- **File Changes & Diff Statistics**: Detailed file list with change status (`added`, `modified`, `deleted`, `renamed`), patch chunks, insertions, and deletions.
- **Freshness & Checkpoint State**: Saved commit SHAs and timestamps used for ultra-fast incremental re-evaluation.

---

## 🧪 Development & Testing

```bash
# Run Vitest test suite
npm test

# Build TypeScript output
npm run build
```

---

## 📜 License

MIT License. Designed for AI agentic workflows and automated coding assistants.
