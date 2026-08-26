import { input, select, confirm, checkbox } from '@inquirer/prompts';
import path from 'node:path';
import { GitAdapter } from '../core/git/index.js';
import { RefreshScope, RendererMode } from '../core/types/index.js';
import { StoragePaths, StorageRegistry } from '../core/storage/index.js';
import { generateRepositoryId } from '../utils/hash.js';

export type WizardAction = 'render' | 'clear';

export interface WizardAnswers {
  action: WizardAction;
  repoPath: string;
  targetBranch: string;
  baseBranch: string;
  checkoutBranch: string;
  storagePath?: string;
  refreshScope: RefreshScope;
  rendererMode: RendererMode;
  saveConfig: boolean;
  startNow: boolean;
  clearTarget?: 'all' | 'selected' | 'storage';
  branchesToClear?: string[];
}

export class TerminalWizard {
  private readonly git = new GitAdapter();

  public async run(initialStorePath?: string): Promise<WizardAnswers> {
    console.log('\n========================================');
    console.log('   Branch Render Context MCP - Wizard   ');
    console.log('========================================\n');

    // 1. Repository Path
    let repoRoot = '';
    while (!repoRoot) {
      const repoInput = await input({
        message: 'Repository path:',
        default: '.',
      });

      try {
        repoRoot = await this.git.getRepositoryRoot(repoInput);
      } catch (err: any) {
        console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
      }
    }

    // 2. Automatically detect Checkout Branch
    const checkout = await this.git.getCurrentCheckout(repoRoot);
    if (checkout.isDetached) {
      throw new Error(
        'Current checkout is detached HEAD. Please checkout a branch before running wizard.'
      );
    }

    const currentBranch = checkout.branchName;
    console.log(`\n\x1b[32m✔\x1b[0m Current branch: \x1b[36m${currentBranch}\x1b[0m\n`);

    // 3. Load config and check existing catalog
    const storePath = StoragePaths.resolveStorePath({ repoRoot, customPath: initialStorePath });
    const registry = new StorageRegistry(storePath);
    const savedConfig = await registry.loadConfig();
    const catalog = await registry.loadCatalog();

    const remoteUrls = await this.git.getRemoteUrls(repoRoot);
    const repoId = generateRepositoryId(repoRoot, remoteUrls);
    const repoEntry = catalog.repositories.find((r) => r.repository_id === repoId);
    const hasExistingBranches = Boolean(repoEntry && repoEntry.branches.length > 0);
    const totalRepos = catalog.repositories.length;

    // 4. Action Selection (Render vs Clear)
    const action = (await select({
      message: 'Select action to perform:',
      choices: [
        { name: '1. Render / Refresh branch context (Render/cập nhật context)', value: 'render' },
        {
          name: `2. Clear document context (Xóa context) ${hasExistingBranches ? `[${repoEntry!.branches.length} branch(es)]` : '[0 branches]'}`,
          value: 'clear',
        },
      ],
      default: 'render',
    })) as WizardAction;

    // --- IF ACTION IS CLEAR ---
    if (action === 'clear') {
      const clearChoices = [];
      if (hasExistingBranches) {
        clearChoices.push(
          { name: `1. Select specific branch(es) to clear (Chọn từng branch) [${repoEntry!.branches.length} available]`, value: 'selected' },
          { name: `2. Clear ALL branches in this repository (${repoEntry!.branches.length} branches)`, value: 'all' }
        );
      }
      clearChoices.push(
        { name: `3. Clear ENTIRE storage (${totalRepos} repositories, catalog, config, indexes)`, value: 'storage' },
        { name: '4. Cancel', value: 'cancel' }
      );

      const clearMode = await select({
        message: 'How would you like to clear document(s)?',
        choices: clearChoices,
        default: hasExistingBranches ? 'selected' : 'storage',
      });

      if (clearMode === 'cancel') {
        return {
          action: 'clear',
          repoPath: repoRoot,
          targetBranch: currentBranch,
          baseBranch: '',
          checkoutBranch: currentBranch,
          storagePath: initialStorePath,
          refreshScope: 'none',
          rendererMode: 'deterministic',
          saveConfig: false,
          startNow: false,
          clearTarget: 'selected',
          branchesToClear: [],
        };
      }

      if (clearMode === 'storage') {
        const confirmed = await confirm({
          message: `Are you ABSOLUTELY sure you want to delete the ENTIRE storage (${totalRepos} repository/repositories)?`,
          default: false,
        });

        return {
          action: 'clear',
          repoPath: repoRoot,
          targetBranch: currentBranch,
          baseBranch: '',
          checkoutBranch: currentBranch,
          storagePath: initialStorePath,
          refreshScope: 'none',
          rendererMode: 'deterministic',
          saveConfig: false,
          startNow: confirmed,
          clearTarget: 'storage',
          branchesToClear: [],
        };
      }

      if (clearMode === 'all') {
        const confirmed = await confirm({
          message: `Are you sure you want to delete ALL (${repoEntry!.branches.length}) branch document(s) for "${repoEntry!.name}"?`,
          default: false,
        });

        return {
          action: 'clear',
          repoPath: repoRoot,
          targetBranch: currentBranch,
          baseBranch: '',
          checkoutBranch: currentBranch,
          storagePath: initialStorePath,
          refreshScope: 'none',
          rendererMode: 'deterministic',
          saveConfig: false,
          startNow: confirmed,
          clearTarget: 'all',
          branchesToClear: [],
        };
      } else {
        const branchChoices = repoEntry!.branches.map((b) => ({
          name: `${b.branch_name} (${b.status})`,
          value: b.branch_name,
        }));

        const selected = await checkbox({
          message: 'Select branch document(s) to clear:',
          choices: branchChoices,
        });

        return {
          action: 'clear',
          repoPath: repoRoot,
          targetBranch: currentBranch,
          baseBranch: '',
          checkoutBranch: currentBranch,
          storagePath: initialStorePath,
          refreshScope: 'none',
          rendererMode: 'deterministic',
          saveConfig: false,
          startNow: selected.length > 0,
          clearTarget: 'selected',
          branchesToClear: selected,
        };
      }
    }

    // --- IF ACTION IS RENDER / REFRESH ---
    let detectedBase = savedConfig.default_base_ref;
    if (!detectedBase) {
      detectedBase = (await this.git.detectMatchingBaseBranch(repoRoot, currentBranch)) || undefined;
    }

    // Prompt for Base Branch with smart default
    let baseBranch = '';
    while (!baseBranch) {
      const baseInput = await input({
        message: 'Base branch to compare against:',
        default: detectedBase || 'main',
      });

      try {
        await this.git.resolveBranchRef(repoRoot, baseInput.trim());
        baseBranch = baseInput.trim();
      } catch (err: any) {
        console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
      }
    }

    // 5. Refresh scope
    const refreshScope = (await select({
      message: 'Refresh scope:',
      choices: [
        { name: 'current (Render current branch vs base)', value: 'current' },
        { name: 'stale   (Render all stale branches in catalog)', value: 'stale' },
        { name: 'all     (Render all branches in catalog)', value: 'all' },
        { name: 'none    (Scan and show status only)', value: 'none' },
      ],
      default: 'current',
    })) as RefreshScope;

    // 6. Ask for advanced options only if requested
    const showAdvanced = await confirm({
      message: 'Configure advanced options (storage mode, renderer)?',
      default: false,
    });

    let storagePath = initialStorePath;
    let rendererMode: RendererMode = 'deterministic';

    if (showAdvanced) {
      const storageModeChoice = await select({
        message: 'Storage mode:',
        choices: [
          { name: 'renderer-local (Default: storage/ inside renderer repo)', value: 'renderer-local' },
          { name: 'global         (OS AppData / User config dir)', value: 'global' },
          { name: 'custom         (Specify custom directory path)', value: 'custom' },
          { name: 'repo-local     (.branch-render-context/ in target repo root)', value: 'repo-local' },
        ],
        default: 'renderer-local',
      });

      if (storageModeChoice === 'custom') {
        storagePath = await input({
          message: 'Custom storage path:',
        });
      } else if (storageModeChoice === 'global') {
        storagePath = StoragePaths.getGlobalStorePath();
      } else if (storageModeChoice === 'renderer-local') {
        storagePath = StoragePaths.getRendererStorePath();
      } else if (storageModeChoice === 'repo-local') {
        storagePath = undefined; // will resolve to repoRoot/.branch-render-context
      }

      rendererMode = (await select({
        message: 'Renderer mode:',
        choices: [
          { name: 'deterministic (Fast AST, diff stats & git metadata)', value: 'deterministic' },
          { name: 'agent-assisted (Collects rich evidence for AI Agent)', value: 'agent-assisted' },
        ],
        default: 'deterministic',
      })) as RendererMode;
    }

    // 7. Save settings
    const saveSettings = await confirm({
      message: 'Save these settings to config.json?',
      default: true,
    });

    // 8. Start rendering now
    const startNow = await confirm({
      message: 'Start rendering now?',
      default: true,
    });

    return {
      action: 'render',
      repoPath: repoRoot,
      targetBranch: currentBranch,
      baseBranch,
      checkoutBranch: currentBranch,
      storagePath,
      refreshScope,
      rendererMode,
      saveConfig: saveSettings,
      startNow,
    };
  }
}
