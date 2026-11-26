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
    Spine enums, ported from spine-core 4.0.31 (BoneData.ts, SlotData.ts,
    PathConstraintData.ts, Animation.ts); see docs/spine_plan.md. Each is a
    class of static values, named as Spine names them (SpineBlendMode.Additive),
    so the ported code reads as Spine's does. Spine's JSON names them in lower
    case; SpineUtils.enumValue() finds the value.

        SpineTransformMode  How a bone inherits its parent's world transform
        SpineBlendMode      How a slot's images blend (mapped to the engine's BlendMode when drawn)
        SpinePositionMode   Path constraint: how the first bone is placed on the path
        SpineSpacingMode    Path constraint: how the other bones are spaced
        SpineRotateMode     Path constraint: how bones turn to follow the path
        SpineMixBlend       How a timeline's value mixes with the setup or current pose
        SpineMixDirection   Whether a timeline is mixing in or out
        SpineProperty       What a timeline changes, for its property ids
        SpineEventType      What a SpineAnimationState reports to its event callback (AnimationState.ts)
*/

/** Determines how a bone inherits world transforms from parent bones. */
class SpineTransformMode
{
    static Normal = 0;
    static OnlyTranslation = 1;
    static NoRotationOrReflection = 2;
    static NoScale = 3;
    static NoScaleOrReflection = 4;
}

/** Determines how images are blended with existing pixels when drawn. */
class SpineBlendMode
{
    static Normal = 0;
    static Additive = 1;
    static Multiply = 2;
    static Screen = 3;
}

/** Controls how the first bone is positioned along the path.
 *
 * See [position](http://esotericsoftware.com/spine-path-constraints#Position) in the Spine User Guide. */
class SpinePositionMode
{
    static Fixed = 0;
    static Percent = 1;
}

/** Controls how bones after the first bone are positioned along the path.
 *
 * See [spacing](http://esotericsoftware.com/spine-path-constraints#Spacing) in the Spine User Guide. */
class SpineSpacingMode
{
    static Length = 0;
    static Fixed = 1;
    static Percent = 2;
    static Proportional = 3;
}

/** Controls how bones are rotated, translated, and scaled to match the path.
 *
 * See [rotate mix](http://esotericsoftware.com/spine-path-constraints#Rotate-mix) in the Spine User Guide. */
class SpineRotateMode
{
    static Tangent = 0;
    static Chain = 1;
    static ChainScale = 2;
}

/** Controls how a timeline value is mixed with the setup pose value or current pose value when a timeline's `alpha`
 * < 1.
 *
 * See Timeline {@link Timeline#apply(Skeleton, float, float, Array, float, MixBlend, MixDirection)}. */
class SpineMixBlend
{
    static setup = 0;
    static first = 1;
    static replace = 2;
    static add = 3;
}

/** Indicates whether a timeline's `alpha` is mixing out over time toward 0 (the setup or current pose value) or
 * mixing in toward 1 (the timeline's value).
 *
 * See Timeline {@link Timeline#apply(Skeleton, float, float, Array, float, MixBlend, MixDirection)}. */
class SpineMixDirection
{
    static mixIn = 0;
    static mixOut = 1;
}

/** What a timeline changes: the first part of each of its property ids ("0|5" is bone 5's rotation). */
class SpineProperty
{
    static rotate = 0;
    static x = 1;
    static y = 2;
    static scaleX = 3;
    static scaleY = 4;
    static shearX = 5;
    static shearY = 6;
    static rgb = 7;
    static alpha = 8;
    static rgb2 = 9;
    static attachment = 10;
    static deform = 11;
    static event = 12;
    static drawOrder = 13;
    static ikConstraint = 14;
    static transformConstraint = 15;
    static pathConstraintPosition = 16;
    static pathConstraintSpacing = 17;
    static pathConstraintMix = 18;
}

/** What a SpineAnimationState reports to its event callback (see SpineAnimationState.setEventCallback()). Engine: Spine's
 * listener methods, one value each. */
class SpineEventType
{
    static start = 0;     // The entry became the current entry
    static interrupt = 1; // Another entry replaced it; it may still be applied while mixing out
    static end = 2;       // It won't be applied again (a dispose follows)
    static dispose = 3;   // It goes back to the pool; don't keep it
    static complete = 4;  // Its animation finished a loop (or reached its end)
    static event = 5;     // Its animation fired a keyed event
}
