export interface PorcelainV2Entry {
  type: 'staged' | 'unstaged' | 'untracked' | 'unmerged';
  xy: string;
  sub: string;
  mH: string;
  mI: string;
  mW: string;
  hH: string;
  hI: string;
  path: string;
  origPath?: string;
}

export interface CommitInfo {
  hash: string;
  date: string;
  author: string;
  subject: string;
}

export interface ChangedFileInfo {
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'U' | '?' | string;
  path: string;
  oldPath?: string;
}

export interface DiffStat {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export function parsePorcelainV2(output: string): PorcelainV2Entry[] {
  const lines = output.trim().split('\n').filter((l) => l.trim().length > 0);
  const entries: PorcelainV2Entry[] = [];

  for (const line of lines) {
    if (line.startsWith('#')) {
      // Header comment
      continue;
    }
    if (line.startsWith('1 ') || line.startsWith('2 ')) {
      // Ordinary changed entry or renamed/copied entry
      // Format: 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      // Or: 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path><tab><origPath>
      const parts = line.split(' ');
      const xy = parts[1];
      const sub = parts[2];
      const mH = parts[3];
      const mI = parts[4];
      const mW = parts[5];
      const hH = parts[6];
      const hI = parts[7];

      if (line.startsWith('2 ')) {
        const remaining = parts.slice(9).join(' ');
        const [path, origPath] = remaining.split('\t');
        entries.push({
          type: xy[0] !== '.' ? 'staged' : 'unstaged',
          xy,
          sub,
          mH,
          mI,
          mW,
          hH,
          hI,
          path: path || '',
          origPath,
        });
      } else {
        const filePath = parts.slice(8).join(' ');
        entries.push({
          type: xy[0] !== '.' ? 'staged' : 'unstaged',
          xy,
          sub,
          mH,
          mI,
          mW,
          hH,
          hI,
          path: filePath,
        });
      }
    } else if (line.startsWith('? ')) {
      // Untracked file: ? <path>
      const filePath = line.slice(2).trim();
      entries.push({
        type: 'untracked',
        xy: '??',
        sub: 'N...',
        mH: '000000',
        mI: '000000',
        mW: '000000',
        hH: '0000000000000000000000000000000000000000',
        hI: '0000000000000000000000000000000000000000',
        path: filePath,
      });
    } else if (line.startsWith('u ')) {
      // Unmerged entry
      const parts = line.split(' ');
      const filePath = parts.slice(10).join(' ');
      entries.push({
        type: 'unmerged',
        xy: 'UU',
        sub: 'N...',
        mH: '000000',
        mI: '000000',
        mW: '000000',
        hH: '',
        hI: '',
        path: filePath,
      });
    }
  }

  return entries;
}

export function parseGitLog(output: string): CommitInfo[] {
  const lines = output.trim().split('\n').filter((l) => l.trim().length > 0);
  const commits: CommitInfo[] = [];

  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length >= 4) {
      commits.push({
        hash: parts[0].trim(),
        date: parts[1].trim(),
        author: parts[2].trim(),
        subject: parts.slice(3).join('\t').trim(),
      });
    }
  }

  return commits;
}

export function parseNameStatus(output: string): ChangedFileInfo[] {
  const lines = output.trim().split('\n').filter((l) => l.trim().length > 0);
  const files: ChangedFileInfo[] = [];

  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length >= 2) {
      const statusCode = parts[0].trim();
      const status = statusCode[0]; // M, A, D, R, etc.
      if (status === 'R' || status === 'C') {
        files.push({
          status,
          oldPath: parts[1].trim(),
          path: parts[2]?.trim() || parts[1].trim(),
        });
      } else {
        files.push({
          status,
          path: parts[1].trim(),
        });
      }
    }
  }

  return files;
}

export function parseDiffShortstat(output: string): DiffStat {
  const result: DiffStat = {
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
  };

  const fileMatch = output.match(/(\d+)\s+file[s]?\s+changed/i);
  if (fileMatch) {
    result.filesChanged = parseInt(fileMatch[1], 10);
  }

  const insertMatch = output.match(/(\d+)\s+insertion[s]?\(\+\)/i);
  if (insertMatch) {
    result.insertions = parseInt(insertMatch[1], 10);
  }

  const deleteMatch = output.match(/(\d+)\s+deletion[s]?\(-\)/i);
  if (deleteMatch) {
    result.deletions = parseInt(deleteMatch[1], 10);
  }

  return result;
}
