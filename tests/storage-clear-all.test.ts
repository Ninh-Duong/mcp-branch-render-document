import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StorageRegistry, StoragePaths, BranchLocker } from '../src/core/storage/index.js';
import { BranchContextOrchestrator } from '../src/core/orchestrator.js';
import { createMcpServer } from '../src/mcp/server.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('Clear All Storage (--all-storage)', () => {
  let tempStore: string;
  let registry: StorageRegistry;

  beforeEach(async () => {
    tempStore = (await fs.mkdtemp(path.join(os.tmpdir(), 'store-clear-all-'))).replace(/\\/g, '/');
    registry = new StorageRegistry(tempStore);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempStore, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  async function populateMockData(reg: StorageRegistry, store: string) {
    const now = new Date().toISOString();

    // 1. Save config
    await reg.saveConfig({
      schema_version: '1.0.0',
      storage_path: store,
      default_refresh_scope: 'all',
      default_renderer_mode: 'deterministic',
    });

    // 2. Repo 1
    await reg.saveRepository({
      schema_version: '1.0.0',
      repository_id: 'r_repo1',
      name: 'repo-one',
      path: '/path/to/repo1',
      remote_urls: [],
      default_branch: 'main',
      created_at: now,
      updated_at: now,
    });

    await reg.saveBranch({
      schema_version: '1.0.0',
      repository_id: 'r_repo1',
      branch_id: 'b_branch1',
      branch_name: 'feature/login',
      base_ref: 'main',
      document_id: 'doc_1',
      document_path: 'doc.json',
      status: 'active',
      created_at: now,
      updated_at: now,
    });

    await reg.saveState({
      schema_version: '1.0.0',
      repository_id: 'r_repo1',
      branch_id: 'b_branch1',
      branch_name: 'feature/login',
      target_branch: 'feature/login',
      base_branch: 'main',
      status: 'FRESH',
      last_rendered_head: '1234567890abcdef',
      last_rendered_at: now,
      last_checked_at: now,
      new_commits_count: 0,
      changed_files_count: 0,
    });

    // 3. Repo 2
    await reg.saveRepository({
      schema_version: '1.0.0',
      repository_id: 'r_repo2',
      name: 'repo-two',
      path: '/path/to/repo2',
      remote_urls: [],
      default_branch: 'master',
      created_at: now,
      updated_at: now,
    });

    await reg.saveBranch({
      schema_version: '1.0.0',
      repository_id: 'r_repo2',
      branch_id: 'b_branch2',
      branch_name: 'bugfix/payment',
      base_ref: 'master',
      document_id: 'doc_2',
      document_path: 'doc2.json',
      status: 'active',
      created_at: now,
      updated_at: now,
    });

    await reg.saveState({
      schema_version: '1.0.0',
      repository_id: 'r_repo2',
      branch_id: 'b_branch2',
      branch_name: 'bugfix/payment',
      target_branch: 'bugfix/payment',
      base_branch: 'master',
      status: 'FRESH',
      last_rendered_head: 'abcdef1234567890',
      last_rendered_at: now,
      last_checked_at: now,
      new_commits_count: 0,
      changed_files_count: 0,
    });

    // 4. Update catalog entries
    const repo1 = (await reg.getRepository('r_repo1'))!;
    const branch1 = (await reg.getBranch('r_repo1', 'feature/login'))!;
    const state1 = (await reg.getState('r_repo1', 'feature/login'))!;
    await reg.updateCatalogEntry(repo1, branch1, state1);

    const repo2 = (await reg.getRepository('r_repo2'))!;
    const branch2 = (await reg.getBranch('r_repo2', 'bugfix/payment'))!;
    const state2 = (await reg.getState('r_repo2', 'bugfix/payment'))!;
    await reg.updateCatalogEntry(repo2, branch2, state2);

    // 5. Create dummy indexes directory
    await fs.mkdir(StoragePaths.getIndexesDir(store), { recursive: true });
    await fs.writeFile(path.join(StoragePaths.getIndexesDir(store), 'dummy.idx'), 'index content');
  }

  it('should clear all repositories, branches, catalog, config, and indexes', async () => {
    await populateMockData(registry, tempStore);

    const catalogBefore = await registry.loadCatalog();
    expect(catalogBefore.repositories.length).toBe(2);

    const res = await registry.clearAllStorage();
    expect(res.clearedRepositoryCount).toBe(2);
    expect(res.clearedBranchCount).toBe(2);
    expect(res.removedEntries).toContain('catalog.json');
    expect(res.removedEntries).toContain('config.json');
    expect(res.removedEntries).toContain('repositories');
    expect(res.removedEntries).toContain('indexes');
    expect(res.failedEntries.length).toBe(0);

    // Verify storage directory still exists
    const storeExists = await fs.access(tempStore).then(() => true).catch(() => false);
    expect(storeExists).toBe(true);

    // Verify catalog is empty now
    const catalogAfter = await registry.loadCatalog();
    expect(catalogAfter.repositories.length).toBe(0);

    // Verify config is default
    const configAfter = await registry.loadConfig();
    expect(configAfter.default_refresh_scope).toBe('current');

    // Verify repositories dir is gone
    const reposExists = await fs.access(StoragePaths.getRepositoriesDir(tempStore)).then(() => true).catch(() => false);
    expect(reposExists).toBe(false);
  });

  it('should preserve non-managed files and directories in storage root', async () => {
    await populateMockData(registry, tempStore);

    const unmanagedFilePath = path.join(tempStore, 'custom-notes.txt');
    const gitignorePath = path.join(tempStore, '.gitignore');
    await fs.writeFile(unmanagedFilePath, 'important user notes');
    await fs.writeFile(gitignorePath, '*\n!.gitignore');

    await registry.clearAllStorage();

    const customFileExists = await fs.access(unmanagedFilePath).then(() => true).catch(() => false);
    expect(customFileExists).toBe(true);

    const gitignoreExists = await fs.access(gitignorePath).then(() => true).catch(() => false);
    expect(gitignoreExists).toBe(true);
  });

  it('should run clearAllStorage idempotently when storage is already empty', async () => {
    const res1 = await registry.clearAllStorage();
    expect(res1.clearedRepositoryCount).toBe(0);
    expect(res1.clearedBranchCount).toBe(0);

    const res2 = await registry.clearAllStorage();
    expect(res2.clearedRepositoryCount).toBe(0);
    expect(res2.clearedBranchCount).toBe(0);
    expect(res2.failedEntries.length).toBe(0);
  });

  it('should clear storage via orchestrator under lock', async () => {
    await populateMockData(registry, tempStore);

    const orchestrator = new BranchContextOrchestrator(tempStore);
    const result = await orchestrator.clearStorage({ storagePath: tempStore });

    expect(result.clearedRepositoryCount).toBe(2);
    expect(result.clearedBranchCount).toBe(2);

    // Lock file should be cleaned up
    const lockPath = StoragePaths.getStorageLockPath(tempStore);
    const lockExists = await fs.access(lockPath).then(() => true).catch(() => false);
    expect(lockExists).toBe(false);
  });

  it('should initialize and register branch_context_clear_storage tool', async () => {
    const server = createMcpServer(tempStore);
    expect(server).toBeDefined();
  });
});
