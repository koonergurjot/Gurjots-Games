/* @vitest-environment jsdom */
import { test, expect, vi } from 'vitest';
import { createSceneManager } from '../src/engine/scenes.js';

test('scene input handlers can fall back when returning false', async () => {
  const manager = createSceneManager();
  const directHandler = vi.fn(() => false);
  const fallbackHandler = vi.fn(() => true);
  await manager.push({
    input: {
      pause: directHandler,
    },
    handleInput: fallbackHandler,
  });

  const handled = manager.handle('pause');

  expect(directHandler).toHaveBeenCalledTimes(1);
  expect(fallbackHandler).toHaveBeenCalledTimes(1);
  expect(handled).toBe(true);
});
