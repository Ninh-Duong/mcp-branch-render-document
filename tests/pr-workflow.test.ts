import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BranchContextOrchestrator } from '../src/core/orchestrator.js';
import { GitAdapter } from '../src/core/git/index.js';
import { GitTestHelper } from './fixtures/git-helper.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('PR Workflow & Target vs Checkout Branch Resolution', () => {
  let fixture: Awaited<ReturnType<typeof GitTestHelper.createTempGitRepo>>;
  let orchestrator: BranchContextOrchestrator;
  let git: GitAdapter;
  let tempStore: string;

  beforeEach(async () => {
    fixture = await GitTestHelper.createTempGitRepo();
    tempStore = (await fs.mkdtemp(path.join(os.tmpdir(), 'store-pr-test-'))).replace(/\\/g, '/');
    git = new GitAdapter();
    orchestrator = new BranchContextOrchestrator(tempStore);
  });

  afterEach(async () => {
    await fixture.cleanup();
    try {
      await fs.rm(tempStore, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('should automatically detect matching base branch release/eagers from target branch name hotfix/Eagers-BE/WCE-946-eagers', async () => {
    // 1. Create base branch release/eagers
    await fixture.run(['branch', '-M', 'release/eagers']);

    // 2. Create feature branch hotfix/Eagers-BE/WCE-946-eagers with 2 commits
    await fixture.run(['checkout', '-b', 'hotfix/Eagers-BE/WCE-946-eagers']);
    await fs.writeFile(path.join(fixture.repoPath, 'file1.ts'), 'export const a = 1;\nexport const b = 2;\n');
    await fixture.run(['add', 'file1.ts']);
    await fixture.run(['commit', '-m', 'feat: add file1']);

    await fs.writeFile(path.join(fixture.repoPath, 'file2.ts'), 'export const c = 3;\n');
    await fixture.run(['add', 'file2.ts']);
    await fixture.run(['commit', '-m', 'feat: add file2']);

    // 3. Keep checkout on hotfix/Eagers-BE/WCE-946-eagers (NO default_base_ref in config)
    const result = await orchestrator.refreshBranch({
      repoPath: fixture.repoPath,
      branchName: 'hotfix/Eagers-BE/WCE-946-eagers',
    });

    // 4. Verify base branch was auto-detected as release/eagers
    expect(result.target_branch).toBe('hotfix/Eagers-BE/WCE-946-eagers');
    expect(result.base_branch).toBe('release/eagers');
    expect(result.comparison).toBe('release/eagers..hotfix/Eagers-BE/WCE-946-eagers');
    expect(result.rendered_commits_count).toBe(2);
    expect(result.changed_files_count).toBe(2);

    // 5. Verify both document.json and document.md were created
    const jsonPath = result.document_path.replace(/\\/g, '/');
    const mdPath = result.document_path.replace(/\.json$/, '.md');
    expect(jsonPath).toContain('branches/hotfix/Eagers-BE/WCE-946-eagers/document.json');
    const jsonContent = await fs.readFile(jsonPath, 'utf-8');
    const mdContent = await fs.readFile(mdPath, 'utf-8');
    expect(jsonContent).toContain('hotfix/Eagers-BE/WCE-946-eagers');
    expect(mdContent).toContain('# Branch Context: hotfix/Eagers-BE/WCE-946-eagers');
    expect(mdContent).toContain('## 🎯 Commits (2)');

    // 6. Verify target repo directory does NOT contain any ai-context or .branch-render-context folder
    const targetLocalContextPath = path.join(fixture.repoPath, 'ai-context');
    const targetLegacyContextPath = path.join(fixture.repoPath, '.branch-render-context');
    const existsLocal = await fs.access(targetLocalContextPath).then(() => true).catch(() => false);
    const existsLegacy = await fs.access(targetLegacyContextPath).then(() => true).catch(() => false);
    expect(existsLocal).toBe(false);
    expect(existsLegacy).toBe(false);
  });

  it('should resolve base from default_base_ref when checkout branch is the target branch itself', async () => {
    // 1. Rename initial branch to release/eagers
    await fixture.run(['branch', '-M', 'release/eagers']);

    // 2. Create feature branch hotfix/Eagers-BE/WCE-946-eagers with 2 commits
    await fixture.run(['checkout', '-b', 'hotfix/Eagers-BE/WCE-946-eagers']);
    await fs.writeFile(path.join(fixture.repoPath, 'file1.ts'), 'export const a = 1;\nexport const b = 2;\n');
    await fixture.run(['add', 'file1.ts']);
    await fixture.run(['commit', '-m', 'feat: add file1']);

    await fs.writeFile(path.join(fixture.repoPath, 'file2.ts'), 'export const c = 3;\n');
    await fixture.run(['add', 'file2.ts']);
    await fixture.run(['commit', '-m', 'feat: add file2']);

    // 3. Keep checkout on hotfix/Eagers-BE/WCE-946-eagers
    const checkout = await git.getCurrentCheckout(fixture.repoPath);
    expect(checkout.branchName).toBe('hotfix/Eagers-BE/WCE-946-eagers');

    // 4. Save config with default_base_ref = 'release/eagers'
    const { registry } = await orchestrator.discoverRepository(fixture.repoPath);
    const config = await registry.loadConfig();
    config.default_base_ref = 'release/eagers';
    await registry.saveConfig(config);

    // 5. Render without specifying base
    const result = await orchestrator.refreshBranch({
      repoPath: fixture.repoPath,
      branchName: 'hotfix/Eagers-BE/WCE-946-eagers',
    });

    // 6. Verify Base branch is release/eagers and comparison is release/eagers..hotfix/...
    expect(result.target_branch).toBe('hotfix/Eagers-BE/WCE-946-eagers');
    expect(result.checkout_branch).toBe('hotfix/Eagers-BE/WCE-946-eagers');
    expect(result.base_branch).toBe('release/eagers');
    expect(result.comparison).toBe('release/eagers..hotfix/Eagers-BE/WCE-946-eagers');
    expect(result.rendered_commits_count).toBe(2);
    expect(result.changed_files_count).toBe(2);
    expect(result.insertions).toBeGreaterThanOrEqual(3);
    expect(result.document?.content.commits).toHaveLength(2);
  });

  it('should render target branch while checkout is on base branch without switching branches', async () => {
    // 1. Rename current branch to release/eagers
    await fixture.run(['branch', '-M', 'release/eagers']);

    // 2. Create feature branch hotfix/Eagers-BE/WCE-946-eagers with 2 commits
    await fixture.run(['checkout', '-b', 'hotfix/Eagers-BE/WCE-946-eagers']);
    await fs.writeFile(path.join(fixture.repoPath, 'file1.ts'), 'export const a = 1;\nexport const b = 2;\n');
    await fixture.run(['add', 'file1.ts']);
    await fixture.run(['commit', '-m', 'feat: add file1']);

    await fs.writeFile(path.join(fixture.repoPath, 'file2.ts'), 'export const c = 3;\n');
    await fixture.run(['add', 'file2.ts']);
    await fixture.run(['commit', '-m', 'feat: add file2']);

    // 3. Switch back to release/eagers (base branch)
    await fixture.run(['checkout', 'release/eagers']);
    const checkoutBefore = await git.getCurrentCheckout(fixture.repoPath);
    expect(checkoutBefore.branchName).toBe('release/eagers');

    // 4. Render hotfix branch
    const result = await orchestrator.refreshBranch({
      repoPath: fixture.repoPath,
      branchName: 'hotfix/Eagers-BE/WCE-946-eagers',
    });

    // 5. Verify Checkout branch remained unchanged (NO switch)
    const checkoutAfter = await git.getCurrentCheckout(fixture.repoPath);
    expect(checkoutAfter.branchName).toBe('release/eagers');

    // 6. Verify result metrics
    expect(result.target_branch).toBe('hotfix/Eagers-BE/WCE-946-eagers');
    expect(result.checkout_branch).toBe('release/eagers');
    expect(result.base_branch).toBe('release/eagers');
    expect(result.comparison).toBe('release/eagers..hotfix/Eagers-BE/WCE-946-eagers');
    expect(result.rendered_commits_count).toBe(2);
    expect(result.changed_files_count).toBe(2);
    expect(result.insertions).toBeGreaterThanOrEqual(3);
    expect(result.rendered).toBe(true);

    // 7. Verify Document contains full commits list and source metadata
    expect(result.document).not.toBeNull();
    expect(result.document?.source.target_branch).toBe('hotfix/Eagers-BE/WCE-946-eagers');
    expect(result.document?.source.base_branch).toBe('release/eagers');
    expect(result.document?.content.commits).toHaveLength(2);
    expect(result.document?.content.commits[0].subject).toBe('feat: add file1');
    expect(result.document?.content.commits[1].subject).toBe('feat: add file2');
  });

  it('should isolate dirty working tree on checkout branch from target branch document', async () => {
    // 1. Setup base release/eagers and target feature/test
    await fixture.run(['branch', '-M', 'release/eagers']);
    await fixture.run(['checkout', '-b', 'feature/test']);
    await fs.writeFile(path.join(fixture.repoPath, 'target-file.ts'), 'export const target = true;\n');
    await fixture.run(['add', 'target-file.ts']);
    await fixture.run(['commit', '-m', 'feat: target change']);

    await fixture.run(['checkout', 'release/eagers']);

    // 2. Make checkout branch dirty with untracked and modified files
    await fs.writeFile(path.join(fixture.repoPath, 'dirty-untracked.ts'), 'dirty code');
    await fs.writeFile(path.join(fixture.repoPath, 'README.md'), 'dirty modified');

    // 3. Render target branch
    const result = await orchestrator.refreshBranch({
      repoPath: fixture.repoPath,
      branchName: 'feature/test',
    });

    // 4. Verify dirty checkout files were NOT included in target document
    expect(result.checkout_worktree_included).toBe(false);
    expect(result.document?.source.includes_uncommitted_changes).toBe(false);
    const changes = result.document?.content.changes || [];
    expect(changes).toHaveLength(1);
    expect(changes[0].path).toBe('target-file.ts');
    expect(changes.some((c: any) => c.path.includes('dirty'))).toBe(false);
  });

  it('should reject non-existent target branch with clear error and no silent fallback', async () => {
    await expect(
      orchestrator.refreshBranch({
        repoPath: fixture.repoPath,
        branchName: 'non-existent-branch-12345',
      })
    ).rejects.toThrow('Target branch was not found: "non-existent-branch-12345"');
  });

  it('should reject detached checkout with clear error', async () => {
    const head = await git.getHeadCommit(fixture.repoPath);
    await fixture.run(['checkout', head]); // detached HEAD

    await expect(
      orchestrator.refreshBranch({
        repoPath: fixture.repoPath,
        branchName: 'main',
      })
    ).rejects.toThrow('Current checkout is detached HEAD');
  });
});
