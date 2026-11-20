"use strict";

/*
    SpriteUtil - Helpers for building sprite frames from an atlas texture,
    and the frame math Sprite plays sequences with.

    UVRects run 0..1 with V up and (x, y) their bottom-left corner (see UVRect).
    To build one from a rect in pixels, use UVRect.pixelsToUVRect().

    Atlas grids: a rect split into rows x cols equal frames, numbered row by
    row from the top-left, as they appear in the image:

        0  1  2  3
        4  5  6  7

    Frames sit edge to edge, so filtering can blend in a sliver of the next
    frame. For pixel art use a NEAREST Sampler; otherwise leave a pixel or two
    of padding between frames in the atlas.

    Usage:
        // A 4 x 8 grid over the whole atlas: frames 8 - 15 (the second row)
        const walk = SpriteUtil.gridFrames(new UVRect(), 4, 8, 8, 8);

        // A run inside a 256 x 64 pixel strip, measured from the image's top-left
        const strip = UVRect.pixelsToUVRect(0, 128, 256, 64, tex.getWidth(), tex.getHeight());
        const jump = SpriteUtil.gridFrames(strip, 1, 4);
*/
class SpriteUtil
{
    // One frame of a rows x cols grid over rect (see the top of this file), written into out (also returned)
    static gridFrame(rect, rows, cols, index, out = new UVRect())
    {
        const fw = rect.getWidth() / cols;
        const fh = rect.getHeight() / rows;
        const row = Math.floor(index / cols);
        const col = index % cols;

        // Row 0 is the top, and V runs up
        return out.set(rect.getX() + (col * fw), rect.getTop() - ((row + 1) * fh), fw, fh);
    }

    /*
        frameCount frames of a rows x cols grid over rect, starting at firstFrame,
        as a new array of UVRects. By default, every frame from firstFrame on.
        Returns null (with a console.error) if the grid or range isn't valid.
    */
    static gridFrames(rect, rows, cols, firstFrame = 0, frameCount = (rows * cols) - firstFrame)
    {
        if (SpriteUtil.#isValidGrid(rows, cols, "gridFrames") === false)
            return null;

        const total = rows * cols;

        if (Number.isInteger(firstFrame) === false || Number.isInteger(frameCount) === false ||
            firstFrame < 0 || frameCount < 1 || firstFrame + frameCount > total)
        {
            console.error(`SpriteUtil.gridFrames(): frames ${firstFrame} - ${firstFrame + frameCount - 1} aren't all in a ${rows} x ${cols} grid`);
                return null;
        }

        let frames = [];

        for (let i = 0; i < frameCount; ++i)
            frames.push(SpriteUtil.gridFrame(rect, rows, cols, firstFrame + i));

        return frames;
    }

    /*
        The frames from (startRow, startCol) to (endRow, endCol), inclusive, of a
        rows x cols grid over rect, reading row by row; the run can span rows.
        Returns null (with a console.error) if the grid or range isn't valid.
    */
    static gridRangeFrames(rect, rows, cols, startRow, startCol, endRow, endCol)
    {
        if (SpriteUtil.#isValidGrid(rows, cols, "gridRangeFrames") === false)
            return null;

        const first = (startRow * cols) + startCol;
        const last = (endRow * cols) + endCol;

        if (startCol < 0 || startCol >= cols || endCol < 0 || endCol >= cols || last < first)
        {
            console.error(`SpriteUtil.gridRangeFrames(): (${startRow}, ${startCol}) - (${endRow}, ${endCol}) isn't a forward run in a ${rows} x ${cols} grid`);
                return null;
        }

        return SpriteUtil.gridFrames(rect, rows, cols, first, (last - first) + 1);
    }

    // *** Playback math ***

    // Frame steps in one cycle: every frame for kOnce / kLoop; there and back (2n - 2) for ping-pong
    static getCycleSteps(frameCount, playMode)
    {
        if (playMode === SpritePlayMode.kPingPong || playMode === SpritePlayMode.kPingPongOnce)
            return Math.max(1, (frameCount * 2) - 2);

        return frameCount;
    }

    // The frame shown step steps (0 .. getCycleSteps() - 1) into a cycle
    static stepToFrame(step, frameCount, playMode)
    {
        if (step >= frameCount)
            return SpriteUtil.getCycleSteps(frameCount, playMode) - step; // Ping-pong, on the way back

        return step;
    }

    // *** Internal Methods ***

    static #isValidGrid(rows, cols, method)
    {
        if (Number.isInteger(rows) === false || Number.isInteger(cols) === false || rows < 1 || cols < 1)
        {
            console.error(`SpriteUtil.${method}(): rows and cols must be whole numbers of at least 1`);
                return false;
        }

        return true;
    }
}
