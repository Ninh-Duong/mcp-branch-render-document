import { BranchContextResult } from '../core/orchestrator.js';
import { FreshnessStatus } from '../core/types/index.js';

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
    checkoutBranch: string,
    branches: Array<{
      branch_name: string;
      status: FreshnessStatus;
      detail?: string;
      isCurrent?: boolean;
    }>
  ): void {
    console.log(`\nRepository:      \x1b[36m${repoName}\x1b[0m`);
    console.log(`Checkout branch: \x1b[36m${checkoutBranch}\x1b[0m\n`);

    console.log('Branch documents:');
    console.log('─────────────────────────────────────────────────────────────────');
    if (branches.length === 0) {
      console.log('  (No branch documents registered yet)');
    } else {
      branches.forEach((b, idx) => {
        const marker = b.isCurrent ? ' *' : '  ';
        const namePad = b.branch_name.padEnd(32, ' ');
        const statusFormatted = CLIFormatter.formatStatus(b.status).padEnd(30, ' ');
        const detail = b.detail || '';
        console.log(`${marker} ${idx + 1}. ${namePad} ${statusFormatted} ${detail}`);
      });
    }
    console.log('─────────────────────────────────────────────────────────────────\n');
  }

  public static printRefreshSummary(result: BranchContextResult): void {
    console.log('\n=================================================================');
    console.log(`Target branch:   \x1b[36m${result.target_branch}\x1b[0m`);
    console.log(`Checkout branch: \x1b[33m${result.checkout_branch}\x1b[0m`);
    console.log(`Base branch:     \x1b[33m${result.base_branch}\x1b[0m`);
    console.log(`Comparison:      \x1b[35m${result.comparison}\x1b[0m`);
    console.log(`Target commit:   ${result.target_commit.slice(0, 8)}`);
    console.log(`Base commit:     ${result.base_commit.slice(0, 8)}`);
    console.log(`Strategy:        \x1b[32m${result.strategy}\x1b[0m`);
    console.log('─────────────────────────────────────────────────────────────────');
    console.log('Metrics:');
    console.log(`- Commits:        ${result.rendered_commits_count}`);
    console.log(`- Changed files:  ${result.changed_files_count}`);
    console.log(`- Insertions:     \x1b[32m+${result.insertions}\x1b[0m`);
    console.log(`- Deletions:      \x1b[31m-${result.deletions}\x1b[0m`);
    console.log(`- Worktree dirty: ${result.checkout_worktree_included ? 'included' : 'ignored (clean isolation)'}`);

    if (result.document?.content) {
      console.log('─────────────────────────────────────────────────────────────────');
      console.log('Document Summary:');
      console.log(`  \x1b[36m${result.document.content.summary || 'No summary'}\x1b[0m`);

      const commits = result.document.content.commits || [];
      if (commits.length > 0) {
        console.log('\nCommits:');
        commits.forEach((c) => {
          console.log(`  - \x1b[33m${c.hash.slice(0, 8)}\x1b[0m ${c.subject} (${c.author})`);
        });
      }

      const changes = result.document.content.changes || [];
      if (changes.length > 0) {
        console.log('\nChanged Files:');
        changes.slice(0, 15).forEach((f: any) => {
          const statusIcon = f.status === 'A' ? '\x1b[32m[A]\x1b[0m' : f.status === 'D' ? '\x1b[31m[D]\x1b[0m' : '\x1b[33m[M]\x1b[0m';
          console.log(`  ${statusIcon} ${f.path}`);
        });
        if (changes.length > 15) {
          console.log(`  ... and ${changes.length - 15} more files.`);
        }
      }
    }

    const mdPath = result.document_path.replace(/\.json$/, '.md');
    console.log('─────────────────────────────────────────────────────────────────');
    console.log('Generated Document Files:');
    console.log(`- JSON (AI Agent): \x1b[32m${result.document_path}\x1b[0m`);
    console.log(`- Markdown (Human): \x1b[36m${mdPath}\x1b[0m`);
    console.log('─────────────────────────────────────────────────────────────────');
    console.log('Prompt for AI Agent:');
    console.log('Please read this document file to understand what feature this branch is working on.');
    console.log(`Document file: ${result.document_path}`);
    console.log('=================================================================\n');
  }
}
