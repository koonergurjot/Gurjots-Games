import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

class CodeDoctorFixture {
  constructor(root) {
    this.root = root;
    this.codeDoctorPath = this.path('tools/code-doctor.mjs');
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

  async readJson(relativePath) {
    const absolutePath = this.path(relativePath);
    const raw = await fs.readFile(absolutePath, 'utf8');
    return JSON.parse(raw);
  }

  async runDoctor(args = [], { env = {} } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [this.codeDoctorPath, ...args], {
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

export async function createCodeDoctorFixture(name = 'fixture') {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), `code-doctor-${name}-`));
  const fixture = new CodeDoctorFixture(tmpRoot);

  await fs.mkdir(fixture.path('tools'), { recursive: true });
  await fs.mkdir(fixture.path('health'), { recursive: true });

  await fs.copyFile(path.join(REPO_ROOT, 'tools', 'code-doctor.mjs'), fixture.path('tools/code-doctor.mjs'));

  try {
    await fs.symlink(path.join(REPO_ROOT, 'node_modules'), fixture.path('node_modules'), 'dir');
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }

  return fixture;
}
