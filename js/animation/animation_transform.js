"use strict";

/*
    AnimTransform - Translation (a Model2D's anchor, see Model2D.setPos()),
    scale and rotation (radians).
*/
class AnimTransform
{
    #x;
    #y;
    #scaleX;
    #scaleY;
    #rotation;

    constructor()
    {
        this.#x = 0.0;
        this.#y = 0.0;
        this.#scaleX = 1.0;
        this.#scaleY = 1.0;
        this.#rotation = 0.0;
    }

    setTranslation(x, y)
    {
        this.#x = x;
        this.#y = y;
    }

    setScale(sx, sy = sx)
    {
        this.#scaleX = sx;
        this.#scaleY = sy;
    }

    setRotation(radians) { this.#rotation = radians; }

    getX() { return this.#x; }
    getY() { return this.#y; }
    getScaleX() { return this.#scaleX; }
    getScaleY() { return this.#scaleY; }
    getRotation() { return this.#rotation; }

    // Copies the AnimChannel parts in channels from other
    copy(other, channels = AnimChannel.kAll)
    {
        if ((channels & AnimChannel.kTranslation) !== 0)
            this.setTranslation(other.getX(), other.getY());

        if ((channels & AnimChannel.kScale) !== 0)
            this.setScale(other.getScaleX(), other.getScaleY());

        if ((channels & AnimChannel.kRotation) !== 0)
            this.setRotation(other.getRotation());
    }

    // The model's anchor, scale and rotation
    readFrom(model)
    {
        const anchor = model.getAnchor();

        this.setTranslation(anchor.x, anchor.y);
        this.setScale(model.getScaleX(), model.getScaleY());
        this.setRotation(model.getRotation());
    }

    // Writes the AnimChannel parts in channels to the model; the anchor keeps the model's alignment
    applyTo(model, channels = AnimChannel.kAll)
    {
        if ((channels & AnimChannel.kTranslation) !== 0)
            model.setPos(this.#x, this.#y, model.getAlignment());

        if ((channels & AnimChannel.kScale) !== 0)
            model.setScale(this.#scaleX, this.#scaleY);

        if ((channels & AnimChannel.kRotation) !== 0)
            model.setRotation(this.#rotation);
    }
}
