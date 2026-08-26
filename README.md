# MCP Branch Render Document

MCP Server và CLI này tạo một **branch context document** để AI Agent hiểu branch hiện tại mà không phải đọc lại toàn bộ repository ở mỗi prompt.

Mỗi repository/branch có một document duy nhất. Khi branch có commit mới, document cũ được cập nhật tại chỗ và không tạo thêm document thứ hai.

## Feature làm gì?

- Phát hiện repository và branch hiện tại.
- Đọc Git HEAD, base ref, commit mới và working tree.
- Tạo context document dạng `document.json`.
- Phát hiện document đã stale sau khi code và commit mới.
- Incremental update khi có commit mới.
- Full rebuild khi branch bị rebase, reset hoặc base ref thay đổi.
- Không trả context stale ở freshness mode mặc định `required`.
- Lưu dữ liệu branch ngoài source repository theo mặc định.
- Tự kiểm tra và cài dependency còn thiếu khi chạy command.

## Yêu cầu

- Node.js `>=22.12.0`
- npm
- Git

Khi chạy các npm script, feature sẽ kiểm tra `package.json`, `package-lock.json` và `node_modules`. Nếu thiếu package hoặc lockfile lệch, feature sẽ chạy `npm ci` hoặc `npm install` tương ứng.

Tắt tự động cài dependency khi cần:

```powershell
$env:BRANCH_RENDER_SKIP_INSTALL = "1"
```

## Cài đặt

Clone repository rồi chạy command mong muốn. Không cần cài package thủ công trước:

```bash
npm run branch-render:start
```

Hoặc cài rõ ràng trước:

```bash
npm run setup
npm run build
```

## Sử dụng CLI

### Khởi động interactive wizard

```bash
npm run branch-render:start
```

Wizard hỏi tuần tự:

1. Repository path.
2. Branch.
3. Base ref, ví dụ `origin/main` hoặc `main`.
4. Storage path.
5. Refresh scope: `current`, `stale`, `all`, `none`.
6. Có include staged/unstaged/untracked changes hay không.
7. Renderer mode.
8. Có lưu cấu hình hay không.
9. Có render ngay hay không.

### Chạy không tương tác

```bash
npm run branch-render:start -- --non-interactive --repo . --refresh current
```

### Liệt kê branch documents

```bash
npm run branch-render:list
```

### Kiểm tra freshness

```bash
npm run branch-render:status -- --repo .
```

### Refresh document hiện tại

```bash
npm run branch-render:refresh -- --repo .
```

Force refresh:

```bash
npm run branch-render:refresh -- --repo . --force
```

## Cấu hình

Storage mặc định nằm ngoài source repository theo thư mục AppData của hệ điều hành. Có thể chỉ định storage bằng wizard, CLI hoặc biến môi trường:

```powershell
$env:BRANCH_CONTEXT_STORE = ".branch-render-context"
```

Cấu hình được lưu trong `config.json` của storage. Giá trị `storage_path` được ghi dưới dạng placeholder tương đối; đường dẫn runtime được lấy từ storage đang mở nên không phụ thuộc vào máy đã tạo config.

Các đường dẫn tuyệt đối chỉ được tạo tạm thời trong runtime để Git và filesystem hoạt động. Chúng không được hardcode trong source và không được ghi vào branch metadata.

Các option chính:

```json
{
  "default_base_ref": "origin/main",
  "default_refresh_scope": "current",
  "include_working_tree": true,
  "default_renderer_mode": "deterministic",
  "default_freshness_mode": "required",
  "max_diff_bytes": 5242880,
  "secret_patterns": [
    "**/.env*",
    "**/*.pem",
    "**/*.key",
    "**/credentials*",
    "**/secrets*"
  ]
}
```

## Storage document

Storage có cấu trúc:

```text
<BRANCH_CONTEXT_STORE>/
├── config.json
├── catalog.json
└── repositories/
    └── r_<repository-id>/
        └── branches/
            └── b_<branch-id>/
                ├── branch.json
                ├── document.json
                ├── state.json
                ├── history.jsonl
                └── evidence/
```

`document.json` là document duy nhất AI Agent cần đọc. `state.json` lưu HEAD đã render, HEAD hiện tại và freshness. `history.jsonl` chỉ là metadata audit, không chứa các bản document cũ.

Dữ liệu branch/context có thể chứa thông tin nội bộ nên không được commit vào source repository. Các tên storage phổ biến đã được thêm vào `.gitignore`.

## MCP Server

Build trước:

```bash
npm run build
```

Start MCP bằng stdio:

```bash
npm run mcp:start
```

MCP tools:

- `branch_context_start`: khởi tạo hoặc load branch context.
- `branch_context_list`: liệt kê repository và branch documents.
- `branch_context_status`: kiểm tra freshness mà không render.
- `branch_context_get`: đọc document với freshness policy.
- `branch_context_refresh`: cập nhật document hiện tại.

`branch_context_get` dùng `freshness: "required"` mặc định. Nếu document stale, Agent phải refresh trước khi sử dụng.

## Kiểm tra

```bash
npm run build
npm test
```

Nếu môi trường sandbox không cho Vitest tạo file tạm trong `node_modules`, chạy test trong terminal có quyền ghi hoặc sửa quyền của thư mục project.
