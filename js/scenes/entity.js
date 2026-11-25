"use strict";

/*
    Entity - Something placed in the world: a name, a local transform and a
    place in a parent / child hierarchy. Model2D and Camera2D are Entities,
    and a plain Entity works as an empty group to move things together.

    Local and world: the transform (getTransform(), changed with
    setPosition(), setScale(), setRotation() or setTransform()) is relative to
    the parent, or the world with no parent. getWorldTransform() is the parent's
    world transform times the local one (see Transform2D), so moving, turning
    or scaling a parent carries all its children, grandchildren and so on.

        let ship = new Entity("ship");
        ship.addChild(hull);                  // A Rect2D
        ship.addChild(turret);
        turret.setPosition(0, 40);            // Relative to the ship
        ship.setPosition(500, 300);           // Moves the hull and turret too
        ship.setRotation(0.5);

    World transforms are worked out when asked for, and only again after the
    entity or one of its parents changed: each entity keeps the versions it
    built from, so asking costs a check per parent up to the root. With no
    parent the world transform is the local one, with no work at all.

    Skew: a parent with a different scale across and up (sx !== sy) and a
    rotated child would skew the child, which a Transform2D (and the shaders)
    can't hold; the child's scale is then only close (see Transform2D).

    keepWorld: addChild(), removeChild() and setParent() take keepWorld. False
    (the default) keeps the local transform, so the entity jumps to its place
    under the new parent; true works out the local transform that keeps it
    where it is in the world.

    Links only: an Entity doesn't own its children. Unloading a model leaves
    it in the hierarchy, and removing a parent doesn't unload its children.

    Motion: an entity can have a MotionController (js/motion), made with
    enableMotion(). update(dt) updates it, if there is one, then each child's
    update(dt), unless setUpdatesChildren(false). Call update() on the roots
    only, or children with motion move twice a frame.

        let motion = rect.enableMotion();
        motion.add("pulse", pulse, MotionPlayStyle.kPingPongLoop);
        motion.play("pulse");

        // Each frame
        root.update(dt);                      // rect too, if it's under root
*/
class Entity
{
    static #worldBuilds = 0;   // World transforms worked out so far (see getWorldBuildCount())

    // Scratch for keepWorld
    static #kWorld = new Transform2D();
    static #kPoint = new Vector2();

    #name;
    #transform;          // Local: relative to the parent, or the world with none
    #parent;             // Entity or null
    #children;           // Entities, in the order added
    #localVersion;       // Goes up on every change to the local transform or the parent
    #world;              // The parent's world transform * the local one; unused with no parent
    #worldVersion;       // Goes up whenever the world transform changes
    #builtLocalVersion;  // The #localVersion the world transform was last worked out for
    #builtParentVersion; // The parent's world version it was last worked out for
    #motion;             // MotionController or null (see enableMotion())
    #updatesChildren;    // update() also updates the children

    constructor(_name = "")
    {
        this.#name = (typeof _name === "string") ? _name : "";
        this.#transform = new Transform2D();
        this.#parent = null;
        this.#children = [];
        this.#localVersion = 0;
        this.#world = new Transform2D();
        this.#worldVersion = 0;
        this.#builtLocalVersion = 0;
        this.#builtParentVersion = -1;
        this.#motion = null;
        this.#updatesChildren = true;
    }

    // Returns false (keeping the old name) if name isn't a string
    setName(name)
    {
        if (typeof name !== "string")
        {
            console.error("Entity.setName() needs a string");
                return false;
        }

        this.#name = name;
            return true;
    }

    getName() { return this.#name; }

    // *** Local Transform ***

    // Relative to the parent (the world with none)
    setPosition(x, y)
    {
        this.#transform.setPosition(x, y);
        this.#localChanged();
    }

    // Radians, counter-clockwise
    setRotation(radians)
    {
        this.#transform.setRotation(radians);
        this.#localChanged();
    }

    setScale(sx, sy = sx)
    {
        this.#transform.setScale(sx, sy);
        this.#localChanged();
    }

    // Copies transform (a Transform2D) as the local transform
    setTransform(transform)
    {
        this.#transform.copy(transform);
        this.#localChanged();
    }

    // The local transform. Read-only; change it with the setters above, so the world transforms follow.
    getTransform() { return this.#transform; }

    // Read-only; change it with setPosition()
    getPosition() { return this.#transform.getPosition(); }
    getRotation() { return this.#transform.getRotation(); }
    getScaleX() { return this.#transform.getScaleX(); }
    getScaleY() { return this.#transform.getScaleY(); }

    // *** World Transform ***

    // The local transform with every parent's applied. Read-only, and shared: copy it to keep it.
    getWorldTransform()
    {
        this.#refreshWorld();
            return (this.#parent === null) ? this.#transform : this.#world;
    }

    // Goes up whenever the world transform changes, including through a parent
    getWorldVersion()
    {
        this.#refreshWorld();
            return this.#worldVersion;
    }

    // A point in this entity's space (where a child at that position would sit) in the world, written into out and returned
    localToWorld(point, out = new Vector2())
    {
        return this.getWorldTransform().transformPoint(point, out);
    }

    // A world point in this entity's space, written into out and returned. out may be point.
    worldToLocal(point, out = new Vector2())
    {
        const w = this.getWorldTransform();
        const dx = point.x - w.getX();
        const dy = point.y - w.getY();
        const s = Math.sin(w.getRotation());
        const c = Math.cos(w.getRotation());
        const sx = w.getScaleX();
        const sy = w.getScaleY();
        const x = (dx * c) + (dy * s);
        const y = (dy * c) - (dx * s);

        out.set((sx !== 0.0) ? x / sx : 0.0, (sy !== 0.0) ? y / sy : 0.0);
            return out;
    }

    // *** Hierarchy ***

    // Makes child one of this entity's children (see setParent())
    addChild(child, keepWorld = false)
    {
        if ((child instanceof Entity) === false)
        {
            console.error("Entity.addChild() needs an Entity");
                return false;
        }

        return child.setParent(this, keepWorld);
    }

    // Makes child a root again; returns false if it isn't this entity's child
    removeChild(child, keepWorld = false)
    {
        if ((child instanceof Entity) === false || child.#parent !== this)
        {
            console.error("Entity.removeChild() needs one of this entity's children");
                return false;
        }

        return child.setParent(null, keepWorld);
    }

    /*
        Moves this entity under parent (an Entity), or makes it a root with null,
        at the end of the parent's children. keepWorld: see the top of this file.
        Returns false (changing nothing) if parent isn't an Entity, or is this
        entity or one of its descendants (which would make a loop).
    */
    setParent(parent, keepWorld = false)
    {
        if (parent !== null && (parent instanceof Entity) === false)
        {
            console.error("Entity.setParent() needs an Entity or null");
                return false;
        }

        if (parent === this.#parent)
            return true;

        if (parent === this || (parent !== null && this.isAncestorOf(parent) === true))
        {
            console.error(`Entity.setParent(): "${parent.#name}" is "${this.#name}" or under it, which would make a loop`);
                return false;
        }

        const world = (keepWorld === true) ? Entity.#kWorld.copy(this.getWorldTransform()) : null;

        if (this.#parent !== null)
        {
            const siblings = this.#parent.#children;
            siblings.splice(siblings.indexOf(this), 1);
        }

        this.#parent = parent;

        if (parent !== null)
            parent.#children.push(this);

        if (world !== null)
            this.#placeInWorld(world);

        this.#builtParentVersion = -1;
        this.#localChanged();
            return true;
    }

    removeFromParent(keepWorld = false) { return this.setParent(null, keepWorld); }

    getParent() { return this.#parent; }

    // Read-only; change it with addChild(), removeChild() or setParent()
    getChildren() { return this.#children; }
    getChildCount() { return this.#children.length; }

    // The first child named name, or null; recursive also searches their children, depth first
    findChild(name, recursive = false)
    {
        for (const child of this.#children)
        {
            if (child.#name === name)
                return child;

            if (recursive === true)
            {
                const found = child.findChild(name, true);

                if (found !== null)
                    return found;
            }
        }

        return null;
    }

    // True if entity is under this one (a child, grandchild ...)
    isAncestorOf(entity)
    {
        let e = (entity instanceof Entity) ? entity.#parent : null;

        while (e !== null)
        {
            if (e === this)
                return true;

            e = e.#parent;
        }

        return false;
    }

    // The top of this entity's hierarchy (itself with no parent)
    getRoot()
    {
        let e = this;

        while (e.#parent !== null)
            e = e.#parent;

        return e;
    }

    // World transforms worked out since the page loaded; take the difference between two calls for a frame's
    static getWorldBuildCount() { return Entity.#worldBuilds; }

    // *** Motion and Updating ***

    // The entity's MotionController, made the first time this is called
    enableMotion()
    {
        if (this.#motion === null)
            this.#motion = new MotionController(this);

        return this.#motion;
    }

    // Drops the MotionController, leaving the entity where its motions put it
    disableMotion() { this.#motion = null; }

    // The MotionController, or null without one
    getMotion() { return this.#motion; }

    // Whether update() also updates the children (true by default)
    setUpdatesChildren(updatesChildren) { this.#updatesChildren = (updatesChildren === true); }
    getUpdatesChildren() { return this.#updatesChildren; }

    /*
        Moves the entity's motions dt seconds on (if it has a MotionController),
        then updates each child, unless setUpdatesChildren(false). Subclasses
        that override it call super.update(dt) first.
    */
    update(dt)
    {
        if (this.#motion !== null)
            this.#motion.update(dt);

        if (this.#updatesChildren === true)
        {
            for (const child of this.#children)
                child.update(dt);
        }
    }

    // *** Subclass Methods ***

    // Called after the local transform or the parent changes (not from the constructor); override to react
    _onTransformChanged() { }

    // *** Internal Methods ***

    #localChanged()
    {
        ++this.#localVersion;
        this._onTransformChanged();
    }

    // Works the world transform out again if this entity or a parent changed since it last was
    #refreshWorld()
    {
        const p = this.#parent;

        if (p === null)
        {
            // The local transform is the world transform
            if (this.#builtLocalVersion !== this.#localVersion)
            {
                this.#builtLocalVersion = this.#localVersion;
                ++this.#worldVersion;
            }

            return;
        }

        p.#refreshWorld();

        if (this.#builtLocalVersion === this.#localVersion && this.#builtParentVersion === p.#worldVersion)
            return;

        const parentWorld = (p.#parent === null) ? p.#transform : p.#world;

        Transform2D.multiply(this.#world, parentWorld, this.#transform);
        this.#builtLocalVersion = this.#localVersion;
        this.#builtParentVersion = p.#worldVersion;
        ++this.#worldVersion;
        ++Entity.#worldBuilds;
    }

    // Sets the local transform so the world transform is world (under the current parent). Doesn't call #localChanged().
    #placeInWorld(world)
    {
        const p = this.#parent;

        if (p === null)
        {
            this.#transform.copy(world);
                return;
        }

        const pw = p.getWorldTransform();
        const pos = p.worldToLocal(world.getPosition(), Entity.#kPoint);
        const sx = (pw.getScaleX() !== 0.0) ? world.getScaleX() / pw.getScaleX() : world.getScaleX();
        const sy = (pw.getScaleY() !== 0.0) ? world.getScaleY() / pw.getScaleY() : world.getScaleY();

        this.#transform.set(pos.x, pos.y, sx, sy, world.getRotation() - pw.getRotation());
    }
}
