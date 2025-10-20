import { describe, expect, it, vi } from 'vitest';
import { scaleCanvas } from '../games/common/canvas.js';

function createCanvas(options = {}) {
  const {
    getContext,
  } = options;

  const base = {
    style: {},
    dataset: {},
    width: 0,
    height: 0,
    parentElement: null,
    ownerDocument: { defaultView: undefined },
  };

  if (typeof getContext === 'function') {
    base.getContext = getContext;
  }

  return Object.assign(base, options);
}

describe('scaleCanvas', () => {
  it('skips the native getContext when the environment lacks CanvasRenderingContext2D', () => {
    const getContext = vi.fn(() => {
      throw new Error('Not implemented');
    });
    const defaultView = {
      CanvasRenderingContext2D: undefined,
      HTMLCanvasElement: { prototype: { getContext } },
    };
    const canvas = createCanvas({ getContext, ownerDocument: { defaultView } });

    expect(() => scaleCanvas(canvas)).not.toThrow();
    expect(getContext).not.toHaveBeenCalled();

    expect(() => scaleCanvas(canvas)).not.toThrow();
    expect(getContext).not.toHaveBeenCalled();
  });

  it('stops retrying getContext after a runtime failure', () => {
    const error = new Error('boom');
    const getContext = vi.fn(() => {
      throw error;
    });
    const defaultView = {
      CanvasRenderingContext2D: function CanvasRenderingContext2D() {},
      HTMLCanvasElement: { prototype: { getContext } },
    };
    const canvas = createCanvas({ getContext, ownerDocument: { defaultView } });

    expect(() => scaleCanvas(canvas)).not.toThrow();
    expect(getContext).toHaveBeenCalledTimes(1);

    expect(() => scaleCanvas(canvas)).not.toThrow();
    expect(getContext).toHaveBeenCalledTimes(1);
  });

  it('retries getContext when it succeeds', () => {
    const ctx = { setTransform: vi.fn() };
    const getContext = vi.fn(() => ctx);
    const defaultView = {
      CanvasRenderingContext2D: function CanvasRenderingContext2D() {},
      HTMLCanvasElement: { prototype: { getContext } },
      devicePixelRatio: 1,
    };
    const canvas = createCanvas({ getContext, ownerDocument: { defaultView } });

    const first = scaleCanvas(canvas);
    expect(first.width).toBeGreaterThan(0);
    expect(getContext).toHaveBeenCalledTimes(1);

    const second = scaleCanvas(canvas);
    expect(second.width).toBeGreaterThan(0);
    expect(getContext).toHaveBeenCalledTimes(2);
  });
});
