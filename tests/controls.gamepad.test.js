import { standardAxesToDir } from '../shared/controls.js';

test('deadzone', () => {
  const pad = { axes: [0.1, 0.05] };
  expect(standardAxesToDir(pad)).toEqual({ dx:0, dy:0 });
});
