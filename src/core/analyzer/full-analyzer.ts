import { GitAdapter, CommitInfo, ChangedFileInfo, DiffStat } from '../git/index.js';
import { SecretRedactor } from './secret-redactor.js';
import { DocumentContent } from '../types/index.js';

export interface FullAnalysisResult {
  commits: CommitInfo[];
  changedFiles: ChangedFileInfo[];
  diffStat: DiffStat;
  content: DocumentContent;
}

export class FullBranchAnalyzer {
  constructor(private readonly git: GitAdapter) {}

  public async analyze(
    repoPath: string,
    baseCommit: string,
    targetCommit: string,
    secretPatterns: string[] = []
  ): Promise<FullAnalysisResult> {
    if (baseCommit === targetCommit) {
      return {
        commits: [],
        changedFiles: [],
        diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
        content: {
          intent: {
            primary_goal: 'No difference between target branch and base branch',
            commit_count: 0,
            authors: [],
          },
          commits: [],
          scope: {
            total_files: 0,
            insertions: 0,
            deletions: 0,
            modules: [],
          },
          changes: [],
          architecture: {
            affected_modules: [],
            config_changes: [],
            doc_changes: [],
          },
          tests: {
            test_files: [],
            has_tests: false,
          },
          dependencies: [],
          risks: [],
          unknowns: [],
          next_relevant_files: [],
          summary: 'Target branch is up to date with base branch (0 commits, 0 files changed).',
        },
      };
    }

    const rawCommits = await this.git.getCommitsSince(repoPath, baseCommit, targetCommit);
    const rawFiles = await this.git.getChangedFilesSince(repoPath, baseCommit, targetCommit);
    const diffStat = await this.git.getDiffStat(repoPath, baseCommit, targetCommit);

    // Redact secret files and commit messages
    const commits = rawCommits.map((c) => ({
      ...c,
      subject: SecretRedactor.redactString(c.subject),
    }));

    const changedFiles = rawFiles.filter(
      (f) => !SecretRedactor.isSecretFile(f.path, secretPatterns)
    );

    // Group files by category
    const tests: string[] = [];
    const configs: string[] = [];
    const documentation: string[] = [];
    const sourceFiles: string[] = [];
    const modules = new Set<string>();
    const risks: string[] = [];
    const unknowns: string[] = [];

    for (const file of changedFiles) {
      const lower = file.path.toLowerCase();
      const parts = file.path.split('/');
      if (parts.length > 1) {
        modules.add(parts.slice(0, 2).join('/'));
      }

      if (lower.includes('test') || lower.includes('spec') || lower.includes('__tests__')) {
        tests.push(file.path);
      } else if (
        lower.endsWith('.json') ||
        lower.endsWith('.yml') ||
        lower.endsWith('.yaml') ||
        lower.endsWith('.toml') ||
        lower.includes('docker') ||
        lower.includes('config')
      ) {
        configs.push(file.path);
      } else if (lower.endsWith('.md') || lower.includes('docs/')) {
        documentation.push(file.path);
      } else {
        sourceFiles.push(file.path);
      }

      if (file.status === 'D') {
        risks.push(`Deleted file: ${file.path}`);
      }
      if (lower.includes('migration') || lower.includes('schema') || lower.includes('db/')) {
        risks.push(`Database or schema change detected in ${file.path}`);
      }
      if (lower.includes('auth') || lower.includes('security') || lower.includes('permission')) {
        risks.push(`Security/Authentication sensitive changes in ${file.path}`);
      }
    }

    if (tests.length === 0 && sourceFiles.length > 0) {
      unknowns.push('No tests detected for modified source files.');
    }

    const intent = {
      primary_goal: commits[commits.length - 1]?.subject || 'Branch development',
      commit_count: commits.length,
      authors: Array.from(new Set(commits.map((c) => c.author))),
    };

    const scope = {
      total_files: changedFiles.length,
      insertions: diffStat.insertions,
      deletions: diffStat.deletions,
      modules: Array.from(modules),
    };

    const architecture = {
      affected_modules: Array.from(modules),
      config_changes: configs,
      doc_changes: documentation,
    };

    const testSection = {
      test_files: tests,
      has_tests: tests.length > 0,
    };

    const nextRelevantFiles = [
      ...sourceFiles.slice(0, 10),
      ...tests.slice(0, 5),
      ...configs.slice(0, 5),
    ];

    const content: DocumentContent = {
      intent,
      commits,
      scope,
      changes: changedFiles.map((f) => ({
        status: f.status,
        path: f.path,
        oldPath: f.oldPath,
      })),
      architecture,
      tests: testSection,
      dependencies: configs.filter((c) => c.includes('package.json') || c.includes('pom.xml') || c.includes('go.mod')),
      risks,
      unknowns,
      next_relevant_files: nextRelevantFiles,
      summary: `Branch has ${commits.length} commits affecting ${changedFiles.length} files (+${diffStat.insertions}/-${diffStat.deletions}).`,
    };

    return {
      commits,
      changedFiles,
      diffStat,
      content,
    };
  }
}
