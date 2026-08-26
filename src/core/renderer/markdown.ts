import { BranchDocument } from '../types/index.js';

export class MarkdownRenderer {
  public static render(doc: BranchDocument): string {
    const lines: string[] = [];

    lines.push(`# Branch Context: ${doc.branch.name}`);
    lines.push('');
    lines.push(`- **Base Branch:** \`${doc.source.base_branch}\``);
    lines.push(`- **Target Commit:** \`${doc.source.target_commit.slice(0, 8)}\``);
    lines.push(`- **Base Commit:** \`${doc.source.base_commit.slice(0, 8)}\``);
    lines.push(`- **Comparison:** \`${doc.source.base_branch}..${doc.source.target_branch}\``);
    lines.push(`- **Freshness:** \`${doc.freshness.status}\` (Rendered at: ${doc.freshness.rendered_at})`);
    lines.push('');
    lines.push('---');
    lines.push('');

    // Summary
    lines.push('## 📌 Summary');
    lines.push(doc.content.summary || 'No summary available.');
    lines.push('');

    // Commits
    const commits = doc.content.commits || [];
    lines.push(`## 🎯 Commits (${commits.length})`);
    if (commits.length === 0) {
      lines.push('*(No new commits)*');
    } else {
      commits.forEach((c) => {
        lines.push(`- \`${c.hash.slice(0, 8)}\` **${c.subject}** (${c.author}, ${c.date})`);
      });
    }
    lines.push('');

    // Changed Files
    const changes = doc.content.changes || [];
    lines.push(`## 📁 Changed Files (${changes.length})`);
    if (changes.length === 0) {
      lines.push('*(No files changed)*');
    } else {
      lines.push('| Status | Path |');
      lines.push('|---|---|');
      changes.forEach((f: any) => {
        const statusIcon = f.status === 'A' ? '🟢 A' : f.status === 'D' ? '🔴 D' : f.status === 'R' ? '🔄 R' : '🟡 M';
        const fileDisplay = f.oldPath ? `${f.oldPath} ➔ ${f.path}` : f.path;
        lines.push(`| ${statusIcon} | \`${fileDisplay}\` |`);
      });
    }
    lines.push('');

    // Scope & Metrics
    const scope = doc.content.scope || {};
    lines.push('## 📊 Scope & Diff Metrics');
    lines.push(`- **Total Changed Files:** ${scope.total_files || changes.length}`);
    lines.push(`- **Insertions:** +${scope.insertions || 0}`);
    lines.push(`- **Deletions:** -${scope.deletions || 0}`);
    if (scope.modules && scope.modules.length > 0) {
      lines.push(`- **Affected Modules:** ${scope.modules.map((m: string) => `\`${m}\``).join(', ')}`);
    }
    lines.push('');

    // Risks
    const risks = doc.content.risks || [];
    if (risks.length > 0) {
      lines.push('## ⚠️ Risks & Considerations');
      risks.forEach((r) => lines.push(`- ${r}`));
      lines.push('');
    }

    // Tests
    const tests = doc.content.tests || {};
    if (tests.test_files && tests.test_files.length > 0) {
      lines.push('## 🧪 Tests Detected');
      tests.test_files.forEach((t: string) => lines.push(`- \`${t}\``));
      lines.push('');
    }

    // Next relevant files
    const nextFiles = doc.content.next_relevant_files || [];
    if (nextFiles.length > 0) {
      lines.push('## 🧭 Next Relevant Files For AI Agent');
      nextFiles.slice(0, 10).forEach((nf: string) => lines.push(`- \`${nf}\``));
      lines.push('');
    }

    return lines.join('\n');
  }
}
