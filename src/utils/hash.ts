import { createHash } from 'node:crypto';
import path from 'node:path';

export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function generateRepositoryId(repoPath: string, remoteUrls: string[] = []): string {
  const normalizedPath = path.resolve(repoPath).replace(/\\/g, '/').toLowerCase();
  const primaryRemote = remoteUrls[0] || '';
  const hashKey = primaryRemote ? `${normalizedPath}|${primaryRemote}` : normalizedPath;
  const hash = sha256(hashKey).slice(0, 8);
  return `r_${hash}`;
}

export function generateBranchId(branchName: string): string {
  const hash = sha256(branchName).slice(0, 8);
  return `b_${hash}`;
}

export function generateDocumentId(repositoryId: string, branchId: string): string {
  return `doc_${repositoryId}_${branchId}`;
}

export function sanitizeBranchSlug(branchName: string): string {
  return branchName
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .toLowerCase();
}
