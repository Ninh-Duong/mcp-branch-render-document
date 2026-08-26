import path from 'node:path';

/**
 * Converts a runtime path to a portable path for persisted metadata.
 * Absolute paths are still used internally for Git and filesystem access.
 */
export function toPortableRelativePath(value: string, basePath: string = process.cwd()): string {
  if (!path.isAbsolute(value)) {
    return value.replace(/\\/g, '/');
  }

  const relative = path.relative(basePath, value).replace(/\\/g, '/');
  // On Windows, path.relative() returns an absolute path when the source and
  // target are on different drives. Never persist that machine-specific value.
  if (!relative || path.isAbsolute(relative) || /^[A-Za-z]:\//.test(relative) || relative.startsWith('//')) {
    return '.';
  }

  return relative;
}
