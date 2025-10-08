import { afterEach, describe, expect, it } from 'vitest';
import { createCodeDoctorFixture } from './fixtures/code-doctor-fixture.mjs';

describe('tools/code-doctor.mjs', () => {
  let fixture;

  afterEach(async () => {
    if (fixture) {
      await fixture.cleanup();
      fixture = null;
    }
  });

  it('builds a graph of relative imports and reports shortest cycle paths', async () => {
    fixture = await createCodeDoctorFixture('circular');

    await fixture.writeJson('package.json', {
      name: 'code-doctor-circular-fixture',
      version: '1.0.0',
    });

    await fixture.writeFile(
      'src/a.js',
      ["import './b.js';", "import './d.js';", ''].join('\n'),
    );
    await fixture.writeFile('src/b.js', "import './c.js';\n");
    await fixture.writeFile('src/c.js', "import './a.js';\n");
    await fixture.writeFile('src/d.js', "import './e.js';\n");
    await fixture.writeFile('src/e.js', "import './f.js';\n");
    await fixture.writeFile('src/f.js', "import './a.js';\n");
    await fixture.writeFile('src/self.js', "import './self.js';\n");

    const result = await fixture.runDoctor();

    expect(result.code).toBe(1);
    expect(result.stderr.trim()).toBe('');

    const report = await fixture.readJson('health/code-report.json');
    const circular = report.checks.circular;

    expect(circular.status).toBe('failed');
    expect(circular.summary).toContain('2 circular dependencies detected');

    expect(circular.graph['src/a.js']).toEqual(['src/b.js', 'src/d.js']);
    expect(circular.graph['src/b.js']).toEqual(['src/c.js']);
    expect(circular.graph['src/c.js']).toEqual(['src/a.js']);
    expect(circular.graph['src/self.js']).toEqual(['src/self.js']);

    expect(circular.cycles).toEqual([
      ['src/a.js', 'src/b.js', 'src/c.js', 'src/a.js'],
      ['src/self.js', 'src/self.js'],
    ]);

    const messages = circular.issues.map((issue) => issue.message);
    expect(messages).toContain('src/a.js -> src/b.js -> src/c.js -> src/a.js');
    expect(messages).toContain('src/self.js -> src/self.js');
    expect(messages).not.toContain('src/a.js -> src/d.js -> src/e.js -> src/f.js -> src/a.js');
  });
});
