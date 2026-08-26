import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ZodSchema } from 'zod';
import { Logger } from '../../utils/logger.js';

export class AtomicWriter {
  /**
   * Write data atomically to targetFilePath.
   * If schema is provided, data is validated prior to replacing target file.
   */
  public static async writeJsonAtomically<T>(
    targetFilePath: string,
    data: T,
    schema?: ZodSchema<T>
  ): Promise<void> {
    if (schema) {
      const validationResult = schema.safeParse(data);
      if (!validationResult.success) {
        throw new Error(
          `Validation failed before atomic write to ${targetFilePath}: ${JSON.stringify(validationResult.error.format())}`
        );
      }
    }

    const dir = path.dirname(targetFilePath);
    await fs.mkdir(dir, { recursive: true });

    const randomSuffix = crypto.randomBytes(6).toString('hex');
    const tempFilePath = `${targetFilePath}.tmp.${process.pid}.${Date.now()}.${randomSuffix}`;
    const content = JSON.stringify(data, null, 2);

    try {
      // 1. Write to temporary file
      await fs.writeFile(tempFilePath, content, 'utf-8');

      // 2. Atomic rename with retry for Windows compatibility
      let retries = 5;
      while (retries > 0) {
        try {
          await fs.rename(tempFilePath, targetFilePath);
          break;
        } catch (err: any) {
          retries--;
          if (retries === 0) {
            throw err;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
    } catch (err) {
      // Clean up temp file on failure
      try {
        await fs.unlink(tempFilePath);
      } catch {
        // Ignore
      }
      throw err;
    }
  }

  /**
   * Append a JSON line to a jsonl file safely.
   */
  public static async appendJsonLine<T>(
    targetFilePath: string,
    data: T,
    schema?: ZodSchema<T>
  ): Promise<void> {
    if (schema) {
      const validationResult = schema.safeParse(data);
      if (!validationResult.success) {
        throw new Error(
          `Validation failed before appending line to ${targetFilePath}: ${JSON.stringify(validationResult.error.format())}`
        );
      }
    }

    const dir = path.dirname(targetFilePath);
    await fs.mkdir(dir, { recursive: true });

    const line = JSON.stringify(data) + '\n';
    await fs.appendFile(targetFilePath, line, 'utf-8');
  }
}
