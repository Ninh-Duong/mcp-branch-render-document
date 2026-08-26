import fs from 'node:fs/promises';
import path from 'node:path';
import { StoragePaths } from './paths.js';
import { AtomicWriter } from './atomic-writer.js';
import {
  Config,
  ConfigSchema,
  Catalog,
  CatalogSchema,
  Repository,
  RepositorySchema,
  Branch,
  BranchSchema,
  BranchDocument,
  DocumentSchema,
  BranchState,
  BranchStateSchema,
  HistoryEvent,
  HistoryEventSchema,
} from '../types/index.js';
import { Logger } from '../../utils/logger.js';
import { toPortableRelativePath } from '../../utils/paths.js';
import { MarkdownRenderer } from '../renderer/markdown.js';

export interface ClearStorageResult {
  clearedRepositoryCount: number;
  clearedBranchCount: number;
  removedEntries: string[];
  failedEntries: string[];
}

export class StorageRegistry {
  private readonly storePath: string;

  constructor(storePath?: string) {
    this.storePath = storePath || StoragePaths.getDefaultStorePath();
    StoragePaths.ensureStoreDirectory(this.storePath);
  }

  public getStorePath(): string {
    return this.storePath;
  }

  // --- STORAGE-WIDE CLEANUP ---

  public async clearAllStorage(): Promise<ClearStorageResult> {
    let clearedRepositoryCount = 0;
    let clearedBranchCount = 0;

    // 1. Read catalog to calculate statistics
    try {
      const catalog = await this.loadCatalog();
      clearedRepositoryCount = catalog.repositories.length;
      clearedBranchCount = catalog.repositories.reduce(
        (acc, r) => acc + (r.branches ? r.branches.length : 0),
        0
      );
    } catch {
      // Catalog not readable or not present
    }

    const removedEntries: string[] = [];
    const failedEntries: string[] = [];

    // 2. Remove managed entries safely
    for (const entryName of StoragePaths.MANAGED_ENTRIES) {
      const targetPath = path.join(this.storePath, entryName);
      if (!StoragePaths.isSafeStorageSubpath(this.storePath, targetPath)) {
        continue;
      }

      try {
        const stat = await fs.stat(targetPath).catch(() => null);
        if (stat) {
          await fs.rm(targetPath, { recursive: true, force: true });
          removedEntries.push(entryName);
        }
      } catch (err: any) {
        failedEntries.push(entryName);
        Logger.warn(`Failed to delete storage entry ${entryName}: ${err.message}`);
      }
    }

    // 3. Ensure storePath root still exists for subsequent runs
    try {
      await fs.mkdir(this.storePath, { recursive: true });
    } catch {
      // ignore
    }

    return {
      clearedRepositoryCount,
      clearedBranchCount,
      removedEntries,
      failedEntries,
    };
  }

  // --- CONFIG ---

  public async loadConfig(): Promise<Config> {
    const configPath = StoragePaths.getConfigPath(this.storePath);
    try {
      const raw = await fs.readFile(configPath, 'utf-8');
      const data = JSON.parse(raw);
      // The registry's runtime store path is authoritative. Persisted config
      // uses a portable placeholder instead of a machine-specific path.
      return ConfigSchema.parse({ ...data, storage_path: this.storePath });
    } catch {
      // Default config
      return ConfigSchema.parse({
        storage_path: this.storePath,
      });
    }
  }

  public async saveConfig(config: Config): Promise<void> {
    const configPath = StoragePaths.getConfigPath(this.storePath);
    await AtomicWriter.writeJsonAtomically(
      configPath,
      { ...config, storage_path: '.' },
      ConfigSchema
    );
  }

  // --- CATALOG ---

  public async loadCatalog(): Promise<Catalog> {
    const catalogPath = StoragePaths.getCatalogPath(this.storePath);
    try {
      const raw = await fs.readFile(catalogPath, 'utf-8');
      const data = JSON.parse(raw);
      return CatalogSchema.parse(data);
    } catch {
      return {
        schema_version: '1.0.0',
        updated_at: new Date().toISOString(),
        repositories: [],
      };
    }
  }

  public async saveCatalog(catalog: Catalog): Promise<void> {
    const catalogPath = StoragePaths.getCatalogPath(this.storePath);
    catalog.updated_at = new Date().toISOString();
    await AtomicWriter.writeJsonAtomically(catalogPath, catalog, CatalogSchema);
  }

  public async updateCatalogEntry(
    repo: Repository,
    branch: Branch,
    state: BranchState
  ): Promise<void> {
    const catalog = await this.loadCatalog();
    let repoEntry = catalog.repositories.find((r) => r.repository_id === repo.repository_id);

    if (!repoEntry) {
      repoEntry = {
        repository_id: repo.repository_id,
        name: repo.name,
        path: toPortableRelativePath(repo.path),
        default_branch: repo.default_branch,
        branches: [],
      };
      catalog.repositories.push(repoEntry);
    } else {
      repoEntry.name = repo.name;
      repoEntry.path = toPortableRelativePath(repo.path);
      repoEntry.default_branch = repo.default_branch;
    }

    const branchIdx = repoEntry.branches.findIndex(
      (b) => b.branch_id === branch.branch_id || b.branch_name === branch.branch_name
    );
    const branchEntry = {
      branch_id: branch.branch_id,
      branch_name: branch.branch_name,
      document_id: branch.document_id,
      document_path: StoragePaths.getRelativeDocumentJsonPath(repo.repository_id, branch.branch_name),
      status: state.status,
      last_rendered_head: state.last_rendered_head,
      last_rendered_at: state.last_rendered_at,
      new_commits_count: state.new_commits_count,
      changed_files_count: state.changed_files_count,
    };

    if (branchIdx >= 0) {
      repoEntry.branches[branchIdx] = branchEntry;
    } else {
      repoEntry.branches.push(branchEntry);
    }

    await this.saveCatalog(catalog);
  }

  public async removeCatalogEntry(repoId: string, branchNameOrId: string): Promise<boolean> {
    const catalog = await this.loadCatalog();
    const repoEntry = catalog.repositories.find((r) => r.repository_id === repoId);
    if (!repoEntry) {
      return false;
    }

    const initialLength = repoEntry.branches.length;
    repoEntry.branches = repoEntry.branches.filter(
      (b) => b.branch_id !== branchNameOrId && b.branch_name !== branchNameOrId
    );

    if (repoEntry.branches.length !== initialLength) {
      await this.saveCatalog(catalog);
      return true;
    }
    return false;
  }

  // --- REPOSITORY ---

  public async getRepository(repoId: string): Promise<Repository | null> {
    const repoJsonPath = StoragePaths.getRepositoryJsonPath(this.storePath, repoId);
    try {
      const raw = await fs.readFile(repoJsonPath, 'utf-8');
      return RepositorySchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  public async saveRepository(repo: Repository): Promise<void> {
    const repoJsonPath = StoragePaths.getRepositoryJsonPath(this.storePath, repo.repository_id);
    await AtomicWriter.writeJsonAtomically(
      repoJsonPath,
      { ...repo, path: toPortableRelativePath(repo.path) },
      RepositorySchema
    );
  }

  // --- MIGRATION ---

  public async migrateLegacyBranchDirs(repoId: string): Promise<void> {
    const branchesDir = StoragePaths.getBranchesDir(this.storePath, repoId);
    try {
      const entries = await fs.readdir(branchesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && /^b_[0-9a-f]{8}$/.test(entry.name)) {
          const oldDir = path.join(branchesDir, entry.name);
          const oldBranchJson = path.join(oldDir, 'branch.json');
          try {
            const raw = await fs.readFile(oldBranchJson, 'utf-8');
            const branch = BranchSchema.parse(JSON.parse(raw));
            if (branch.branch_name) {
              const newDir = StoragePaths.getBranchDir(this.storePath, repoId, branch.branch_name);
              if (path.resolve(oldDir) !== path.resolve(newDir)) {
                await fs.mkdir(newDir, { recursive: true });
                const files = await fs.readdir(oldDir);
                for (const file of files) {
                  const src = path.join(oldDir, file);
                  const dest = path.join(newDir, file);
                  await fs.cp(src, dest, { recursive: true, force: true });
                }
                await fs.rm(oldDir, { recursive: true, force: true });
                Logger.info(`Migrated legacy branch dir ${entry.name} to ${branch.branch_name}`);
              }
            }
          } catch {
            // Ignore corrupted or unreadable legacy dir
          }
        }
      }
    } catch {
      // Directory doesn't exist yet, ignore
    }
  }

  // --- BRANCH REMOVAL & CLEANUP ---

  public async removeBranchDirectory(repoId: string, branchNameOrId: string): Promise<boolean> {
    let branchName = branchNameOrId;
    const branch = await this.getBranch(repoId, branchNameOrId);
    if (branch) {
      branchName = branch.branch_name;
    }

    let deleted = false;

    // 1. Delete new hierarchical directory
    try {
      const branchDir = StoragePaths.getBranchDir(this.storePath, repoId, branchName);
      await fs.rm(branchDir, { recursive: true, force: true });
      deleted = true;

      // Clean up empty parent directories up to branches directory
      const branchesDir = path.resolve(StoragePaths.getBranchesDir(this.storePath, repoId));
      let currentParent = path.dirname(path.resolve(branchDir));
      while (currentParent !== branchesDir && currentParent.startsWith(branchesDir)) {
        try {
          const contents = await fs.readdir(currentParent);
          if (contents.length === 0) {
            await fs.rmdir(currentParent);
            currentParent = path.dirname(currentParent);
          } else {
            break;
          }
        } catch {
          break;
        }
      }
    } catch {
      // Directory may not exist
    }

    // 2. Also check if legacy b_<hash> directory exists and delete it
    if (/^b_[0-9a-f]{8}$/.test(branchNameOrId) || (branch && branch.branch_id)) {
      const bId = branch ? branch.branch_id : branchNameOrId;
      try {
        const legacyDir = path.join(StoragePaths.getBranchesDir(this.storePath, repoId), bId);
        await fs.rm(legacyDir, { recursive: true, force: true });
        deleted = true;
      } catch {
        // ignore
      }
    }

    // 3. Remove entry from catalog
    await this.removeCatalogEntry(repoId, branchName);

    return deleted;
  }

  // --- BRANCH ---

  public async getBranch(repoId: string, branchNameOrId: string): Promise<Branch | null> {
    // 1. Try resolving by branchName directly
    try {
      const branchJsonPath = StoragePaths.getBranchJsonPath(this.storePath, repoId, branchNameOrId);
      const raw = await fs.readFile(branchJsonPath, 'utf-8');
      return BranchSchema.parse(JSON.parse(raw));
    } catch {
      // Not found directly with branchName
    }

    // 2. Check catalog to see if branchNameOrId is a branch_id or known name
    try {
      const catalog = await this.loadCatalog();
      const repoEntry = catalog.repositories.find((r) => r.repository_id === repoId);
      if (repoEntry) {
        const found = repoEntry.branches.find(
          (b) => b.branch_id === branchNameOrId || b.branch_name === branchNameOrId
        );
        if (found) {
          try {
            const branchJsonPath = StoragePaths.getBranchJsonPath(
              this.storePath,
              repoId,
              found.branch_name
            );
            const raw = await fs.readFile(branchJsonPath, 'utf-8');
            return BranchSchema.parse(JSON.parse(raw));
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }

    // 3. Fallback: check legacy b_<hash> path
    if (/^b_[0-9a-f]{8}$/.test(branchNameOrId)) {
      try {
        const legacyPath = path.join(
          StoragePaths.getBranchesDir(this.storePath, repoId),
          branchNameOrId,
          'branch.json'
        );
        const raw = await fs.readFile(legacyPath, 'utf-8');
        return BranchSchema.parse(JSON.parse(raw));
      } catch {
        // ignore
      }

      // 4. Fallback: scan branches directory for matching branch_id
      try {
        const branchesDir = StoragePaths.getBranchesDir(this.storePath, repoId);
        const scanDir = async (dir: string): Promise<Branch | null> => {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              const res = await scanDir(full);
              if (res) return res;
            } else if (entry.isFile() && entry.name === 'branch.json') {
              try {
                const raw = await fs.readFile(full, 'utf-8');
                const data = BranchSchema.parse(JSON.parse(raw));
                if (data.branch_id === branchNameOrId) {
                  return data;
                }
              } catch {
                // ignore
              }
            }
          }
          return null;
        };
        const foundBranch = await scanDir(branchesDir);
        if (foundBranch) return foundBranch;
      } catch {
        // ignore
      }
    }

    return null;
  }

  public async saveBranch(branch: Branch): Promise<void> {
    const branchJsonPath = StoragePaths.getBranchJsonPath(
      this.storePath,
      branch.repository_id,
      branch.branch_name
    );
    await AtomicWriter.writeJsonAtomically(branchJsonPath, branch, BranchSchema);
  }

  // --- DOCUMENT ---

  public async getDocument(repoId: string, branchNameOrId: string): Promise<BranchDocument | null> {
    // 1. Try directly by branch name
    try {
      const docPath = StoragePaths.getDocumentJsonPath(this.storePath, repoId, branchNameOrId);
      const raw = await fs.readFile(docPath, 'utf-8');
      return DocumentSchema.parse(JSON.parse(raw));
    } catch {
      // ignore
    }

    // 2. Fallback via branch resolution
    const branch = await this.getBranch(repoId, branchNameOrId);
    if (branch && branch.branch_name !== branchNameOrId) {
      try {
        const docPath = StoragePaths.getDocumentJsonPath(this.storePath, repoId, branch.branch_name);
        const raw = await fs.readFile(docPath, 'utf-8');
        return DocumentSchema.parse(JSON.parse(raw));
      } catch {
        // ignore
      }
    }

    // 3. Fallback legacy b_<hash>
    if (/^b_[0-9a-f]{8}$/.test(branchNameOrId)) {
      try {
        const legacyPath = path.join(
          StoragePaths.getBranchesDir(this.storePath, repoId),
          branchNameOrId,
          'document.json'
        );
        const raw = await fs.readFile(legacyPath, 'utf-8');
        return DocumentSchema.parse(JSON.parse(raw));
      } catch {
        // ignore
      }
    }

    return null;
  }

  public async saveDocument(doc: BranchDocument): Promise<void> {
    const branchName = doc.branch.name;
    const docPath = StoragePaths.getDocumentJsonPath(
      this.storePath,
      doc.repository.id,
      branchName
    );
    await AtomicWriter.writeJsonAtomically(docPath, doc, DocumentSchema);

    // Also write human-readable markdown document
    const mdPath = StoragePaths.getDocumentMarkdownPath(
      this.storePath,
      doc.repository.id,
      branchName
    );
    const mdContent = MarkdownRenderer.render(doc);
    await fs.mkdir(path.dirname(mdPath), { recursive: true });
    await fs.writeFile(mdPath, mdContent, 'utf-8');
  }

  // --- STATE ---

  public async getState(repoId: string, branchNameOrId: string): Promise<BranchState | null> {
    // 1. Try directly by branch name
    try {
      const statePath = StoragePaths.getStateJsonPath(this.storePath, repoId, branchNameOrId);
      const raw = await fs.readFile(statePath, 'utf-8');
      return BranchStateSchema.parse(JSON.parse(raw));
    } catch {
      // ignore
    }

    // 2. Fallback via branch resolution
    const branch = await this.getBranch(repoId, branchNameOrId);
    if (branch && branch.branch_name !== branchNameOrId) {
      try {
        const statePath = StoragePaths.getStateJsonPath(this.storePath, repoId, branch.branch_name);
        const raw = await fs.readFile(statePath, 'utf-8');
        return BranchStateSchema.parse(JSON.parse(raw));
      } catch {
        // ignore
      }
    }

    // 3. Fallback legacy b_<hash>
    if (/^b_[0-9a-f]{8}$/.test(branchNameOrId)) {
      try {
        const legacyPath = path.join(
          StoragePaths.getBranchesDir(this.storePath, repoId),
          branchNameOrId,
          'state.json'
        );
        const raw = await fs.readFile(legacyPath, 'utf-8');
        return BranchStateSchema.parse(JSON.parse(raw));
      } catch {
        // ignore
      }
    }

    return null;
  }

  public async saveState(state: BranchState): Promise<void> {
    const branchName = state.target_branch || state.branch_name;
    if (!branchName) {
      throw new Error(`Cannot save state without target_branch or branch_name (branch_id: ${state.branch_id})`);
    }
    const statePath = StoragePaths.getStateJsonPath(
      this.storePath,
      state.repository_id,
      branchName
    );
    await AtomicWriter.writeJsonAtomically(statePath, state, BranchStateSchema);
  }

  // --- HISTORY ---

  public async appendHistory(
    repoId: string,
    branchNameOrId: string,
    event: HistoryEvent
  ): Promise<void> {
    let branchName = branchNameOrId;
    if (/^b_[0-9a-f]{8}$/.test(branchNameOrId)) {
      const branch = await this.getBranch(repoId, branchNameOrId);
      if (branch) {
        branchName = branch.branch_name;
      }
    }
    const historyPath = StoragePaths.getHistoryJsonlPath(this.storePath, repoId, branchName);
    await AtomicWriter.appendJsonLine(historyPath, event, HistoryEventSchema);
  }
}
