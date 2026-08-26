import { BranchContextResult } from '../core/orchestrator.js';
import { Catalog, FreshnessStatus } from '../core/types/index.js';

export class CLIFormatter {
  public static formatStatus(status: FreshnessStatus): string {
    switch (status) {
      case 'FRESH':
        return '\x1b[32mFRESH\x1b[0m';
      case 'STALE_NEW_COMMITS':
        return '\x1b[33mSTALE_NEW_COMMITS\x1b[0m';
      case 'STALE_WORKTREE':
        return '\x1b[33mSTALE_WORKTREE\x1b[0m';
      case 'STALE_BASE_CHANGED':
        return '\x1b[35mSTALE_BASE_CHANGED\x1b[0m';
      case 'REQUIRES_FULL_REBUILD':
        return '\x1b[31mREQUIRES_FULL_REBUILD\x1b[0m';
      case 'UPDATE_FAILED':
        return '\x1b[31mUPDATE_FAILED\x1b[0m';
      default:
        return status;
    }
  }

  public static printBranchList(
    repoName: string,
    currentBranch: string,
    baseRef: string,
    branches: Array<{
      branch_name: string;
      status: FreshnessStatus;
      detail?: string;
      isCurrent?: boolean;
    }>
  ): void {
    console.log(`\nRepository: \x1b[36m${repoName}\x1b[0m`);
    console.log(`Current branch: \x1b[36m${currentBranch}\x1b[0m`);
    console.log(`Base ref: \x1b[36m${baseRef}\x1b[0m\n`);

    console.log('Branch documents:');
    console.log('─────────────────────────────────────────────────────────────────');
    if (branches.length === 0) {
      console.log('  (No branch documents registered yet)');
    } else {
      branches.forEach((b, idx) => {
        const marker = b.isCurrent ? ' *' : '  ';
        const namePad = b.branch_name.padEnd(28, ' ');
        const statusFormatted = CLIFormatter.formatStatus(b.status).padEnd(30, ' ');
        const detail = b.detail || '';
        console.log(`${marker} ${idx + 1}. ${namePad} ${statusFormatted} ${detail}`);
      });
    }
    console.log('─────────────────────────────────────────────────────────────────\n');
  }

  public static printRefreshSummary(result: BranchContextResult): void {
    console.log(`\nRefreshing branch: \x1b[36m${result.branch.branch_name}\x1b[0m`);
    console.log('\nGit changes:');
    console.log(`- New commits: ${result.state.new_commits_count}`);
    console.log(`- Changed files: ${result.state.changed_files_count}`);
    console.log(`- Working tree: ${result.state.current_worktree_fingerprint === 'clean' ? 'clean' : 'dirty'}`);

    console.log('\nDocument path:');
    console.log(`\x1b[32m${result.branch.document_path}\x1b[0m`);

    console.log(`\nStatus: \x1b[32mSUCCESS\x1b[0m`);
    console.log(`Document is now based on HEAD \x1b[33m${result.state.current_head.slice(0, 8)}\x1b[0m\n`);
  }
}
