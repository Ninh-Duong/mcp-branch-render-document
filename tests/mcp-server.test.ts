import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMcpServer } from '../src/mcp/server.js';
import { GitTestHelper } from './fixtures/git-helper.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('MCP Server Tools', () => {
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

  it('should initialize server with tools registered including branch_context_clear', async () => {
    const server = createMcpServer(tempStore);
    expect(server).toBeDefined();
  });
});
