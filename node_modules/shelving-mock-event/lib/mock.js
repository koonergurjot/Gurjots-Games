'use strict';

/**
 * Event mock
 * Designed to be stricter than browser/DOM Event to uses of Event that don't exactly match the spec.
 *
 * @author Dave Houlbrooke <dave@shax.com>
 */
class Event
{
	// Construct.
	constructor(name, { bubbles = false, cancelable = false } = { bubbles: false, cancelable: false })
	{
		// Checks.
		if (typeof name !== 'string') throw new TypeError('Event: name must be string, not ' + name);
		if (typeof bubbles !== 'boolean') throw new TypeError('Event: bubbles must be boolean, not '  + bubbles);
		if (typeof cancelable !== 'boolean') throw new TypeError('Event: cancelable must be boolean, not ' + cancelable);

		// Vars.
		let eventPhase = Event.NONE;
		let target = null;
		let currentTarget = null;
		let defaultPrevented = false;
		let propagationStopped = false;
		let immediateStopped = false;

		// Properties.
		Object.defineProperty(this, 'type', { value: name, enumerable: true }); // Name/type of the event.
		Object.defineProperty(this, 'cancelable', { value: cancelable, enumerable: true }); // Whether this event bubbles.
		Object.defineProperty(this, 'bubbles', { value: bubbles, enumerable: true }); // Whether this event can have its default action prevented.
		Object.defineProperty(this, 'isTrusted', { value: false, enumerable: true }); // Not a trusted event, generally.
		Object.defineProperty(this, 'timeStamp', { value: Date.now(), enumerable: true }); // Time the event was created.
		Object.defineProperty(this, 'cancelBubble', {
			enumerable: true,
			get() { return propagationStopped; },
			set() { throw new Error('Event: cancelBubble is depreciated — use preventDefault() instead'); }
		});
		Object.defineProperty(this, 'eventPhase', {
			enumerable: true,
			get() { return eventPhase; },
			set(v) { if (v !== Event.NONE && v !== Event.CAPTURING_PHASE && v !== Event.AT_TARGET && v !== Event.BUBBLING_PHASE) throw new TypeError('Event: eventPhase must be one of the event capturing constants: Event.NONE, Event.CAPTURING_PHASE, Event.AT_TARGET, Event.BUBBLING_PHASE)'); eventPhase = v; }
		});
		Object.defineProperty(this, 'target', {
			enumerable: true,
			get() { return target; },
			set(v) { if (target) throw new Error('Event: target cannot be changed after it has been set'); if ((!(v instanceof Object) || typeof v.dispatchEvent !== 'function') && v !== null) throw new TypeError('Event: target must be an object implementing EventTarget or null'); target = v; }
		});
		Object.defineProperty(this, 'currentTarget', {
			enumerable: true,
			get() { return currentTarget; },
			set(v) { if ((!(v instanceof Object) || typeof v.dispatchEvent !== 'function') && v !== null) throw new TypeError('Event: currentTarget must be an object implementing EventTarget or null'); currentTarget = v; }
		});
		Object.defineProperty(this, 'defaultPrevented', {
			get() { return defaultPrevented; },
			set() { throw new Error('Event: Cannot set defaultPrevented directly — use preventDefault() instead'); }
		});
		Object.defineProperty(this, 'propagationStopped', {
			get() { return propagationStopped; },
			set() { throw new Error('Event: Cannot set propagationStopped directly — use stopPropagation() instead'); }
		});
		Object.defineProperty(this, 'immediateStopped', {
			get() { return immediateStopped; },
			set() { throw new Error('Event: Cannot set immediateStopped directly — use stopImmediatePropagation() instead'); }
		});

		// Methods.
		Object.defineProperty(this, 'preventDefault', { value: preventDefault });
		Object.defineProperty(this, 'stopPropagation', { value: stopPropagation });
		Object.defineProperty(this, 'stopImmediatePropagation', { value: stopImmediatePropagation });

		// Functions.
		function preventDefault() { if (cancelable) defaultPrevented = true; }
		function stopPropagation() { propagationStopped = true; }
		function stopImmediatePropagation() { immediateStopped = propagationStopped = true; }
	}
}

/**
 * EventTarget mock.
 * @author Dave Houlbrooke <dave@shax.com>
 */
class EventTarget
{
	// Construct.
	constructor(parent = null, handlerNames = [])
	{
		// Checks.
		if ((!(parent instanceof Object) || typeof parent.dispatchEvent !== 'function') && parent !== null) throw new TypeError('EventTarget: parent must be null or implement EventTarget');
		if (!(handlerNames instanceof Array)) throw new TypeError('EventTarget: handlerNames must be array, not ' + handlerNames);

		// Vars.
		const handlers = {};
		const listenersCapture = {};
		const listenersBubble = {};

		// Methods.
		Object.defineProperty(this, 'dispatchEvent', { value: dispatchEvent });
		Object.defineProperty(this, 'addEventListener', { value: addEventListener });
		Object.defineProperty(this, 'removeEventListener', { value: removeEventListener });

		// Allow an event _handler_ (e.g. this.onerror() etc) to be set on this EventTarget.
		// This is a convenience function that ensures the handler is a function.
		handlerNames.forEach((name) =>  {

			// Check.
			if (typeof name !== 'string') throw new TypeError('EventTarget: handlerNames must be array of strings, not ' + name);

			// Set to null.
			handlers[name] = null;

			// Add the handler's property.
			Object.defineProperty(this, 'on' + name, {
				get() { return handlers[name]; },
				set(handler) { if (typeof handler !== 'function' && handler !== null) throw new TypeError('on' + name + ': event handler can only be function or null'); handlers[name] = handler ? handler : null; }
			});

		});

		// Dispatch an event.
		function dispatchEvent(e)
		{
			// Checks.
			if (!(e instanceof Object) || !e.type) throw new TypeError('dispatchEvent(): event must be Event');

			// If phase is NONE, then we assume this is the actual dispatch.
			if (e.eventPhase === Event.NONE)
			{
				// Setup.
				e.target = this;

				// Capturing phase.
				e.eventPhase = Event.CAPTURING_PHASE;
				if (e.bubbles && parent) parent.dispatchEvent(e);

				// At phase.
				e.eventPhase = Event.AT_TARGET;
				e.currentTarget = this;
				if (!e.propagationStopped && listenersCapture[e.type]) for (let i = 0; i < listenersCapture[e.type].length; i++) if (!e.immediateStopped) listenersCapture[e.type][i].call(this, e);
				if (!e.propagationStopped && handlers[e.type]) handlers[e.type].call(this, e);
				if (!e.propagationStopped && listenersBubble[e.type]) for (let i = 0; i < listenersBubble[e.type].length; i++) if (!e.immediateStopped) listenersBubble[e.type][i].call(this, e);

				// Bubble phase.
				e.eventPhase = Event.BUBBLING_PHASE
				if (e.bubbles && parent) parent.dispatchEvent(e);

				// Reset.
				e.eventPhase = Event.NONE;
				e.currentTarget = null;

				// Return false if default was prevented, or true otherwise.
				return e.defaultPrevented ? false : true;
			}
			else if (e.eventPhase === Event.CAPTURING_PHASE)
			{
				// Capture up first.
				if (e.bubbles && parent) parent.dispatchEvent(e);

				// Capturing listeners.
				e.currentTarget = this;
				if (!e.propagationStopped && listenersCapture[e.type]) for (let i = 0; i < listenersCapture[e.type].length; i++) if (!e.immediateStopped) listenersCapture[e.type][i].call(this, e);
			}
			else if (e.eventPhase === Event.BUBBLING_PHASE)
			{
				// Handlers and bubbling listeners.
				e.currentTarget = this;
				if (!e.propagationStopped && handlers[e.type]) handlers[e.type].call(this, e);
				if (!e.propagationStopped && listenersBubble[e.type]) for (let i = 0; i < listenersBubble[e.type].length; i++) if (!e.immediateStopped) listenersBubble[e.type][i].call(this, e);

				// Bubble up last.
				if (e.bubbles && parent) parent.dispatchEvent(e);
			}
		}

		// Add an event listener.
		function addEventListener(name, listener, useCapture = false)
		{
			// Checks.
			if (typeof name !== 'string') throw new TypeError('addEventListener(): name must be string');
			if (typeof listener !== 'function') throw new TypeError('addEventListener(): listener must be a function');
			if (typeof useCapture !== 'boolean') throw new TypeError('addEventListener(): useCapture must be boolean');

			// Bubble or capture.
			if (useCapture)
			{
				// Make sure there's array and add it.
				if (!listenersCapture[name]) listenersCapture[name] = [];
				listenersCapture[name].push(listener);
			}
			else
			{
				// Make sure there's array and add it.
				if (!listenersBubble[name]) listenersBubble[name] = [];
				listenersBubble[name].push(listener);
			}
		}

		// Remove an event listener.
		function removeEventListener(name, listener, useCapture = false)
		{
			// Checks.
			if (typeof name !== 'string') throw new TypeError('removeEventListener(): name must be string');
			if (typeof listener !== 'function') throw new TypeError('removeEventListener(): listener must be a function');
			if (typeof useCapture !== 'boolean') throw new TypeError('removeEventListener(): useCapture must be boolean');

			// Bubble or capture.
			if (useCapture)
			{
				// Find it and remove it.
				if (listenersCapture[name])
				{
					const i = listenersCapture[name].indexOf(listener);
					if (i >= 0) listenersCapture[name].splice(i, 1);
				}
			}
			else
			{
				// Find it and remove it.
				if (listenersBubble[name])
				{
					const i = listenersBubble[name].indexOf(listener);
					if (i >= 0) listenersBubble[name].splice(i, 1);
				}
			}
		}
	}
}

// Constants.
Object.defineProperty(Event, 'NONE', { value: 0 });
Object.defineProperty(Event, 'CAPTURING_PHASE', { value: 1 });
Object.defineProperty(Event, 'AT_TARGET', { value: 2 });
Object.defineProperty(Event, 'BUBBLING_PHASE', { value: 3 });

// Exports.
module.exports.Event = Event;
module.exports.EventTarget = EventTarget;