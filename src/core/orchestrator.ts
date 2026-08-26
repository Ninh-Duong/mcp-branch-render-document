import { GitAdapter, WorkingTreeStatus } from './git/index.js';
import { StorageRegistry, StoragePaths, BranchLocker, GitignoreHelper } from './storage/index.js';
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

export interface RenderContext {
  repo: Repository;
  storePath: string;
  targetBranch: string;
  targetCommit: string;
  checkoutBranch: string;
  baseBranch: string;
  baseCommit: string;
  checkoutIsDetached: boolean;
  workingTreeStatus: WorkingTreeStatus;
  branchId: string;
  documentId: string;
}

export interface RenderOptions {
  repoPath?: string;
  branchName?: string; // Target branch
  baseRef?: string;    // Base branch (defaults to checkout branch)
  force?: boolean;
  includeWorkingTree?: boolean;
  storagePath?: string;
}

export interface BranchContextResult {
  repository: Repository;
  branch: Branch;
  target_branch: string;
  checkout_branch: string;
  base_branch: string;
  target_commit: string;
  base_commit: string;
  comparison: string;
  strategy: 'full' | 'incremental' | 'cached';
  rendered: boolean;
  rendered_commits_count: number;
  changed_files_count: number;
  insertions: number;
  deletions: number;
  checkout_worktree_included: boolean;
  document_path: string;
  document: BranchDocument | null;
  state: BranchState;
  evaluation: FreshnessEvaluation;
  refreshed: boolean;
}

export class BranchContextOrchestrator {
  private readonly git: GitAdapter;
  private readonly freshnessEvaluator: FreshnessEvaluator;
  private readonly fullAnalyzer: FullBranchAnalyzer;
  private readonly deltaAnalyzer: DeltaBranchAnalyzer;
  private readonly customStorePath?: string;

  constructor(customStorePath?: string) {
    this.git = new GitAdapter();
    this.freshnessEvaluator = new FreshnessEvaluator(this.git);
    this.fullAnalyzer = new FullBranchAnalyzer(this.git);
    this.deltaAnalyzer = new DeltaBranchAnalyzer(this.git);
    this.customStorePath = customStorePath;
  }

  public getGit(): GitAdapter {
    return this.git;
  }

  public getRegistry(storePath?: string): StorageRegistry {
    return new StorageRegistry(storePath || this.customStorePath);
  }

  /**
   * Discover and register repository
   */
  public async discoverRepository(
    targetPath: string = '.',
    customStore?: string
  ): Promise<{ repo: Repository; storePath: string; registry: StorageRegistry }> {
    const rootPath = await this.git.getRepositoryRoot(targetPath);
    const remoteUrls = await this.git.getRemoteUrls(rootPath);
    const repoId = generateRepositoryId(rootPath, remoteUrls);
    const name = path.basename(rootPath);

    const storePath = StoragePaths.resolveStorePath({
      repoRoot: rootPath,
      customPath: customStore || this.customStorePath,
    });

    const registry = new StorageRegistry(storePath);
    let repo = await registry.getRepository(repoId);
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
      await registry.saveRepository(repo);
    } else {
      repo.path = rootPath;
      repo.remote_urls = remoteUrls;
      repo.updated_at = now;
      await registry.saveRepository(repo);
    }

    return { repo, storePath, registry };
  }

  /**
   * Resolve standard PR RenderContext
   */
  public async resolveRenderContext(
    repoPath: string = '.',
    targetBranchInput?: string,
    baseBranchInput?: string,
    customStore?: string
  ): Promise<RenderContext> {
    const { repo, storePath, registry } = await this.discoverRepository(repoPath, customStore);
    const checkout = await this.git.getCurrentCheckout(repo.path);

    if (checkout.isDetached) {
      throw new Error(
        'Current checkout is detached HEAD. Please checkout a base branch (e.g. main, release/...) before rendering target branch context.'
      );
    }

    const checkoutBranch = checkout.branchName;
    let baseBranch = checkoutBranch;
    let baseCommit = checkout.headCommit;

    if (baseBranchInput && baseBranchInput.trim().length > 0) {
      const resolvedBase = await this.git.resolveBranchRef(repo.path, baseBranchInput.trim());
      baseBranch = baseBranchInput.trim();
      baseCommit = resolvedBase.commit;
    }

    // Target branch defaults to checkout branch if not provided
    const targetBranch = targetBranchInput && targetBranchInput.trim().length > 0
      ? targetBranchInput.trim()
      : checkoutBranch;

    // Resolve target commit independently from target branch ref
    let targetCommit: string;
    if (targetBranch === checkoutBranch && !baseBranchInput) {
      targetCommit = baseCommit;
    } else {
      const resolvedTarget = await this.git.resolveBranchRef(repo.path, targetBranch);
      targetCommit = resolvedTarget.commit;
    }

    const config = await registry.loadConfig();
    const workingTreeStatus = await this.git.getWorkingTreeStatus(repo.path, config.secret_patterns);

    const branchId = generateBranchId(targetBranch);
    const documentId = generateDocumentId(repo.repository_id, branchId);

    // Save/update branch record
    let branchRecord = await registry.getBranch(repo.repository_id, branchId);
    const now = new Date().toISOString();
    if (!branchRecord) {
      branchRecord = {
        schema_version: '1.0.0',
        repository_id: repo.repository_id,
        branch_id: branchId,
        branch_name: targetBranch,
        base_ref: baseBranch,
        document_id: documentId,
        document_path: 'document.json',
        status: 'active',
        created_at: now,
        updated_at: now,
      };
      await registry.saveBranch(branchRecord);
    } else {
      branchRecord.base_ref = baseBranch;
      branchRecord.updated_at = now;
      await registry.saveBranch(branchRecord);
    }

    return {
      repo,
      storePath,
      targetBranch,
      targetCommit,
      checkoutBranch,
      baseBranch,
      baseCommit,
      checkoutIsDetached: checkout.isDetached,
      workingTreeStatus,
      branchId,
      documentId,
    };
  }

  /**
   * Get status & freshness without performing rendering
   */
  public async getStatus(options: RenderOptions = {}): Promise<BranchContextResult> {
    const ctx = await this.resolveRenderContext(
      options.repoPath || '.',
      options.branchName,
      options.baseRef,
      options.storagePath
    );
    const registry = new StorageRegistry(ctx.storePath);

    const existingState = await registry.getState(ctx.repo.repository_id, ctx.branchId);
    const existingDoc = await registry.getDocument(ctx.repo.repository_id, ctx.branchId);
    const config = await registry.loadConfig();

    const evaluation = await this.freshnessEvaluator.evaluate({
      repoPath: ctx.repo.path,
      targetCommit: ctx.targetCommit,
      baseCommit: ctx.baseCommit,
      targetBranch: ctx.targetBranch,
      checkoutBranch: ctx.checkoutBranch,
      workingTreeStatus: ctx.workingTreeStatus,
      previousState: existingState,
      secretPatterns: config.secret_patterns,
    });

    const now = new Date().toISOString();
    const docPath = StoragePaths.getDocumentJsonPath(ctx.storePath, ctx.repo.repository_id, ctx.branchId);

    const state: BranchState = existingState || {
      schema_version: '1.0.0',
      repository_id: ctx.repo.repository_id,
      branch_id: ctx.branchId,
      target_branch: ctx.targetBranch,
      base_branch: ctx.baseBranch,
      last_rendered_target_commit: '',
      current_target_commit: ctx.targetCommit,
      last_rendered_base_commit: '',
      current_base_commit: ctx.baseCommit,
      last_rendered_worktree_fingerprint: '',
      current_worktree_fingerprint: ctx.workingTreeStatus.fingerprint,
      status: evaluation.status,
      pending_new_commits_count: evaluation.newCommitsCount,
      pending_changed_files_count: evaluation.changedFilesCount,
      rendered_commits_count: existingDoc?.content.commits?.length || 0,
      rendered_changed_files_count: existingDoc?.content.changes?.length || 0,
      rendered_insertions: (existingDoc?.content.scope?.insertions as number) || 0,
      rendered_deletions: (existingDoc?.content.scope?.deletions as number) || 0,
      last_rendered_head: '',
      current_head: ctx.targetCommit,
      new_commits_count: evaluation.newCommitsCount,
      changed_files_count: evaluation.changedFilesCount,
      last_checked_at: now,
      last_rendered_at: existingDoc ? existingDoc.freshness.rendered_at : now,
      analyzer_version: '1.0.0',
      renderer_version: '1.0.0',
    };

    const branch: Branch = {
      schema_version: '1.0.0',
      repository_id: ctx.repo.repository_id,
      branch_id: ctx.branchId,
      branch_name: ctx.targetBranch,
      base_ref: ctx.baseBranch,
      document_id: ctx.documentId,
      document_path: docPath,
      status: 'active',
      created_at: now,
      updated_at: now,
    };

    return {
      repository: ctx.repo,
      branch,
      target_branch: ctx.targetBranch,
      checkout_branch: ctx.checkoutBranch,
      base_branch: ctx.baseBranch,
      target_commit: ctx.targetCommit,
      base_commit: ctx.baseCommit,
      comparison: `${ctx.baseBranch}..${ctx.targetBranch}`,
      strategy: 'cached',
      rendered: false,
      rendered_commits_count: state.rendered_commits_count,
      changed_files_count: state.rendered_changed_files_count,
      insertions: state.rendered_insertions,
      deletions: state.rendered_deletions,
      checkout_worktree_included: ctx.targetBranch === ctx.checkoutBranch && !ctx.workingTreeStatus.isClean,
      document_path: docPath,
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
    const ctx = await this.resolveRenderContext(
      options.repoPath || '.',
      options.branchName,
      options.baseRef,
      options.storagePath
    );
    const registry = new StorageRegistry(ctx.storePath);
    const config = await registry.loadConfig();

    // 1. Ensure .gitignore if storage is repo-local and enabled
    if (config.auto_update_gitignore && ctx.storePath.includes('.branch-render-context')) {
      await GitignoreHelper.ensureBranchRenderGitignore(ctx.repo.path);
    }

    const lockPath = StoragePaths.getBranchLockPath(
      ctx.storePath,
      ctx.repo.repository_id,
      ctx.branchId
    );

    const unlock = await BranchLocker.acquireLock(lockPath);

    try {
      const existingState = await registry.getState(ctx.repo.repository_id, ctx.branchId);
      const existingDoc = await registry.getDocument(ctx.repo.repository_id, ctx.branchId);

      const evaluation = await this.freshnessEvaluator.evaluate({
        repoPath: ctx.repo.path,
        targetCommit: ctx.targetCommit,
        baseCommit: ctx.baseCommit,
        targetBranch: ctx.targetBranch,
        checkoutBranch: ctx.checkoutBranch,
        workingTreeStatus: ctx.workingTreeStatus,
        previousState: existingState,
        secretPatterns: config.secret_patterns,
      });

      const docPath = StoragePaths.getDocumentJsonPath(ctx.storePath, ctx.repo.repository_id, ctx.branchId);

      // If already FRESH and not forced, return cached document
      if (evaluation.status === 'FRESH' && !options.force && existingDoc && existingState) {
        const branch: Branch = {
          schema_version: '1.0.0',
          repository_id: ctx.repo.repository_id,
          branch_id: ctx.branchId,
          branch_name: ctx.targetBranch,
          base_ref: ctx.baseBranch,
          document_id: ctx.documentId,
          document_path: docPath,
          status: 'active',
          created_at: existingDoc.freshness.rendered_at,
          updated_at: new Date().toISOString(),
        };

        return {
          repository: ctx.repo,
          branch,
          target_branch: ctx.targetBranch,
          checkout_branch: ctx.checkoutBranch,
          base_branch: ctx.baseBranch,
          target_commit: ctx.targetCommit,
          base_commit: ctx.baseCommit,
          comparison: `${ctx.baseBranch}..${ctx.targetBranch}`,
          strategy: 'cached',
          rendered: false,
          rendered_commits_count: existingState.rendered_commits_count,
          changed_files_count: existingState.rendered_changed_files_count,
          insertions: existingState.rendered_insertions,
          deletions: existingState.rendered_deletions,
          checkout_worktree_included: ctx.targetBranch === ctx.checkoutBranch && !ctx.workingTreeStatus.isClean,
          document_path: docPath,
          document: existingDoc,
          state: existingState,
          evaluation,
          refreshed: false,
        };
      }

      const now = new Date().toISOString();
      let newDocument: BranchDocument;
      let strategy: 'full' | 'incremental' = 'full';
      let renderedCommitsCount = 0;
      let renderedChangedFilesCount = 0;
      let renderedInsertions = 0;
      let renderedDeletions = 0;

      const isIncremental =
        evaluation.status === 'STALE_NEW_COMMITS' &&
        existingDoc !== null &&
        existingState !== null &&
        existingState.last_rendered_base_commit === ctx.baseCommit &&
        evaluation.isAncestor;

      const isWorktreeIncluded = ctx.targetBranch === ctx.checkoutBranch && !ctx.workingTreeStatus.isClean;

      if (isIncremental) {
        // --- INCREMENTAL UPDATE ---
        strategy = 'incremental';
        const lastTarget = existingState!.last_rendered_target_commit || existingState!.last_rendered_head;
        Logger.info(`Performing incremental update for ${ctx.targetBranch} (${lastTarget}..${ctx.targetCommit})`);

        const deltaResult = await this.deltaAnalyzer.analyzeDelta(
          ctx.repo.path,
          lastTarget,
          ctx.targetCommit,
          existingDoc!.content,
          config.secret_patterns
        );

        renderedCommitsCount = deltaResult.updatedContent.commits?.length || 0;
        renderedChangedFilesCount = deltaResult.updatedContent.changes?.length || 0;
        renderedInsertions = (deltaResult.updatedContent.scope?.insertions as number) || 0;
        renderedDeletions = (deltaResult.updatedContent.scope?.deletions as number) || 0;

        newDocument = {
          schema_version: '1.0.0',
          document_id: ctx.documentId,
          document_type: 'branch-context',
          repository: {
            id: ctx.repo.repository_id,
            name: ctx.repo.name,
          },
          branch: {
            id: ctx.branchId,
            name: ctx.targetBranch,
          },
          source: {
            target_branch: ctx.targetBranch,
            target_commit: ctx.targetCommit,
            base_branch: ctx.baseBranch,
            base_commit: ctx.baseCommit,
            checkout_branch: ctx.checkoutBranch,
            working_tree_state: ctx.workingTreeStatus.isClean ? 'clean' : 'dirty',
            includes_uncommitted_changes: isWorktreeIncluded,
            base_ref: ctx.baseBranch,
            head_commit: ctx.targetCommit,
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

        await registry.appendHistory(ctx.repo.repository_id, ctx.branchId, {
          type: 'updated',
          timestamp: now,
          from_head: lastTarget,
          to_head: ctx.targetCommit,
          new_commits: deltaResult.deltaCommits.length,
        });
      } else {
        // --- FULL BUILD / REBUILD ---
        strategy = 'full';
        Logger.info(`Performing full build for ${ctx.targetBranch} (${ctx.baseBranch}..${ctx.targetCommit})`);

        const fullResult = await this.fullAnalyzer.analyze(
          ctx.repo.path,
          ctx.baseCommit,
          ctx.targetCommit,
          config.secret_patterns
        );

        renderedCommitsCount = fullResult.commits.length;
        renderedChangedFilesCount = fullResult.changedFiles.length;
        renderedInsertions = fullResult.diffStat.insertions;
        renderedDeletions = fullResult.diffStat.deletions;

        newDocument = {
          schema_version: '1.0.0',
          document_id: ctx.documentId,
          document_type: 'branch-context',
          repository: {
            id: ctx.repo.repository_id,
            name: ctx.repo.name,
          },
          branch: {
            id: ctx.branchId,
            name: ctx.targetBranch,
          },
          source: {
            target_branch: ctx.targetBranch,
            target_commit: ctx.targetCommit,
            base_branch: ctx.baseBranch,
            base_commit: ctx.baseCommit,
            checkout_branch: ctx.checkoutBranch,
            working_tree_state: ctx.workingTreeStatus.isClean ? 'clean' : 'dirty',
            includes_uncommitted_changes: isWorktreeIncluded,
            base_ref: ctx.baseBranch,
            head_commit: ctx.targetCommit,
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

        await registry.appendHistory(ctx.repo.repository_id, ctx.branchId, {
          type: existingDoc ? 'rebuild_required' : 'created',
          timestamp: now,
          head: ctx.targetCommit,
          reason: evaluation.status === 'REQUIRES_FULL_REBUILD' ? 'branch_rebased_or_initial' : evaluation.status,
        });
      }

      // Save document atomically
      await registry.saveDocument(newDocument);

      const newState: BranchState = {
        schema_version: '1.0.0',
        repository_id: ctx.repo.repository_id,
        branch_id: ctx.branchId,
        target_branch: ctx.targetBranch,
        base_branch: ctx.baseBranch,
        last_rendered_target_commit: ctx.targetCommit,
        current_target_commit: ctx.targetCommit,
        last_rendered_base_commit: ctx.baseCommit,
        current_base_commit: ctx.baseCommit,
        last_rendered_worktree_fingerprint: ctx.workingTreeStatus.fingerprint,
        current_worktree_fingerprint: ctx.workingTreeStatus.fingerprint,
        status: 'FRESH',
        pending_new_commits_count: 0,
        pending_changed_files_count: 0,
        rendered_commits_count: renderedCommitsCount,
        rendered_changed_files_count: renderedChangedFilesCount,
        rendered_insertions: renderedInsertions,
        rendered_deletions: renderedDeletions,
        // Aliases
        last_rendered_head: ctx.targetCommit,
        current_head: ctx.targetCommit,
        new_commits_count: 0,
        changed_files_count: 0,
        last_checked_at: now,
        last_rendered_at: now,
        last_valid_document_head: ctx.targetCommit,
        analyzer_version: '1.0.0',
        renderer_version: '1.0.0',
      };

      await registry.saveState(newState);

      const branch: Branch = {
        schema_version: '1.0.0',
        repository_id: ctx.repo.repository_id,
        branch_id: ctx.branchId,
        branch_name: ctx.targetBranch,
        base_ref: ctx.baseBranch,
        document_id: ctx.documentId,
        document_path: docPath,
        status: 'active',
        created_at: now,
        updated_at: now,
      };

      await registry.updateCatalogEntry(ctx.repo, branch, newState);

      return {
        repository: ctx.repo,
        branch,
        target_branch: ctx.targetBranch,
        checkout_branch: ctx.checkoutBranch,
        base_branch: ctx.baseBranch,
        target_commit: ctx.targetCommit,
        base_commit: ctx.baseCommit,
        comparison: `${ctx.baseBranch}..${ctx.targetBranch}`,
        strategy,
        rendered: true,
        rendered_commits_count: renderedCommitsCount,
        changed_files_count: renderedChangedFilesCount,
        insertions: renderedInsertions,
        deletions: renderedDeletions,
        checkout_worktree_included: isWorktreeIncluded,
        document_path: docPath,
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
      Logger.error(`Failed to render document for ${ctx.targetBranch}: ${err.message}`, err);

      const failedState: BranchState = {
        schema_version: '1.0.0',
        repository_id: ctx.repo.repository_id,
        branch_id: ctx.branchId,
        target_branch: ctx.targetBranch,
        base_branch: ctx.baseBranch,
        last_rendered_target_commit: (await registry.getState(ctx.repo.repository_id, ctx.branchId))?.last_rendered_target_commit || '',
        current_target_commit: ctx.targetCommit,
        last_rendered_base_commit: (await registry.getState(ctx.repo.repository_id, ctx.branchId))?.last_rendered_base_commit || '',
        current_base_commit: ctx.baseCommit,
        last_rendered_worktree_fingerprint: '',
        current_worktree_fingerprint: ctx.workingTreeStatus.fingerprint,
        status: 'UPDATE_FAILED',
        pending_new_commits_count: 0,
        pending_changed_files_count: 0,
        rendered_commits_count: 0,
        rendered_changed_files_count: 0,
        rendered_insertions: 0,
        rendered_deletions: 0,
        last_rendered_head: (await registry.getState(ctx.repo.repository_id, ctx.branchId))?.last_rendered_head || '',
        current_head: ctx.targetCommit,
        new_commits_count: 0,
        changed_files_count: 0,
        last_checked_at: new Date().toISOString(),
        last_rendered_at: (await registry.getState(ctx.repo.repository_id, ctx.branchId))?.last_rendered_at || new Date().toISOString(),
        analyzer_version: '1.0.0',
        renderer_version: '1.0.0',
        error: err.message,
      };

      await registry.saveState(failedState);
      await registry.appendHistory(ctx.repo.repository_id, ctx.branchId, {
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
    targetBranch?: string,
    force: boolean = false,
    storagePath?: string
  ): Promise<BranchContextResult[]> {
    const results: BranchContextResult[] = [];
    const { repo, storePath, registry } = await this.discoverRepository(repoPath, storagePath);

    if (scope === 'current') {
      const result = await this.refreshBranch({
        repoPath: repo.path,
        branchName: targetBranch,
        force,
        storagePath: storePath,
      });
      results.push(result);
    } else if (scope === 'stale' || scope === 'all') {
      const catalog = await registry.loadCatalog();
      const repoEntry = catalog.repositories.find((r) => r.repository_id === repo.repository_id);

      if (repoEntry && repoEntry.branches.length > 0) {
        for (const branchEntry of repoEntry.branches) {
          const status = await this.getStatus({
            repoPath: repo.path,
            branchName: branchEntry.branch_name,
            storagePath: storePath,
          });

          if (scope === 'all' || status.evaluation.status !== 'FRESH' || force) {
            const refreshed = await this.refreshBranch({
              repoPath: repo.path,
              branchName: branchEntry.branch_name,
              force,
              storagePath: storePath,
            });
            results.push(refreshed);
          } else {
            results.push(status);
          }
        }
      } else {
        const result = await this.refreshBranch({
          repoPath: repo.path,
          branchName: targetBranch,
          force,
          storagePath: storePath,
        });
        results.push(result);
      }
    } else if (scope === 'none') {
      const status = await this.getStatus({
        repoPath: repo.path,
        branchName: targetBranch,
        storagePath: storePath,
      });
      results.push(status);
    }

    return results;
  }
}
