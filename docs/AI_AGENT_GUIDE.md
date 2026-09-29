# AI Agent Integration & Usage Guide (MCP Branch Context)

Welcome, AI Agent (Claude, Cursor, Cline, Roo Code, Antigravity, Copilot Workspace). This guide defines the standard operational procedures for using `mcp-branch-render-document`.

---

## 🎯 Purpose & Core Value

When assisting developers in multi-branch Git repositories, AI Agents frequently need to understand:
- What changes were introduced in a feature/PR branch?
- What are the modified files, functions, dependencies, and risks?
- Are tests covering the modified modules?

**Traditional Problem:** Running `git checkout <feature>` disrupts developer worktrees, breaks running servers, or creates conflicts with uncommitted changes. Guessing diffs or running ad-hoc git commands wastes dozens of round-trips and thousands of tokens.

**The Solution:** This MCP server provides **1-call, zero-working-tree-disruption Git context rendering**. It computes commits, diff metrics, affected modules, and risks, saving results in a unified `ai-context/` storage and returning concise, high-signal Markdown directly into your context window.

---

## 🛠️ MCP Primitives for AI Agents

### 1. Primary Tool: `get_branch_context`

This is your **primary tool**. It requires zero preparation and executes in a single round-trip.

#### When to call:
- When the user asks: *"Review branch `feature/auth`"*, *"What changes are in this PR?"*, *"Help me fix tests for branch X"*, or *"What is this branch doing?"*.
- Before making modifications or refactoring code that belongs to an active feature branch.

#### Parameters:
| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `branch` | `string` | *(current checkout)* | Name of the target branch to analyze. |
| `base` | `string` | *(auto-detected)* | Base branch to compare against (e.g. `main`, `develop`, `release/...`). |
| `detail` | `'summary' \| 'full'` | `'summary'` | **Use `'summary'`** for token-efficient overview, changed files list, risks, and tests. Use `'full'` only when you explicitly need complete structured JSON with raw commit trees. |
| `force_refresh` | `boolean` | `false` | Force recalculating git diff even if cache is marked fresh. |
| `repo_path` | `string` | `'.'` | Repository root path. |

#### Behavior:
- **Zero Ping-Pong:** Automatically detects git freshness. If new commits were pushed or the cache is missing, it synchronizes in the background and returns the latest context immediately.
- **Direct Markdown Output:** Returns high-signal Markdown ready for immediate comprehension—no secondary file-reading steps required.

---

### 2. MCP Resource: `branch-context://{branch}`

For MCP clients that support direct resource attachment (e.g. Claude Desktop, Cursor), you or the developer can attach the branch context as a document without consuming a tool invocation:

- **URI Format:** `branch-context://{branch}` (e.g. `branch-context://feature/user-auth`)
- **Content Type:** `text/markdown`
- Returns the rendered `document.md` directly.

---

### 3. MCP Prompts: Pre-Engineered Workflows

When the user initiates a standardized task, leverage the built-in MCP prompts:

- `review_pr_branch`: Automatically injects the fresh branch context into a code-review system template focusing on architectural risks, missing tests, and regressions.
- `summarize_branch_changes`: Injects the branch context into a concise summary template focusing on intent, scope, and key touched files.

---

### 4. Maintenance Tool: `manage_branch_cache`

Agents should only call this tool if explicit cache management is requested by the user:

- `action: "status"`: Inspect freshness without rendering.
- `action: "list"`: Inspect all cached repositories and branches.
- `action: "clear_branch"`: Invalidate cache for a specific branch.
- `action: "clear_all_branches"`: Clear cached contexts for the current repository.
- `action: "clear_all_storage"`: Full wipe across all repositories (`confirm: true` required).

---

## 📁 Standard Storage Standard: `ai-context/`

All rendered branch contexts and metadata are persisted in the repository's root inside the `ai-context/` folder:

```text
<repository-root>/
├── ai-context/                       # Standard MCP AI Context folder (auto-gitignored)
│   ├── catalog.json                  # Global registry of analyzed repositories & branches
│   ├── config.json                   # Caching policies, secret patterns, and defaults
│   └── repositories/
│       └── <repo-id>/
│           ├── repository.json       # Repository metadata & remote URLs
│           └── branches/
│               └── <branch-path>/    # Hierarchical branch path (e.g. feature/user-auth)
│                   ├── document.md   # Human & LLM optimized Markdown summary
│                   ├── document.json # Structured AST, diff chunks, commit list
│                   ├── state.json    # Commit checkpoints for fast incremental updates
│                   └── history.jsonl # Audit log of changes & updates
```

> [!NOTE]
> `ai-context/` is automatically added to `.gitignore` by the server. Never commit this folder to version control.

---

## 📋 Best Practices & Operational Rules (Dos & Don'ts)

### ✅ DO:
1. **Always use `detail: 'summary'` first:** It gives you the PR intent, commit messages, changed files table (+/- line counts), risks, tests, and next relevant files in ~500–1,500 tokens.
2. **Consult `next_relevant_files`:** The orchestrator highlights key entry points and dependent files to examine.
3. **Respect developer worktree isolation:** Never run `git checkout` or `git switch` just to inspect code from another branch.
4. **Use `manage_branch_cache` for cache issues:** If you suspect stale context after a complex rebase, invoke `get_branch_context` with `force_refresh: true`.

### ❌ DON'T:
1. **DON'T run manual git diffs across branches:** Let the MCP server perform secret redaction, delta tracking, and structured diff parsing.
2. **DON'T manually edit or delete files in `ai-context/`:** Files are locked via `.branch.lock` during writes to prevent race conditions.
3. **DON'T request `'full'` detail unless necessary:** Full structured JSON dumps large commit metadata and can quickly fill your context window.
