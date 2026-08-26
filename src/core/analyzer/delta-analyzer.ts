import { GitAdapter, CommitInfo, ChangedFileInfo, DiffStat } from '../git/index.js';
import { SecretRedactor } from './secret-redactor.js';
import { DocumentContent } from '../types/index.js';

export interface DeltaAnalysisResult {
  deltaCommits: CommitInfo[];
  deltaChangedFiles: ChangedFileInfo[];
  deltaDiffStat: DiffStat;
  updatedContent: DocumentContent;
}

export class DeltaBranchAnalyzer {
  constructor(private readonly git: GitAdapter) {}

  public async analyzeDelta(
    repoPath: string,
    lastRenderedTargetCommit: string,
    currentTargetCommit: string,
    existingContent: DocumentContent,
    secretPatterns: string[] = []
  ): Promise<DeltaAnalysisResult> {
    const rawDeltaCommits = await this.git.getCommitsSince(repoPath, lastRenderedTargetCommit, currentTargetCommit);
    const rawDeltaFiles = await this.git.getChangedFilesSince(repoPath, lastRenderedTargetCommit, currentTargetCommit);
    const deltaDiffStat = await this.git.getDiffStat(repoPath, lastRenderedTargetCommit, currentTargetCommit);

    const deltaCommits = rawDeltaCommits.map((c) => ({
      ...c,
      subject: SecretRedactor.redactString(c.subject),
    }));

    const deltaChangedFiles = rawDeltaFiles.filter(
      (f) => !SecretRedactor.isSecretFile(f.path, secretPatterns)
    );

    // Merge commits list (prevent duplicate hashes)
    const existingCommits = existingContent.commits || [];
    const existingHashes = new Set(existingCommits.map((c) => c.hash));
    const mergedCommits = [...existingCommits];

    for (const commit of deltaCommits) {
      if (!existingHashes.has(commit.hash)) {
        mergedCommits.push(commit);
        existingHashes.add(commit.hash);
      }
    }

    // Merge changes: existing changes map updated with delta
    const changesMap = new Map<string, any>();
    for (const change of existingContent.changes || []) {
      changesMap.set(change.path, change);
    }

    for (const deltaFile of deltaChangedFiles) {
      if (deltaFile.status === 'D') {
        changesMap.set(deltaFile.path, { status: 'D', path: deltaFile.path });
      } else {
        changesMap.set(deltaFile.path, {
          status: deltaFile.status,
          path: deltaFile.path,
          oldPath: deltaFile.oldPath,
        });
      }
    }

    const mergedChanges = Array.from(changesMap.values());

    // Update risks
    const risks = new Set<string>(existingContent.risks || []);
    for (const file of deltaChangedFiles) {
      const lower = file.path.toLowerCase();
      if (file.status === 'D') {
        risks.add(`Deleted file: ${file.path}`);
      }
      if (lower.includes('migration') || lower.includes('schema') || lower.includes('db/')) {
        risks.add(`Database or schema change detected in ${file.path}`);
      }
      if (lower.includes('auth') || lower.includes('security') || lower.includes('permission')) {
        risks.add(`Security/Authentication sensitive changes in ${file.path}`);
      }
    }

    // Update tests and architecture
    const existingTests = (existingContent.tests?.test_files as string[]) || [];
    const newTests = deltaChangedFiles
      .filter((f) => {
        const lower = f.path.toLowerCase();
        return lower.includes('test') || lower.includes('spec') || lower.includes('__tests__');
      })
      .map((f) => f.path);

    const mergedTests = Array.from(new Set([...existingTests, ...newTests]));

    const existingNextFiles = existingContent.next_relevant_files || [];
    const newNextFiles = deltaChangedFiles.map((f) => f.path);
    const mergedNextFiles = Array.from(new Set([...newNextFiles, ...existingNextFiles])).slice(0, 20);

    const previousAuthors = (existingContent.intent?.authors as string[]) || [];
    const newAuthors = deltaCommits.map((c) => c.author);
    const mergedAuthors = Array.from(new Set([...previousAuthors, ...newAuthors]));

    const updatedContent: DocumentContent = {
      intent: {
        ...existingContent.intent,
        primary_goal: deltaCommits[deltaCommits.length - 1]?.subject || existingContent.intent?.primary_goal,
        commit_count: mergedCommits.length,
        authors: mergedAuthors,
        last_delta_commits: deltaCommits.map((c) => c.subject),
      },
      commits: mergedCommits,
      scope: {
        ...existingContent.scope,
        total_files: mergedChanges.length,
        insertions: ((existingContent.scope?.insertions as number) || 0) + deltaDiffStat.insertions,
        deletions: ((existingContent.scope?.deletions as number) || 0) + deltaDiffStat.deletions,
      },
      changes: mergedChanges,
      architecture: {
        ...existingContent.architecture,
      },
      tests: {
        test_files: mergedTests,
        has_tests: mergedTests.length > 0,
      },
      dependencies: existingContent.dependencies || [],
      risks: Array.from(risks),
      unknowns: existingContent.unknowns || [],
      next_relevant_files: mergedNextFiles,
      summary: `Incrementally updated: +${deltaCommits.length} commits, ${deltaChangedFiles.length} files changed (+${deltaDiffStat.insertions}/-${deltaDiffStat.deletions}). Total commits: ${mergedCommits.length}, active changed files: ${mergedChanges.length}.`,
    };

    return {
      deltaCommits,
      deltaChangedFiles,
      deltaDiffStat,
      updatedContent,
    };
  }
}
