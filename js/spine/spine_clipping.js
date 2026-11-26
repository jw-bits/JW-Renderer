"use strict";

/******************************************************************************
 * Spine Runtimes License Agreement
 * Last updated January 1, 2020. Replaces all prior versions.
 *
 * Copyright (c) 2013-2020, Esoteric Software LLC
 *
 * Integration of the Spine Runtimes into software or otherwise creating
 * derivative works of the Spine Runtimes is permitted under the terms and
 * conditions of Section 2 of the Spine Editor License Agreement:
 * http://esotericsoftware.com/spine-editor-license
 *
 * Otherwise, it is permitted to integrate the Spine Runtimes into software
 * or otherwise create derivative works of the Spine Runtimes (collectively,
 * "Products"), provided that each user of the Products must obtain their own
 * Spine Editor license and redistribution of the Products in any form must
 * include this license and copyright notice.
 *
 * THE SPINE RUNTIMES ARE PROVIDED BY ESOTERIC SOFTWARE LLC "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL ESOTERIC SOFTWARE LLC BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES,
 * BUSINESS INTERRUPTION, OR LOSS OF USE, DATA, OR PROFITS) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THE SPINE RUNTIMES, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *****************************************************************************/

/*
    Clipping, ported from spine-core 4.0.31 (SkeletonClipping.ts and
    Triangulator.ts); see docs/spine_plan.md, phase 6.

        SpineSkeletonClipping  Clips attachments' triangles to a clipping attachment's polygon
        SpineTriangulator      Splits a polygon into triangles, then into convex polygons

    Use, per slot in draw order (as Skeleton2D does):

        clipper.clipStart(slot, clippingAttachment);  // When a slot shows a SpineClippingAttachment
        if (clipper.isClipping())
            clipper.clipTriangles(world, n, triangles, triangles.length, uvs, light, dark, twoColor);
        clipper.clipEndWithSlot(slot);                 // After each slot
        clipper.clipEnd();                             // After the last slot

    Changed from upstream: clipTriangles() writes Skeleton2D's vertex layout
    into clippedVertices, x, y, u, v, r, g, b, a, then with twoColor the dark
    color's r, g, b, a (Spine's is x, y, r, g, b, a, u, v, then the dark
    color), so Skeleton2D copies them into its stream as they are. light and
    dark are Vector4s (r, g, b, a in x, y, z, w).
*/

class SpineSkeletonClipping
{
    static #kVertexSize = 8;          // x, y, u, v, r, g, b, a
    static #kVertexSizeTwoColor = 12; // ...then the dark color: r, g, b, a

    triangulator = new SpineTriangulator();
    clippingPolygon = new Array();
    clipOutput = new Array();
    clippedVertices = new Array();  // Read-only: x, y, u, v, r, g, b, a (then dark r, g, b, a with twoColor) each, after clipTriangles()
    clippedTriangles = new Array(); // Read-only: indices into clippedVertices (in vertices, from 0)
    scratch = new Array();

    clipAttachment = null;
    clippingPolygons = null;

    // Starts clipping to clip's polygon, as slot poses it; returns its number of convex parts (0 if already clipping)
    clipStart(slot, clip)
    {
        if (this.clipAttachment)
            return 0;
        this.clipAttachment = clip;

        let n = clip.worldVerticesLength;
        let vertices = SpineUtils.setArraySize(this.clippingPolygon, n);
        clip.computeWorldVertices(slot, 0, n, vertices, 0, 2);
        let clippingPolygon = this.clippingPolygon;
        SpineSkeletonClipping.makeClockwise(clippingPolygon);
        let clippingPolygons = this.clippingPolygons = this.triangulator.decompose(clippingPolygon, this.triangulator.triangulate(clippingPolygon));
        for (let i = 0, n = clippingPolygons.length; i < n; i++)
        {
            let polygon = clippingPolygons[i];
            SpineSkeletonClipping.makeClockwise(polygon);
            polygon.push(polygon[0]);
            polygon.push(polygon[1]);
        }

        return clippingPolygons.length;
    }

    // Ends clipping if slot is the clipping attachment's end slot
    clipEndWithSlot(slot)
    {
        if (this.clipAttachment && this.clipAttachment.endSlot == slot.data)
            this.clipEnd();
    }

    clipEnd()
    {
        if (!this.clipAttachment)
            return;
        this.clipAttachment = null;
        this.clippingPolygons = null;
        this.clippedVertices.length = 0;
        this.clippedTriangles.length = 0;
        this.clippingPolygon.length = 0;
    }

    isClipping()
    {
        return this.clipAttachment != null;
    }

    /*
        Clips the triangles (vertices: world x, y pairs; uvs: u, v pairs) to the clipping
        polygon, filling clippedVertices and clippedTriangles. Each vertex gets light's
        color, and with twoColor dark's after it (dark is ignored otherwise).
    */
    clipTriangles(vertices, verticesLength, triangles, trianglesLength, uvs, light, dark, twoColor)
    {
        let clipOutput = this.clipOutput, clippedVertices = this.clippedVertices;
        let clippedTriangles = this.clippedTriangles;
        let polygons = this.clippingPolygons;
        let polygonsCount = this.clippingPolygons.length;
        let vertexSize = twoColor ? SpineSkeletonClipping.#kVertexSizeTwoColor : SpineSkeletonClipping.#kVertexSize;
        let r = light.x, g = light.y, b = light.z, a = light.w;

        let index = 0;
        clippedVertices.length = 0;
        clippedTriangles.length = 0;
        outer:
        for (let i = 0; i < trianglesLength; i += 3)
        {
            let vertexOffset = triangles[i] << 1;
            let x1 = vertices[vertexOffset], y1 = vertices[vertexOffset + 1];
            let u1 = uvs[vertexOffset], v1 = uvs[vertexOffset + 1];

            vertexOffset = triangles[i + 1] << 1;
            let x2 = vertices[vertexOffset], y2 = vertices[vertexOffset + 1];
            let u2 = uvs[vertexOffset], v2 = uvs[vertexOffset + 1];

            vertexOffset = triangles[i + 2] << 1;
            let x3 = vertices[vertexOffset], y3 = vertices[vertexOffset + 1];
            let u3 = uvs[vertexOffset], v3 = uvs[vertexOffset + 1];

            for (let p = 0; p < polygonsCount; p++)
            {
                let s = clippedVertices.length;
                if (this.clip(x1, y1, x2, y2, x3, y3, polygons[p], clipOutput))
                {
                    let clipOutputLength = clipOutput.length;
                    if (clipOutputLength == 0)
                        continue;
                    let d0 = y2 - y3, d1 = x3 - x2, d2 = x1 - x3, d4 = y3 - y1;
                    let d = 1 / (d0 * d2 + d1 * (y1 - y3));

                    let clipOutputCount = clipOutputLength >> 1;
                    let clipOutputItems = this.clipOutput;
                    let clippedVerticesItems = SpineUtils.setArraySize(clippedVertices, s + clipOutputCount * vertexSize);
                    for (let ii = 0; ii < clipOutputLength; ii += 2)
                    {
                        let x = clipOutputItems[ii], y = clipOutputItems[ii + 1];
                        let c0 = x - x3, c1 = y - y3;
                        let ba = (d0 * c0 + d1 * c1) * d;
                        let bb = (d4 * c0 + d2 * c1) * d;
                        let bc = 1 - ba - bb;
                        clippedVerticesItems[s] = x;
                        clippedVerticesItems[s + 1] = y;
                        clippedVerticesItems[s + 2] = u1 * ba + u2 * bb + u3 * bc;
                        clippedVerticesItems[s + 3] = v1 * ba + v2 * bb + v3 * bc;
                        clippedVerticesItems[s + 4] = r;
                        clippedVerticesItems[s + 5] = g;
                        clippedVerticesItems[s + 6] = b;
                        clippedVerticesItems[s + 7] = a;
                        if (twoColor)
                        {
                            clippedVerticesItems[s + 8] = dark.x;
                            clippedVerticesItems[s + 9] = dark.y;
                            clippedVerticesItems[s + 10] = dark.z;
                            clippedVerticesItems[s + 11] = dark.w;
                        }
                        s += vertexSize;
                    }

                    s = clippedTriangles.length;
                    let clippedTrianglesItems = SpineUtils.setArraySize(clippedTriangles, s + 3 * (clipOutputCount - 2));
                    clipOutputCount--;
                    for (let ii = 1; ii < clipOutputCount; ii++)
                    {
                        clippedTrianglesItems[s] = index;
                        clippedTrianglesItems[s + 1] = (index + ii);
                        clippedTrianglesItems[s + 2] = (index + ii + 1);
                        s += 3;
                    }
                    index += clipOutputCount + 1;
                }
                else
                {
                    // The triangle whole (engine change: one helper per vertex, for either layout)
                    let clippedVerticesItems = SpineUtils.setArraySize(clippedVertices, s + 3 * vertexSize);
                    SpineSkeletonClipping.#putVertex(clippedVerticesItems, s, x1, y1, u1, v1, light, dark, twoColor);
                    SpineSkeletonClipping.#putVertex(clippedVerticesItems, s + vertexSize, x2, y2, u2, v2, light, dark, twoColor);
                    SpineSkeletonClipping.#putVertex(clippedVerticesItems, s + 2 * vertexSize, x3, y3, u3, v3, light, dark, twoColor);

                    s = clippedTriangles.length;
                    let clippedTrianglesItems = SpineUtils.setArraySize(clippedTriangles, s + 3);
                    clippedTrianglesItems[s] = index;
                    clippedTrianglesItems[s + 1] = (index + 1);
                    clippedTrianglesItems[s + 2] = (index + 2);
                    index += 3;
                    continue outer;
                }
            }
        }
    }

    /*
        Clips the input triangle against the convex, clockwise clipping area. If the
        triangle lies entirely within the clipping area, false is returned. The clipping
        area must duplicate the first vertex at the end of the vertices list.
    */
    clip(x1, y1, x2, y2, x3, y3, clippingArea, output)
    {
        let originalOutput = output;
        let clipped = false;

        // Avoid copy at the end.
        let input = null;
        if (clippingArea.length % 4 >= 2)
        {
            input = output;
            output = this.scratch;
        }
        else
            input = this.scratch;

        input.length = 0;
        input.push(x1);
        input.push(y1);
        input.push(x2);
        input.push(y2);
        input.push(x3);
        input.push(y3);
        input.push(x1);
        input.push(y1);
        output.length = 0;

        let clippingVertices = clippingArea;
        let clippingVerticesLast = clippingArea.length - 4;
        for (let i = 0; ; i += 2)
        {
            let edgeX = clippingVertices[i], edgeY = clippingVertices[i + 1];
            let edgeX2 = clippingVertices[i + 2], edgeY2 = clippingVertices[i + 3];
            let deltaX = edgeX - edgeX2, deltaY = edgeY - edgeY2;

            let inputVertices = input;
            let inputVerticesLength = input.length - 2, outputStart = output.length;
            for (let ii = 0; ii < inputVerticesLength; ii += 2)
            {
                let inputX = inputVertices[ii], inputY = inputVertices[ii + 1];
                let inputX2 = inputVertices[ii + 2], inputY2 = inputVertices[ii + 3];
                let side2 = deltaX * (inputY2 - edgeY2) - deltaY * (inputX2 - edgeX2) > 0;
                if (deltaX * (inputY - edgeY2) - deltaY * (inputX - edgeX2) > 0)
                {
                    if (side2)
                    { // v1 inside, v2 inside
                        output.push(inputX2);
                        output.push(inputY2);
                        continue;
                    }
                    // v1 inside, v2 outside
                    let c0 = inputY2 - inputY, c2 = inputX2 - inputX;
                    let s = c0 * (edgeX2 - edgeX) - c2 * (edgeY2 - edgeY);
                    if (Math.abs(s) > 0.000001)
                    {
                        let ua = (c2 * (edgeY - inputY) - c0 * (edgeX - inputX)) / s;
                        output.push(edgeX + (edgeX2 - edgeX) * ua);
                        output.push(edgeY + (edgeY2 - edgeY) * ua);
                    }
                    else
                    {
                        output.push(edgeX);
                        output.push(edgeY);
                    }
                }
                else if (side2)
                { // v1 outside, v2 inside
                    let c0 = inputY2 - inputY, c2 = inputX2 - inputX;
                    let s = c0 * (edgeX2 - edgeX) - c2 * (edgeY2 - edgeY);
                    if (Math.abs(s) > 0.000001)
                    {
                        let ua = (c2 * (edgeY - inputY) - c0 * (edgeX - inputX)) / s;
                        output.push(edgeX + (edgeX2 - edgeX) * ua);
                        output.push(edgeY + (edgeY2 - edgeY) * ua);
                    }
                    else
                    {
                        output.push(edgeX);
                        output.push(edgeY);
                    }
                    output.push(inputX2);
                    output.push(inputY2);
                }
                clipped = true;
            }

            if (outputStart == output.length)
            { // All edges outside.
                originalOutput.length = 0;
                return true;
            }

            output.push(output[0]);
            output.push(output[1]);

            if (i == clippingVerticesLast)
                break;
            let temp = output;
            output = input;
            output.length = 0;
            input = temp;
        }

        if (originalOutput != output)
        {
            originalOutput.length = 0;
            for (let i = 0, n = output.length - 2; i < n; i++)
                originalOutput[i] = output[i];
        }
        else
            originalOutput.length = originalOutput.length - 2;

        return clipped;
    }

    // Writes one vertex at items[s]: x, y, u, v, light's r, g, b, a, then with twoColor dark's
    static #putVertex(items, s, x, y, u, v, light, dark, twoColor)
    {
        items[s] = x;
        items[s + 1] = y;
        items[s + 2] = u;
        items[s + 3] = v;
        items[s + 4] = light.x;
        items[s + 5] = light.y;
        items[s + 6] = light.z;
        items[s + 7] = light.w;
        if (twoColor)
        {
            items[s + 8] = dark.x;
            items[s + 9] = dark.y;
            items[s + 10] = dark.z;
            items[s + 11] = dark.w;
        }
    }

    // Reverses polygon (x, y pairs) in place if it's counter-clockwise
    static makeClockwise(polygon)
    {
        let vertices = polygon;
        let verticeslength = polygon.length;

        let area = vertices[verticeslength - 2] * vertices[1] - vertices[0] * vertices[verticeslength - 1], p1x = 0, p1y = 0, p2x = 0, p2y = 0;
        for (let i = 0, n = verticeslength - 3; i < n; i += 2)
        {
            p1x = vertices[i];
            p1y = vertices[i + 1];
            p2x = vertices[i + 2];
            p2y = vertices[i + 3];
            area += p1x * p2y - p2x * p1y;
        }
        if (area < 0)
            return;

        for (let i = 0, lastX = verticeslength - 2, n = verticeslength >> 1; i < n; i += 2)
        {
            let x = vertices[i], y = vertices[i + 1];
            let other = lastX - i;
            vertices[i] = vertices[other];
            vertices[i + 1] = vertices[other + 1];
            vertices[other] = x;
            vertices[other + 1] = y;
        }
    }
}

class SpineTriangulator
{
    convexPolygons = new Array();
    convexPolygonsIndices = new Array();

    indicesArray = new Array();
    isConcaveArray = new Array();
    triangles = new Array();

    polygonPool = new SpinePool(() => new Array());
    polygonIndicesPool = new SpinePool(() => new Array());

    // Ear-clips the polygon (x, y pairs); returns its triangles' vertex indices (read-only, reused by the next call)
    triangulate(verticesArray)
    {
        let vertices = verticesArray;
        let vertexCount = verticesArray.length >> 1;

        let indices = this.indicesArray;
        indices.length = 0;
        for (let i = 0; i < vertexCount; i++)
            indices[i] = i;

        let isConcave = this.isConcaveArray;
        isConcave.length = 0;
        for (let i = 0, n = vertexCount; i < n; ++i)
            isConcave[i] = SpineTriangulator.isConcave(i, vertexCount, vertices, indices);

        let triangles = this.triangles;
        triangles.length = 0;

        while (vertexCount > 3)
        {
            // Find ear tip.
            let previous = vertexCount - 1, i = 0, next = 1;
            while (true)
            {
                outer:
                if (!isConcave[i])
                {
                    let p1 = indices[previous] << 1, p2 = indices[i] << 1, p3 = indices[next] << 1;
                    let p1x = vertices[p1], p1y = vertices[p1 + 1];
                    let p2x = vertices[p2], p2y = vertices[p2 + 1];
                    let p3x = vertices[p3], p3y = vertices[p3 + 1];
                    for (let ii = (next + 1) % vertexCount; ii != previous; ii = (ii + 1) % vertexCount)
                    {
                        if (!isConcave[ii])
                            continue;
                        let v = indices[ii] << 1;
                        let vx = vertices[v], vy = vertices[v + 1];
                        if (SpineTriangulator.positiveArea(p3x, p3y, p1x, p1y, vx, vy))
                        {
                            if (SpineTriangulator.positiveArea(p1x, p1y, p2x, p2y, vx, vy))
                            {
                                if (SpineTriangulator.positiveArea(p2x, p2y, p3x, p3y, vx, vy))
                                    break outer;
                            }
                        }
                    }
                    break;
                }

                if (next == 0)
                {
                    do
                    {
                        if (!isConcave[i])
                            break;
                        i--;
                    } while (i > 0);
                    break;
                }

                previous = i;
                i = next;
                next = (next + 1) % vertexCount;
            }

            // Cut ear tip.
            triangles.push(indices[(vertexCount + i - 1) % vertexCount]);
            triangles.push(indices[i]);
            triangles.push(indices[(i + 1) % vertexCount]);
            indices.splice(i, 1);
            isConcave.splice(i, 1);
            vertexCount--;

            let previousIndex = (vertexCount + i - 1) % vertexCount;
            let nextIndex = i == vertexCount ? 0 : i;
            isConcave[previousIndex] = SpineTriangulator.isConcave(previousIndex, vertexCount, vertices, indices);
            isConcave[nextIndex] = SpineTriangulator.isConcave(nextIndex, vertexCount, vertices, indices);
        }

        if (vertexCount == 3)
        {
            triangles.push(indices[2]);
            triangles.push(indices[0]);
            triangles.push(indices[1]);
        }

        return triangles;
    }

    // Merges triangulate()'s triangles into convex polygons (x, y pairs each); read-only, reused by the next call
    decompose(verticesArray, triangles)
    {
        let vertices = verticesArray;
        let convexPolygons = this.convexPolygons;
        this.polygonPool.freeAll(convexPolygons);
        convexPolygons.length = 0;

        let convexPolygonsIndices = this.convexPolygonsIndices;
        this.polygonIndicesPool.freeAll(convexPolygonsIndices);
        convexPolygonsIndices.length = 0;

        let polygonIndices = this.polygonIndicesPool.obtain();
        polygonIndices.length = 0;

        let polygon = this.polygonPool.obtain();
        polygon.length = 0;

        // Merge subsequent triangles if they form a triangle fan.
        let fanBaseIndex = -1, lastWinding = 0;
        for (let i = 0, n = triangles.length; i < n; i += 3)
        {
            let t1 = triangles[i] << 1, t2 = triangles[i + 1] << 1, t3 = triangles[i + 2] << 1;
            let x1 = vertices[t1], y1 = vertices[t1 + 1];
            let x2 = vertices[t2], y2 = vertices[t2 + 1];
            let x3 = vertices[t3], y3 = vertices[t3 + 1];

            // If the base of the last triangle is the same as this triangle, check if they form a convex polygon (triangle fan).
            let merged = false;
            if (fanBaseIndex == t1)
            {
                let o = polygon.length - 4;
                let winding1 = SpineTriangulator.winding(polygon[o], polygon[o + 1], polygon[o + 2], polygon[o + 3], x3, y3);
                let winding2 = SpineTriangulator.winding(x3, y3, polygon[0], polygon[1], polygon[2], polygon[3]);
                if (winding1 == lastWinding && winding2 == lastWinding)
                {
                    polygon.push(x3);
                    polygon.push(y3);
                    polygonIndices.push(t3);
                    merged = true;
                }
            }

            // Otherwise make this triangle the new base.
            if (!merged)
            {
                if (polygon.length > 0)
                {
                    convexPolygons.push(polygon);
                    convexPolygonsIndices.push(polygonIndices);
                }
                else
                {
                    this.polygonPool.free(polygon);
                    this.polygonIndicesPool.free(polygonIndices);
                }
                polygon = this.polygonPool.obtain();
                polygon.length = 0;
                polygon.push(x1);
                polygon.push(y1);
                polygon.push(x2);
                polygon.push(y2);
                polygon.push(x3);
                polygon.push(y3);
                polygonIndices = this.polygonIndicesPool.obtain();
                polygonIndices.length = 0;
                polygonIndices.push(t1);
                polygonIndices.push(t2);
                polygonIndices.push(t3);
                lastWinding = SpineTriangulator.winding(x1, y1, x2, y2, x3, y3);
                fanBaseIndex = t1;
            }
        }

        if (polygon.length > 0)
        {
            convexPolygons.push(polygon);
            convexPolygonsIndices.push(polygonIndices);
        }

        // Go through the list of polygons and try to merge the remaining triangles with the found triangle fans.
        for (let i = 0, n = convexPolygons.length; i < n; i++)
        {
            polygonIndices = convexPolygonsIndices[i];
            if (polygonIndices.length == 0)
                continue;
            let firstIndex = polygonIndices[0];
            let lastIndex = polygonIndices[polygonIndices.length - 1];

            polygon = convexPolygons[i];
            let o = polygon.length - 4;
            let prevPrevX = polygon[o], prevPrevY = polygon[o + 1];
            let prevX = polygon[o + 2], prevY = polygon[o + 3];
            let firstX = polygon[0], firstY = polygon[1];
            let secondX = polygon[2], secondY = polygon[3];
            let winding = SpineTriangulator.winding(prevPrevX, prevPrevY, prevX, prevY, firstX, firstY);

            for (let ii = 0; ii < n; ii++)
            {
                if (ii == i)
                    continue;
                let otherIndices = convexPolygonsIndices[ii];
                if (otherIndices.length != 3)
                    continue;
                let otherFirstIndex = otherIndices[0];
                let otherSecondIndex = otherIndices[1];
                let otherLastIndex = otherIndices[2];

                let otherPoly = convexPolygons[ii];
                let x3 = otherPoly[otherPoly.length - 2], y3 = otherPoly[otherPoly.length - 1];

                if (otherFirstIndex != firstIndex || otherSecondIndex != lastIndex)
                    continue;
                let winding1 = SpineTriangulator.winding(prevPrevX, prevPrevY, prevX, prevY, x3, y3);
                let winding2 = SpineTriangulator.winding(x3, y3, firstX, firstY, secondX, secondY);
                if (winding1 == winding && winding2 == winding)
                {
                    otherPoly.length = 0;
                    otherIndices.length = 0;
                    polygon.push(x3);
                    polygon.push(y3);
                    polygonIndices.push(otherLastIndex);
                    prevPrevX = prevX;
                    prevPrevY = prevY;
                    prevX = x3;
                    prevY = y3;
                    ii = 0;
                }
            }
        }

        // Remove empty polygons that resulted from the merge step above.
        for (let i = convexPolygons.length - 1; i >= 0; i--)
        {
            polygon = convexPolygons[i];
            if (polygon.length == 0)
            {
                convexPolygons.splice(i, 1);
                this.polygonPool.free(polygon);
                polygonIndices = convexPolygonsIndices[i];
                convexPolygonsIndices.splice(i, 1);
                this.polygonIndicesPool.free(polygonIndices);
            }
        }

        return convexPolygons;
    }

    static isConcave(index, vertexCount, vertices, indices)
    {
        let previous = indices[(vertexCount + index - 1) % vertexCount] << 1;
        let current = indices[index] << 1;
        let next = indices[(index + 1) % vertexCount] << 1;
        return !SpineTriangulator.positiveArea(vertices[previous], vertices[previous + 1], vertices[current], vertices[current + 1], vertices[next],
            vertices[next + 1]);
    }

    static positiveArea(p1x, p1y, p2x, p2y, p3x, p3y)
    {
        return p1x * (p3y - p2y) + p2x * (p1y - p3y) + p3x * (p2y - p1y) >= 0;
    }

    static winding(p1x, p1y, p2x, p2y, p3x, p3y)
    {
        let px = p2x - p1x, py = p2y - p1y;
        return p3x * py - p3y * px + px * p1y - p1x * py >= 0 ? 1 : -1;
    }
}
