import os from 'node:os';
import path from 'node:path';
import { sanitizeBranchSlug } from '../../utils/hash.js';

export class StoragePaths {
  public static getDefaultStorePath(): string {
    if (process.env.BRANCH_CONTEXT_STORE) {
      return path.resolve(process.env.BRANCH_CONTEXT_STORE).replace(/\\/g, '/');
    }

    const homeDir = os.homedir();
    if (process.platform === 'win32') {
      const appData = process.env.LOCALAPPDATA || process.env.APPDATA || path.join(homeDir, 'AppData', 'Local');
      return path.join(appData, 'branch-render-context').replace(/\\/g, '/');
    }

    return path.join(homeDir, '.branch-render-context').replace(/\\/g, '/');
  }

  public static getConfigPath(storePath: string): string {
    return path.join(storePath, 'config.json').replace(/\\/g, '/');
  }

  public static getCatalogPath(storePath: string): string {
    return path.join(storePath, 'catalog.json').replace(/\\/g, '/');
  }

  public static getIndexesDir(storePath: string): string {
    return path.join(storePath, 'indexes').replace(/\\/g, '/');
  }

  public static getRepositoriesDir(storePath: string): string {
    return path.join(storePath, 'repositories').replace(/\\/g, '/');
  }

  public static getRepositoryDir(storePath: string, repoId: string): string {
    return path.join(storePath, 'repositories', repoId).replace(/\\/g, '/');
  }

  public static getRepositoryJsonPath(storePath: string, repoId: string): string {
    return path.join(StoragePaths.getRepositoryDir(storePath, repoId), 'repository.json').replace(/\\/g, '/');
  }

  public static getBranchesDir(storePath: string, repoId: string): string {
    return path.join(StoragePaths.getRepositoryDir(storePath, repoId), 'branches').replace(/\\/g, '/');
  }

  public static getBranchDir(storePath: string, repoId: string, branchId: string): string {
    return path.join(StoragePaths.getBranchesDir(storePath, repoId), branchId).replace(/\\/g, '/');
  }

  public static getBranchJsonPath(storePath: string, repoId: string, branchId: string): string {
    return path.join(StoragePaths.getBranchDir(storePath, repoId, branchId), 'branch.json').replace(/\\/g, '/');
  }

  public static getDocumentJsonPath(storePath: string, repoId: string, branchId: string): string {
    return path.join(StoragePaths.getBranchDir(storePath, repoId, branchId), 'document.json').replace(/\\/g, '/');
  }

  /**
   * Portable path stored in catalog metadata. Filesystem access must use
   * getDocumentJsonPath instead; this path is intentionally relative.
   */
  public static getRelativeDocumentJsonPath(repoId: string, branchId: string): string {
    return path.join('repositories', repoId, 'branches', branchId, 'document.json').replace(/\\/g, '/');
  }

  public static getStateJsonPath(storePath: string, repoId: string, branchId: string): string {
    return path.join(StoragePaths.getBranchDir(storePath, repoId, branchId), 'state.json').replace(/\\/g, '/');
  }

  public static getHistoryJsonlPath(storePath: string, repoId: string, branchId: string): string {
    return path.join(StoragePaths.getBranchDir(storePath, repoId, branchId), 'history.jsonl').replace(/\\/g, '/');
  }

  public static getEvidenceDir(storePath: string, repoId: string, branchId: string): string {
    return path.join(StoragePaths.getBranchDir(storePath, repoId, branchId), 'evidence').replace(/\\/g, '/');
  }

  public static getBranchLockPath(storePath: string, repoId: string, branchId: string): string {
    return path.join(StoragePaths.getBranchDir(storePath, repoId, branchId), '.branch.lock').replace(/\\/g, '/');
  }
}
