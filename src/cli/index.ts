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
  .option('-s, --storage <path>', 'Storage path (default: repo-local .branch-render-context)')
  .option('--refresh <scope>', 'Refresh scope (current, stale, all, none)', 'current')
  .option('-f, --force', 'Force refresh even if already fresh', false)
  .action(async (options) => {
    try {
      let repoPath = options.repo;
      let targetBranch = options.branch;
      let storagePath = options.storage;
      let refreshScope: RefreshScope = options.refresh as RefreshScope;
      let rendererMode: RendererMode = 'deterministic';
      let startNow = true;

      if (!options.nonInteractive) {
        const wizard = new TerminalWizard();
        const answers = await wizard.run(storagePath);
        repoPath = answers.repoPath;
        targetBranch = answers.targetBranch;
        storagePath = answers.storagePath;
        refreshScope = answers.refreshScope;
        rendererMode = answers.rendererMode;
        startNow = answers.startNow;

        if (answers.saveConfig) {
          const orchestrator = new BranchContextOrchestrator(storagePath);
          const { registry } = await orchestrator.discoverRepository(repoPath, storagePath);
          const config = await registry.loadConfig();
          if (storagePath) config.storage_path = storagePath;
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
          storagePath
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
      const { repo, storePath, registry } = await orchestrator.discoverRepository(options.repo, options.storage);
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
  .description('Check freshness of target branch vs checkout base branch')
  .option('-r, --repo <path>', 'Repository path', '.')
  .option('-b, --branch <name>', 'Target branch name (default: current checkout branch)')
  .option('-s, --storage <path>', 'Storage path')
  .action(async (options) => {
    try {
      const orchestrator = new BranchContextOrchestrator(options.storage);
      const status = await orchestrator.getStatus({
        repoPath: options.repo,
        branchName: options.branch,
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
  .description('Refresh target branch document vs checkout base branch')
  .option('-r, --repo <path>', 'Repository path', '.')
  .option('-b, --branch <name>', 'Target branch name (default: current checkout branch)')
  .option('-s, --storage <path>', 'Storage path')
  .option('-f, --force', 'Force refresh even if fresh', false)
  .action(async (options) => {
    try {
      const orchestrator = new BranchContextOrchestrator(options.storage);
      const result = await orchestrator.refreshBranch({
        repoPath: options.repo,
        branchName: options.branch,
        force: options.force,
        storagePath: options.storage,
      });

      CLIFormatter.printRefreshSummary(result);
    } catch (err: any) {
      console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
      process.exit(1);
    }
  });

program.parse(process.argv);
