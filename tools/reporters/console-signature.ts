import { execSync } from 'child_process';

const gitSHA = execSync('git rev-parse --short HEAD').toString().trim();

function prefix(game: string) {
  return `[GurjotsGame:${game}@${gitSHA}]`;
}

export function log(game: string, ...args: unknown[]) {
  console.log(prefix(game), ...args);
}

export function warn(game: string, ...args: unknown[]) {
  console.warn(prefix(game), ...args);
}

export function error(game: string, ...args: unknown[]) {
  console.error(prefix(game), ...args);
}

