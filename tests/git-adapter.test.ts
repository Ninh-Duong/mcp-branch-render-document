import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GitAdapter } from '../src/core/git/adapter.js';
import { GitTestHelper } from './fixtures/git-helper.js';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('GitAdapter', () => {
  let fixture: Awaited<ReturnType<typeof GitTestHelper.createTempGitRepo>>;
  let git: GitAdapter;

  beforeEach(async () => {
    fixture = await GitTestHelper.createTempGitRepo();
    git = new GitAdapter();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it('should detect repository root and current checkout', async () => {
    const root = await git.getRepositoryRoot(fixture.repoPath);
    expect(root.toLowerCase()).toBe(fixture.repoPath.toLowerCase());

    const checkout = await git.getCurrentCheckout(fixture.repoPath);
    expect(checkout.branchName).toBe('main');
    expect(checkout.isDetached).toBe(false);
    expect(checkout.headCommit).toHaveLength(40);
  });

  it('should resolve branch ref with resolveBranchRef', async () => {
    await fixture.run(['checkout', '-b', 'feature/resolve-test']);
    const resolved = await git.resolveBranchRef(fixture.repoPath, 'feature/resolve-test');
    expect(resolved.requestedRef).toBe('feature/resolve-test');
    expect(resolved.commit).toHaveLength(40);
  });

  it('should throw error when resolving non-existent branch without fallback', async () => {
    await expect(git.resolveBranchRef(fixture.repoPath, 'does-not-exist')).rejects.toThrow(
      'Target branch was not found: "does-not-exist"'
    );
  });

  it('should detect working tree clean status and fingerprint', async () => {
    const status = await git.getWorkingTreeStatus(fixture.repoPath);
    expect(status.isClean).toBe(true);
    expect(status.fingerprint).toBe('clean');
  });

  it('should detect dirty working tree when untracked file is created', async () => {
    await fs.writeFile(path.join(fixture.repoPath, 'temp.txt'), 'hello');
    const status = await git.getWorkingTreeStatus(fixture.repoPath);
    expect(status.isClean).toBe(false);
    expect(status.untrackedCount).toBe(1);
    expect(status.fingerprint).toContain('wt_');
  });

  it('should detect commits and changed files on feature branch', async () => {
    await fixture.run(['checkout', '-b', 'feature/test']);
    await fs.writeFile(path.join(fixture.repoPath, 'file1.ts'), 'export const a = 1;');
    await fixture.run(['add', 'file1.ts']);
    await fixture.run(['commit', '-m', 'feat: add file1']);

    const head = await git.getHeadCommit(fixture.repoPath);
    const mainCheckout = await git.resolveBranchRef(fixture.repoPath, 'main');

    const commits = await git.getCommitsSince(fixture.repoPath, mainCheckout.commit, head);
    expect(commits).toHaveLength(1);
    expect(commits[0].subject).toBe('feat: add file1');

    const files = await git.getChangedFilesSince(fixture.repoPath, mainCheckout.commit, head);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('file1.ts');
  });
});
