#!/usr/bin/env node
import { Command } from 'commander';
import { TerminalWizard } from './wizard.js';
import { BranchContextOrchestrator } from '../core/orchestrator.js';
import { CLIFormatter } from './formatter.js';
import { RefreshScope, RendererMode } from '../core/types/index.js';
import { StoragePaths } from '../core/storage/index.js';

const program = new Command();

program
  .name('branch-render')
  .description('Branch Render Context - Efficient context caching and incremental updates for AI Agents')
  .version('1.0.0');

// --- START COMMAND ---
program
  .command('start')
  .description('Start interactive wizard or non-interactive rendering')
  .option('-n, --non-interactive', 'Run without interactive prompts')
  .option('-r, --repo <path>', 'Repository path', '.')
  .option('-b, --branch <name>', 'Branch name')
  .option('--base <ref>', 'Base ref/branch')
  .option('-s, --storage <path>', 'Storage path')
  .option('--refresh <scope>', 'Refresh scope (current, stale, all, none)', 'current')
  .option('--working-tree <boolean>', 'Include working tree changes', true)
  .option('--mode <mode>', 'Renderer mode (deterministic, agent-assisted, external-model)', 'deterministic')
  .action(async (options) => {
    try {
      let repoPath = options.repo;
      let branchName = options.branch;
      let baseRef = options.base;
      let storagePath = options.storage;
      let refreshScope: RefreshScope = options.refresh as RefreshScope;
      let rendererMode: RendererMode = options.mode as RendererMode;
      let includeWorkingTree = options.workingTree !== false && options.workingTree !== 'false';
      let startNow = true;

      if (!options.nonInteractive) {
        const wizard = new TerminalWizard();
        const answers = await wizard.run(storagePath);
        repoPath = answers.repoPath;
        branchName = answers.branchName;
        baseRef = answers.baseRef;
        storagePath = answers.storagePath;
        refreshScope = answers.refreshScope;
        includeWorkingTree = answers.includeWorkingTree;
        rendererMode = answers.rendererMode;
        startNow = answers.startNow;

        if (answers.saveConfig) {
          const orchestrator = new BranchContextOrchestrator(storagePath);
          const config = await orchestrator.getRegistry().loadConfig();
          config.storage_path = storagePath;
          config.default_base_ref = baseRef;
          config.default_refresh_scope = refreshScope;
          config.include_working_tree = includeWorkingTree;
          config.default_renderer_mode = rendererMode;
          await orchestrator.getRegistry().saveConfig(config);
          console.log('\x1b[32m✔ Configuration saved.\x1b[0m');
        }
      }

      if (!startNow) {
        console.log('Exiting without rendering.');
        process.exit(0);
      }

      const orchestrator = new BranchContextOrchestrator(storagePath);
      const repo = await orchestrator.discoverRepository(repoPath);

      // 1. Scan catalog and branches
      const catalog = await orchestrator.getRegistry().loadCatalog();
      const repoEntry = catalog.repositories.find((r) => r.repository_id === repo.repository_id);

      const branchListToDisplay: Array<{
        branch_name: string;
        status: any;
        detail?: string;
        isCurrent?: boolean;
      }> = [];

      const currentStatus = await orchestrator.getStatus({
        repoPath,
        branchName,
        baseRef,
      });

      branchListToDisplay.push({
        branch_name: currentStatus.branch.branch_name,
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
          if (b.branch_name !== currentStatus.branch.branch_name) {
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
        currentStatus.branch.branch_name,
        currentStatus.branch.base_ref,
        branchListToDisplay
      );

      // 2. Refresh according to refresh scope
      if (refreshScope !== 'none') {
        const results = await orchestrator.executeRefreshScope(repoPath, refreshScope, baseRef);
        for (const res of results) {
          if (res.refreshed) {
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
  .option('-s, --storage <path>', 'Storage path')
  .action(async (options) => {
    try {
      const storagePath = options.storage || StoragePaths.getDefaultStorePath();
      const orchestrator = new BranchContextOrchestrator(storagePath);
      const catalog = await orchestrator.getRegistry().loadCatalog();

      console.log('\n========================================');
      console.log('   Branch Render Context - Catalog      ');
      console.log('========================================');

      if (catalog.repositories.length === 0) {
        console.log('\nNo repositories registered yet.');
      } else {
        for (const repo of catalog.repositories) {
          console.log(`\nRepository: \x1b[36m${repo.name}\x1b[0m (${repo.path})`);
          console.log('─────────────────────────────────────────────────────────────────');
          for (const b of repo.branches) {
            const statusFormatted = CLIFormatter.formatStatus(b.status).padEnd(25, ' ');
            console.log(`  - ${b.branch_name.padEnd(25, ' ')} ${statusFormatted} HEAD: ${b.last_rendered_head.slice(0, 8)}`);
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
  .description('Check freshness of current branch')
  .option('-r, --repo <path>', 'Repository path', '.')
  .option('-b, --branch <name>', 'Branch name')
  .option('-s, --storage <path>', 'Storage path')
  .action(async (options) => {
    try {
      const orchestrator = new BranchContextOrchestrator(options.storage);
      const status = await orchestrator.getStatus({
        repoPath: options.repo,
        branchName: options.branch,
      });

      console.log(`\nRepository: \x1b[36m${status.repository.name}\x1b[0m`);
      console.log(`Branch: \x1b[36m${status.branch.branch_name}\x1b[0m`);
      console.log(`Base Ref: \x1b[36m${status.branch.base_ref}\x1b[0m`);
      console.log(`Status: ${CLIFormatter.formatStatus(status.evaluation.status)}`);
      console.log(`HEAD: ${status.evaluation.currentHead.slice(0, 8)}`);
      console.log(`Working Tree: ${status.evaluation.workingTreeStatus.isClean ? 'clean' : 'dirty'}`);
      console.log(`New Commits: ${status.evaluation.newCommitsCount}`);
      console.log(`Changed Files: ${status.evaluation.changedFilesCount}\n`);
    } catch (err: any) {
      console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
      process.exit(1);
    }
  });

// --- REFRESH COMMAND ---
program
  .command('refresh')
  .description('Force refresh branch document')
  .option('-r, --repo <path>', 'Repository path', '.')
  .option('-b, --branch <name>', 'Branch name')
  .option('--base <ref>', 'Base ref')
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
      });

      CLIFormatter.printRefreshSummary(result);
    } catch (err: any) {
      console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
      process.exit(1);
    }
  });

program.parse(process.argv);
