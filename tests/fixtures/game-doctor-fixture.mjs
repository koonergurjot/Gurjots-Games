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

async function copyDependencyModule(dependency, targetRoot) {
  const source = path.join(REPO_ROOT, 'node_modules', dependency);
  const destination = path.join(targetRoot, 'node_modules', dependency);

  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(source, destination, { recursive: true });
}

async function ensureNodeModulesSymlink(targetRoot) {
  const source = path.join(REPO_ROOT, 'node_modules');
  const destination = path.join(targetRoot, 'node_modules');

  try {
    await fs.access(source);
  } catch {
    return;
  }

  try {
    await fs.symlink(source, destination, 'dir');
    return;
  } catch (error) {
    if (error.code === 'EEXIST') {
      const stats = await fs.lstat(destination);
      if (stats.isSymbolicLink() || stats.isDirectory()) {
        return;
      }
    }

    if (error.code === 'EPERM' || error.code === 'EEXIST') {
      await copyDependencyModule('ajv', targetRoot);
      return;
    }

    throw error;
  }
}

async function writeFixtureSchema(fixture) {
  const schema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'Test games catalog schema',
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['slug', 'title', 'firstFrame'],
      properties: {
        slug: { type: 'string', minLength: 1 },
        title: { type: 'string', minLength: 1 },
        firstFrame: {
          type: 'object',
          additionalProperties: false,
          required: ['sprites'],
          properties: {
            sprites: {
              type: 'array',
              minItems: 1,
              items: { type: 'string', minLength: 1 },
            },
            audio: {
              type: 'array',
              items: { type: 'string', minLength: 1 },
            },
          },
        },
      },
    },
  };

  await fixture.writeJson('tools/schemas/games.schema.json', schema);
}

export async function createGameDoctorFixture(name = 'fixture') {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), `game-doctor-${name}-`));
  const fixture = new GameDoctorFixture(tmpRoot);

  await fs.mkdir(fixture.path('tools/reporters'), { recursive: true });
  await fs.mkdir(fixture.path('assets'), { recursive: true });
  await fs.mkdir(fixture.path('games'), { recursive: true });
  await fs.mkdir(fixture.path('gameshells'), { recursive: true });
  await fs.mkdir(fixture.path('health'), { recursive: true });

  await copyFileIfExists(path.join(REPO_ROOT, 'tools', 'game-doctor.mjs'), fixture.path('tools/game-doctor.mjs'));
  await copyFileIfExists(
    path.join(REPO_ROOT, 'tools', 'reporters', 'game-doctor-manifest.json'),
    fixture.path('tools/reporters/game-doctor-manifest.json'),
  );
  await copyFileIfExists(
    path.join(REPO_ROOT, 'assets', 'placeholder-thumb.png'),
    fixture.path('assets/placeholder-thumb.png'),
  );
  await writeFixtureSchema(fixture);

  await ensureNodeModulesSymlink(fixture.root);

  return fixture;
}
