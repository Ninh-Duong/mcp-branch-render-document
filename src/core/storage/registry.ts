import fs from 'node:fs/promises';
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

export class StorageRegistry {
  private readonly storePath: string;

  constructor(storePath?: string) {
    this.storePath = storePath || StoragePaths.getDefaultStorePath();
  }

  public getStorePath(): string {
    return this.storePath;
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

    const branchIdx = repoEntry.branches.findIndex((b) => b.branch_id === branch.branch_id);
    const branchEntry = {
      branch_id: branch.branch_id,
      branch_name: branch.branch_name,
      document_id: branch.document_id,
      document_path: StoragePaths.getRelativeDocumentJsonPath(repo.repository_id, branch.branch_id),
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

  // --- BRANCH ---

  public async getBranch(repoId: string, branchId: string): Promise<Branch | null> {
    const branchJsonPath = StoragePaths.getBranchJsonPath(this.storePath, repoId, branchId);
    try {
      const raw = await fs.readFile(branchJsonPath, 'utf-8');
      return BranchSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  public async saveBranch(branch: Branch): Promise<void> {
    const branchJsonPath = StoragePaths.getBranchJsonPath(
      this.storePath,
      branch.repository_id,
      branch.branch_id
    );
    await AtomicWriter.writeJsonAtomically(branchJsonPath, branch, BranchSchema);
  }

  // --- DOCUMENT ---

  public async getDocument(repoId: string, branchId: string): Promise<BranchDocument | null> {
    const docPath = StoragePaths.getDocumentJsonPath(this.storePath, repoId, branchId);
    try {
      const raw = await fs.readFile(docPath, 'utf-8');
      return DocumentSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  public async saveDocument(doc: BranchDocument): Promise<void> {
    const docPath = StoragePaths.getDocumentJsonPath(
      this.storePath,
      doc.repository.id,
      doc.branch.id
    );
    await AtomicWriter.writeJsonAtomically(docPath, doc, DocumentSchema);
  }

  // --- STATE ---

  public async getState(repoId: string, branchId: string): Promise<BranchState | null> {
    const statePath = StoragePaths.getStateJsonPath(this.storePath, repoId, branchId);
    try {
      const raw = await fs.readFile(statePath, 'utf-8');
      return BranchStateSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  public async saveState(state: BranchState): Promise<void> {
    const statePath = StoragePaths.getStateJsonPath(
      this.storePath,
      state.repository_id,
      state.branch_id
    );
    await AtomicWriter.writeJsonAtomically(statePath, state, BranchStateSchema);
  }

  // --- HISTORY ---

  public async appendHistory(
    repoId: string,
    branchId: string,
    event: HistoryEvent
  ): Promise<void> {
    const historyPath = StoragePaths.getHistoryJsonlPath(this.storePath, repoId, branchId);
    await AtomicWriter.appendJsonLine(historyPath, event, HistoryEventSchema);
  }
}
