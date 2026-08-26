import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StorageRegistry } from '../src/core/storage/registry.js';
import { BranchLocker } from '../src/core/storage/lock.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('StorageRegistry & Atomic Writer', () => {
  let tempStore: string;
  let registry: StorageRegistry;

  beforeEach(async () => {
    tempStore = (await fs.mkdtemp(path.join(os.tmpdir(), 'store-test-'))).replace(/\\/g, '/');
    registry = new StorageRegistry(tempStore);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempStore, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('should load default config and save updated config', async () => {
    const config = await registry.loadConfig();
    expect(config.default_refresh_scope).toBe('current');

    config.default_refresh_scope = 'all';
    await registry.saveConfig(config);

    const reloaded = await registry.loadConfig();
    expect(reloaded.default_refresh_scope).toBe('all');
  });

  it('should register repository, branch, and state', async () => {
    const now = new Date().toISOString();
    await registry.saveRepository({
      schema_version: '1.0.0',
      repository_id: 'r_12345678',
      name: 'test-repo',
      path: '/test/repo',
      remote_urls: [],
      default_branch: 'main',
      created_at: now,
      updated_at: now,
    });

    const repo = await registry.getRepository('r_12345678');
    expect(repo?.name).toBe('test-repo');

    await registry.saveBranch({
      schema_version: '1.0.0',
      repository_id: 'r_12345678',
      branch_id: 'b_abcdef12',
      branch_name: 'feature/auth',
      base_ref: 'main',
      document_id: 'doc_r_12345678_b_abcdef12',
      document_path: 'document.json',
      status: 'active',
      created_at: now,
      updated_at: now,
    });

    const branch = await registry.getBranch('r_12345678', 'b_abcdef12');
    expect(branch?.branch_name).toBe('feature/auth');
  });

  it('should lock branch and prevent concurrent locker until released', async () => {
    const lockFile = path.join(tempStore, 'test.lock');
    const unlock1 = await BranchLocker.acquireLock(lockFile, { retries: 1 });

    // Trying to acquire again should fail
    await expect(BranchLocker.acquireLock(lockFile, { retries: 1, retryIntervalMs: 50 })).rejects.toThrow();

    await unlock1();

    // Now acquiring should succeed
    const unlock2 = await BranchLocker.acquireLock(lockFile, { retries: 1 });
    await unlock2();
  });
});
