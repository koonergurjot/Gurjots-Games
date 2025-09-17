// Resolve a commit hash if one was injected at build time. Browsers don't
// expose git metadata, so fall back to a generic placeholder when running in
// the client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const gitSHA = (globalThis as any).__GIT_SHA__ || 'dev';

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

