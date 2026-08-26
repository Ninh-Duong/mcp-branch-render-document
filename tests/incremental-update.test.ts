import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BranchContextOrchestrator } from '../src/core/orchestrator.js';
import { GitTestHelper } from './fixtures/git-helper.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('Incremental Update & Lifecycle', () => {
  let fixture: Awaited<ReturnType<typeof GitTestHelper.createTempGitRepo>>;
  let tempStore: string;
  let orchestrator: BranchContextOrchestrator;

  beforeEach(async () => {
    fixture = await GitTestHelper.createTempGitRepo();
    tempStore = (await fs.mkdtemp(path.join(os.tmpdir(), 'store-lifecycle-'))).replace(/\\/g, '/');
    orchestrator = new BranchContextOrchestrator(tempStore);
  });

  afterEach(async () => {
    await fixture.cleanup();
    try {
      await fs.rm(tempStore, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('should handle full build, incremental update, and rebase recovery', async () => {
    // 1. Create feature branch with commit 1
    await fixture.run(['checkout', '-b', 'feature/invoice-filter']);
    await fs.writeFile(path.join(fixture.repoPath, 'filter.ts'), 'export function filter() {}');
    await fixture.run(['add', 'filter.ts']);
    await fixture.run(['commit', '-m', 'feat: initial filter']);

    // 2. First render (Full build)
    const firstResult = await orchestrator.refreshBranch({
      repoPath: fixture.repoPath,
      baseRef: 'main',
    });

    expect(firstResult.refreshed).toBe(true);
    expect(firstResult.state.status).toBe('FRESH');
    expect(firstResult.document).not.toBeNull();
    expect(firstResult.document?.content.changes).toHaveLength(1);
    expect(firstResult.document?.content.intent.commit_count).toBe(1);

    // 3. Status without changes should be FRESH
    const statusBefore = await orchestrator.getStatus({
      repoPath: fixture.repoPath,
      baseRef: 'main',
    });
    expect(statusBefore.evaluation.status).toBe('FRESH');

    // 4. Add commit 2 and commit 3
    await fs.writeFile(path.join(fixture.repoPath, 'filter.test.ts'), 'test("filter", () => {})');
    await fixture.run(['add', 'filter.test.ts']);
    await fixture.run(['commit', '-m', 'test: add filter tests']);

    await fs.writeFile(path.join(fixture.repoPath, 'utils.ts'), 'export const util = 1;');
    await fixture.run(['add', 'utils.ts']);
    await fixture.run(['commit', '-m', 'refactor: add utils']);

    // Check status: should be STALE_NEW_COMMITS with 2 commits
    const staleStatus = await orchestrator.getStatus({
      repoPath: fixture.repoPath,
      baseRef: 'main',
    });
    expect(staleStatus.evaluation.status).toBe('STALE_NEW_COMMITS');
    expect(staleStatus.evaluation.newCommitsCount).toBe(2);

    // 5. Refresh: should perform INCREMENTAL UPDATE
    const incrementalResult = await orchestrator.refreshBranch({
      repoPath: fixture.repoPath,
      baseRef: 'main',
    });

    expect(incrementalResult.refreshed).toBe(true);
    expect(incrementalResult.state.status).toBe('FRESH');
    expect(incrementalResult.document?.content.intent.commit_count).toBe(3);
    expect(incrementalResult.document?.content.changes).toHaveLength(3);
    expect(incrementalResult.document?.content.summary).toContain('Incrementally updated: +2 commits');

    // 6. Test Working Tree Dirty
    await fs.writeFile(path.join(fixture.repoPath, 'uncommitted.ts'), 'dirty');
    const dirtyStatus = await orchestrator.getStatus({
      repoPath: fixture.repoPath,
      baseRef: 'main',
    });
    expect(dirtyStatus.evaluation.status).toBe('STALE_WORKTREE');

    // Clean up untracked file
    await fs.unlink(path.join(fixture.repoPath, 'uncommitted.ts'));

    // 7. Test Rebase / Reset -> REQUIRES_FULL_REBUILD
    // Reset to HEAD~1
    await fixture.run(['reset', '--hard', 'HEAD~1']);
    const rebaseStatus = await orchestrator.getStatus({
      repoPath: fixture.repoPath,
      baseRef: 'main',
    });
    expect(rebaseStatus.evaluation.status).toBe('REQUIRES_FULL_REBUILD');

    // Refresh after reset -> Full rebuild
    const rebuiltResult = await orchestrator.refreshBranch({
      repoPath: fixture.repoPath,
      baseRef: 'main',
    });
    expect(rebuiltResult.state.status).toBe('FRESH');
    expect(rebuiltResult.document?.content.intent.commit_count).toBe(2);
  });
});
