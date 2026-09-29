#!/usr/bin/env node
import { Command } from 'commander';
import { TerminalWizard } from './wizard.js';
import { BranchContextOrchestrator } from '../core/orchestrator.js';
import { CLIFormatter } from './formatter.js';
import { RefreshScope, RendererMode } from '../core/types/index.js';

const program = new Command();

program
  .name('branch-render')
  .description('Automatic PR Branch Document Renderer - Context caching & incremental git updates for AI agents')
  .version('1.1.0');

// --- START COMMAND ---
program
  .command('start')
  .description('Start interactive wizard or non-interactive PR branch rendering')
  .option('-n, --non-interactive', 'Run without interactive prompts')
  .option('-r, --repo <path>', 'Repository path', '.')
  .option('-b, --branch <name>', 'Target branch name')
  .option('--base <ref>', 'Base branch/ref')
  .option('-s, --storage <path>', 'Storage path (default: repo-local ai-context)')
  .option('--refresh <scope>', 'Refresh scope (current, stale, all, none)', 'current')
  .option('-f, --force', 'Force refresh even if already fresh', false)
  .action(async (options) => {
    try {
      let repoPath = options.repo;
      let targetBranch = options.branch;
      let baseRef = options.base;
      let storagePath = options.storage;
      let refreshScope: RefreshScope = options.refresh as RefreshScope;
      let rendererMode: RendererMode = 'deterministic';
      let startNow = true;

      if (!options.nonInteractive) {
        const wizard = new TerminalWizard();
        const answers = await wizard.run(storagePath);
        repoPath = answers.repoPath;
        targetBranch = answers.targetBranch;
        baseRef = answers.baseBranch;
        storagePath = answers.storagePath;
        refreshScope = answers.refreshScope;
        rendererMode = answers.rendererMode;
        startNow = answers.startNow;

        if (answers.action === 'clear') {
          if (!answers.startNow) {
            console.log('Cancelled.');
            process.exit(0);
          }

          const orchestrator = new BranchContextOrchestrator(storagePath);
          if (answers.clearTarget === 'storage') {
            const res = await orchestrator.clearStorage({ storagePath });
            console.log(`\n\x1b[32m✔ Cleared entire storage:\x1b[0m`);
            console.log(`  - Repositories removed: ${res.clearedRepositoryCount}`);
            console.log(`  - Branch documents removed: ${res.clearedBranchCount}`);
            if (res.removedEntries.length > 0) {
              console.log(`  - Removed entries: ${res.removedEntries.join(', ')}`);
            }
            if (res.failedEntries.length > 0) {
              console.log(`\x1b[33m  - Failed entries: ${res.failedEntries.join(', ')}\x1b[0m`);
            }
            console.log();
          } else if (answers.clearTarget === 'all') {
            const res = await orchestrator.clearContext({
              repoPath,
              all: true,
              storagePath,
            });
            console.log(`\n\x1b[32m✔ Cleared all ${res.clearedCount} branch document(s).\x1b[0m\n`);
          } else {
            let total = 0;
            for (const branch of answers.branchesToClear || []) {
              const res = await orchestrator.clearContext({
                repoPath,
                branchName: branch,
                storagePath,
              });
              total += res.clearedCount;
            }
            console.log(`\n\x1b[32m✔ Successfully cleared ${total} selected branch document(s).\x1b[0m\n`);
          }
          process.exit(0);
        }

        if (answers.saveConfig) {
          const orchestrator = new BranchContextOrchestrator(storagePath);
          const { registry } = await orchestrator.discoverRepository(repoPath, storagePath);
          const config = await registry.loadConfig();
          if (storagePath) config.storage_path = storagePath;
          if (baseRef) config.default_base_ref = baseRef;
          config.default_refresh_scope = refreshScope;
          config.default_renderer_mode = rendererMode;
          await registry.saveConfig(config);
          console.log('\x1b[32m✔ Configuration saved.\x1b[0m');
        }
      }

      if (!startNow) {
        console.log('Exiting without rendering.');
        process.exit(0);
      }

      const orchestrator = new BranchContextOrchestrator(storagePath);
      const { repo, registry } = await orchestrator.discoverRepository(repoPath, storagePath);

      // 1. Scan catalog and branches
      const catalog = await registry.loadCatalog();
      const repoEntry = catalog.repositories.find((r) => r.repository_id === repo.repository_id);

      const currentStatus = await orchestrator.getStatus({
        repoPath,
        branchName: targetBranch,
        baseRef,
        storagePath,
      });

      const branchListToDisplay: Array<{
        branch_name: string;
        status: any;
        detail?: string;
        isCurrent?: boolean;
      }> = [];

      branchListToDisplay.push({
        branch_name: currentStatus.target_branch,
        status: currentStatus.evaluation.status,
        detail:
          currentStatus.evaluation.status === 'STALE_NEW_COMMITS'
            ? `${currentStatus.evaluation.newCommitsCount} commits`
            : currentStatus.evaluation.status === 'STALE_WORKTREE'
              ? `${currentStatus.evaluation.changedFilesCount} files`
              : '',
        isCurrent: true,
      });

      if (repoEntry) {
        for (const b of repoEntry.branches) {
          if (b.branch_name !== currentStatus.target_branch) {
            branchListToDisplay.push({
              branch_name: b.branch_name,
              status: b.status,
              detail: b.new_commits_count > 0 ? `${b.new_commits_count} commits` : '',
              isCurrent: false,
            });
          }
        }
      }

      CLIFormatter.printBranchList(
        repo.name,
        currentStatus.checkout_branch,
        branchListToDisplay
      );

      // 2. Refresh according to refresh scope
      if (refreshScope !== 'none') {
        const results = await orchestrator.executeRefreshScope(
          repoPath,
          refreshScope,
          targetBranch,
          options.force,
          storagePath,
          baseRef
        );
        for (const res of results) {
          if (res.rendered || res.strategy === 'cached') {
            CLIFormatter.printRefreshSummary(res);
          }
        }
      }
    } catch (err: any) {
      console.error(`\x1b[31mFatal Error: ${err.message}\x1b[0m`);
      process.exit(1);
    }
  });

// --- LIST COMMAND ---
program
  .command('list')
  .description('List all repositories and branch documents')
  .option('-r, --repo <path>', 'Repository path', '.')
  .option('-s, --storage <path>', 'Storage path')
  .action(async (options) => {
    try {
      const orchestrator = new BranchContextOrchestrator(options.storage);
      const { storePath, registry } = await orchestrator.discoverRepository(options.repo, options.storage);
      const catalog = await registry.loadCatalog();

      console.log('\n========================================');
      console.log('   Branch Render Context - Catalog      ');
      console.log('========================================');
      console.log(`Store path: \x1b[36m${storePath}\x1b[0m\n`);

      if (catalog.repositories.length === 0) {
        console.log('No repositories registered yet in this storage.');
      } else {
        for (const r of catalog.repositories) {
          console.log(`Repository: \x1b[36m${r.name}\x1b[0m (${r.path})`);
          console.log('─────────────────────────────────────────────────────────────────');
          for (const b of r.branches) {
            const statusFormatted = CLIFormatter.formatStatus(b.status).padEnd(25, ' ');
            console.log(`  - ${b.branch_name.padEnd(30, ' ')} ${statusFormatted} HEAD: ${b.last_rendered_head.slice(0, 8)}`);
          }
        }
      }
      console.log('\n');
    } catch (err: any) {
      console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
      process.exit(1);
    }
  });

// --- STATUS COMMAND ---
program
  .command('status')
  .description('Check freshness of target branch vs base branch')
  .option('-r, --repo <path>', 'Repository path', '.')
  .option('-b, --branch <name>', 'Target branch name (default: current checkout branch)')
  .option('--base <ref>', 'Base branch/ref')
  .option('-s, --storage <path>', 'Storage path')
  .action(async (options) => {
    try {
      const orchestrator = new BranchContextOrchestrator(options.storage);
      const status = await orchestrator.getStatus({
        repoPath: options.repo,
        branchName: options.branch,
        baseRef: options.base,
        storagePath: options.storage,
      });

      console.log(`\nRepository:      \x1b[36m${status.repository.name}\x1b[0m`);
      console.log(`Target branch:   \x1b[36m${status.target_branch}\x1b[0m`);
      console.log(`Checkout branch: \x1b[33m${status.checkout_branch}\x1b[0m`);
      console.log(`Base branch:     \x1b[33m${status.base_branch}\x1b[0m`);
      console.log(`Comparison:      \x1b[35m${status.comparison}\x1b[0m`);
      console.log(`Status:          ${CLIFormatter.formatStatus(status.evaluation.status)}`);
      console.log(`Target Commit:   ${status.target_commit.slice(0, 8)}`);
      console.log(`Base Commit:     ${status.base_commit.slice(0, 8)}`);
      console.log(`New Commits:     ${status.evaluation.newCommitsCount}`);
      console.log(`Changed Files:   ${status.evaluation.changedFilesCount}\n`);
    } catch (err: any) {
      console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
      process.exit(1);
    }
  });

// --- REFRESH COMMAND ---
program
  .command('refresh')
  .description('Refresh target branch document vs base branch')
  .option('-r, --repo <path>', 'Repository path', '.')
  .option('-b, --branch <name>', 'Target branch name (default: current checkout branch)')
  .option('--base <ref>', 'Base branch/ref')
  .option('-s, --storage <path>', 'Storage path')
  .option('-f, --force', 'Force refresh even if fresh', false)
  .action(async (options) => {
    try {
      const orchestrator = new BranchContextOrchestrator(options.storage);
      const result = await orchestrator.refreshBranch({
        repoPath: options.repo,
        branchName: options.branch,
        baseRef: options.base,
        force: options.force,
        storagePath: options.storage,
      });

      CLIFormatter.printRefreshSummary(result);
    } catch (err: any) {
      console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
      process.exit(1);
    }
  });

// --- CLEAR COMMAND ---
program
  .command('clear')
  .description('Clear and remove branch documents (single branch, all in repo, or entire storage)')
  .option('-r, --repo <path>', 'Repository path', '.')
  .option('-b, --branch <name>', 'Target branch name to clear')
  .option('-a, --all', 'Clear all branch documents in repository')
  .option('-A, --all-storage', 'Clear entire storage (all repositories, documents, config, indexes)')
  .option('-y, --yes', 'Confirm destructive action without interactive prompt')
  .option('-s, --storage <path>', 'Storage path')
  .action(async (options) => {
    try {
      const scopeCount = (options.branch ? 1 : 0) + (options.all ? 1 : 0) + (options.allStorage ? 1 : 0);
      if (scopeCount > 1) {
        throw new Error('Flags --branch, --all, and --all-storage are mutually exclusive. Please specify only one.');
      }

      const orchestrator = new BranchContextOrchestrator(options.storage);

      // 1. Handle --all-storage (Storage-wide, independent of current repo)
      if (options.allStorage) {
        if (!options.yes) {
          if (!process.stdin.isTTY) {
            throw new Error('--all-storage is a destructive action. Use --yes (-y) to confirm in non-interactive environments.');
          }

          const { confirm } = await import('@inquirer/prompts');
          const confirmed = await confirm({
            message: 'Are you ABSOLUTELY sure you want to clear the ENTIRE storage (all repositories, branches, catalog, config, indexes)?',
            default: false,
          });
          if (!confirmed) {
            console.log('Cancelled.');
            return;
          }
        }

        const res = await orchestrator.clearStorage({ storagePath: options.storage });
        console.log(`\n\x1b[32m✔ Cleared entire storage:\x1b[0m`);
        console.log(`  - Repositories removed: ${res.clearedRepositoryCount}`);
        console.log(`  - Branch documents removed: ${res.clearedBranchCount}`);
        if (res.removedEntries.length > 0) {
          console.log(`  - Removed entries: ${res.removedEntries.join(', ')}`);
        }
        if (res.failedEntries.length > 0) {
          console.log(`\x1b[33m  - Failed entries: ${res.failedEntries.join(', ')}\x1b[0m`);
        }
        console.log();
        return;
      }

      const { repo, registry } = await orchestrator.discoverRepository(options.repo, options.storage);
      const catalog = await registry.loadCatalog();
      const repoEntry = catalog.repositories.find((r) => r.repository_id === repo.repository_id);
      const branchCount = repoEntry?.branches?.length || 0;

      if (options.all) {
        if (branchCount === 0) {
          console.log(`\n\x1b[33mNo registered branch documents found for repository "${repo.name}".\x1b[0m\n`);
          return;
        }
        const res = await orchestrator.clearContext({
          repoPath: options.repo,
          all: true,
          storagePath: options.storage,
        });
        console.log(`\n\x1b[32m✔ Cleared all ${res.clearedCount} branch document(s) for repository "${repo.name}".\x1b[0m\n`);
        return;
      }

      if (options.branch) {
        const res = await orchestrator.clearContext({
          repoPath: options.repo,
          branchName: options.branch,
          storagePath: options.storage,
        });
        if (res.clearedCount > 0) {
          console.log(`\n\x1b[32m✔ Cleared branch document for "${options.branch}".\x1b[0m\n`);
        } else {
          console.log(`\n\x1b[33mNo document found for branch "${options.branch}".\x1b[0m\n`);
        }
        return;
      }

      // Interactive mode when neither --all, --all-storage nor --branch is passed
      const { select, checkbox, confirm } = await import('@inquirer/prompts');
      const actionChoice = await select({
        message: 'Choose clear action:',
        choices: [
          { name: `1. Select specific branch(es) to clear ${branchCount > 0 ? `(${branchCount} available)` : '(0 available)'}`, value: 'select', disabled: branchCount === 0 },
          { name: `2. Clear ALL branches in this repository (${repo.name})`, value: 'all', disabled: branchCount === 0 },
          { name: `3. Clear ENTIRE storage (all ${catalog.repositories.length} repositories, catalog, config, indexes)`, value: 'all-storage' },
          { name: '4. Cancel', value: 'cancel' },
        ],
      });

      if (actionChoice === 'cancel') {
        console.log('Cancelled.');
        return;
      }

      if (actionChoice === 'all-storage') {
        const confirmed = await confirm({
          message: `Are you ABSOLUTELY sure you want to delete the ENTIRE storage (${catalog.repositories.length} repository/repositories)?`,
          default: false,
        });
        if (confirmed) {
          const res = await orchestrator.clearStorage({ storagePath: options.storage });
          console.log(`\n\x1b[32m✔ Cleared entire storage:\x1b[0m`);
          console.log(`  - Repositories removed: ${res.clearedRepositoryCount}`);
          console.log(`  - Branch documents removed: ${res.clearedBranchCount}`);
          console.log();
        } else {
          console.log('Cancelled.');
        }
        return;
      }

      if (actionChoice === 'all') {
        const confirmed = await confirm({
          message: `Are you sure you want to delete ALL (${repoEntry!.branches.length}) branch document(s) for "${repo.name}"?`,
          default: false,
        });
        if (confirmed) {
          const res = await orchestrator.clearContext({
            repoPath: options.repo,
            all: true,
            storagePath: options.storage,
          });
          console.log(`\n\x1b[32m✔ Cleared ${res.clearedCount} branch document(s).\x1b[0m\n`);
        } else {
          console.log('Cancelled.');
        }
        return;
      }

      if (actionChoice === 'select') {
        const branchChoices = repoEntry!.branches.map((b) => ({
          name: `${b.branch_name} (${b.status})`,
          value: b.branch_name,
        }));

        const selectedBranches = await checkbox({
          message: 'Select branch document(s) to clear:',
          choices: branchChoices,
        });

        if (selectedBranches.length === 0) {
          console.log('No branches selected.');
          return;
        }

        let totalCleared = 0;
        for (const branch of selectedBranches) {
          const res = await orchestrator.clearContext({
            repoPath: options.repo,
            branchName: branch,
            storagePath: options.storage,
          });
          totalCleared += res.clearedCount;
        }

        console.log(`\n\x1b[32m✔ Successfully cleared ${totalCleared} selected branch document(s).\x1b[0m\n`);
      }
    } catch (err: any) {
      console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
      process.exit(1);
    }
  });

program.parse(process.argv);

