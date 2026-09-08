import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BranchContextOrchestrator } from '../core/orchestrator.js';
import { StoragePaths } from '../core/storage/paths.js';
import { Logger } from '../utils/logger.js';

export function createMcpServer(customStorePath?: string): McpServer {
  StoragePaths.ensureStoreDirectory(customStorePath || StoragePaths.getDefaultStorePath());

  const server = new McpServer({
    name: 'mcp-branch-render-context',
    version: '1.1.0',
  });

  const getOrchestrator = (storePath?: string) => {
    return new BranchContextOrchestrator(storePath || customStorePath);
  };

  // 1. TOOL: branch_context_start
  server.tool(
    'branch_context_start',
    'Initialize or load branch render context session for target PR branch',
    {
      repo_path: z.string().optional().describe('Path to git repository (default: .)'),
      branch: z.string().optional().describe('Target branch to analyze (default: current checkout branch)'),
      storage_path: z.string().optional().describe('Custom storage path (default: repo-local .branch-render-context)'),
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

  // 2. TOOL: branch_context_list
  server.tool(
    'branch_context_list',
    'List all repositories and branch documents currently registered',
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

  // 3. TOOL: branch_context_status
  server.tool(
    'branch_context_status',
    'Check git freshness and changes of target branch vs checkout base branch without rendering',
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
                  ai_prompt: `Please read this document file to understand what feature this branch is working on.\nDocument file: ${status.document_path}`,
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

  // 4. TOOL: branch_context_get
  server.tool(
    'branch_context_get',
    'Get single logical branch document with freshness guarantees (default policy: required)',
    {
      repo_path: z.string().optional().describe('Path to git repository (default: .)'),
      branch: z.string().optional().describe('Target branch name (default: current checkout branch)'),
      freshness: z
        .enum(['required', 'auto', 'check_only', 'allow_stale'])
        .default('required')
        .describe('Freshness requirement policy. "required" refuses stale context, "auto" auto-refreshes.'),
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
                  text: `ERROR: Document for target branch "${status.target_branch}" (vs base "${status.base_branch}") is ${status.evaluation.status} (New commits: ${status.evaluation.newCommitsCount}, Changed files: ${status.evaluation.changedFilesCount}). Freshness mode is "required". Please call branch_context_refresh first or use freshness="auto".`,
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
                text: `No document exists yet for branch "${status.target_branch}". Call branch_context_refresh with freshness="auto" or refresh command.`,
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

  // 5. TOOL: branch_context_refresh
  server.tool(
    'branch_context_refresh',
    'Refresh and synchronize target branch document vs checkout base branch',
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
                  ai_prompt: `Please read this document file to understand what feature this branch is working on.\nDocument file: ${r.document_path}`,
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

  // 6. TOOL: branch_context_clear
  server.tool(
    'branch_context_clear',
    'Clear and delete rendered document context for a specific branch or all branches',
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

  // 7. TOOL: branch_context_clear_storage
  server.tool(
    'branch_context_clear_storage',
    'Clear and delete the ENTIRE storage (all repositories, documents, config, indexes). Requires confirm: true.',
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
