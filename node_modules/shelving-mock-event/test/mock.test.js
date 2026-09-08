const { Event, EventTarget } = require('../lib/mock');

// Event tests.
test('Event mock: event handler works', () => {
	expect.assertions(1);
	const target = new EventTarget(null, ['boom']);
	const event = new Event('boom');
	target.onboom = e => { expect(e).toBe(event); }
	target.dispatchEvent(event);
});
test('Event mock: event listener works', () => {
	expect.assertions(1);
	const target = new EventTarget(null);
	const event = new Event('boom');
	target.addEventListener('boom', e => { expect(e).toBe(event); });
	target.dispatchEvent(event);
});
test('Event mock: event listeners capture and bubble in the correct order', () => {
	expect.assertions(30);
	const targetGrandParent = new EventTarget(null, ['boom']);
	const targetParent = new EventTarget(targetGrandParent, ['boom']);
	const target = new EventTarget(targetParent, ['boom']);
	const event = new Event('boom', { bubbles: true });
	let count = 1;
	targetGrandParent.addEventListener('boom', e => { expect(e).toBe(event); expect(count++).toBe(1); }, true);
	targetGrandParent.addEventListener('boom', e => { expect(e).toBe(event); expect(count++).toBe(2); }, true);
	targetParent.addEventListener('boom', e => { expect(e).toBe(event); expect(count++).toBe(3); }, true);
	targetParent.addEventListener('boom', e => { expect(e).toBe(event); expect(count++).toBe(4); }, true);
	target.addEventListener('boom', e => { expect(e).toBe(event); expect(count++).toBe(5); }, true);
	target.addEventListener('boom', e => { expect(e).toBe(event); expect(count++).toBe(6); }, true);
	target.onboom = e => { expect(e).toBe(event); expect(count++).toBe(7); };
	target.addEventListener('boom', e => { expect(e).toBe(event); expect(count++).toBe(8); });
	target.addEventListener('boom', e => { expect(e).toBe(event); expect(count++).toBe(9); });
	targetParent.onboom = e => { expect(e).toBe(event); expect(count++).toBe(10); };
	targetParent.addEventListener('boom', e => { expect(e).toBe(event); expect(count++).toBe(11); });
	targetParent.addEventListener('boom', e => { expect(e).toBe(event); expect(count++).toBe(12); });
	targetGrandParent.onboom = e => { expect(e).toBe(event); expect(count++).toBe(13); };
	targetGrandParent.addEventListener('boom', e => { expect(e).toBe(event); expect(count++).toBe(14); });
	targetGrandParent.addEventListener('boom', e => { expect(e).toBe(event); expect(count++).toBe(15); });
	target.dispatchEvent(event);
});
test('Event mock: event cancelable defaults to false', () => {
	expect(new Event('boom').cancelable).toBe(false);
	expect(new Event('boom', { bubbles: true }).cancelable).toBe(false);
});
test('Event mock: event bubbles defaults to false', () => {
	expect(new Event('boom').bubbles).toBe(false);
	expect(new Event('boom', { cancelable: true }).bubbles).toBe(false);
});
test('Event mock: dispatchEvent() returns true', () => {
	const target = new EventTarget(null);
	const event = new Event('boom');
	expect(target.dispatchEvent(event)).toBe(true);
});
test('Event mock: dispatchEvent() returns false if preventDefault() is called and event is cancelable', () => {
	const target = new EventTarget(null);
	const event = new Event('boom', { cancelable: true });
	const prevent = jest.fn(e => { e.preventDefault(); });
	target.addEventListener('boom', prevent);
	expect(target.dispatchEvent(event)).toBe(false);
	expect(prevent).toHaveBeenCalled();
});
test('Event mock: dispatchEvent() returns true if preventDefault() is called but event is not cancelable and ', () => {
	const target = new EventTarget(null);
	const event = new Event('boom', { cancelable: false });
	const prevent = jest.fn(e => { e.preventDefault(); });
	target.addEventListener('boom', prevent);
	expect(target.dispatchEvent(event)).toBe(true);
	expect(prevent).toHaveBeenCalled();
});
test('Event mock: stopPropagation() stops future listeners', () => {
	const targetParent = new EventTarget(null, ['boom']);
	const target = new EventTarget(targetParent, ['boom']);
	const event = new Event('boom', { bubbles: true });
	const callback = jest.fn();
	const stop = jest.fn(e => { e.stopPropagation(); });
	targetParent.addEventListener('boom', callback, true); // Called.
	targetParent.addEventListener('boom', stop, true);
	targetParent.addEventListener('boom', callback, true); // Still called (immediate not stopped).
	target.addEventListener('boom', callback, true); // Not called.
	target.onboom = callback; // Not called.
	target.addEventListener('boom', callback); // Not called.
	targetParent.onboom = callback; // Not called.
	targetParent.addEventListener('boom', callback); // Not called.
	target.dispatchEvent(event); // Not called.
	expect(callback).toHaveBeenCalledTimes(2);
	expect(stop).toHaveBeenCalled();
});
test('Event mock: stopImmediatePropagation() stops future listeners', () => {
	const targetParent = new EventTarget(null, ['boom']);
	const target = new EventTarget(targetParent, ['boom']);
	const event = new Event('boom', { bubbles: true });
	const callback = jest.fn();
	const stop = jest.fn(e => { e.stopImmediatePropagation(); });
	targetParent.addEventListener('boom', callback, true); // Called.
	targetParent.addEventListener('boom', stop, true);
	targetParent.addEventListener('boom', callback, true); // Not called.
	target.addEventListener('boom', callback, true); // Not called.
	target.onboom = callback; // Not called.
	target.addEventListener('boom', callback); // Not called.
	targetParent.onboom = callback; // Not called.
	targetParent.addEventListener('boom', callback); // Not called.
	target.dispatchEvent(event);
	expect(callback).toHaveBeenCalledTimes(1);
	expect(stop).toHaveBeenCalled();
});
test('Event mock: Can get handlers after they have been set', () => {
	const target = new EventTarget(null, ['boom']);
	const handler = jest.fn();
	target.onboom = handler;
	expect(target.onboom).toBe(handler);
	target.onboom = null;
	expect(target.onboom).toBe(null);
});
test('Event mock: Can remove/unset handlers and listeners', () => {
	const target = new EventTarget(null, ['boom']);
	const event = new Event('boom');
	const handler = jest.fn();
	const listener = jest.fn();
	target.onboom = handler;
	target.onboom = null;
	target.addEventListener('boom', listener);
	target.removeEventListener('boom', listener);
	target.dispatchEvent(event);
	expect(handler).not.toHaveBeenCalled();
	expect(listener).not.toHaveBeenCalled();
});