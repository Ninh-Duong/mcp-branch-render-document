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

  it('should detect repository root and current branch', async () => {
    const root = await git.getRepositoryRoot(fixture.repoPath);
    expect(root.toLowerCase()).toBe(fixture.repoPath.toLowerCase());

    const branchInfo = await git.getCurrentBranch(fixture.repoPath);
    expect(branchInfo.branchName).toBe('main');
    expect(branchInfo.isDetached).toBe(false);
    expect(branchInfo.headCommit).toHaveLength(40);
  });

  it('should resolve base ref', async () => {
    const base = await git.resolveBaseRef(fixture.repoPath, 'main');
    expect(base.baseRef).toBe('main');
    expect(base.baseCommit).toHaveLength(40);
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
    const base = await git.resolveBaseRef(fixture.repoPath, 'main');

    const commits = await git.getCommitsSince(fixture.repoPath, base.baseCommit, head);
    expect(commits).toHaveLength(1);
    expect(commits[0].subject).toBe('feat: add file1');

    const files = await git.getChangedFilesSince(fixture.repoPath, base.baseCommit, head);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('file1.ts');
  });
});
