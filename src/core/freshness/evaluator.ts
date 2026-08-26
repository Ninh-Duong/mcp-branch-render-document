import { GitAdapter, WorkingTreeStatus } from '../git/index.js';
import { BranchState, FreshnessStatus } from '../types/index.js';

export type ComparisonRelation =
  | 'SAME_COMMIT'
  | 'BASE_IS_ANCESTOR_OF_TARGET'
  | 'TARGET_IS_ANCESTOR_OF_BASE'
  | 'DIVERGED';

export interface FreshnessEvaluationParams {
  repoPath: string;
  targetCommit: string;
  baseCommit: string;
  targetBranch: string;
  baseBranch?: string;
  checkoutBranch: string;
  workingTreeStatus: WorkingTreeStatus;
  previousState: BranchState | null;
  secretPatterns?: string[];
}

export interface FreshnessEvaluation {
  status: FreshnessStatus;
  comparisonRelation: ComparisonRelation;
  currentTargetCommit: string;
  currentBaseCommit: string;
  currentWorktreeFingerprint: string;
  newCommitsCount: number;
  changedFilesCount: number;
  isAncestor: boolean;
  workingTreeStatus: WorkingTreeStatus;
}

export class FreshnessEvaluator {
  constructor(private readonly git: GitAdapter) {}

  public async evaluate(params: FreshnessEvaluationParams): Promise<FreshnessEvaluation> {
    const {
      repoPath,
      targetCommit,
      baseCommit,
      targetBranch,
      baseBranch,
      checkoutBranch,
      workingTreeStatus,
      previousState,
    } = params;

    const currentWorktreeFingerprint = workingTreeStatus.fingerprint;

    // 1. Determine relationship between baseCommit and targetCommit
    let comparisonRelation: ComparisonRelation = 'DIVERGED';
    if (baseCommit === targetCommit) {
      comparisonRelation = 'SAME_COMMIT';
    } else {
      const baseIsAncestor = await this.git.isAncestor(repoPath, baseCommit, targetCommit);
      if (baseIsAncestor) {
        comparisonRelation = 'BASE_IS_ANCESTOR_OF_TARGET';
      } else {
        const targetIsAncestor = await this.git.isAncestor(repoPath, targetCommit, baseCommit);
        if (targetIsAncestor) {
          comparisonRelation = 'TARGET_IS_ANCESTOR_OF_BASE';
        } else {
          comparisonRelation = 'DIVERGED';
        }
      }
    }

    // If never rendered before, full build is required
    const lastTargetCommit = previousState?.last_rendered_target_commit || previousState?.last_rendered_head || '';
    const lastBaseCommit = previousState?.last_rendered_base_commit || '';

    if (!previousState || !lastTargetCommit) {
      const newCommits = await this.git.getCommitsSince(repoPath, baseCommit, targetCommit);
      const changedFiles = await this.git.getChangedFilesSince(repoPath, baseCommit, targetCommit);

      return {
        status: 'REQUIRES_FULL_REBUILD',
        comparisonRelation,
        currentTargetCommit: targetCommit,
        currentBaseCommit: baseCommit,
        currentWorktreeFingerprint,
        newCommitsCount: newCommits.length,
        changedFilesCount: changedFiles.length,
        isAncestor: true,
        workingTreeStatus,
      };
    }

    // 2. Check if base commit or base branch changed
    if (
      (lastBaseCommit && lastBaseCommit !== baseCommit) ||
      (previousState.base_branch && previousState.base_branch !== baseBranch)
    ) {
      const newCommits = await this.git.getCommitsSince(repoPath, baseCommit, targetCommit);
      const changedFiles = await this.git.getChangedFilesSince(repoPath, baseCommit, targetCommit);

      return {
        status: 'STALE_BASE_CHANGED',
        comparisonRelation,
        currentTargetCommit: targetCommit,
        currentBaseCommit: baseCommit,
        currentWorktreeFingerprint,
        newCommitsCount: newCommits.length,
        changedFilesCount: changedFiles.length,
        isAncestor: true,
        workingTreeStatus,
      };
    }

    // 3. Check if previous target commit is ancestor of current target commit (rebase/reset detection)
    const isAncestor = await this.git.isAncestor(repoPath, lastTargetCommit, targetCommit);
    if (!isAncestor) {
      const newCommits = await this.git.getCommitsSince(repoPath, baseCommit, targetCommit);
      const changedFiles = await this.git.getChangedFilesSince(repoPath, baseCommit, targetCommit);

      return {
        status: 'REQUIRES_FULL_REBUILD',
        comparisonRelation,
        currentTargetCommit: targetCommit,
        currentBaseCommit: baseCommit,
        currentWorktreeFingerprint,
        newCommitsCount: newCommits.length,
        changedFilesCount: changedFiles.length,
        isAncestor: false,
        workingTreeStatus,
      };
    }

    // 4. Check if new commits exist in target branch
    if (lastTargetCommit !== targetCommit) {
      const deltaCommits = await this.git.getCommitsSince(repoPath, lastTargetCommit, targetCommit);
      const deltaChangedFiles = await this.git.getChangedFilesSince(
        repoPath,
        lastTargetCommit,
        targetCommit
      );

      return {
        status: 'STALE_NEW_COMMITS',
        comparisonRelation,
        currentTargetCommit: targetCommit,
        currentBaseCommit: baseCommit,
        currentWorktreeFingerprint,
        newCommitsCount: deltaCommits.length,
        changedFilesCount: deltaChangedFiles.length,
        isAncestor: true,
        workingTreeStatus,
      };
    }

    // 5. Check if working tree changed (ONLY if targetBranch === checkoutBranch)
    if (targetBranch === checkoutBranch) {
      if (previousState.last_rendered_worktree_fingerprint !== currentWorktreeFingerprint) {
        return {
          status: 'STALE_WORKTREE',
          comparisonRelation,
          currentTargetCommit: targetCommit,
          currentBaseCommit: baseCommit,
          currentWorktreeFingerprint,
          newCommitsCount: 0,
          changedFilesCount: workingTreeStatus.entries.length,
          isAncestor: true,
          workingTreeStatus,
        };
      }
    }

    // Everything matches!
    return {
      status: 'FRESH',
      comparisonRelation,
      currentTargetCommit: targetCommit,
      currentBaseCommit: baseCommit,
      currentWorktreeFingerprint,
      newCommitsCount: 0,
      changedFilesCount: 0,
      isAncestor: true,
      workingTreeStatus,
    };
  }
}
