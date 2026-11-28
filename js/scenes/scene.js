"use strict";

/*
    Scene - The top-level container: a list of root Entities, each with its own
    render layer. It isn't an Entity and has no transform; each Entity still
    looks after its own parent and children.

        let scene = new Scene();
        scene.add(level);                     // A plain Entity with its children (walls, decor)
        scene.add(crate);                     // A root of its own (a dynamic PhysicsEntity must be one)
        scene.add(hud, 5);                    // On layer 5

        // Each frame
        scene.update(dt);                     // Each root's update(), in the order added
        scene.submit(batcher);                // Each root's submit(), on its layer

    Roots: add() takes an Entity with no parent. One that gets a parent later
    stays in the list but is skipped (update(), render(), submit(), find())
    while it has one, so it's never reached twice: once here and once through
    its parent. Made a root again, it's back where it was.

    Order: update(), render() and submit() go through the roots in the order
    they were added. A layer only decides where a root's tree is drawn (see
    Batcher), not when it's updated.

    Changes during a pass: add(), remove(), setLayer() and clear() made while
    update(), render() or submit() is running (from an Entity's update(), say,
    or a contact event it handles) wait until that pass ends, then happen in
    the order they were made. A root removed during a pass is still reached
    by the rest of it; one added isn't.

    Links only: a Scene doesn't own its Entities. remove() and clear() leave
    them as they are, and unloading their models is the caller's job. An
    Entity can be in several Scenes, which is rarely wanted.
*/
class Scene
{
    #roots;    // { entity, layer }, in the order added
    #passes;   // update() / render() / submit() calls running (they can nest)
    #pending;  // Changes made during a pass: [kind, entity, layer]

    static #kAdd = 0;
    static #kRemove = 1;
    static #kSetLayer = 2;
    static #kClear = 3;

    constructor()
    {
        this.#roots = [];
        this.#passes = 0;
        this.#pending = [];
    }

    // *** Roots ***

    /*
        Adds entity (an Entity with no parent) at the end of the list, drawn on layer
        (Batcher.kMinLayer - kMaxLayer). Returns false (changing nothing) if entity
        isn't an Entity, has a parent or is already in the list, or layer isn't valid.
        During a pass it happens when the pass ends (see the top of this file).
    */
    add(entity, layer = 0)
    {
        if ((entity instanceof Entity) === false)
        {
            console.error("Scene.add() needs an Entity");
                return false;
        }

        if (entity.getParent() !== null)
        {
            console.error(`Scene.add(): "${entity.getName()}" has a parent; a Scene holds roots only`);
                return false;
        }

        if (Scene.#isLayer(layer) === false)
        {
            console.error(`Scene.add(): layer must be ${Batcher.kMinLayer} - ${Batcher.kMaxLayer}`);
                return false;
        }

        if (this.#willHave(entity) === true)
        {
            console.error(`Scene.add(): "${entity.getName()}" is already in the scene`);
                return false;
        }

        if (this.#passes > 0)
        {
            this.#pending.push([Scene.#kAdd, entity, layer]);
                return true;
        }

        this.#roots.push({ entity, layer });
            return true;
    }

    // Takes entity out of the list (it's left as it is). Returns false if it isn't in it. During a pass it happens when the pass ends.
    remove(entity)
    {
        if (this.#willHave(entity) === false)
        {
            console.error("Scene.remove() needs an Entity in the scene");
                return false;
        }

        if (this.#passes > 0)
        {
            this.#pending.push([Scene.#kRemove, entity, 0]);
                return true;
        }

        this.#roots.splice(this.#indexOf(entity), 1);
            return true;
    }

    // Takes every Entity out of the list. During a pass it happens when the pass ends.
    clear()
    {
        if (this.#passes > 0)
        {
            this.#pending.push([Scene.#kClear, null, 0]);
                return;
        }

        this.#roots.length = 0;
    }

    // True if entity is in the list (changes waiting for a pass to end aren't counted yet)
    has(entity) { return (this.#indexOf(entity) !== -1); }

    // How many Entities are in the list, including any skipped for having a parent
    getCount() { return this.#roots.length; }

    // The index-th Entity in the order added (0 - getCount() - 1), or null
    getEntity(index)
    {
        const r = this.#roots[index];
            return (r === undefined) ? null : r.entity;
    }

    // Moves entity's tree to another layer. Returns false if entity isn't in the list or layer isn't valid. During a pass it happens when the pass ends.
    setLayer(entity, layer)
    {
        if (Scene.#isLayer(layer) === false)
        {
            console.error(`Scene.setLayer(): layer must be ${Batcher.kMinLayer} - ${Batcher.kMaxLayer}`);
                return false;
        }

        if (this.#willHave(entity) === false)
        {
            console.error("Scene.setLayer() needs an Entity in the scene");
                return false;
        }

        if (this.#passes > 0)
        {
            this.#pending.push([Scene.#kSetLayer, entity, layer]);
                return true;
        }

        this.#roots[this.#indexOf(entity)].layer = layer;
            return true;
    }

    // entity's layer, or -1 if it isn't in the list
    getLayer(entity)
    {
        const i = this.#indexOf(entity);
            return (i === -1) ? -1 : this.#roots[i].layer;
    }

    /*
        The first root named name, in the order added, or null; recursive also
        searches each root's children (depth first, see Entity.findChild()) before
        moving on to the next root. Roots with a parent are skipped.
    */
    find(name, recursive = false)
    {
        for (const r of this.#roots)
        {
            const e = r.entity;

            if (e.getParent() !== null)
                continue;

            if (e.getName() === name)
                return e;

            if (recursive === true)
            {
                const found = e.findChild(name, true);

                if (found !== null)
                    return found;
            }
        }

        return null;
    }

    // *** Updating and Drawing ***

    // Each root's update(dt) (its motion, model and children: see Entity.update()), in the order added
    update(dt)
    {
        this.#beginPass();

        try
        {
            for (const r of this.#roots)
            {
                if (r.entity.getParent() === null)
                    r.entity.update(dt);
            }
        }
        finally
        {
            this.#endPass();
        }
    }

    // Each root's render(): its model and children drawn right away, in the order added (layers aren't used)
    render()
    {
        this.#beginPass();

        try
        {
            for (const r of this.#roots)
            {
                if (r.entity.getParent() === null)
                    r.entity.render();
            }
        }
        finally
        {
            this.#endPass();
        }
    }

    // Each root's submit(batcher, layer), with its own layer, in the order added. Returns false (submitting nothing) if batcher isn't a Batcher.
    submit(batcher)
    {
        if ((batcher instanceof Batcher) === false)
        {
            console.error("Scene.submit() needs a Batcher");
                return false;
        }

        this.#beginPass();

        try
        {
            for (const r of this.#roots)
            {
                if (r.entity.getParent() === null)
                    r.entity.submit(batcher, r.layer);
            }
        }
        finally
        {
            this.#endPass();
        }

        return true;
    }

    // *** Internal Methods ***

    static #isLayer(layer)
    {
        return (Number.isInteger(layer) === true && layer >= Batcher.kMinLayer && layer <= Batcher.kMaxLayer);
    }

    #indexOf(entity)
    {
        for (let i = 0; i < this.#roots.length; ++i)
        {
            if (this.#roots[i].entity === entity)
                return i;
        }

        return -1;
    }

    // Whether entity will be in the list once the changes waiting for the pass are made
    #willHave(entity)
    {
        let has = (this.#indexOf(entity) !== -1);

        for (const [kind, e] of this.#pending)
        {
            if (kind === Scene.#kClear)
                has = false;
            else if (e === entity && kind === Scene.#kAdd)
                has = true;
            else if (e === entity && kind === Scene.#kRemove)
                has = false;
        }

        return has;
    }

    #beginPass() { ++this.#passes; }

    // Makes the changes that waited, once the outermost pass ends
    #endPass()
    {
        if (--this.#passes > 0 || this.#pending.length === 0)
            return;

        const pending = this.#pending;
        this.#pending = [];

        for (const [kind, entity, layer] of pending)
        {
            if (kind === Scene.#kAdd)
                this.#roots.push({ entity, layer });
            else if (kind === Scene.#kRemove)
                this.#roots.splice(this.#indexOf(entity), 1);
            else if (kind === Scene.#kSetLayer)
                this.#roots[this.#indexOf(entity)].layer = layer;
            else
                this.#roots.length = 0;
        }
    }
}
