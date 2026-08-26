import { GitAdapter } from './git/index.js';
import { StorageRegistry, StoragePaths, BranchLocker } from './storage/index.js';
import { FreshnessEvaluator, FreshnessEvaluation } from './freshness/index.js';
import { FullBranchAnalyzer, DeltaBranchAnalyzer } from './analyzer/index.js';
import {
  Config,
  Repository,
  Branch,
  BranchDocument,
  BranchState,
  FreshnessStatus,
  RefreshScope,
} from './types/index.js';
import {
  generateRepositoryId,
  generateBranchId,
  generateDocumentId,
} from '../utils/hash.js';
import { Logger } from '../utils/logger.js';
import path from 'node:path';

export interface RenderOptions {
  repoPath?: string;
  branchName?: string;
  baseRef?: string;
  force?: boolean;
  includeWorkingTree?: boolean;
}

export interface BranchContextResult {
  repository: Repository;
  branch: Branch;
  document: BranchDocument | null;
  state: BranchState;
  evaluation: FreshnessEvaluation;
  refreshed: boolean;
}

export class BranchContextOrchestrator {
  private readonly git: GitAdapter;
  private readonly registry: StorageRegistry;
  private readonly freshnessEvaluator: FreshnessEvaluator;
  private readonly fullAnalyzer: FullBranchAnalyzer;
  private readonly deltaAnalyzer: DeltaBranchAnalyzer;

  constructor(storePath?: string) {
    this.git = new GitAdapter();
    this.registry = new StorageRegistry(storePath);
    this.freshnessEvaluator = new FreshnessEvaluator(this.git);
    this.fullAnalyzer = new FullBranchAnalyzer(this.git);
    this.deltaAnalyzer = new DeltaBranchAnalyzer(this.git);
  }

  public getRegistry(): StorageRegistry {
    return this.registry;
  }

  public getGit(): GitAdapter {
    return this.git;
  }

  /**
   * Discover and register repository
   */
  public async discoverRepository(targetPath: string = '.'): Promise<Repository> {
    const rootPath = await this.git.getRepositoryRoot(targetPath);
    const remoteUrls = await this.git.getRemoteUrls(rootPath);
    const repoId = generateRepositoryId(rootPath, remoteUrls);
    const name = path.basename(rootPath);

    let repo = await this.registry.getRepository(repoId);
    const now = new Date().toISOString();

    if (!repo) {
      repo = {
        schema_version: '1.0.0',
        repository_id: repoId,
        name,
        path: rootPath,
        remote_urls: remoteUrls,
        default_branch: 'main',
        created_at: now,
        updated_at: now,
      };
      await this.registry.saveRepository(repo);
    } else {
      repo.path = rootPath;
      repo.remote_urls = remoteUrls;
      repo.updated_at = now;
      await this.registry.saveRepository(repo);
    }

    return repo;
  }

  /**
   * Discover and register branch
   */
  public async discoverBranch(
    repo: Repository,
    preferredBranch?: string,
    preferredBase?: string
  ): Promise<{ branch: Branch; baseCommit: string; headCommit: string }> {
    let branchName = preferredBranch;
    let headCommit = '';

    if (!branchName) {
      const info = await this.git.getCurrentBranch(repo.path);
      branchName = info.branchName;
      headCommit = info.headCommit;
    } else {
      headCommit = await this.git.getHeadCommit(repo.path);
    }

    const { baseRef, baseCommit } = await this.git.resolveBaseRef(repo.path, preferredBase);
    const branchId = generateBranchId(branchName);
    const documentId = generateDocumentId(repo.repository_id, branchId);

    let branch = await this.registry.getBranch(repo.repository_id, branchId);
    const now = new Date().toISOString();

    if (!branch) {
      branch = {
        schema_version: '1.0.0',
        repository_id: repo.repository_id,
        branch_id: branchId,
        branch_name: branchName,
        base_ref: baseRef,
        document_id: documentId,
        document_path: 'document.json',
        status: 'active',
        created_at: now,
        updated_at: now,
      };
      await this.registry.saveBranch(branch);
    } else {
      branch.base_ref = baseRef;
      branch.updated_at = now;
      await this.registry.saveBranch(branch);
    }

    return { branch, baseCommit, headCommit };
  }

  /**
   * Get status & freshness without rendering
   */
  public async getStatus(options: RenderOptions = {}): Promise<BranchContextResult> {
    const config = await this.registry.loadConfig();
    const repo = await this.discoverRepository(options.repoPath || '.');
    const { branch } = await this.discoverBranch(repo, options.branchName, options.baseRef || config.default_base_ref);

    const existingState = await this.registry.getState(repo.repository_id, branch.branch_id);
    const existingDoc = await this.registry.getDocument(repo.repository_id, branch.branch_id);

    const evaluation = await this.freshnessEvaluator.evaluate(
      repo.path,
      branch.base_ref,
      existingState,
      config.secret_patterns
    );

    const now = new Date().toISOString();
    const state: BranchState = existingState || {
      schema_version: '1.0.0',
      repository_id: repo.repository_id,
      branch_id: branch.branch_id,
      last_rendered_head: '',
      current_head: evaluation.currentHead,
      last_rendered_base_commit: '',
      current_base_commit: evaluation.currentBaseCommit,
      last_rendered_worktree_fingerprint: '',
      current_worktree_fingerprint: evaluation.currentWorktreeFingerprint,
      status: evaluation.status,
      new_commits_count: evaluation.newCommitsCount,
      changed_files_count: evaluation.changedFilesCount,
      last_checked_at: now,
      last_rendered_at: existingDoc ? existingDoc.freshness.rendered_at : now,
      analyzer_version: '1.0.0',
      renderer_version: '1.0.0',
    };

    return {
      repository: repo,
      branch,
      document: existingDoc,
      state,
      evaluation,
      refreshed: false,
    };
  }

  /**
   * Render or Refresh branch document (Full or Incremental)
   */
  public async refreshBranch(options: RenderOptions = {}): Promise<BranchContextResult> {
    const config = await this.registry.loadConfig();
    const repo = await this.discoverRepository(options.repoPath || '.');
    const { branch } = await this.discoverBranch(repo, options.branchName, options.baseRef || config.default_base_ref);

    const lockPath = StoragePaths.getBranchLockPath(
      this.registry.getStorePath(),
      repo.repository_id,
      branch.branch_id
    );

    const unlock = await BranchLocker.acquireLock(lockPath);

    try {
      const existingState = await this.registry.getState(repo.repository_id, branch.branch_id);
      const existingDoc = await this.registry.getDocument(repo.repository_id, branch.branch_id);

      const evaluation = await this.freshnessEvaluator.evaluate(
        repo.path,
        branch.base_ref,
        existingState,
        config.secret_patterns
      );

      // If already fresh and force is not set, return directly
      if (evaluation.status === 'FRESH' && !options.force && existingDoc) {
        return {
          repository: repo,
          branch,
          document: existingDoc,
          state: existingState!,
          evaluation,
          refreshed: false,
        };
      }

      const now = new Date().toISOString();
      let newDocument: BranchDocument;
      let newStatus: FreshnessStatus = 'FRESH';

      const isIncremental =
        evaluation.status === 'STALE_NEW_COMMITS' &&
        existingDoc !== null &&
        existingState !== null &&
        evaluation.isAncestor;

      if (isIncremental) {
        // --- INCREMENTAL UPDATE ---
        Logger.info(`Performing incremental update for ${branch.branch_name} (${existingState!.last_rendered_head}..${evaluation.currentHead})`);

        const deltaResult = await this.deltaAnalyzer.analyzeDelta(
          repo.path,
          existingState!.last_rendered_head,
          evaluation.currentHead,
          existingDoc!.content,
          config.secret_patterns
        );

        newDocument = {
          schema_version: '1.0.0',
          document_id: branch.document_id,
          document_type: 'branch-context',
          repository: {
            id: repo.repository_id,
            name: repo.name,
          },
          branch: {
            id: branch.branch_id,
            name: branch.branch_name,
          },
          source: {
            base_ref: branch.base_ref,
            base_commit: evaluation.currentBaseCommit,
            head_commit: evaluation.currentHead,
            working_tree_state: evaluation.workingTreeStatus.isClean ? 'clean' : 'dirty',
            includes_uncommitted_changes: !evaluation.workingTreeStatus.isClean,
          },
          freshness: {
            status: 'FRESH',
            rendered_at: now,
            analyzer_version: '1.0.0',
            renderer_version: '1.0.0',
          },
          content: deltaResult.updatedContent,
          evidence_refs: existingDoc!.evidence_refs || [],
        };

        await this.registry.appendHistory(repo.repository_id, branch.branch_id, {
          type: 'updated',
          timestamp: now,
          from_head: existingState!.last_rendered_head,
          to_head: evaluation.currentHead,
          new_commits: deltaResult.deltaCommits.length,
        });
      } else {
        // --- FULL BUILD / REBUILD ---
        Logger.info(`Performing full build for ${branch.branch_name} (${branch.base_ref}..${evaluation.currentHead})`);

        const fullResult = await this.fullAnalyzer.analyze(
          repo.path,
          evaluation.currentBaseCommit,
          evaluation.currentHead,
          config.secret_patterns
        );

        newDocument = {
          schema_version: '1.0.0',
          document_id: branch.document_id,
          document_type: 'branch-context',
          repository: {
            id: repo.repository_id,
            name: repo.name,
          },
          branch: {
            id: branch.branch_id,
            name: branch.branch_name,
          },
          source: {
            base_ref: branch.base_ref,
            base_commit: evaluation.currentBaseCommit,
            head_commit: evaluation.currentHead,
            working_tree_state: evaluation.workingTreeStatus.isClean ? 'clean' : 'dirty',
            includes_uncommitted_changes: !evaluation.workingTreeStatus.isClean,
          },
          freshness: {
            status: 'FRESH',
            rendered_at: now,
            analyzer_version: '1.0.0',
            renderer_version: '1.0.0',
          },
          content: fullResult.content,
          evidence_refs: [],
        };

        await this.registry.appendHistory(repo.repository_id, branch.branch_id, {
          type: existingDoc ? 'rebuild_required' : 'created',
          timestamp: now,
          head: evaluation.currentHead,
          reason: evaluation.status === 'REQUIRES_FULL_REBUILD' ? 'branch_rebased_or_initial' : evaluation.status,
        });
      }

      // Save document atomically
      await this.registry.saveDocument(newDocument);

      const newState: BranchState = {
        schema_version: '1.0.0',
        repository_id: repo.repository_id,
        branch_id: branch.branch_id,
        last_rendered_head: evaluation.currentHead,
        current_head: evaluation.currentHead,
        last_rendered_base_commit: evaluation.currentBaseCommit,
        current_base_commit: evaluation.currentBaseCommit,
        last_rendered_worktree_fingerprint: evaluation.currentWorktreeFingerprint,
        current_worktree_fingerprint: evaluation.currentWorktreeFingerprint,
        status: newStatus,
        new_commits_count: 0,
        changed_files_count: 0,
        last_checked_at: now,
        last_rendered_at: now,
        last_valid_document_head: evaluation.currentHead,
        analyzer_version: '1.0.0',
        renderer_version: '1.0.0',
      };

      await this.registry.saveState(newState);
      await this.registry.updateCatalogEntry(repo, branch, newState);

      return {
        repository: repo,
        branch,
        document: newDocument,
        state: newState,
        evaluation: {
          ...evaluation,
          status: 'FRESH',
          newCommitsCount: 0,
          changedFilesCount: 0,
        },
        refreshed: true,
      };
    } catch (err: any) {
      Logger.error(`Failed to render document for ${branch.branch_name}: ${err.message}`, err);

      const failedState: BranchState = {
        schema_version: '1.0.0',
        repository_id: repo.repository_id,
        branch_id: branch.branch_id,
        last_rendered_head: (await this.registry.getState(repo.repository_id, branch.branch_id))?.last_rendered_head || '',
        current_head: await this.git.getHeadCommit(repo.path),
        last_rendered_base_commit: '',
        current_base_commit: '',
        last_rendered_worktree_fingerprint: '',
        current_worktree_fingerprint: '',
        status: 'UPDATE_FAILED',
        new_commits_count: 0,
        changed_files_count: 0,
        last_checked_at: new Date().toISOString(),
        last_rendered_at: (await this.registry.getState(repo.repository_id, branch.branch_id))?.last_rendered_at || new Date().toISOString(),
        analyzer_version: '1.0.0',
        renderer_version: '1.0.0',
        error: err.message,
      };

      await this.registry.saveState(failedState);
      await this.registry.appendHistory(repo.repository_id, branch.branch_id, {
        type: 'update_failed',
        timestamp: new Date().toISOString(),
        error: err.message,
      });

      throw err;
    } finally {
      await unlock();
    }
  }

  /**
   * Execute refresh scope on repository
   */
  public async executeRefreshScope(
    repoPath: string,
    scope: RefreshScope,
    preferredBase?: string
  ): Promise<BranchContextResult[]> {
    const results: BranchContextResult[] = [];
    const repo = await this.discoverRepository(repoPath);

    if (scope === 'current') {
      const result = await this.refreshBranch({ repoPath: repo.path, baseRef: preferredBase });
      results.push(result);
    } else if (scope === 'stale' || scope === 'all') {
      const catalog = await this.registry.loadCatalog();
      const repoEntry = catalog.repositories.find((r) => r.repository_id === repo.repository_id);

      if (repoEntry) {
        for (const branchEntry of repoEntry.branches) {
          const status = await this.getStatus({ repoPath: repo.path, branchName: branchEntry.branch_name });
          if (scope === 'all' || status.evaluation.status !== 'FRESH') {
            const refreshed = await this.refreshBranch({
              repoPath: repo.path,
              branchName: branchEntry.branch_name,
            });
            results.push(refreshed);
          } else {
            results.push(status);
          }
        }
      } else {
        // If repo not in catalog yet, refresh current
        const result = await this.refreshBranch({ repoPath: repo.path, baseRef: preferredBase });
        results.push(result);
      }
    } else if (scope === 'none') {
      const status = await this.getStatus({ repoPath: repo.path, baseRef: preferredBase });
      results.push(status);
    }

    return results;
  }
}
