# Automatic PR Branch Document Renderer (Branch Render Context MCP)

**Automatic PR Branch Document Renderer** là hệ thống MCP Server & CLI chuyên dụng giúp tự động phân tích và kết xuất ngữ cảnh PR branch / target branch so với branch hiện tại (checkout base branch), lưu trữ document cục bộ trong repo (`.branch-render-context/`), tự động cập nhật `.gitignore`, và đồng bộ lũy tiến cho AI Agent.

---

## 🎯 Điểm Nổi Bật Của Workflow Mới

1. **Chỉ Cần Nhập Target Branch**:
   - Khi repository đang checkout ở `release/eagers` và bạn chỉ định `hotfix/Eagers-BE/WCE-946-eagers`, hệ thống tự động hiểu:
     - `baseBranch`: `release/eagers` (từ checkout hiện tại)
     - `targetBranch`: `hotfix/Eagers-BE/WCE-946-eagers`
     - Phép so sánh: `release/eagers..hotfix/Eagers-BE/WCE-946-eagers`
2. **Tuyệt Đối KHÔNG Switch Branch**:
   - Working tree của developer luôn giữ nguyên branch hiện tại. Không bao giờ tự ý `git checkout` hay `git switch`.
3. **Target Commit Resolve Độc Lập**:
   - Commit của target branch được resolve từ local ref hoặc remote ref (`origin/...`), không lấy nhầm HEAD hiện tại.
4. **Cách Ly Working Tree (Clean Isolation)**:
   - Khi target branch khác checkout branch, các thay đổi dirty trên checkout branch sẽ không bị đưa vào document của target branch.
5. **Kho Lưu Trữ Cục Bộ Repo (`repo-local`) & Tự Động `.gitignore`**:
   - Mặc định lưu trữ tại `<repo-root>/.branch-render-context/`.
   - Tự động thêm `/.branch-render-context/` vào `.gitignore` một cách idempotent, không duplicate, không ghi đè rule khác.
6. **Lưu Trữ Danh Sách Commits Đầy Đủ**:
   - `document.json` lưu toàn bộ danh sách commits (kèm che giấu thông tin nhạy cảm - secret redaction).
7. **Đầy Đủ Diff Metrics trong Response**:
   - Trả về chi tiết: `rendered_commits_count`, `changed_files_count`, `insertions`, `deletions`.

---

## 🛠️ Hướng Dẫn Sử Dụng CLI

### 1. Phân tích Target Branch qua CLI
```bash
# Phân tích target branch so với branch đang checkout
npm run branch-render:refresh -- --branch hotfix/Eagers-BE/WCE-946-eagers
```

Output:
```text
=================================================================
Target branch:   hotfix/Eagers-BE/WCE-946-eagers
Checkout branch: release/eagers
Base branch:     release/eagers
Comparison:      release/eagers..hotfix/Eagers-BE/WCE-946-eagers
Target commit:   223bed2a
Base commit:     8c702b98
Strategy:        full
─────────────────────────────────────────────────────────────────
Metrics:
- Commits:        2
- Changed files:  2
- Insertions:     +62
- Deletions:      -4
- Worktree dirty: ignored (clean isolation)
─────────────────────────────────────────────────────────────────
Document path:
.branch-render-context/repositories/r_a13f92c1/branches/b_91a2/document.json
=================================================================
```

### 2. Interactive Terminal Wizard
```bash
npm run branch-render:start
```
Wizard tự động phát hiện checkout branch và hỏi bạn target branch cần render.

### 3. Kiểm Tra Freshness
```bash
npm run branch-render:status -- --branch hotfix/Eagers-BE/WCE-946-eagers
```

### 4. Liệt Kê Danh Mục Document Đã Lưu
```bash
npm run branch-render:list
```

---

## 🤖 MCP Server Tools

Cấu hình MCP Server trong file config của bạn:
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

### Danh sách Tools:

| Tool Name | Mô tả |
|---|---|
| `branch_context_start` | Khởi tạo session, quét catalog và kiểm tra target branch |
| `branch_context_list` | Liệt kê tất cả repositories và branch documents đã đăng ký |
| `branch_context_status` | Kiểm tra Git freshness mà không render |
| `branch_context_get` | Đọc `document.json` với chính sách freshness (`required` mặc định, `auto`, `check_only`, `allow_stale`) |
| `branch_context_refresh` | Trigger cập nhật lũy tiến hoặc full rebuild cho target branch |

---

## 🧪 Testing

```bash
# Chạy Vitest test suite
npm test

# Build TypeScript
npm run build
```
