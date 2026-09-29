# AI Agent Rules: Git Context & Branch Analysis

When operating in this codebase or any repository managed by `mcp-branch-render-document`, you MUST adhere to the following rules:

---

### RULE 1: Never Switch Git Branches
- **NEVER** run `git checkout <branch>`, `git switch <branch>`, or `git stash` to inspect a feature or PR branch.
- The developer's active working tree must remain pristine and undisturbed at all times.
- All target branch comparisons must be performed via the MCP server.

---

### RULE 2: Use `get_branch_context` for Branch Knowledge
- When asked to analyze, review, write tests for, or implement features on a branch, call the MCP tool:
  ```json
  {
    "tool": "get_branch_context",
    "arguments": {
      "branch": "<target-branch>",
      "detail": "summary"
    }
  }
  ```
- Alternatively, read the MCP Resource `branch-context://<target-branch>`.
- Do not perform manual git log, diff, or file-by-file investigations across branches.

---

### RULE 3: Token Economy (Summary First)
- Always start with `detail: "summary"` (default).
- Inspect the returned Markdown summary:
  - **Summary & Intent:** Why the branch exists.
  - **Commits:** Chronological commit subjects and authors.
  - **Changed Files:** Modified, added, or deleted files.
  - **Risks & Edge Cases:** Architecture risks and sensitive areas detected.
  - **Tests Detected:** Existing unit/integration test coverage.
  - **Next Relevant Files:** Priority files to examine.
- Only switch to `detail: "full"` if you explicitly need raw JSON diff chunks for line-level patching.

---

### RULE 4: Treat `ai-context/` as Read-Only MCP Storage
- The directory `ai-context/` is the standard storage location for MCP-rendered branch documents.
- Do NOT edit, commit, or delete files inside `ai-context/` manually.
- If you need to refresh or clear cache, use `get_branch_context(force_refresh=true)` or `manage_branch_cache(...)`.

---

### RULE 5: Verify Risks and Tests Before Completing PR Tasks
- Before claiming a PR review is complete or that a branch is ready to merge:
  1. Check the `Risks & Considerations` section in the context.
  2. Verify that every changed file in `Changed Files` has a corresponding test in `Tests Detected`.
  3. Ensure untracked/dirty files on the checkout branch did not leak into the target branch context.
