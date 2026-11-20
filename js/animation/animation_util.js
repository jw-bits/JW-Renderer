"use strict";

/*
    AnimationUtil - Helpers for building sprite frames from an atlas texture,
    and the frame math Sprite plays sequences with.

    UVRects run 0..1 with V up and (x, y) their bottom-left corner (see UVRect).
    That matches textures uploaded with flipY (Texture's default), so pixel
    rects measured from an image's top-left convert correctly.

    Atlas grids: a rect split into rows x cols equal frames, numbered row by
    row from the top-left, as they appear in the image:

        0  1  2  3
        4  5  6  7

    Frames sit edge to edge, so filtering can blend in a sliver of the next
    frame. For pixel art use a NEAREST Sampler; otherwise leave a pixel or two
    of padding between frames in the atlas.

    Usage:
        // A 4 x 8 grid over the whole atlas: frames 8 - 15 (the second row)
        const walk = AnimationUtil.gridFrames(new UVRect(), 4, 8, 8, 8);

        // A run inside a 256 x 64 pixel strip, measured from the image's top-left
        const strip = AnimationUtil.pixelsToUVRect(0, 128, 256, 64, tex.getWidth(), tex.getHeight());
        const jump = AnimationUtil.gridFrames(strip, 1, 4);
*/
class AnimationUtil
{
    /*
        Converts a rect in texture pixels to a UVRect, written into out (also returned).

        origin is the Alignment of pixel (0, 0) on the texture:
            Alignment.kTopLeft     Image editors and atlas tools: x right, y down (the default)
            Alignment.kBottomLeft  GL style: x right, y up
            Others                 x runs away from a right edge (else right); y runs down
                                   from a top edge (else up); center / middle put the
                                   origin halfway across
        (x, y) is the rect's corner nearest the origin, and it extends width / height
        along those directions. Values outside the texture are clamped to it.

        Returns null (with a console.error) if the texture size or origin isn't valid.
    */
    static pixelsToUVRect(x, y, width, height, texWidth, texHeight, origin = Alignment.kTopLeft, out = new UVRect())
    {
        const o = AnimationUtil.#getOrigin(texWidth, texHeight, origin, "pixelsToUVRect");

        if (o === null)
            return null;

        const left = o.xRunsRight ? (o.x + x) : (o.x - x - width);
        const bottom = o.yRunsUp ? (o.y + y) : (o.y - y - height);

        return out.set(left / texWidth, bottom / texHeight, width / texWidth, height / texHeight);
    }

    /*
        Converts a UVRect to texture pixels, as pixelsToUVRect() takes them: written
        into out as (x, y, width, height) and returned. Returns null (with a
        console.error) if the texture size or origin isn't valid.
    */
    static uvRectToPixels(uvRect, texWidth, texHeight, origin = Alignment.kTopLeft, out = new Vector4())
    {
        const o = AnimationUtil.#getOrigin(texWidth, texHeight, origin, "uvRectToPixels");

        if (o === null)
            return null;

        const left = uvRect.getX() * texWidth;
        const bottom = uvRect.getY() * texHeight;
        const width = uvRect.getWidth() * texWidth;
        const height = uvRect.getHeight() * texHeight;

        const x = o.xRunsRight ? (left - o.x) : (o.x - left - width);
        const y = o.yRunsUp ? (bottom - o.y) : (o.y - bottom - height);

        out.set(x, y, width, height);
            return out;
    }

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
        if (AnimationUtil.#isValidGrid(rows, cols, "gridFrames") === false)
            return null;

        const total = rows * cols;

        if (Number.isInteger(firstFrame) === false || Number.isInteger(frameCount) === false ||
            firstFrame < 0 || frameCount < 1 || firstFrame + frameCount > total)
        {
            console.error(`AnimationUtil.gridFrames(): frames ${firstFrame} - ${firstFrame + frameCount - 1} aren't all in a ${rows} x ${cols} grid`);
                return null;
        }

        let frames = [];

        for (let i = 0; i < frameCount; ++i)
            frames.push(AnimationUtil.gridFrame(rect, rows, cols, firstFrame + i));

        return frames;
    }

    /*
        The frames from (startRow, startCol) to (endRow, endCol), inclusive, of a
        rows x cols grid over rect, reading row by row; the run can span rows.
        Returns null (with a console.error) if the grid or range isn't valid.
    */
    static gridRangeFrames(rect, rows, cols, startRow, startCol, endRow, endCol)
    {
        if (AnimationUtil.#isValidGrid(rows, cols, "gridRangeFrames") === false)
            return null;

        const first = (startRow * cols) + startCol;
        const last = (endRow * cols) + endCol;

        if (startCol < 0 || startCol >= cols || endCol < 0 || endCol >= cols || last < first)
        {
            console.error(`AnimationUtil.gridRangeFrames(): (${startRow}, ${startCol}) - (${endRow}, ${endCol}) isn't a forward run in a ${rows} x ${cols} grid`);
                return null;
        }

        return AnimationUtil.gridFrames(rect, rows, cols, first, (last - first) + 1);
    }

    // *** Playback math ***

    // Frame steps in one cycle: every frame for kOnce / kLoop; there and back (2n - 2) for ping-pong
    static getCycleSteps(frameCount, playMode)
    {
        if (playMode === AnimationPlayMode.kPingPong || playMode === AnimationPlayMode.kPingPongOnce)
            return Math.max(1, (frameCount * 2) - 2);

        return frameCount;
    }

    // The frame shown step steps (0 .. getCycleSteps() - 1) into a cycle
    static stepToFrame(step, frameCount, playMode)
    {
        if (step >= frameCount)
            return AnimationUtil.getCycleSteps(frameCount, playMode) - step; // Ping-pong, on the way back

        return step;
    }

    // *** Internal Methods ***

    static #isValidGrid(rows, cols, method)
    {
        if (Number.isInteger(rows) === false || Number.isInteger(cols) === false || rows < 1 || cols < 1)
        {
            console.error(`AnimationUtil.${method}(): rows and cols must be whole numbers of at least 1`);
                return false;
        }

        return true;
    }

    // Where pixel (0, 0) sits, in pixels from the bottom-left, and which way x and y run from it
    static #getOrigin(texWidth, texHeight, origin, method)
    {
        if (!(texWidth > 0) || !(texHeight > 0))
        {
            console.error(`AnimationUtil.${method}() needs a texture width and height above 0`);
                return null;
        }

        if (Alignment.isValid(origin) === false)
        {
            console.error(`AnimationUtil.${method}(): origin must be an Alignment`);
                return null;
        }

        const col = Alignment.getColumn(origin);
        const row = Alignment.getRow(origin);

        return {
            x: col * (texWidth / 2.0),
            y: row * (texHeight / 2.0),
            xRunsRight: (col !== 2),
            yRunsUp: (row !== 2)
        };
    }
}
