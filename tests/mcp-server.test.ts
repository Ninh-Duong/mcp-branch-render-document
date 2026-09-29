import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMcpServer } from '../src/mcp/server.js';
import { GitTestHelper } from './fixtures/git-helper.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('MCP Server: AI Agent Standard & Ponytail Tools', () => {
  let fixture: Awaited<ReturnType<typeof GitTestHelper.createTempGitRepo>>;
  let tempStore: string;

  beforeEach(async () => {
    fixture = await GitTestHelper.createTempGitRepo();
    tempStore = (await fs.mkdtemp(path.join(os.tmpdir(), 'store-mcp-'))).replace(/\\/g, '/');
  });

  afterEach(async () => {
    await fixture.cleanup();
    try {
      await fs.rm(tempStore, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('should initialize server with primary tool get_branch_context and manage_branch_cache', () => {
    const server = createMcpServer(tempStore);
    expect(server).toBeDefined();

    // Check primary agent tool
    const registeredTools = (server as any)._registeredTools;
    expect(registeredTools['get_branch_context']).toBeDefined();
    expect(registeredTools['manage_branch_cache']).toBeDefined();

    // Check backward-compatibility aliases
    expect(registeredTools['branch_context_get']).toBeDefined();
    expect(registeredTools['branch_context_refresh']).toBeDefined();
    expect(registeredTools['branch_context_status']).toBeDefined();
    expect(registeredTools['branch_context_list']).toBeDefined();
    expect(registeredTools['branch_context_clear']).toBeDefined();
    expect(registeredTools['branch_context_clear_storage']).toBeDefined();
    expect(registeredTools['branch_context_start']).toBeDefined();
  });

  it('should register MCP resource templates and prompts', () => {
    const server = createMcpServer(tempStore);

    const resourceTemplates = (server as any)._registeredResourceTemplates;
    expect(resourceTemplates['branch_context']).toBeDefined();

    const registeredPrompts = (server as any)._registeredPrompts;
    expect(registeredPrompts['review_pr_branch']).toBeDefined();
    expect(registeredPrompts['summarize_branch_changes']).toBeDefined();
  });

  it('should execute get_branch_context and return markdown directly', async () => {
    // 1. Setup a feature branch with a commit in fixture repo
    await fixture.run(['checkout', '-b', 'feature/mcp-test']);
    await fs.writeFile(path.join(fixture.repoPath, 'agent.ts'), 'export const agent = true;\n');
    await fixture.run(['add', 'agent.ts']);
    await fixture.run(['commit', '-m', 'feat: add agent support']);

    const server = createMcpServer(tempStore);
    const getBranchContextTool = (server as any)._registeredTools['get_branch_context'];

    const result = await getBranchContextTool.handler({
      branch: 'feature/mcp-test',
      repo_path: fixture.repoPath,
      storage_path: tempStore,
      detail: 'summary',
      force_refresh: false,
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('# Branch Context: feature/mcp-test');
    expect(result.content[0].text).toContain('agent.ts');
  });

  it('should execute manage_branch_cache action=list and action=status', async () => {
    await fixture.run(['checkout', '-b', 'feature/cache-test']);
    await fs.writeFile(path.join(fixture.repoPath, 'cache.ts'), 'export const cache = 1;\n');
    await fixture.run(['add', 'cache.ts']);
    await fixture.run(['commit', '-m', 'feat: cache test']);

    const server = createMcpServer(tempStore);
    const cacheTool = (server as any)._registeredTools['manage_branch_cache'];

    const result = await cacheTool.handler({
      action: 'status',
      branch: 'feature/cache-test',
      repo_path: fixture.repoPath,
      storage_path: tempStore,
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.target_branch).toBe('feature/cache-test');

    const listResult = await cacheTool.handler({
      action: 'list',
      repo_path: fixture.repoPath,
      storage_path: tempStore,
    });
    expect(listResult.isError).toBeFalsy();
  });
});
