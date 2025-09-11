import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Smoke test to ensure the Pong game loads without console errors
// and responds to basic controls.
test('pong loads and responds to controls', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  const gamePath = path.resolve(__dirname, '../../games/pong/index.html');
  await page.goto('file://' + gamePath);

  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    try {
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return Array.from(data).some(v => v !== 0);
    } catch {
      return false;
    }
  });

  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');

  expect(errors).toEqual([]);
});
