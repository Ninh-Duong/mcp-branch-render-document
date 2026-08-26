import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from '../../utils/hash.js';
import { PorcelainV2Entry } from './parser.js';

export async function computeWorkingTreeFingerprint(
  repoPath: string,
  entries: PorcelainV2Entry[],
  secretPatterns: string[] = []
): Promise<string> {
  if (entries.length === 0) {
    return 'clean';
  }

  // Sort entries for deterministic hashing
  const sortedEntries = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  const parts: string[] = [];

  for (const entry of sortedEntries) {
    // Check if path matches common secret patterns
    const isSecret = secretPatterns.some((pattern) => {
      const cleanPattern = pattern.replace(/^\*\*\//, '').replace(/\*$/, '');
      return entry.path.includes(cleanPattern);
    });

    if (isSecret) {
      parts.push(`${entry.type}:${entry.xy}:${entry.path}:[SECRET_REDACTED]`);
      continue;
    }

    if (entry.type === 'untracked') {
      // For untracked files, hash their content if they exist and are small enough (< 1MB)
      try {
        const fullPath = path.join(repoPath, entry.path);
        const stat = await fs.stat(fullPath);
        if (stat.isFile() && stat.size < 1024 * 1024) {
          const content = await fs.readFile(fullPath);
          parts.push(`untracked:${entry.path}:${sha256(content)}`);
        } else {
          parts.push(`untracked:${entry.path}:size=${stat.size}:mtime=${stat.mtimeMs}`);
        }
      } catch {
        parts.push(`untracked:${entry.path}:missing`);
      }
    } else {
      // For tracked changes (staged or unstaged), include file path and index/head hashes from porcelain
      parts.push(`${entry.type}:${entry.xy}:${entry.path}:${entry.mH}:${entry.mI}:${entry.mW}:${entry.hH}:${entry.hI}`);
    }
  }

  return `wt_${sha256(parts.join('\n')).slice(0, 16)}`;
}
