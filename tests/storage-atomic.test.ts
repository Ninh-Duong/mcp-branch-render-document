import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StorageRegistry } from '../src/core/storage/registry.js';
import { StoragePaths } from '../src/core/storage/paths.js';
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

  it('should create a missing storage directory when the registry is initialized', async () => {
    const missingStore = path.join(tempStore, 'storage');
    await fs.rm(missingStore, { recursive: true, force: true });

    const missingRegistry = new StorageRegistry(missingStore);

    expect(missingRegistry.getStorePath()).toBe(missingStore);
    expect(await fs.access(missingStore).then(() => true).catch(() => false)).toBe(true);
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

  it('should store branch files in Git-like hierarchical folder structure', async () => {
    const now = new Date().toISOString();
    const branchName = 'hotfix/Eagers-BE/WCE-946-eagers';
    await registry.saveBranch({
      schema_version: '1.0.0',
      repository_id: 'r_02ea8b54',
      branch_id: 'b_4aaccde8',
      branch_name: branchName,
      base_ref: 'release/eagers',
      document_id: 'doc_r_02ea8b54_b_4aaccde8',
      document_path: 'repositories/r_02ea8b54/branches/hotfix/Eagers-BE/WCE-946-eagers/document.json',
      status: 'active',
      created_at: now,
      updated_at: now,
    });

    const expectedBranchJson = path.join(
      tempStore,
      'repositories',
      'r_02ea8b54',
      'branches',
      'hotfix',
      'Eagers-BE',
      'WCE-946-eagers',
      'branch.json'
    );

    const exists = await fs.access(expectedBranchJson).then(() => true).catch(() => false);
    expect(exists).toBe(true);

    const fetchedByBranchName = await registry.getBranch('r_02ea8b54', branchName);
    expect(fetchedByBranchName?.branch_id).toBe('b_4aaccde8');
    expect(fetchedByBranchName?.branch_name).toBe(branchName);
  });

  it('should reject directory traversal in branch names', () => {
    expect(() => StoragePaths.getBranchDir(tempStore, 'r_test', '../bad-branch')).toThrow();
    expect(() => StoragePaths.getBranchDir(tempStore, 'r_test', 'feature/../../escape')).toThrow();
    expect(() => StoragePaths.getBranchDir(tempStore, 'r_test', '')).toThrow();
  });

  it('should migrate legacy b_<hash> directory to hierarchical layout', async () => {
    const legacyDir = path.join(tempStore, 'repositories', 'r_legacy', 'branches', 'b_4aaccde8');
    await fs.mkdir(legacyDir, { recursive: true });

    const now = new Date().toISOString();
    const legacyBranchData = {
      schema_version: '1.0.0',
      repository_id: 'r_legacy',
      branch_id: 'b_4aaccde8',
      branch_name: 'hotfix/Eagers-BE/WCE-946-eagers',
      base_ref: 'release/eagers',
      document_id: 'doc_r_legacy_b_4aaccde8',
      document_path: 'document.json',
      status: 'active',
      created_at: now,
      updated_at: now,
    };
    await fs.writeFile(path.join(legacyDir, 'branch.json'), JSON.stringify(legacyBranchData, null, 2));
    await fs.writeFile(path.join(legacyDir, 'document.json'), JSON.stringify({ hello: 'world' }));

    await registry.migrateLegacyBranchDirs('r_legacy');

    const newBranchJson = path.join(
      tempStore,
      'repositories',
      'r_legacy',
      'branches',
      'hotfix',
      'Eagers-BE',
      'WCE-946-eagers',
      'branch.json'
    );
    const newDocJson = path.join(
      tempStore,
      'repositories',
      'r_legacy',
      'branches',
      'hotfix',
      'Eagers-BE',
      'WCE-946-eagers',
      'document.json'
    );

    expect(await fs.access(newBranchJson).then(() => true).catch(() => false)).toBe(true);
    expect(await fs.access(newDocJson).then(() => true).catch(() => false)).toBe(true);
    expect(await fs.access(legacyDir).then(() => true).catch(() => false)).toBe(false);
  });

  it('should clear branch directory and clean empty parent folders', async () => {
    const now = new Date().toISOString();
    const branchName = 'hotfix/Eagers-BE/WCE-946-eagers';
    await registry.saveBranch({
      schema_version: '1.0.0',
      repository_id: 'r_del',
      branch_id: 'b_del12345',
      branch_name: branchName,
      base_ref: 'release/eagers',
      document_id: 'doc_r_del_b_del12345',
      document_path: 'repositories/r_del/branches/hotfix/Eagers-BE/WCE-946-eagers/document.json',
      status: 'active',
      created_at: now,
      updated_at: now,
    });

    const branchDir = path.join(
      tempStore,
      'repositories',
      'r_del',
      'branches',
      'hotfix',
      'Eagers-BE',
      'WCE-946-eagers'
    );
    expect(await fs.access(branchDir).then(() => true).catch(() => false)).toBe(true);

    const deleted = await registry.removeBranchDirectory('r_del', branchName);
    expect(deleted).toBe(true);
    expect(await fs.access(branchDir).then(() => true).catch(() => false)).toBe(false);

    // Empty parent directories should have been cleaned
    const parentDir = path.join(tempStore, 'repositories', 'r_del', 'branches', 'hotfix');
    expect(await fs.access(parentDir).then(() => true).catch(() => false)).toBe(false);
  });
});
