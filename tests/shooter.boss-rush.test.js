import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { BossRushMode } from '../games/shooter/shooter.js';
import { ShooterUI } from '../games/shooter/ui.js';

describe('BossRushMode', () => {
  let bossRush;

  beforeEach(() => {
    bossRush = new BossRushMode(
      [
        { type: 'overseer', name: 'One', hpMultiplier: 1 },
        { type: 'overseer', name: 'Two', hpMultiplier: 1 },
      ],
      { intermissionDuration: 0, initialDelay: 0 }
    );
    bossRush.start();
  });

  it('tracks total timer across ticks', () => {
    bossRush.tick(0.5);
    bossRush.tick(1.25);
    bossRush.tick(0.05);
    expect(bossRush.getTimer()).toBeCloseTo(1.8, 5);
  });

  it('resets perfect wave flag each stage', () => {
    expect(bossRush.shouldSpawnBoss()).toBe(true);
    bossRush.startNextStage();
    bossRush.recordPlayerDamage();
    const first = bossRush.completeStage();
    expect(first.perfect).toBe(false);
    expect(first.runComplete).toBe(false);

    expect(bossRush.shouldSpawnBoss()).toBe(true);
    bossRush.startNextStage();
    const second = bossRush.completeStage();
    expect(second.perfect).toBe(true);
    expect(second.runComplete).toBe(true);
    expect(bossRush.getPerfectWaveCount()).toBe(1);
  });
});

describe('ShooterUI', () => {
  it('renders wave and timer stats', () => {
    const dom = new JSDOM('<div class="hud"></div>');
    const { document } = dom.window;
    const ui = new ShooterUI({ document, totalBosses: 5 });
    ui.setWave(2, 5, 'Sentinel');
    ui.setTimer(125.7);

    const waveValue = document.querySelector('.hud__stat--wave .hud__stat-value');
    const timerValue = document.querySelector('.hud__stat--timer .hud__stat-value');

    expect(waveValue?.textContent).toBe('2/5');
    expect(waveValue?.title).toBe('Sentinel');
    expect(timerValue?.textContent).toBe('2:05');
  });
});
