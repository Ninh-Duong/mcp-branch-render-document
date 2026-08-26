#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJsonPath = path.join(projectRoot, 'package.json');
const lockfilePath = path.join(projectRoot, 'package-lock.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

function packageRoot(packageName) {
  return path.join(projectRoot, 'node_modules', ...packageName.split('/'));
}

function isPackageInstalled(packageName) {
  try {
    const installedPackagePath = path.join(packageRoot(packageName), 'package.json');
    const packageData = JSON.parse(fs.readFileSync(installedPackagePath, 'utf8'));
    return Boolean(packageData.name && packageData.version);
  } catch {
    return false;
  }
}

function getExpectedDependencies() {
  return {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  };
}

function getLockRoot() {
  try {
    const lockfile = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'));
    return lockfile.packages?.[''] || null;
  } catch {
    return null;
  }
}

function lockfileMatchesPackageJson() {
  const lockRoot = getLockRoot();
  if (!lockRoot) return false;

  const expected = getExpectedDependencies();
  const actual = {
    ...(lockRoot.dependencies || {}),
    ...(lockRoot.devDependencies || {}),
  };
  const expectedNames = Object.keys(expected).sort();
  const actualNames = Object.keys(actual).sort();

  if (expectedNames.length !== actualNames.length) return false;
  if (expectedNames.some((name, index) => name !== actualNames[index])) return false;
  return expectedNames.every((name) => expected[name] === actual[name]);
}

function checkNodeVersion() {
  const required = packageJson.engines?.node;
  if (!required) return;

  const minimumMatch = required.match(/>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!minimumMatch) return;

  const current = process.versions.node.split('.').map(Number);
  const minimum = [
    Number(minimumMatch[1]),
    Number(minimumMatch[2] || 0),
    Number(minimumMatch[3] || 0),
  ];

  const isOlder = current.some((value, index) => {
    if (value !== minimum[index]) return value < minimum[index];
    return false;
  });

  if (isOlder) {
    throw new Error(
      `Node.js ${required} is required, but the current version is ${process.versions.node}.`
    );
  }
}

function runInstall() {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const useCi = fs.existsSync(lockfilePath) && lockfileMatchesPackageJson();
  const args = useCi ? ['ci'] : ['install'];

  console.log(`[branch-render] Installing dependencies with ${npmCommand} ${args.join(' ')}...`);
  const result = spawnSync(npmCommand, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  });

  if (result.error) {
    throw new Error(
      `Could not start ${npmCommand}. Install Node.js/npm and run '${npmCommand} ${args.join(' ')}' manually. ${result.error.message}`
    );
  }
  if (result.status !== 0) {
    throw new Error(`${npmCommand} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}.`);
  }
}

function main() {
  checkNodeVersion();

  const expected = getExpectedDependencies();
  const missing = Object.keys(expected).filter((name) => !isPackageInstalled(name));
  const lockMismatch = !lockfileMatchesPackageJson();
  const needsInstall = missing.length > 0 || lockMismatch;
  const checkOnly = process.argv.includes('--check-only');

  if (!needsInstall) {
    console.log('[branch-render] Dependencies are ready.');
    return;
  }

  if (missing.length > 0) {
    console.log(`[branch-render] Missing packages: ${missing.join(', ')}`);
  }
  if (lockMismatch) {
    console.log('[branch-render] package.json and package-lock.json are out of sync.');
  }

  if (checkOnly) {
    process.exitCode = 1;
    return;
  }
  if (process.env.BRANCH_RENDER_SKIP_INSTALL === '1') {
    throw new Error('Automatic dependency installation is disabled by BRANCH_RENDER_SKIP_INSTALL=1.');
  }

  runInstall();
  console.log('[branch-render] Dependencies installed successfully.');
}

try {
  main();
} catch (error) {
  console.error(`[branch-render] ${error.message}`);
  process.exitCode = 1;
}
