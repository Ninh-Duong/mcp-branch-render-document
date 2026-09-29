import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BranchContextOrchestrator } from '../core/orchestrator.js';
import { StoragePaths } from '../core/storage/paths.js';
import { MarkdownRenderer } from '../core/renderer/markdown.js';
import { Logger } from '../utils/logger.js';

export function createMcpServer(customStorePath?: string): McpServer {
  StoragePaths.ensureStoreDirectory(customStorePath || StoragePaths.getDefaultStorePath());

  const server = new McpServer({
    name: 'mcp-branch-render-context',
    version: '1.2.0',
  });

  const getOrchestrator = (storePath?: string) => {
    return new BranchContextOrchestrator(storePath || customStorePath);
  };

  // =========================================================================
  // 1. PRIMARY AI AGENT TOOL: get_branch_context
  // Zero-friction, auto-freshness by default, returns token-efficient markdown directly.
  // =========================================================================
  server.tool(
    'get_branch_context',
    'Get fresh, token-optimized context (summary, commits, file changes, risks, metrics) for a target Git branch relative to base. Automatically synchronizes if stale.',
    {
      branch: z.string().optional().describe('Target branch to analyze (default: current checkout branch)'),
      base: z.string().optional().describe('Base branch to compare against (default: auto-detected base or default branch)'),
      detail: z
        .enum(['summary', 'full'])
        .default('summary')
        .describe('Level of detail: "summary" for high-signal Markdown overview, "full" for complete structured JSON'),
      force_refresh: z.boolean().default(false).describe('Force re-render even if cache is fresh'),
      repo_path: z.string().optional().describe('Path to git repository (default: .)'),
      storage_path: z.string().optional().describe('Custom storage path (default: repo-local ai-context/)'),
    },
    async ({ branch, base, detail, force_refresh, repo_path, storage_path }) => {
      try {
        const orchestrator = getOrchestrator(storage_path);
        const repo = repo_path || '.';

        const status = await orchestrator.getStatus({
          repoPath: repo,
          branchName: branch,
          baseRef: base,
          storagePath: storage_path,
        });

        let document = status.document;

        // Auto-refresh when stale, missing, or explicitly forced (Zero Ping-Pong)
        if (force_refresh || status.evaluation.status !== 'FRESH' || !document) {
          const refreshed = await orchestrator.refreshBranch({
            repoPath: repo,
            branchName: branch,
            baseRef: base,
            force: force_refresh,
            storagePath: storage_path,
          });
          document = refreshed.document;
        }

        if (!document) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Unable to render branch context for "${branch || status.target_branch}".`,
              },
            ],
          };
        }

        if (detail === 'full') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(document, null, 2),
              },
            ],
          };
        }

        // Return token-efficient, human/LLM-optimized Markdown directly
        const markdown = MarkdownRenderer.render(document);
        return {
          content: [
            {
              type: 'text',
              text: markdown,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error retrieving branch context: ${err.message}` }],
        };
      }
    }
  );

  // =========================================================================
  // 2. MAINTENANCE TOOL: manage_branch_cache
  // Consolidated admin operations: status, listing, clearing branch, wiping storage.
  // =========================================================================
  server.tool(
    'manage_branch_cache',
    'Administrative management for branch context cache (status check, catalog listing, clearing branch cache, or storage wiping)',
    {
      action: z
        .enum(['status', 'list', 'clear_branch', 'clear_all_branches', 'clear_all_storage'])
        .describe('Cache maintenance action to perform'),
      branch: z.string().optional().describe('Target branch name (used for "status" or "clear_branch")'),
      repo_path: z.string().optional().describe('Repository path (default: .)'),
      confirm: z
        .boolean()
        .optional()
        .describe('Must be set to true when action is "clear_all_storage"'),
      storage_path: z.string().optional().describe('Custom storage path'),
    },
    async ({ action, branch, repo_path, confirm, storage_path }) => {
      try {
        const orchestrator = getOrchestrator(storage_path);
        const repo = repo_path || '.';

        switch (action) {
          case 'status': {
            const status = await orchestrator.getStatus({
              repoPath: repo,
              branchName: branch,
              storagePath: storage_path,
            });
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      target_branch: status.target_branch,
                      checkout_branch: status.checkout_branch,
                      base_branch: status.base_branch,
                      target_commit: status.target_commit,
                      base_commit: status.base_commit,
                      freshness_status: status.evaluation.status,
                      new_commits_count: status.evaluation.newCommitsCount,
                      changed_files_count: status.evaluation.changedFilesCount,
                      document_path: status.document_path,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          }

          case 'list': {
            const { storePath, registry } = await orchestrator.discoverRepository(repo, storage_path);
            const catalog = await registry.loadCatalog();
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ storage_path: storePath, catalog }, null, 2),
                },
              ],
            };
          }

          case 'clear_branch': {
            const result = await orchestrator.clearContext({
              repoPath: repo,
              branchName: branch,
              all: false,
              storagePath: storage_path,
            });
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ success: true, cleared_branches: result.clearedBranches }, null, 2),
                },
              ],
            };
          }

          case 'clear_all_branches': {
            const result = await orchestrator.clearContext({
              repoPath: repo,
              all: true,
              storagePath: storage_path,
            });
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    { success: true, cleared_count: result.clearedCount, cleared_branches: result.clearedBranches },
                    null,
                    2
                  ),
                },
              ],
            };
          }

          case 'clear_all_storage': {
            if (!confirm) {
              return {
                isError: true,
                content: [{ type: 'text', text: 'Operation aborted: confirm must be true to wipe all storage.' }],
              };
            }
            const result = await orchestrator.clearStorage({ storagePath: storage_path });
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ success: true, ...result }, null, 2),
                },
              ],
            };
          }
        }
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error executing cache action: ${err.message}` }],
        };
      }
    }
  );

  // =========================================================================
  // 3. MCP RESOURCE: branch-context://{branch}
  // Allows AI Agent / Clients to attach branch context directly without a tool call turn.
  // =========================================================================
  server.resource(
    'branch_context',
    new ResourceTemplate('branch-context://{branch}', { list: undefined }),
    async (uri, { branch }) => {
      try {
        const targetBranch = Array.isArray(branch) ? branch[0] : branch;
        const orchestrator = getOrchestrator();
        const status = await orchestrator.getStatus({
          repoPath: '.',
          branchName: targetBranch,
        });

        let doc = status.document;
        if (status.evaluation.status !== 'FRESH' || !doc) {
          const refreshed = await orchestrator.refreshBranch({
            repoPath: '.',
            branchName: targetBranch,
          });
          doc = refreshed.document;
        }

        const text = doc ? MarkdownRenderer.render(doc) : `# Branch Context: ${targetBranch}\n\nNo document available.`;

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'text/markdown',
              text,
            },
          ],
        };
      } catch (err: any) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'text/plain',
              text: `Error loading branch context resource: ${err.message}`,
            },
          ],
        };
      }
    }
  );

  // =========================================================================
  // 4. MCP PROMPTS: Pre-engineered Agent Workflows
  // =========================================================================
  server.prompt(
    'review_pr_branch',
    'Review code changes, risks, and test coverage for a PR branch against base',
    {
      branch: z.string().optional().describe('Target branch name to review (default: current checkout branch)'),
      base: z.string().optional().describe('Base branch name to compare against'),
    },
    async ({ branch, base }) => {
      const orchestrator = getOrchestrator();
      const refreshed = await orchestrator.refreshBranch({
        repoPath: '.',
        branchName: branch,
        baseRef: base,
      });

      const md = refreshed.document ? MarkdownRenderer.render(refreshed.document) : `Branch: ${branch || 'current'}`;

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `You are an expert software engineer reviewing the PR branch "${refreshed.target_branch}" compared to base "${refreshed.base_branch}".\n\nVerified Branch Context:\n${md}\n\nPlease perform a comprehensive review:\n1. Verify if the commit intents align with the file changes.\n2. Spot architectural risks, security concerns, or breaking changes.\n3. Check test coverage for newly added/modified logic.\n4. Recommend missing edge-case tests or follow-up tasks.`,
            },
          },
        ],
      };
    }
  );

  server.prompt(
    'summarize_branch_changes',
    'Summarize intent, scope, and key implementation details of a branch',
    {
      branch: z.string().optional().describe('Target branch to summarize (default: current checkout branch)'),
    },
    async ({ branch }) => {
      const orchestrator = getOrchestrator();
      const status = await orchestrator.getStatus({
        repoPath: '.',
        branchName: branch,
      });

      let doc = status.document;
      if (status.evaluation.status !== 'FRESH' || !doc) {
        const refreshed = await orchestrator.refreshBranch({
          repoPath: '.',
          branchName: branch,
        });
        doc = refreshed.document;
      }

      const md = doc ? MarkdownRenderer.render(doc) : `Branch: ${branch || status.target_branch}`;

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please summarize the key purpose, architectural impact, and changed components of branch "${branch || status.target_branch}":\n\n${md}`,
            },
          },
        ],
      };
    }
  );

  // =========================================================================
  // 5. BACKWARD-COMPATIBILITY TOOLS (Deprecated aliases for existing scripts/tests)
  // =========================================================================
  server.tool(
    'branch_context_start',
    '[DEPRECATED: Use get_branch_context] Initialize or load branch render context session for target PR branch',
    {
      repo_path: z.string().optional().describe('Path to git repository (default: .)'),
      branch: z.string().optional().describe('Target branch to analyze (default: current checkout branch)'),
      storage_path: z.string().optional().describe('Custom storage path'),
    },
    async ({ repo_path, branch, storage_path }) => {
      try {
        const orchestrator = getOrchestrator(storage_path);
        const status = await orchestrator.getStatus({
          repoPath: repo_path || '.',
          branchName: branch,
          storagePath: storage_path,
        });

        const catalog = await orchestrator.getRegistry(status.state.repository_id).loadCatalog();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  repository: status.repository,
                  target_branch: status.target_branch,
                  checkout_branch: status.checkout_branch,
                  base_branch: status.base_branch,
                  status: status.evaluation.status,
                  target_commit: status.target_commit,
                  base_commit: status.base_commit,
                  pending_new_commits: status.evaluation.newCommitsCount,
                  pending_changed_files: status.evaluation.changedFilesCount,
                  catalog_summary: {
                    total_repositories: catalog.repositories.length,
                    registered_branches: catalog.repositories.flatMap((r) => r.branches).length,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error starting branch context: ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    'branch_context_list',
    '[DEPRECATED: Use manage_branch_cache(action="list")] List all repositories and branch documents currently registered',
    {
      repo_path: z.string().optional().describe('Repository path (default: .)'),
      storage_path: z.string().optional().describe('Custom storage path'),
    },
    async ({ repo_path, storage_path }) => {
      try {
        const orchestrator = getOrchestrator(storage_path);
        const { storePath, registry } = await orchestrator.discoverRepository(repo_path || '.', storage_path);
        const catalog = await registry.loadCatalog();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ storage_path: storePath, catalog }, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error listing branch contexts: ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    'branch_context_status',
    '[DEPRECATED: Use manage_branch_cache(action="status")] Check git freshness and changes of target branch vs checkout base branch',
    {
      repo_path: z.string().optional().describe('Path to git repository (default: .)'),
      branch: z.string().optional().describe('Target branch name (default: current checkout branch)'),
      storage_path: z.string().optional().describe('Custom storage path'),
    },
    async ({ repo_path, branch, storage_path }) => {
      try {
        const orchestrator = getOrchestrator(storage_path);
        const status = await orchestrator.getStatus({
          repoPath: repo_path || '.',
          branchName: branch,
          storagePath: storage_path,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  target_branch: status.target_branch,
                  checkout_branch: status.checkout_branch,
                  base_branch: status.base_branch,
                  target_commit: status.target_commit,
                  base_commit: status.base_commit,
                  comparison: status.comparison,
                  freshness_status: status.evaluation.status,
                  comparison_relation: status.evaluation.comparisonRelation,
                  new_commits_count: status.evaluation.newCommitsCount,
                  changed_files_count: status.evaluation.changedFilesCount,
                  last_rendered_at: status.state.last_rendered_at,
                  document_path: status.document_path,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error checking status: ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    'branch_context_get',
    '[DEPRECATED: Use get_branch_context] Get single logical branch document with freshness guarantees',
    {
      repo_path: z.string().optional().describe('Path to git repository (default: .)'),
      branch: z.string().optional().describe('Target branch name (default: current checkout branch)'),
      freshness: z
        .enum(['required', 'auto', 'check_only', 'allow_stale'])
        .default('auto')
        .describe('Freshness requirement policy. Defaults to "auto" to prevent unnecessary failures.'),
      mode: z.enum(['compact', 'full']).default('compact').describe('Response mode'),
      storage_path: z.string().optional().describe('Custom storage path'),
    },
    async ({ repo_path, branch, freshness, mode, storage_path }) => {
      try {
        const orchestrator = getOrchestrator(storage_path);
        const status = await orchestrator.getStatus({
          repoPath: repo_path || '.',
          branchName: branch,
          storagePath: storage_path,
        });

        if (freshness === 'check_only') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    status: status.evaluation.status,
                    target_commit: status.target_commit,
                    base_commit: status.base_commit,
                    new_commits: status.evaluation.newCommitsCount,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        let document = status.document;

        if (status.evaluation.status !== 'FRESH') {
          if (freshness === 'required') {
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: `ERROR: Document for target branch "${status.target_branch}" is ${status.evaluation.status}. Please use freshness="auto".`,
                },
              ],
            };
          } else if (freshness === 'auto') {
            const refreshed = await orchestrator.refreshBranch({
              repoPath: repo_path || '.',
              branchName: branch,
              storagePath: storage_path,
            });
            document = refreshed.document;
          }
        }

        if (!document) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `No document exists yet for branch "${status.target_branch}".`,
              },
            ],
          };
        }

        let responseText = '';
        if (mode === 'compact') {
          const compactDoc = {
            document_id: document.document_id,
            target_branch: document.source.target_branch,
            base_branch: document.source.base_branch,
            target_commit: document.source.target_commit.slice(0, 8),
            base_commit: document.source.base_commit.slice(0, 8),
            freshness: document.freshness.status,
            rendered_at: document.freshness.rendered_at,
            summary: document.content.summary,
            commit_count: document.content.intent?.commit_count || document.content.commits?.length || 0,
            scope: document.content.scope,
            risks: document.content.risks,
            unknowns: document.content.unknowns,
            changes_summary: document.content.changes.slice(0, 30),
            next_relevant_files: document.content.next_relevant_files,
          };
          responseText = JSON.stringify(compactDoc, null, 2);
        } else {
          responseText = JSON.stringify(document, null, 2);
        }

        return {
          content: [
            {
              type: 'text',
              text: responseText,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error getting branch context: ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    'branch_context_refresh',
    '[DEPRECATED: Use get_branch_context(force_refresh=true)] Refresh and synchronize target branch document vs checkout base branch',
    {
      repo_path: z.string().optional().describe('Path to git repository (default: .)'),
      branch: z.string().optional().describe('Target branch name to render (default: current checkout branch)'),
      scope: z.enum(['current', 'stale', 'all', 'none']).default('current'),
      force: z.boolean().default(false).describe('Force refresh even if already fresh'),
      storage_path: z.string().optional().describe('Custom storage path'),
    },
    async ({ repo_path, branch, scope, force, storage_path }) => {
      try {
        const orchestrator = getOrchestrator(storage_path);
        const results = await orchestrator.executeRefreshScope(
          repo_path || '.',
          scope,
          branch,
          force,
          storage_path
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                results.map((r) => ({
                  target_branch: r.target_branch,
                  checkout_branch: r.checkout_branch,
                  base_branch: r.base_branch,
                  target_commit: r.target_commit,
                  base_commit: r.base_commit,
                  comparison: r.comparison,
                  strategy: r.strategy,
                  rendered: r.rendered,
                  rendered_commits_count: r.rendered_commits_count,
                  changed_files_count: r.changed_files_count,
                  insertions: r.insertions,
                  deletions: r.deletions,
                  checkout_worktree_included: r.checkout_worktree_included,
                  document_path: r.document_path,
                })),
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error refreshing branch context: ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    'branch_context_clear',
    '[DEPRECATED: Use manage_branch_cache(action="clear_branch")] Clear rendered document context for a branch or all branches',
    {
      repo_path: z.string().optional().describe('Path to git repository (default: .)'),
      branch: z.string().optional().describe('Target branch name to clear (default: current checkout branch)'),
      all: z.boolean().optional().default(false).describe('Clear all branch documents in the repository'),
      storage_path: z.string().optional().describe('Custom storage path'),
    },
    async ({ repo_path, branch, all, storage_path }) => {
      try {
        const orchestrator = getOrchestrator(storage_path);
        const result = await orchestrator.clearContext({
          repoPath: repo_path || '.',
          branchName: branch,
          all,
          storagePath: storage_path,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  cleared_count: result.clearedCount,
                  cleared_branches: result.clearedBranches,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error clearing branch context: ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    'branch_context_clear_storage',
    '[DEPRECATED: Use manage_branch_cache(action="clear_all_storage")] Clear and delete the ENTIRE storage',
    {
      storage_path: z.string().optional().describe('Custom storage path'),
      confirm: z.boolean().describe('Must be set to true to confirm complete storage wipe'),
    },
    async ({ storage_path, confirm }) => {
      if (!confirm) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'Operation aborted: confirm must be set to true to wipe all storage.',
            },
          ],
        };
      }

      try {
        const orchestrator = getOrchestrator(storage_path);
        const result = await orchestrator.clearStorage({
          storagePath: storage_path,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  cleared_repository_count: result.clearedRepositoryCount,
                  cleared_branch_count: result.clearedBranchCount,
                  removed_entries: result.removedEntries,
                  failed_entries: result.failedEntries,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error clearing storage: ${err.message}` }],
        };
      }
    }
  );

  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  Logger.info('Branch Render Context MCP Server running on stdio');
}
