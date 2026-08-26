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

export interface CheckoutInfo {
  branchName: string;
  headCommit: string;
  isDetached: boolean;
}

export interface ResolvedBranchRef {
  requestedRef: string;
  resolvedRef: string;
  commit: string;
  isRemote: boolean;
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
          LC_ALL: 'C',
          LANG: 'C',
          GIT_TERMINAL_PROMPT: '0',
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
   * Get current checkout branch, HEAD commit, and detached status
   */
  public async getCurrentCheckout(repoPath: string): Promise<CheckoutInfo> {
    const headCommit = await this.getHeadCommit(repoPath);

    try {
      const { stdout } = await this.runGit(['branch', '--show-current'], repoPath);
      const branchName = stdout.trim();

      if (!branchName) {
        return {
          branchName: '',
          headCommit,
          isDetached: true,
        };
      }

      return {
        branchName,
        headCommit,
        isDetached: false,
      };
    } catch {
      return {
        branchName: '',
        headCommit,
        isDetached: true,
      };
    }
  }

  /**
   * Resolve branch ref without silent fallback
   * Resolution order:
   * 1. refs/heads/<branchName>
   * 2. exact ref / commit
   * 3. refs/remotes/origin/<branchName>
   */
  public async resolveBranchRef(repoPath: string, branchName: string): Promise<ResolvedBranchRef> {
    if (!branchName || !branchName.trim()) {
      throw new Error('Branch name cannot be empty.');
    }

    const trimmed = branchName.trim();
    const candidates = [
      { ref: `refs/heads/${trimmed}`, isRemote: false },
      { ref: trimmed, isRemote: false },
      { ref: `refs/remotes/origin/${trimmed}`, isRemote: true },
      { ref: `origin/${trimmed}`, isRemote: true },
    ];

    for (const candidate of candidates) {
      try {
        const { stdout } = await this.runGit(['rev-parse', '--verify', candidate.ref], repoPath);
        const commit = stdout.trim();
        if (commit) {
          return {
            requestedRef: trimmed,
            resolvedRef: candidate.ref,
            commit,
            isRemote: candidate.isRemote,
          };
        }
      } catch {
        // Try next candidate
      }
    }

    throw new Error(
      `Target branch was not found: "${trimmed}". Checked local refs and origin remote refs.`
    );
  }

  /**
   * Intelligently detect matching base branch (e.g. tracking upstream, or release/<token> matching target branch)
   */
  public async detectMatchingBaseBranch(repoPath: string, targetBranch: string): Promise<string | null> {
    if (!targetBranch) return null;

    // 1. Check git config branch.<targetBranch>.merge
    try {
      const { stdout } = await this.runGit(['config', '--get', `branch.${targetBranch}.merge`], repoPath);
      const mergeRef = stdout.trim().replace(/^refs\/heads\//, '');
      if (mergeRef && mergeRef !== targetBranch) {
        try {
          await this.resolveBranchRef(repoPath, mergeRef);
          return mergeRef;
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }

    // 2. Fetch all branch refs in a single fast command
    let availableBranches: Set<string>;
    try {
      const { stdout } = await this.runGit(
        ['for-each-ref', '--format=%(refname:short)', 'refs/heads/', 'refs/remotes/'],
        repoPath
      );
      availableBranches = new Set(
        stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
      );
    } catch {
      availableBranches = new Set();
    }

    // 3. Token / Suffix extraction from branch name
    // Examples: "hotfix/Eagers-BE/WCE-946-eagers" -> tokens: ["eagers", "Eagers-BE"]
    const parts = targetBranch.split('/');
    const lastPart = parts[parts.length - 1] || '';
    const subParts = lastPart.split(/[-_]/);

    const candidateTokens = new Set<string>();
    if (parts.length > 2) {
      candidateTokens.add(parts[1]);
      candidateTokens.add(parts[1].toLowerCase());
    }
    candidateTokens.add(lastPart);
    candidateTokens.add(lastPart.toLowerCase());
    for (const sub of subParts) {
      if (sub.length > 2) {
        candidateTokens.add(sub);
        candidateTokens.add(sub.toLowerCase());
      }
    }

    for (const token of candidateTokens) {
      const patterns = [
        `release/${token}`,
        `origin/release/${token}`,
        `releases/${token}`,
        `origin/releases/${token}`,
        `staging/${token}`,
        `origin/staging/${token}`,
        `develop/${token}`,
        `origin/develop/${token}`,
      ];

      for (const pattern of patterns) {
        if (availableBranches.has(pattern) && pattern !== targetBranch) {
          return pattern;
        }
      }
    }

    return null;
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
    toCommit: string
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
    toCommit: string
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
   * Get diffstat summary between fromCommit and toCommit
   */
  public async getDiffStat(
    repoPath: string,
    fromCommit: string,
    toCommit: string
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
    toCommit: string,
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
