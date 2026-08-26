import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { StorageMode } from '../types/config.js';

export class StoragePaths {
  /**
   * Resolve root directory of the mcp-branch-render-document tool package
   */
  public static getRendererRootPath(): string {
    try {
      let dir = path.dirname(fileURLToPath(import.meta.url));
      while (dir && dir !== path.dirname(dir)) {
        if (fs.existsSync(path.join(dir, 'package.json'))) {
          return dir.replace(/\\/g, '/');
        }
        dir = path.dirname(dir);
      }
    } catch {
      // fallback
    }
    return process.cwd().replace(/\\/g, '/');
  }

  /**
   * Central storage inside the renderer repository itself
   */
  public static getRendererStorePath(): string {
    return path.join(StoragePaths.getRendererRootPath(), 'storage').replace(/\\/g, '/');
  }

  public static getGlobalStorePath(): string {
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

  /**
   * Resolve storage path based on mode and options.
   * Default mode is 'renderer-local' (stored inside mcp-branch-render-document/storage).
   */
  public static resolveStorePath(options: {
    repoRoot?: string;
    mode?: StorageMode;
    customPath?: string;
  } = {}): string {
    if (options.customPath) {
      return path.resolve(options.customPath).replace(/\\/g, '/');
    }

    if (options.mode === 'global') {
      return StoragePaths.getGlobalStorePath();
    }

    if (options.mode === 'repo-local' && options.repoRoot) {
      return path.join(path.resolve(options.repoRoot), '.branch-render-context').replace(/\\/g, '/');
    }

    // Default: renderer-local (inside tool's storage/ directory)
    return StoragePaths.getRendererStorePath();
  }

  public static getDefaultStorePath(): string {
    return StoragePaths.getRendererStorePath();
  }

  /**
   * Ensure the storage root exists before it is read or written.
   * The directory is intentionally created at runtime because generated
   * branch documents are excluded from source control.
   */
  public static ensureStoreDirectory(storePath: string): void {
    fs.mkdirSync(storePath, { recursive: true });
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

  public static sanitizeBranchSegments(branchName: string): string[] {
    if (!branchName || typeof branchName !== 'string' || branchName.trim().length === 0) {
      throw new Error('Branch name cannot be empty');
    }

    // Normalize slashes and split
    const rawSegments = branchName.trim().split(/[\\/]+/);
    const safeSegments: string[] = [];

    for (const seg of rawSegments) {
      const trimmed = seg.trim();
      if (!trimmed || trimmed === '.' || trimmed === '..') {
        throw new Error(`Invalid path segment "${seg}" in branch name "${branchName}"`);
      }
      // Sanitize Windows invalid filename characters: < > : " / \ | ? *
      const sanitized = trimmed.replace(/[<>:"|?*]/g, '_');
      safeSegments.push(sanitized);
    }

    if (safeSegments.length === 0) {
      throw new Error(`Invalid branch name: "${branchName}"`);
    }

    return safeSegments;
  }

  public static getBranchesDir(storePath: string, repoId: string): string {
    return path.join(StoragePaths.getRepositoryDir(storePath, repoId), 'branches').replace(/\\/g, '/');
  }

  public static getBranchDir(storePath: string, repoId: string, branchName: string): string {
    const safeSegments = StoragePaths.sanitizeBranchSegments(branchName);
    const branchesDir = StoragePaths.getBranchesDir(storePath, repoId);
    const fullPath = path.resolve(branchesDir, ...safeSegments).replace(/\\/g, '/');
    const normalizedBranchesDir = path.resolve(branchesDir).replace(/\\/g, '/');

    if (fullPath !== normalizedBranchesDir && !fullPath.startsWith(normalizedBranchesDir + '/')) {
      throw new Error(`Path traversal attempt detected in branch name: "${branchName}"`);
    }

    return fullPath;
  }

  public static getBranchJsonPath(storePath: string, repoId: string, branchName: string): string {
    return path.join(StoragePaths.getBranchDir(storePath, repoId, branchName), 'branch.json').replace(/\\/g, '/');
  }

  public static getDocumentJsonPath(storePath: string, repoId: string, branchName: string): string {
    return path.join(StoragePaths.getBranchDir(storePath, repoId, branchName), 'document.json').replace(/\\/g, '/');
  }

  public static getDocumentMarkdownPath(storePath: string, repoId: string, branchName: string): string {
    return path.join(StoragePaths.getBranchDir(storePath, repoId, branchName), 'document.md').replace(/\\/g, '/');
  }

  public static getRelativeDocumentJsonPath(repoId: string, branchName: string): string {
    const safeSegments = StoragePaths.sanitizeBranchSegments(branchName);
    return `repositories/${repoId}/branches/${safeSegments.join('/')}/document.json`;
  }

  public static getStateJsonPath(storePath: string, repoId: string, branchName: string): string {
    return path.join(StoragePaths.getBranchDir(storePath, repoId, branchName), 'state.json').replace(/\\/g, '/');
  }

  public static getHistoryJsonlPath(storePath: string, repoId: string, branchName: string): string {
    return path.join(StoragePaths.getBranchDir(storePath, repoId, branchName), 'history.jsonl').replace(/\\/g, '/');
  }

  public static getEvidenceDir(storePath: string, repoId: string, branchName: string): string {
    return path.join(StoragePaths.getBranchDir(storePath, repoId, branchName), 'evidence').replace(/\\/g, '/');
  }

  public static readonly MANAGED_ENTRIES = [
    'catalog.json',
    'config.json',
    'repositories',
    'indexes',
  ] as const;

  public static getStorageLockPath(storePath: string): string {
    return path.join(storePath, '.storage.lock').replace(/\\/g, '/');
  }

  public static isSafeStorageSubpath(storePath: string, targetPath: string): boolean {
    const normalizedStore = path.resolve(storePath).replace(/\\/g, '/');
    const normalizedTarget = path.resolve(targetPath).replace(/\\/g, '/');
    return normalizedTarget === normalizedStore || normalizedTarget.startsWith(normalizedStore + '/');
  }

  public static getBranchLockPath(storePath: string, repoId: string, branchName: string): string {
    return path.join(StoragePaths.getBranchDir(storePath, repoId, branchName), '.branch.lock').replace(/\\/g, '/');
  }
}
