export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export class Logger {
  private static level: LogLevel = LogLevel.INFO;

  public static setLevel(level: LogLevel): void {
    Logger.level = level;
  }

  public static debug(message: string, ...args: any[]): void {
    if (Logger.level <= LogLevel.DEBUG) {
      process.stderr.write(`[DEBUG] ${message} ${args.length ? JSON.stringify(args) : ''}\n`);
    }
  }

  public static info(message: string, ...args: any[]): void {
    if (Logger.level <= LogLevel.INFO) {
      process.stderr.write(`[INFO] ${message} ${args.length ? JSON.stringify(args) : ''}\n`);
    }
  }

  public static warn(message: string, ...args: any[]): void {
    if (Logger.level <= LogLevel.WARN) {
      process.stderr.write(`[WARN] ${message} ${args.length ? JSON.stringify(args) : ''}\n`);
    }
  }

  public static error(message: string, error?: any): void {
    if (Logger.level <= LogLevel.ERROR) {
      const errStr = error instanceof Error ? error.stack || error.message : error ? JSON.stringify(error) : '';
      process.stderr.write(`[ERROR] ${message} ${errStr}\n`);
    }
  }
}
