import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { BranchContextOrchestrator } from '../core/orchestrator.js';
import { Logger } from '../utils/logger.js';

export function createMcpServer(customStorePath?: string): McpServer {
  const server = new McpServer({
    name: 'mcp-branch-render-context',
    version: '1.0.0',
  });

  const getOrchestrator = (storePath?: string) => {
    return new BranchContextOrchestrator(storePath || customStorePath);
  };

  // 1. TOOL: branch_context_start
  server.tool(
    'branch_context_start',
    'Initialize or load branch render context session and scan catalog',
    {
      repo_path: z.string().optional().describe('Path to git repository (default: .)'),
      branch: z.string().optional().describe('Specific branch to initialize'),
      base_ref: z.string().optional().describe('Base ref/branch (default: origin/main or auto-resolved)'),
      storage_path: z.string().optional().describe('Custom storage path'),
    },
    async ({ repo_path, branch, base_ref, storage_path }) => {
      try {
        const orchestrator = getOrchestrator(storage_path);
        const repo = await orchestrator.discoverRepository(repo_path || '.');
        const branchInfo = await orchestrator.discoverBranch(repo, branch, base_ref);
        const catalog = await orchestrator.getRegistry().loadCatalog();
        const status = await orchestrator.getStatus({
          repoPath: repo.path,
          branchName: branchInfo.branch.branch_name,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  repository: repo,
                  branch: branchInfo.branch,
                  status: status.evaluation.status,
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
      storage_path: z.string().optional().describe('Custom storage path'),
    },
    async ({ storage_path }) => {
      try {
        const orchestrator = getOrchestrator(storage_path);
        const catalog = await orchestrator.getRegistry().loadCatalog();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(catalog, null, 2),
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
    'Check git freshness and changes of a branch without performing rendering',
    {
      repo_path: z.string().optional().describe('Path to git repository (default: .)'),
      branch: z.string().optional().describe('Branch name (default: current branch)'),
      base_ref: z.string().optional().describe('Base ref'),
      storage_path: z.string().optional().describe('Custom storage path'),
    },
    async ({ repo_path, branch, base_ref, storage_path }) => {
      try {
        const orchestrator = getOrchestrator(storage_path);
        const status = await orchestrator.getStatus({
          repoPath: repo_path || '.',
          branchName: branch,
          baseRef: base_ref,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  repository: status.repository,
                  branch: status.branch,
                  freshness_status: status.evaluation.status,
                  head_commit: status.evaluation.currentHead,
                  base_commit: status.evaluation.currentBaseCommit,
                  is_clean: status.evaluation.workingTreeStatus.isClean,
                  new_commits_count: status.evaluation.newCommitsCount,
                  changed_files_count: status.evaluation.changedFilesCount,
                  last_rendered_at: status.state.last_rendered_at,
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
      branch: z.string().optional().describe('Branch name (default: current branch)'),
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
        const repo = await orchestrator.discoverRepository(repo_path || '.');
        const branchInfo = await orchestrator.discoverBranch(repo, branch);

        const status = await orchestrator.getStatus({
          repoPath: repo.path,
          branchName: branchInfo.branch.branch_name,
        });

        if (freshness === 'check_only') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    status: status.evaluation.status,
                    head: status.evaluation.currentHead,
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
                  text: `ERROR: Document for branch "${branchInfo.branch.branch_name}" is ${status.evaluation.status} (New commits: ${status.evaluation.newCommitsCount}, Changed files: ${status.evaluation.changedFilesCount}). Freshness mode is "required". Please run branch_context_refresh first or use freshness="auto".`,
                },
              ],
            };
          } else if (freshness === 'auto') {
            const refreshed = await orchestrator.refreshBranch({
              repoPath: repo.path,
              branchName: branchInfo.branch.branch_name,
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
                text: `No document exists yet for branch "${branchInfo.branch.branch_name}". Call branch_context_refresh with freshness="auto" or refresh command.`,
              },
            ],
          };
        }

        let responseText = '';
        if (mode === 'compact') {
          const compactDoc = {
            document_id: document.document_id,
            branch: document.branch.name,
            head_commit: document.source.head_commit.slice(0, 8),
            freshness: document.freshness.status,
            rendered_at: document.freshness.rendered_at,
            summary: document.content.summary,
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
    'Refresh and synchronize branch document (incremental or full rebuild)',
    {
      repo_path: z.string().optional().describe('Path to git repository (default: .)'),
      branch: z.string().optional().describe('Branch name (default: current branch)'),
      scope: z.enum(['current', 'stale', 'all', 'none']).default('current'),
      force: z.boolean().default(false).describe('Force refresh even if already fresh'),
      storage_path: z.string().optional().describe('Custom storage path'),
    },
    async ({ repo_path, branch, scope, force, storage_path }) => {
      try {
        const orchestrator = getOrchestrator(storage_path);
        const results = await orchestrator.executeRefreshScope(repo_path || '.', scope);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                results.map((r) => ({
                  branch: r.branch.branch_name,
                  refreshed: r.refreshed,
                  status: r.state.status,
                  head: r.state.current_head.slice(0, 8),
                  document_path: r.branch.document_path,
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

  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  Logger.info('Branch Render Context MCP Server running on stdio');
}
