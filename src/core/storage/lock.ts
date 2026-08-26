import fs from 'node:fs/promises';
import path from 'node:path';
import { Logger } from '../../utils/logger.js';

export interface LockOptions {
  staleMs?: number;
  retries?: number;
  retryIntervalMs?: number;
}

export class BranchLocker {
  private static readonly DEFAULT_STALE_MS = 60000; // 60s
  private static readonly DEFAULT_RETRIES = 10;
  private static readonly DEFAULT_RETRY_INTERVAL_MS = 300;

  /**
   * Acquire a lock for the branch directory.
   */
  public static async acquireLock(
    lockPath: string,
    options: LockOptions = {}
  ): Promise<() => Promise<void>> {
    const staleMs = options.staleMs ?? BranchLocker.DEFAULT_STALE_MS;
    const retries = options.retries ?? BranchLocker.DEFAULT_RETRIES;
    const retryIntervalMs = options.retryIntervalMs ?? BranchLocker.DEFAULT_RETRY_INTERVAL_MS;

    const lockDir = path.dirname(lockPath);
    await fs.mkdir(lockDir, { recursive: true });

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const lockInfo = {
          pid: process.pid,
          time: Date.now(),
        };

        // 'wx' flag opens file for writing exclusively; fails if file exists
        await fs.writeFile(lockPath, JSON.stringify(lockInfo), { flag: 'wx' });

        // Lock acquired, return unlock callback
        return async () => {
          try {
            await fs.unlink(lockPath);
          } catch (err: any) {
            Logger.debug(`Failed to remove lock file ${lockPath}: ${err.message}`);
          }
        };
      } catch (err: any) {
        if (err.code === 'EEXIST') {
          // Check if existing lock is stale
          try {
            const raw = await fs.readFile(lockPath, 'utf-8');
            const lockData = JSON.parse(raw);
            if (Date.now() - lockData.time > staleMs) {
              Logger.warn(`Removing stale lock file ${lockPath} (age: ${Date.now() - lockData.time}ms)`);
              await fs.unlink(lockPath);
              continue;
            }
          } catch {
            // If reading or parsing fails, remove the corrupted lock
            try {
              await fs.unlink(lockPath);
              continue;
            } catch {
              // Ignore
            }
          }

          if (attempt < retries) {
            await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
            continue;
          }

          throw new Error(
            `Could not acquire lock on branch. Another process is currently updating it (lock: ${lockPath}).`
          );
        }

        throw err;
      }
    }

    throw new Error(`Timeout trying to acquire lock on ${lockPath}`);
  }
}
