"use strict";

/*
    Input types shared by InputManager and its listeners.

    Positions are in design units with +Y up (see WGLV.clientToView()), the
    same space everything is drawn in. Points over the bars around the view
    land outside 0..WGLV.getWidth() / 0..WGLV.getHeight().
*/

class InputEventType
{
    static kNone = -1;

    // Pointer (mouse button 0, a finger or a pen)
    static kTap = 0;      // Pressed and released quickly without moving
    static kDrag = 1;     // Sent every frame while a drag is held
    static kDragEnd = 2;  // Released after dragging
    static kSwipe = 3;    // Released after a fast, long enough drag; ends the drag instead of kDragEnd

    // Keyboard
    static kKeyDown = 4;  // Also sent for key repeats (see InputEvent.isRepeat)
    static kKeyUp = 5;
}

class InputDevice
{
    static kNone = -1;
    static kMouse = 0;
    static kTouch = 1;
    static kPen = 2;
    static kKeyboard = 3;
}

/*
    Common KeyboardEvent.code values. Codes name the physical key, so they don't
    change with Shift or the keyboard layout ("KeyA" is "a" and "A").
    Any other code string works too:
    https://developer.mozilla.org/docs/Web/API/UI_Events/Keyboard_event_code_values
*/
class KeyCode
{
    static kEscape = "Escape";
    static kEnter = "Enter";
    static kNumpadEnter = "NumpadEnter";
    static kSpace = "Space";
    static kTab = "Tab";
    static kBackspace = "Backspace";

    static kLeft = "ArrowLeft";
    static kRight = "ArrowRight";
    static kUp = "ArrowUp";
    static kDown = "ArrowDown";

    static kShiftLeft = "ShiftLeft";
    static kShiftRight = "ShiftRight";
    static kControlLeft = "ControlLeft";
    static kControlRight = "ControlRight";
    static kAltLeft = "AltLeft";
    static kAltRight = "AltRight";

    // Letters
    static kA = "KeyA";
    static kB = "KeyB";
    static kC = "KeyC";
    static kD = "KeyD";
    static kE = "KeyE";
    static kF = "KeyF";
    static kG = "KeyG";
    static kH = "KeyH";
    static kI = "KeyI";
    static kJ = "KeyJ";
    static kK = "KeyK";
    static kL = "KeyL";
    static kM = "KeyM";
    static kN = "KeyN";
    static kO = "KeyO";
    static kP = "KeyP";
    static kQ = "KeyQ";
    static kR = "KeyR";
    static kS = "KeyS";
    static kT = "KeyT";
    static kU = "KeyU";
    static kV = "KeyV";
    static kW = "KeyW";
    static kX = "KeyX";
    static kY = "KeyY";
    static kZ = "KeyZ";

    // Number row (above the letters, not the numpad)
    static k0 = "Digit0";
    static k1 = "Digit1";
    static k2 = "Digit2";
    static k3 = "Digit3";
    static k4 = "Digit4";
    static k5 = "Digit5";
    static k6 = "Digit6";
    static k7 = "Digit7";
    static k8 = "Digit8";
    static k9 = "Digit9";

    // Numpad digits (kNumpadEnter is with the other keys above)
    static kNumpad0 = "Numpad0";
    static kNumpad1 = "Numpad1";
    static kNumpad2 = "Numpad2";
    static kNumpad3 = "Numpad3";
    static kNumpad4 = "Numpad4";
    static kNumpad5 = "Numpad5";
    static kNumpad6 = "Numpad6";
    static kNumpad7 = "Numpad7";
    static kNumpad8 = "Numpad8";
    static kNumpad9 = "Numpad9";
}

/*
    What a listener receives. InputManager reuses one InputEvent for every event,
    so copy any value a listener wants to keep past its onInputEvent() call.

    Pointer events (kTap, kDrag, kDragEnd, kSwipe):
        position       Where the pointer is now
        startPosition  Where it was pressed
        delta          kDrag / kDragEnd: movement since the previous kDrag (or since
                       the press, for the first one), so a drag's deltas add up to
                       position - startPosition.
                       kSwipe: the whole swipe, position - startPosition.
                       kTap: (0, 0)
        duration       Seconds since the press

    Key events (kKeyDown, kKeyUp):
        code           KeyboardEvent.code, the physical key (see KeyCode)
        key            KeyboardEvent.key, the character or key name typed ("a", "A", "Enter")
        isRepeat       kKeyDown only: true when the key is being held and auto-repeats

    hasBeenConsumed is true once a listener has returned true for this event.
    Every listener still receives it, so later ones can check it and step aside.
*/
class InputEvent
{
    constructor()
    {
        this.type = InputEventType.kNone;
        this.device = InputDevice.kNone;

        this.position = new Vector2();
        this.startPosition = new Vector2();
        this.delta = new Vector2();
        this.duration = 0.0;

        this.code = "";
        this.key = "";
        this.isRepeat = false;

        this.hasBeenConsumed = false;
    }

    isPointer() { return (this.type >= InputEventType.kTap && this.type <= InputEventType.kSwipe); }
    isGesture() { return (this.type >= InputEventType.kDrag && this.type <= InputEventType.kSwipe); }
    isKey() { return (this.type === InputEventType.kKeyDown || this.type === InputEventType.kKeyUp); }

    // Ends a drag: listeners holding something from kDrag should let go on either
    isDragOver() { return (this.type === InputEventType.kDragEnd || this.type === InputEventType.kSwipe); }
}
