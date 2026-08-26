import { GitAdapter, WorkingTreeStatus } from '../git/index.js';
import { BranchState, FreshnessStatus } from '../types/index.js';

export interface FreshnessEvaluation {
  status: FreshnessStatus;
  currentHead: string;
  currentBaseCommit: string;
  currentWorktreeFingerprint: string;
  newCommitsCount: number;
  changedFilesCount: number;
  isAncestor: boolean;
  workingTreeStatus: WorkingTreeStatus;
}

export class FreshnessEvaluator {
  constructor(private readonly git: GitAdapter) {}

  public async evaluate(
    repoPath: string,
    baseRef: string,
    state: BranchState | null,
    secretPatterns: string[] = []
  ): Promise<FreshnessEvaluation> {
    const currentHead = await this.git.getHeadCommit(repoPath);
    const { baseCommit: currentBaseCommit } = await this.git.resolveBaseRef(repoPath, baseRef);
    const workingTreeStatus = await this.git.getWorkingTreeStatus(repoPath, secretPatterns);
    const currentWorktreeFingerprint = workingTreeStatus.fingerprint;

    // If never rendered before, full build is required
    if (!state || !state.last_rendered_head) {
      return {
        status: 'REQUIRES_FULL_REBUILD',
        currentHead,
        currentBaseCommit,
        currentWorktreeFingerprint,
        newCommitsCount: 0,
        changedFilesCount: 0,
        isAncestor: true,
        workingTreeStatus,
      };
    }

    // 1. Check if base commit changed
    if (state.last_rendered_base_commit !== currentBaseCommit) {
      return {
        status: 'STALE_BASE_CHANGED',
        currentHead,
        currentBaseCommit,
        currentWorktreeFingerprint,
        newCommitsCount: 0,
        changedFilesCount: 0,
        isAncestor: true,
        workingTreeStatus,
      };
    }

    // 2. Check if last rendered HEAD is ancestor of current HEAD (rebase / reset detection)
    const isAncestor = await this.git.isAncestor(repoPath, state.last_rendered_head, currentHead);
    if (!isAncestor) {
      return {
        status: 'REQUIRES_FULL_REBUILD',
        currentHead,
        currentBaseCommit,
        currentWorktreeFingerprint,
        newCommitsCount: 0,
        changedFilesCount: 0,
        isAncestor: false,
        workingTreeStatus,
      };
    }

    // 3. Check if new commits exist
    if (state.last_rendered_head !== currentHead) {
      const newCommits = await this.git.getCommitsSince(repoPath, state.last_rendered_head, currentHead);
      const changedFiles = await this.git.getChangedFilesSince(
        repoPath,
        state.last_rendered_head,
        currentHead
      );

      return {
        status: 'STALE_NEW_COMMITS',
        currentHead,
        currentBaseCommit,
        currentWorktreeFingerprint,
        newCommitsCount: newCommits.length,
        changedFilesCount: changedFiles.length,
        isAncestor: true,
        workingTreeStatus,
      };
    }

    // 4. Check if working tree changed
    if (state.last_rendered_worktree_fingerprint !== currentWorktreeFingerprint) {
      return {
        status: 'STALE_WORKTREE',
        currentHead,
        currentBaseCommit,
        currentWorktreeFingerprint,
        newCommitsCount: 0,
        changedFilesCount: workingTreeStatus.entries.length,
        isAncestor: true,
        workingTreeStatus,
      };
    }

    // Everything matches!
    return {
      status: 'FRESH',
      currentHead,
      currentBaseCommit,
      currentWorktreeFingerprint,
      newCommitsCount: 0,
      changedFilesCount: 0,
      isAncestor: true,
      workingTreeStatus,
    };
  }
}
