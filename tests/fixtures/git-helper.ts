import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class GitTestHelper {
  public static async createTempGitRepo(): Promise<{
    repoPath: string;
    cleanup: () => Promise<void>;
    run: (args: string[]) => Promise<{ stdout: string; stderr: string }>;
  }> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-test-repo-'));
    const repoPath = tempDir.replace(/\\/g, '/');

    const run = async (args: string[]) => {
      return execFileAsync('git', args, {
        cwd: repoPath,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Test Author',
          GIT_AUTHOR_EMAIL: 'test@example.com',
          GIT_COMMITTER_NAME: 'Test Author',
          GIT_COMMITTER_EMAIL: 'test@example.com',
        },
      });
    };

    // Initialize git repo with main branch
    await run(['init', '-b', 'main']);
    await run(['config', 'user.name', 'Test Author']);
    await run(['config', 'user.email', 'test@example.com']);

    // Create initial commit
    await fs.writeFile(path.join(repoPath, 'README.md'), '# Initial Repo\n');
    await run(['add', 'README.md']);
    await run(['commit', '-m', 'Initial commit']);

    const cleanup = async () => {
      try {
        await fs.rm(repoPath, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    };

    return { repoPath, cleanup, run };
  }
}
