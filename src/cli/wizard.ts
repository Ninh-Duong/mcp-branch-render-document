import { input, select, confirm } from '@inquirer/prompts';
import { GitAdapter } from '../core/git/index.js';
import { RefreshScope, RendererMode } from '../core/types/index.js';

export interface WizardAnswers {
  repoPath: string;
  targetBranch: string;
  checkoutBranch: string;
  storagePath?: string;
  refreshScope: RefreshScope;
  rendererMode: RendererMode;
  saveConfig: boolean;
  startNow: boolean;
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

    // 2. Detect Checkout Branch
    const checkout = await this.git.getCurrentCheckout(repoRoot);
    if (checkout.isDetached) {
      throw new Error(
        'Current checkout is detached HEAD. Please checkout a base branch (e.g. main, release/...) before running wizard.'
      );
    }

    console.log(`\n\x1b[32m✔\x1b[0m Detected checkout (base) branch: \x1b[36m${checkout.branchName}\x1b[0m\n`);

    // 3. Target Branch
    let targetBranch = '';
    while (!targetBranch) {
      const targetInput = await input({
        message: 'Target branch to analyze:',
        default: checkout.branchName,
      });

      try {
        await this.git.resolveBranchRef(repoRoot, targetInput);
        targetBranch = targetInput.trim();
      } catch (err: any) {
        console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
      }
    }

    // 4. Refresh scope
    const refreshScope = (await select({
      message: 'Refresh scope:',
      choices: [
        { name: 'current (Render target branch)', value: 'current' },
        { name: 'stale   (Render all stale branches in catalog)', value: 'stale' },
        { name: 'all     (Render all branches in catalog)', value: 'all' },
        { name: 'none    (Scan and show status only)', value: 'none' },
      ],
      default: 'current',
    })) as RefreshScope;

    // 5. Ask for advanced options only if needed
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
          { name: 'repo-local (Default: .branch-render-context/ in repo root)', value: 'repo-local' },
          { name: 'global     (OS AppData / User config dir)', value: 'global' },
          { name: 'custom     (Specify custom directory path)', value: 'custom' },
        ],
        default: 'repo-local',
      });

      if (storageModeChoice === 'custom') {
        storagePath = await input({
          message: 'Custom storage path:',
        });
      } else if (storageModeChoice === 'global') {
        storagePath = undefined;
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

    // 6. Save settings
    const saveSettings = await confirm({
      message: 'Save these settings to config.json?',
      default: true,
    });

    // 7. Start rendering now
    const startNow = await confirm({
      message: 'Start rendering now?',
      default: true,
    });

    return {
      repoPath: repoRoot,
      targetBranch,
      checkoutBranch: checkout.branchName,
      storagePath,
      refreshScope,
      rendererMode,
      saveConfig: saveSettings,
      startNow,
    };
  }
}
