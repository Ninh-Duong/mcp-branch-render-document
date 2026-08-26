import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StorageRegistry } from '../src/core/storage/registry.js';

describe('Portable persisted metadata', () => {
  it('does not persist machine-specific absolute paths', async () => {
    const storePath = (await fs.mkdtemp(path.join(os.tmpdir(), 'portable-store-'))).replace(/\\/g, '/');
    const registry = new StorageRegistry(storePath);
    const now = new Date().toISOString();

    try {
      const config = await registry.loadConfig();
      await registry.saveConfig(config);

      await registry.saveRepository({
        schema_version: '1.0.0',
        repository_id: 'r_portable',
        name: 'portable-repo',
        path: path.win32.resolve('C:\\private\\repo'),
        remote_urls: [],
        default_branch: 'main',
        created_at: now,
        updated_at: now,
      });

      const configRaw = await fs.readFile(path.join(storePath, 'config.json'), 'utf8');
      const repositoryRaw = await fs.readFile(
        path.join(storePath, 'repositories', 'r_portable', 'repository.json'),
        'utf8'
      );

      expect(JSON.parse(configRaw).storage_path).toBe('.');
      expect(JSON.parse(repositoryRaw).path).not.toMatch(/^[A-Za-z]:[\\/]/);
    } finally {
      await fs.rm(storePath, { recursive: true, force: true });
    }
  });
});
