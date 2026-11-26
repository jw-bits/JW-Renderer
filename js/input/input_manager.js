"use strict";

/*
    InputManager - Mouse, touch and keyboard input, turned into taps, drags,
    swipes and key events (see input_defines.js) and handed to listeners once
    per frame.

    The browser's events are queued as they arrive and handled in update(),
    so listeners always run at the same point in the frame, in the order the
    input happened.

    Pointer: mouse button 0, one finger or a pen; while one is pressed, others
    are ignored (no multi-touch). A press becomes:
        - kTap      if released within the tap time without moving past the tap distance.
        - a drag    once it's held longer than the tap time or moves past the tap distance.
                    kDrag is sent every frame while it's held (delta may be 0).
        - kSwipe    if a drag is released within the swipe time, at least the swipe distance
                    from where it started. It ends the drag instead of kDragEnd.
        - kDragEnd  when any other drag is released, or the browser cancels the press.
    Distances are in CSS pixels, so they're about the same physical size on any screen.

    Keyboard: kKeyDown / kKeyUp events, plus key state for this frame by KeyboardEvent.code.

    Usage:
        InputManager.init();                   // After WGLV.init(); listens on WGLV's canvas
        InputManager.addListener(obj);         // obj.onInputEvent(inputEvent) returns true if it used it

        // Each frame, before updating the game
        InputManager.update();                 // Sends this frame's events to the listeners

        if (InputManager.wasKeyPressed(KeyCode.kSpace)) ...
        if (InputManager.hasPosition()) hover(InputManager.getPosition());

    Listeners are held strongly; always remove them (removeListener()).
*/
class InputManager
{
    // Queued browser input
    static #kRecordDown = 0;
    static #kRecordMove = 1;
    static #kRecordUp = 2;
    static #kRecordCancel = 3;
    static #kRecordLeave = 4;
    static #kRecordKeyDown = 5;
    static #kRecordKeyUp = 6;
    static #kRecordReset = 7; // The window lost focus; release everything

    static #element = null;
    static #domHandlers = [];       // [target, type, handler], to remove in shutdown()
    static #queue = [];             // Filled by the browser's events
    static #processing = [];        // Swapped with #queue in update()

    static #listeners = new Set();
    static #event = new InputEvent(); // Reused for every event

    static #tapMaxTime = 0.25;      // Seconds
    static #tapMaxDistance = 10.0;  // CSS pixels
    static #swipeMinDistance = 60.0; // CSS pixels
    static #swipeMaxTime = 0.35;    // Seconds

    // The pressed pointer
    static #pointerId = -1;         // -1 while nothing's pressed
    static #device = InputDevice.kNone; // Of the last pointer used
    static #isDragging = false;
    static #pressTime = 0.0;        // Seconds, same clock as performance.now()
    static #pressClient = new Vector2(); // CSS pixels
    static #client = new Vector2();
    static #pressPosition = new Vector2(); // Design units
    static #position = new Vector2();
    static #reported = new Vector2(); // Position when the last kDrag was sent
    static #hasPosition = false;

    // This frame
    static #wasPressed = false;
    static #wasReleased = false;
    static #keysHeld = new Set();
    static #keysPressed = new Set();
    static #keysReleased = new Set();

    /*
        Starts listening. Pointer input comes from element (WGLV's canvas by default),
        keys from the window. Positions are converted through WGLV's view.
        Returns false if already initialized or there's no element.
    */
    static init(element = null)
    {
        if (InputManager.#element !== null)
            return false; // Already initialized

        const target = element ?? WGLV.context?.canvas ?? null;

        if (target == null)
        {
            console.error("InputManager.init() needs an element, or WGLV initialized first");
                return false;
        }

        // Touches go to the game: no scrolling, zooming, text selection or long-press menu
        target.style.touchAction = "none";
        target.style.userSelect = "none";
        target.style.webkitUserSelect = "none";
        target.style.webkitTouchCallout = "none";

        const add = (t, type, handler) => {
            t.addEventListener(type, handler);
            InputManager.#domHandlers.push([t, type, handler]);
        };

        add(target, "pointerdown", (e) => {
            if (e.pointerType === "mouse" && e.button !== 0)
                return; // Left button only

            try { target.setPointerCapture(e.pointerId); } catch {} // Keep getting its events outside the element
            InputManager.#queuePointer(InputManager.#kRecordDown, e);
        });

        add(target, "pointermove", (e) => InputManager.#queuePointer(InputManager.#kRecordMove, e));
        add(target, "pointerup", (e) => InputManager.#queuePointer(InputManager.#kRecordUp, e));
        add(target, "pointercancel", (e) => InputManager.#queuePointer(InputManager.#kRecordCancel, e));
        add(target, "pointerleave", (e) => InputManager.#queuePointer(InputManager.#kRecordLeave, e));
        add(target, "contextmenu", (e) => e.preventDefault());

        add(window, "keydown", (e) => InputManager.#queueKey(InputManager.#kRecordKeyDown, e));
        add(window, "keyup", (e) => InputManager.#queueKey(InputManager.#kRecordKeyUp, e));
        add(window, "blur", () => InputManager.#queue.push({ kind: InputManager.#kRecordReset }));

        InputManager.#element = target;
            return true;
    }

    // Stops listening and forgets all input state and listeners
    static shutdown()
    {
        for (const [t, type, handler] of InputManager.#domHandlers)
            t.removeEventListener(type, handler);

        InputManager.#domHandlers = [];
        InputManager.#queue.length = 0;
        InputManager.#listeners.clear();
        InputManager.#releasePointer(false);
        InputManager.#keysHeld.clear();
        InputManager.#keysPressed.clear();
        InputManager.#keysReleased.clear();
        InputManager.#wasPressed = false;
        InputManager.#wasReleased = false;
        InputManager.#element = null;
    }

    // listener needs an onInputEvent(inputEvent) method that returns true if it used the event
    static addListener(listener)
    {
        if (typeof listener?.onInputEvent !== "function")
        {
            console.error("InputManager.addListener() needs an object with an onInputEvent(inputEvent) method");
                return false;
        }

        InputManager.#listeners.add(listener); // Listeners are called in the order they were added
            return true;
    }

    static removeListener(listener)
    {
        InputManager.#listeners.delete(listener);
    }

    // Seconds and CSS pixels: a tap is released within maxTime, moving no more than maxDistance
    static setTapLimits(maxTime, maxDistance)
    {
        if (maxTime <= 0.0 || maxDistance < 0.0)
        {
            console.error(`InputManager.setTapLimits() needs maxTime > 0 and maxDistance >= 0, got ${maxTime}, ${maxDistance}`);
                return false;
        }

        InputManager.#tapMaxTime = maxTime;
        InputManager.#tapMaxDistance = maxDistance;
            return true;
    }

    // CSS pixels and seconds: a swipe covers at least minDistance and is released within maxTime
    static setSwipeLimits(minDistance, maxTime)
    {
        if (minDistance <= 0.0 || maxTime <= 0.0)
        {
            console.error(`InputManager.setSwipeLimits() needs minDistance > 0 and maxTime > 0, got ${minDistance}, ${maxTime}`);
                return false;
        }

        InputManager.#swipeMinDistance = minDistance;
        InputManager.#swipeMaxTime = maxTime;
            return true;
    }

    static getTapMaxTime() { return InputManager.#tapMaxTime; }
    static getTapMaxDistance() { return InputManager.#tapMaxDistance; }
    static getSwipeMinDistance() { return InputManager.#swipeMinDistance; }
    static getSwipeMaxTime() { return InputManager.#swipeMaxTime; }

    /*
        Call once per frame, before anything reads input. Handles the input queued
        since the last call, in order, sending its events to the listeners, then
        sends kDrag if a drag is held.
    */
    static update()
    {
        if (InputManager.#element === null)
            return;

        InputManager.#wasPressed = false;
        InputManager.#wasReleased = false;
        InputManager.#keysPressed.clear();
        InputManager.#keysReleased.clear();

        // Swap, so input arriving while listeners run waits for the next frame
        const records = InputManager.#queue;
        InputManager.#queue = InputManager.#processing;
        InputManager.#processing = records;

        for (const r of records)
        {
            switch (r.kind)
            {
                case InputManager.#kRecordDown: InputManager.#onDown(r); break;
                case InputManager.#kRecordMove: InputManager.#onMove(r); break;
                case InputManager.#kRecordUp: InputManager.#onUp(r); break;
                case InputManager.#kRecordCancel: InputManager.#onCancel(r); break;
                case InputManager.#kRecordLeave: InputManager.#onLeave(r); break;
                case InputManager.#kRecordKeyDown: InputManager.#onKeyDown(r); break;
                case InputManager.#kRecordKeyUp: InputManager.#onKeyUp(r); break;
                case InputManager.#kRecordReset: InputManager.#onReset(); break;
            }
        }

        records.length = 0;

        if (InputManager.#pointerId === -1)
            return;

        // A press held longer than a tap is a drag, moving or not
        const now = performance.now() * MathDefines.kSecondsPerMs;

        if (InputManager.#isDragging === false && (now - InputManager.#pressTime) > InputManager.#tapMaxTime)
            InputManager.#isDragging = true;

        if (InputManager.#isDragging === true)
            InputManager.#sendPointer(InputEventType.kDrag, now);
    }

    // *** Pointer state ***

    static isPointerDown() { return (InputManager.#pointerId !== -1); }
    static wasPointerPressed() { return InputManager.#wasPressed; }   // This frame
    static wasPointerReleased() { return InputManager.#wasReleased; } // This frame
    static isDragging() { return InputManager.#isDragging; }
    static getDevice() { return InputManager.#device; } // Of the last pointer used

    // True while the mouse is over the element, or a finger / pen is pressed. Use it for hover.
    static hasPosition() { return InputManager.#hasPosition; }

    // The pointer's last position in design units; don't change it, copy it to keep it
    static getPosition() { return InputManager.#position; }

    // *** Key state, by KeyboardEvent.code (see KeyCode) ***

    static isKeyHeld(code) { return InputManager.#keysHeld.has(code); }
    static wasKeyPressed(code) { return InputManager.#keysPressed.has(code); }   // This frame; not repeats
    static wasKeyReleased(code) { return InputManager.#keysReleased.has(code); } // This frame

    // *** Internal Methods ***

    static #deviceOf(pointerType)
    {
        switch (pointerType)
        {
            case "mouse": return InputDevice.kMouse;
            case "pen": return InputDevice.kPen;
            default: return InputDevice.kTouch;
        }
    }

    static #queuePointer(kind, e)
    {
        let queue = InputManager.#queue;
        const last = (queue.length > 0) ? queue[queue.length - 1] : null;

        // Moves in a row only need the latest, which keeps the queue short between frames
        if (kind === InputManager.#kRecordMove && last !== null && last.kind === kind && last.id === e.pointerId)
        {
            last.x = e.clientX;
            last.y = e.clientY;
            last.time = e.timeStamp * MathDefines.kSecondsPerMs;
                return;
        }

        queue.push({
            kind: kind,
            id: e.pointerId,
            device: InputManager.#deviceOf(e.pointerType),
            x: e.clientX,
            y: e.clientY,
            time: e.timeStamp * MathDefines.kSecondsPerMs
        });
    }

    static #queueKey(kind, e)
    {
        InputManager.#queue.push({ kind: kind, code: e.code, key: e.key, repeat: e.repeat });
    }

    static #setPosition(r)
    {
        const p = WGLV.clientToView(r.x, r.y);
        InputManager.#position.set(p);
        InputManager.#client.set(r);
    }

    // CSS pixels from the press
    static #distanceFromPress()
    {
        const dx = InputManager.#client.x - InputManager.#pressClient.x;
        const dy = InputManager.#client.y - InputManager.#pressClient.y;
            return Math.sqrt((dx * dx) + (dy * dy));
    }

    static #onDown(r)
    {
        if (InputManager.#pointerId !== -1)
            return; // Another pointer is already pressed

        InputManager.#pointerId = r.id;
        InputManager.#device = r.device;
        InputManager.#isDragging = false;
        InputManager.#pressTime = r.time;
        InputManager.#setPosition(r);
        InputManager.#pressClient.set(r);
        InputManager.#pressPosition.set(InputManager.#position);
        InputManager.#reported.set(InputManager.#position);
        InputManager.#hasPosition = true;
        InputManager.#wasPressed = true;
    }

    static #onMove(r)
    {
        if (InputManager.#pointerId === -1)
        {
            if (r.device === InputDevice.kTouch)
                return; // Not pressed

            // Hover
            InputManager.#device = r.device;
            InputManager.#setPosition(r);
            InputManager.#hasPosition = true;
                return;
        }

        if (r.id !== InputManager.#pointerId)
            return;

        InputManager.#setPosition(r);

        if (InputManager.#isDragging === false && InputManager.#distanceFromPress() > InputManager.#tapMaxDistance)
            InputManager.#isDragging = true;
    }

    static #onUp(r)
    {
        if (r.id !== InputManager.#pointerId)
            return;

        InputManager.#setPosition(r);

        const duration = r.time - InputManager.#pressTime;
        const distance = InputManager.#distanceFromPress();

        if (InputManager.#isDragging === false && duration <= InputManager.#tapMaxTime && distance <= InputManager.#tapMaxDistance)
            InputManager.#sendPointer(InputEventType.kTap, r.time);
        else if (duration <= InputManager.#swipeMaxTime && distance >= InputManager.#swipeMinDistance)
            InputManager.#sendPointer(InputEventType.kSwipe, r.time);
        else
            InputManager.#sendPointer(InputEventType.kDragEnd, r.time);

        InputManager.#releasePointer(r.device !== InputDevice.kTouch); // A mouse (or hovering pen) is still over the element
    }

    // The browser took the press (e.g. a system gesture); end any drag without a tap or swipe
    static #onCancel(r)
    {
        if (r.id !== InputManager.#pointerId)
            return;

        if (InputManager.#isDragging === true)
            InputManager.#sendPointer(InputEventType.kDragEnd, r.time);

        InputManager.#releasePointer(false);
    }

    static #onLeave(r)
    {
        if (InputManager.#pointerId === -1 && r.device !== InputDevice.kTouch)
            InputManager.#hasPosition = false;
    }

    static #releasePointer(keepPosition)
    {
        if (InputManager.#pointerId !== -1)
            InputManager.#wasReleased = true;

        InputManager.#pointerId = -1;
        InputManager.#isDragging = false;
        InputManager.#hasPosition = keepPosition;
    }

    static #onKeyDown(r)
    {
        if (r.repeat === false && InputManager.#keysHeld.has(r.code) === false)
        {
            InputManager.#keysHeld.add(r.code);
            InputManager.#keysPressed.add(r.code);
        }

        InputManager.#sendKey(InputEventType.kKeyDown, r.code, r.key, r.repeat);
    }

    static #onKeyUp(r)
    {
        InputManager.#keysHeld.delete(r.code);
        InputManager.#keysReleased.add(r.code);
        InputManager.#sendKey(InputEventType.kKeyUp, r.code, r.key, false);
    }

    // Keys and presses get no up event once the window loses focus, so release them now
    static #onReset()
    {
        for (const code of Array.from(InputManager.#keysHeld))
            InputManager.#onKeyUp({ code: code, key: "" });

        if (InputManager.#pointerId !== -1)
        {
            if (InputManager.#isDragging === true)
                InputManager.#sendPointer(InputEventType.kDragEnd, performance.now() * MathDefines.kSecondsPerMs);

            InputManager.#releasePointer(false);
        }
    }

    static #sendPointer(type, time)
    {
        let e = InputManager.#event;
        const pos = InputManager.#position;
        const start = InputManager.#pressPosition;

        e.type = type;
        e.device = InputManager.#device;
        e.position.set(pos);
        e.startPosition.set(start);
        e.duration = time - InputManager.#pressTime;
        e.code = "";
        e.key = "";
        e.isRepeat = false;

        switch (type)
        {
            case InputEventType.kTap: e.delta.setXY(0.0, 0.0); break;
            case InputEventType.kSwipe: e.delta.setXY(pos.x - start.x, pos.y - start.y); break;

            default: // kDrag, kDragEnd
            {
                e.delta.setXY(pos.x - InputManager.#reported.x, pos.y - InputManager.#reported.y);
                InputManager.#reported.set(pos);
            }
            break;
        }

        InputManager.#dispatch();
    }

    static #sendKey(type, code, key, isRepeat)
    {
        let e = InputManager.#event;

        e.type = type;
        e.device = InputDevice.kKeyboard;
        e.position.set(InputManager.#position);
        e.startPosition.set(InputManager.#position);
        e.delta.setXY(0.0, 0.0);
        e.duration = 0.0;
        e.code = code;
        e.key = key;
        e.isRepeat = isRepeat;

        InputManager.#dispatch();
    }

    static #dispatch()
    {
        let e = InputManager.#event;
        e.hasBeenConsumed = false;

        // A copy, so listeners can add or remove listeners while being called
        for (const listener of Array.from(InputManager.#listeners))
        {
            if (InputManager.#listeners.has(listener) === false)
                continue; // Removed by an earlier listener

            if (listener.onInputEvent(e) === true)
                e.hasBeenConsumed = true;
        }
    }
}
