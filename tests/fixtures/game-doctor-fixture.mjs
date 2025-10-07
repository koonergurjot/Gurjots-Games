import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

class GameDoctorFixture {
  constructor(root) {
    this.root = root;
    this.gameDoctorPath = this.path('tools/game-doctor.mjs');
  }

  path(relativePath) {
    return path.join(this.root, relativePath);
  }

  async writeFile(relativePath, contents = '') {
    const absolutePath = this.path(relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, contents);
  }

  async writeJson(relativePath, data) {
    await this.writeFile(relativePath, `${JSON.stringify(data, null, 2)}\n`);
  }

  async readFile(relativePath) {
    const absolutePath = this.path(relativePath);
    return fs.readFile(absolutePath, 'utf8');
  }

  async readJson(relativePath) {
    const raw = await this.readFile(relativePath);
    return JSON.parse(raw);
  }

  async runDoctor(args = [], { env = {} } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [this.gameDoctorPath, ...args], {
        cwd: this.root,
        env: { ...process.env, ...env },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');

      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });

      child.on('error', reject);
      child.on('close', (code) => {
        resolve({ code, stdout, stderr });
      });
    });
  }

  async cleanup() {
    await fs.rm(this.root, { recursive: true, force: true });
  }
}

async function copyFileIfExists(source, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
}

async function copyDependencyTree(moduleName, fixture, visited = new Set()) {
  if (visited.has(moduleName)) {
    return;
  }
  visited.add(moduleName);

  const sourceDir = path.join(REPO_ROOT, 'node_modules', moduleName);
  try {
    await fs.stat(sourceDir);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  const destinationDir = fixture.path(path.join('node_modules', moduleName));
  await fs.cp(sourceDir, destinationDir, { recursive: true });

  let packageJsonRaw;
  try {
    packageJsonRaw = await fs.readFile(path.join(sourceDir, 'package.json'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  let packageJson;
  try {
    packageJson = JSON.parse(packageJsonRaw);
  } catch {
    return;
  }

  const dependencies = packageJson.dependencies ? Object.keys(packageJson.dependencies) : [];
  for (const dependency of dependencies) {
    // eslint-disable-next-line no-await-in-loop
    await copyDependencyTree(dependency, fixture, visited);
  }
}

export async function createGameDoctorFixture(name = 'fixture') {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), `game-doctor-${name}-`));
  const fixture = new GameDoctorFixture(tmpRoot);

  await fs.mkdir(fixture.path('tools/reporters'), { recursive: true });
  await fs.mkdir(fixture.path('tools/schemas'), { recursive: true });
  await fs.mkdir(fixture.path('assets'), { recursive: true });
  await fs.mkdir(fixture.path('games'), { recursive: true });
  await fs.mkdir(fixture.path('gameshells'), { recursive: true });
  await fs.mkdir(fixture.path('health'), { recursive: true });
  await fs.mkdir(fixture.path('node_modules'), { recursive: true });

  await copyFileIfExists(path.join(REPO_ROOT, 'tools', 'game-doctor.mjs'), fixture.path('tools/game-doctor.mjs'));
  await copyFileIfExists(
    path.join(REPO_ROOT, 'tools', 'reporters', 'game-doctor-manifest.json'),
    fixture.path('tools/reporters/game-doctor-manifest.json'),
  );
  await copyFileIfExists(
    path.join(REPO_ROOT, 'tools', 'schemas', 'games.schema.json'),
    fixture.path('tools/schemas/games.schema.json'),
  );
  await copyFileIfExists(
    path.join(REPO_ROOT, 'assets', 'placeholder-thumb.png'),
    fixture.path('assets/placeholder-thumb.png'),
  );

  await copyDependencyTree('ajv', fixture);

  return fixture;
}
