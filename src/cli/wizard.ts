import { input, select, confirm } from '@inquirer/prompts';
import { GitAdapter } from '../core/git/index.js';
import { StorageRegistry, StoragePaths } from '../core/storage/index.js';
import { Config, RefreshScope, RendererMode } from '../core/types/index.js';
import path from 'node:path';

export interface WizardAnswers {
  repoPath: string;
  branchName: string;
  baseRef: string;
  storagePath: string;
  refreshScope: RefreshScope;
  includeWorkingTree: boolean;
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

    // Load existing config if available
    const defaultStorage = initialStorePath || StoragePaths.getDefaultStorePath();
    const registry = new StorageRegistry(defaultStorage);
    const savedConfig = await registry.loadConfig();

    // 2. Branch
    const branchInfo = await this.git.getCurrentBranch(repoRoot);
    let selectedBranch = branchInfo.branchName;

    if (branchInfo.isDetached) {
      const continueDetached = await confirm({
        message: `Current checkout is detached HEAD (${branchInfo.headCommit.slice(0, 8)}). Continue with commit-based context?`,
        default: true,
      });
      if (!continueDetached) {
        process.exit(0);
      }
    } else {
      selectedBranch = await input({
        message: 'Branch:',
        default: branchInfo.branchName,
      });
    }

    // 3. Base ref
    let resolvedBaseRef = '';
    const preferredBaseCandidate = savedConfig.default_base_ref || 'origin/main';
    while (!resolvedBaseRef) {
      const baseInput = await input({
        message: 'Base branch/ref:',
        default: preferredBaseCandidate,
      });

      try {
        const { baseRef } = await this.git.resolveBaseRef(repoRoot, baseInput);
        resolvedBaseRef = baseRef;
      } catch (err: any) {
        console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
      }
    }

    // 4. Storage path
    const storagePath = await input({
      message: 'Branch Context storage path:',
      default: savedConfig.storage_path || defaultStorage,
    });

    // 5. Refresh scope
    const refreshScope = (await select({
      message: 'Refresh scope:',
      choices: [
        { name: 'current (Render only current branch)', value: 'current' },
        { name: 'stale   (Render all stale branches)', value: 'stale' },
        { name: 'all     (Render all branches)', value: 'all' },
        { name: 'none    (Scan and show status only)', value: 'none' },
      ],
      default: 'current',
    })) as RefreshScope;

    // 6. Include working tree
    const includeWorkingTree = await confirm({
      message: 'Include staged/unstaged/untracked changes?',
      default: savedConfig.include_working_tree ?? true,
    });

    // 7. Renderer mode
    const rendererMode = (await select({
      message: 'Renderer mode:',
      choices: [
        { name: 'deterministic (Fast AST, stats & git metadata)', value: 'deterministic' },
        { name: 'agent-assisted (Collects rich evidence for AI Agent)', value: 'agent-assisted' },
        { name: 'external-model (Calls configured external LLM)', value: 'external-model' },
      ],
      default: savedConfig.default_renderer_mode || 'deterministic',
    })) as RendererMode;

    // 8. Save settings
    const saveSettings = await confirm({
      message: 'Save these settings to config.json?',
      default: true,
    });

    // 9. Start rendering now
    const startNow = await confirm({
      message: 'Start rendering now?',
      default: true,
    });

    return {
      repoPath: repoRoot,
      branchName: selectedBranch,
      baseRef: resolvedBaseRef,
      storagePath,
      refreshScope,
      includeWorkingTree,
      rendererMode,
      saveConfig: saveSettings,
      startNow,
    };
  }
}
