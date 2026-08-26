import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import {
  parsePorcelainV2,
  parseGitLog,
  parseNameStatus,
  parseDiffShortstat,
  PorcelainV2Entry,
  CommitInfo,
  ChangedFileInfo,
  DiffStat,
} from './parser.js';
import { computeWorkingTreeFingerprint } from './fingerprint.js';
import { Logger } from '../../utils/logger.js';

const execFileAsync = promisify(execFile);

export interface GitBranchInfo {
  branchName: string;
  isDetached: boolean;
  headCommit: string;
}

export interface GitBaseRefInfo {
  baseRef: string;
  baseCommit: string;
}

export interface WorkingTreeStatus {
  isClean: boolean;
  fingerprint: string;
  entries: PorcelainV2Entry[];
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
}

export class GitAdapter {
  private readonly defaultTimeoutMs: number = 15000;

  /**
   * Run a read-only git command safely.
   */
  public async runGit(
    args: string[],
    cwd: string,
    options: { timeout?: number; maxBuffer?: number } = {}
  ): Promise<{ stdout: string; stderr: string }> {
    const timeout = options.timeout ?? this.defaultTimeoutMs;
    const maxBuffer = options.maxBuffer ?? 10 * 1024 * 1024; // 10MB default buffer

    try {
      const { stdout, stderr } = await execFileAsync('git', args, {
        cwd,
        timeout,
        maxBuffer,
        windowsHide: true,
        env: {
          ...process.env,
          // Force standard locale and date formatting for consistent parsing
          LC_ALL: 'C',
          LANG: 'C',
          GIT_TERMINAL_PROMPT: '0', // never prompt for password in headless
        },
      });

      return {
        stdout: stdout.toString(),
        stderr: stderr.toString(),
      };
    } catch (error: any) {
      Logger.debug(`git ${args.join(' ')} failed in ${cwd}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Verify and return repository root path
   */
  public async getRepositoryRoot(cwd: string = '.'): Promise<string> {
    try {
      const { stdout } = await this.runGit(['rev-parse', '--show-toplevel'], cwd);
      const repoRoot = stdout.trim();
      return path.resolve(repoRoot).replace(/\\/g, '/');
    } catch (error: any) {
      throw new Error(`Directory is not a valid git repository: ${cwd} (${error.message})`);
    }
  }

  /**
   * Get current branch name, head commit and whether HEAD is detached
   */
  public async getCurrentBranch(repoPath: string): Promise<GitBranchInfo> {
    const headCommit = await this.getHeadCommit(repoPath);

    try {
      const { stdout } = await this.runGit(['branch', '--show-current'], repoPath);
      const branchName = stdout.trim();

      if (!branchName) {
        return {
          branchName: `detached-${headCommit.slice(0, 8)}`,
          isDetached: true,
          headCommit,
        };
      }

      return {
        branchName,
        isDetached: false,
        headCommit,
      };
    } catch {
      return {
        branchName: `detached-${headCommit.slice(0, 8)}`,
        isDetached: true,
        headCommit,
      };
    }
  }

  /**
   * Get current HEAD commit hash
   */
  public async getHeadCommit(repoPath: string): Promise<string> {
    const { stdout } = await this.runGit(['rev-parse', 'HEAD'], repoPath);
    return stdout.trim();
  }

  /**
   * Get remote URLs configured for the repository
   */
  public async getRemoteUrls(repoPath: string): Promise<string[]> {
    try {
      const { stdout } = await this.runGit(['remote', '-v'], repoPath);
      const lines = stdout.trim().split('\n');
      const urls = new Set<string>();

      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 2 && parts[1]) {
          urls.add(parts[1]);
        }
      }

      return Array.from(urls);
    } catch {
      return [];
    }
  }

  /**
   * Resolve base ref commit following resolution rules:
   * 1. User preferred base
   * 2. origin/main
   * 3. main
   * 4. origin/master
   * 5. master
   */
  public async resolveBaseRef(
    repoPath: string,
    preferredBase?: string
  ): Promise<GitBaseRefInfo> {
    const candidates = [
      preferredBase,
      'origin/main',
      'main',
      'origin/master',
      'master',
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
      try {
        const { stdout } = await this.runGit(['rev-parse', '--verify', candidate], repoPath);
        const baseCommit = stdout.trim();
        if (baseCommit) {
          return {
            baseRef: candidate,
            baseCommit,
          };
        }
      } catch {
        // Continue to next candidate
      }
    }

    throw new Error(
      `Could not resolve base ref. Checked candidates: ${candidates.join(', ')}. Please specify a valid base ref.`
    );
  }

  /**
   * Get working tree status and fingerprint
   */
  public async getWorkingTreeStatus(
    repoPath: string,
    secretPatterns: string[] = []
  ): Promise<WorkingTreeStatus> {
    const { stdout } = await this.runGit(
      ['status', '--porcelain=v2', '--untracked-files=all'],
      repoPath
    );

    const entries = parsePorcelainV2(stdout);
    const fingerprint = await computeWorkingTreeFingerprint(repoPath, entries, secretPatterns);

    let stagedCount = 0;
    let unstagedCount = 0;
    let untrackedCount = 0;

    for (const entry of entries) {
      if (entry.type === 'staged') stagedCount++;
      else if (entry.type === 'unstaged') unstagedCount++;
      else if (entry.type === 'untracked') untrackedCount++;
    }

    return {
      isClean: entries.length === 0,
      fingerprint,
      entries,
      stagedCount,
      unstagedCount,
      untrackedCount,
    };
  }

  /**
   * Check if commit A is ancestor of commit B
   */
  public async isAncestor(
    repoPath: string,
    maybeAncestor: string,
    descendant: string
  ): Promise<boolean> {
    if (maybeAncestor === descendant) {
      return true;
    }

    try {
      await this.runGit(['merge-base', '--is-ancestor', maybeAncestor, descendant], repoPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get list of commits in range fromCommit..toCommit
   */
  public async getCommitsSince(
    repoPath: string,
    fromCommit: string,
    toCommit: string = 'HEAD'
  ): Promise<CommitInfo[]> {
    if (fromCommit === toCommit) {
      return [];
    }

    const { stdout } = await this.runGit(
      ['log', '--reverse', '--format=%H%x09%ad%x09%an%x09%s', '--date=iso-strict', `${fromCommit}..${toCommit}`],
      repoPath
    );

    return parseGitLog(stdout);
  }

  /**
   * Get changed files in range fromCommit..toCommit
   */
  public async getChangedFilesSince(
    repoPath: string,
    fromCommit: string,
    toCommit: string = 'HEAD'
  ): Promise<ChangedFileInfo[]> {
    if (fromCommit === toCommit) {
      return [];
    }

    const { stdout } = await this.runGit(
      ['diff', '--name-status', '--find-renames', fromCommit, toCommit],
      repoPath
    );

    return parseNameStatus(stdout);
  }

  /**
   * Get diffstat summary
   */
  public async getDiffStat(
    repoPath: string,
    fromCommit: string,
    toCommit: string = 'HEAD'
  ): Promise<DiffStat> {
    if (fromCommit === toCommit) {
      return { filesChanged: 0, insertions: 0, deletions: 0 };
    }

    const { stdout } = await this.runGit(
      ['diff', '--shortstat', fromCommit, toCommit],
      repoPath
    );

    return parseDiffShortstat(stdout);
  }

  /**
   * Get patch diff between two commits with length limit
   */
  public async getDiffPatch(
    repoPath: string,
    fromCommit: string,
    toCommit: string = 'HEAD',
    maxBytes: number = 5 * 1024 * 1024
  ): Promise<{ patch: string; truncated: boolean }> {
    if (fromCommit === toCommit) {
      return { patch: '', truncated: false };
    }

    const { stdout } = await this.runGit(
      ['diff', fromCommit, toCommit],
      repoPath,
      { maxBuffer: maxBytes * 2 }
    );

    if (stdout.length > maxBytes) {
      return {
        patch: stdout.slice(0, maxBytes) + '\n\n... [DIFF TRUNCATED DUE TO SIZE LIMIT]',
        truncated: true,
      };
    }

    return { patch: stdout, truncated: false };
  }
}
