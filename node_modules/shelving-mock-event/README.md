# Event mock

[![Build Status](https://travis-ci.org/dhoulb/shelving-mock-event.svg?branch=master)](https://travis-ci.org/dhoulb/shelving-mock-event)

Fully unit tested mock implementation of the browser Event API. Conforms as closely as possible to [Event](https://developer.mozilla.org/en-US/docs/Web/API/Event).

Mocked Event and EventTarget classes that conform to browser's Event API. Can be used to simulate events in server-side code for testing, or in other places where browser APIs are not available. 

Supports the following functionality:

- Event listeners, e.g. `addEventListener()` and `removeEventListener()`
- Event handlers, e.g. `target.onclick = function()`
- Event dispatch, e.g. `dispatchEvent()`
- Parent heirarchy with bubbling (and capturing) like DOM elements
- Stopping propagation with `stopPropagation()` and `stopImmediatePropagation()`
- Preventing default with `preventDefault()`

## Examples

### Create an event target and dispatch events on it

This full example shows how you would create an `EventTarget` (with a parent `EventTarget` that events will bubble up to), and dispatch an `Event` on that target:

```js
import { Event, EventTarget } from 'shelving-mock-event';

// Create targets.

	// Create a parent target.
	const parent = new EventTarget();

	// Create a target and pass in the parent target.
	// Allow `onclick` handler on the target.
	const target = new EventTarget(parent, ['click']); 

// Attach event listeners/handlers.
// Will be called in this order (as-per the event capturing/bubbling model).

	// Add event listener on parent.
	// Called during capturing phase, i.e. BEFORE listeners on the target.
	parent.addEventListener('click', () => { console.log('Called 1'); }, true);

	// Add event handler on target.
	target.onclick = (e) => { console.log('Called 2'); }
	
	// Add event listener on target.
	target.addEventListener('click', () => { console.log('Called 3'); });
	
	// Add event listener on parent target.
	// Called during bubbling phase, i.e. AFTER listeners on the target.
	parentTarget.addEventListener('click', () => { console.log('Called 5'); });

// Fire the event on the target.
target.dispatchEvent(new Event('click', { bubbles: true }));
```

### Creating a custom event targets

`EventTarget` is not normally used directly, but is implemented by a specific class. Javascript ES6 classes make this easy as you can simply extend `EventTarget`:

```js
// Create a custom Javascript class.
class MyThing extends EventTarget
{
	// Construct.
	constructor(parent)
	{
		// Call super() to initialise this.
		// Pass through any parent element.
		// Initialise `onclick` and `onboom` properties.
		super(parent, ['click', 'boom']);
	}
}

// Make a new MyThing.
const thing = new MyThing();

// Add a handler on the thing.
thing.onboom = () => { console.log('Called handler!'); }

// Add a listener on the thing.
thing.addEventListener('boom', () => { console.log('Called listener!'); });

// Dispatch event.
thing.dispatchEvent(new Event('boom'));
```

## API

### Event

`new Event(type, { bubbles = false, cancelable = false })`  
Create a new event that can be dispatched on an event target. Conforms to the [Event](https://developer.mozilla.org/en-US/docs/Web/API/Event) interface.

- `type` (string)  
	The name of the event, e.g. `'click'`, `'blur'` or `'my-custom-event'`

- `bubbles` (boolean)  
	Whether the event should bubble up to the parent EventTarget when dispatched. The default is `false`

- `cancellable` (boolean)  
	Whether the event can be cancelled. The default is `false`

#### Properties

- `Event.type` (string)  
	The name of the event, e.g. `'click'`, `'blur'` or `'my-custom-event'` (matches what was passed in to the constructor. Read only.

- `Event.cancellable` (boolean)  
	Whether this event can be cancelled or not (matches what was passed in to the constructor). Read only.

- `Event.bubbles` (boolean)  
	Whether this event will bubble or not (matches what was passed in to the constructor). Read only.

- `Event.target` (boolean)  
	A reference to the original event target the event was called on. Read only.

- `Event.currentTarget` (boolean)  
	A reference to the current target that this event is firing on. Read only. 

- `Event.eventPhase` (constant)  
	The current phase of the event. Read only. Will be one of the following: 
	
	- `Event.NONE`
	- `Event.CAPTURING_PHASE`
	- `Event.AT_TARGET`
	- `Event.BUBBLING_PHASE`

- `Event.timeStamp` (number)  
	The time this event was created, in milliseconds. Read only.

- `Event.defaultPrevented` (boolean)  
	Whether or not `Event.preventDefault()` has been called on the event. Read only.

#### Methods

- `Event.preventDefault()`  
	Cancels the event (if it is cancelable).

- `Event.stopPropagation()`  
	Stops the propagation (bubbling or capturing) of events on targets further along in the event dispatch order.

- `Event.stopImmediatePropagation()`  
	Stops the propagation (bubbling or capturing) of events on targets further along in the event dispatch order _and_ any further events on the current target.

### EventTarget

`new EventTarget(parent = undefined, handlers = [])`  
An object which can have events dispatched on it. Conforms to the [EventTarget](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget) interface.

- `parent` (EventTarget)  
	The parent element for this element that events will bubble up to (if specified)

- `handlers` (array of strings)  
	Allow event handlers on this target. Handlers that are not explicitly named in the constructor will not be called when an event is dispatched. Handlers must be functions. Do not include 'on' at the start of the handler name.

#### Properties

- `EventTarget.onclick` (function)  
	Set this property to a function to be called when an event is dispatched. Handler names must be explicitly specified in the constructor. If handler is not a function then `TypeError` will be thrown.

#### Methods

- `EventTarget.addEventListener(type, callback, capturing = false)`  
	Add an event listener to an event target. Event listeners are callback functions that are called when the named event is dispatched on the event target or one of its children.

	- `type` (string)  
		The name of the event to listen for, e.g. `'click'`, `'blur'` or `'my-custom-event'`

	- `callback` (function)  
		The callback function that gets called when `type` events are dispatched on this target. The callback function will receive the following arguments:

		- `event`  
			The `Event` object that was dispatched on the event target.

	- `capturing` (boolean)  
		Whether the listener should be attached to the capturing phase (before listeners on the target) or the bubbling phase (after listeners on the target). The default is `false` (bubbling phase).

- `EventTarget.removeEventListener(type, callback, capturing = false)`  
	Remove a specific event listener from an event target.

	- `type` (string)  
		The name of the event you wish to stop listening for, e.g. `'click'`, `'blur'` or `'my-custom-event'`

	- `callback` (function)  
		The callback function you wish to remove. Must be a reference to the same callback function that was added.

	- `capturing` (boolean)  
		Must match the `capturing` setting that was used when the event was added.