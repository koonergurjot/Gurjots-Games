// @ts-nocheck
import { execSync } from 'child_process';
const gitSHA = execSync('git rev-parse --short HEAD').toString().trim();
function prefix(game) {
    return `[GurjotsGame:${game}@${gitSHA}]`;
}
export function log(game, ...args) {
    console.log(prefix(game), ...args);
}
export function warn(game, ...args) {
    console.warn(prefix(game), ...args);
}
export function error(game, ...args) {
    console.error(prefix(game), ...args);
}
