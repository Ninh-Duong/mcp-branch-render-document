import fs from 'node:fs/promises';
import path from 'node:path';
import { Logger } from '../../utils/logger.js';

export class GitignoreHelper {
  public static readonly TARGET_ENTRY = '/ai-context/';
  public static readonly LEGACY_ENTRY = '/.branch-render-context/';

  /**
   * Ensure .gitignore contains the ai-context entry idempotently.
   */
  public static async ensureBranchRenderGitignore(repoRoot: string): Promise<{
    changed: boolean;
    entry: string;
  }> {
    const gitignorePath = path.join(repoRoot, '.gitignore');
    let content = '';
    let exists = false;

    try {
      content = await fs.readFile(gitignorePath, 'utf-8');
      exists = true;
    } catch {
      exists = false;
      content = '';
    }

    const lines = content.split(/\r?\n/);
    const hasStandardEntry = lines.some((line) => {
      const trimmed = line.trim();
      return (
        trimmed === '/ai-context/' ||
        trimmed === '/ai-context' ||
        trimmed === 'ai-context/' ||
        trimmed === 'ai-context'
      );
    });

    if (hasStandardEntry) {
      return { changed: false, entry: GitignoreHelper.TARGET_ENTRY };
    }

    // Append entry
    const delimiter = content.includes('\r\n') ? '\r\n' : '\n';
    const prefix = content.length > 0 && !content.endsWith(delimiter) ? delimiter : '';
    const entryBlock = `${prefix}${delimiter}# AI Context Storage (MCP)${delimiter}${GitignoreHelper.TARGET_ENTRY}${delimiter}`;

    await fs.writeFile(gitignorePath, content + entryBlock, 'utf-8');
    Logger.debug(`Updated .gitignore at ${gitignorePath} with ${GitignoreHelper.TARGET_ENTRY}`);

    return { changed: true, entry: GitignoreHelper.TARGET_ENTRY };
  }
}
