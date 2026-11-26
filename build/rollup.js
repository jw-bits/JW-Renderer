"use strict";

/*
    Roll-up - Joins the engine's classic scripts in js/ into one file, in load
    order, and makes a minified copy. Runs on the Node built into VS Code; it
    needs no npm packages and nothing installed.

        dist/jw-renderer.js      Every file in kFiles, in order, each under a comment naming it
        dist/jw-renderer.min.js  The same with comments, indentation and blank lines removed

    Running it:
        VS Code: Terminal > Run Build Task (Ctrl+Shift+B), "Roll-up js" (.vscode/tasks.json)

        PowerShell, from the project folder:
            $env:ELECTRON_RUN_AS_NODE = "1"; & "<VS Code folder>\Code.exe" build/rollup.js | Out-Default

        (The pipe makes PowerShell wait for Code.exe and show its output.)

    kFiles is the load order, the same as the <script> order in the pages. A
    file in js/ that isn't listed is reported and left out; a listed file
    that's missing stops the build.

    The bundle is one script with a single "use strict" at the top, so every
    file runs strict (class bodies already do).

    The minifier is deliberately simple. It only removes a line break after
    ; { , ( or [, where automatic semicolon insertion can't happen, and keeps
    lines to about 500 characters so error line numbers stay useful. It
    copies strings, template literals (the shader sources) and regular
    expressions exactly.
    It renames nothing. Both outputs are compiled (not run) before the build
    reports success.
*/

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const kRoot = path.resolve(__dirname, "..");
const kOutDir = path.join(kRoot, "dist");
const kOutName = "jw-renderer";

// The load order: each file may only use what's above it when it loads
const kFiles = [
    "js/math/math_defines.js",
    "js/math/math_utils.js",
    "js/math/matrix3.js",
    "js/math/matrix4.js",
    "js/math/vector2.js",
    "js/math/vector3.js",
    "js/math/vector4.js",
    "js/math/transform.js",
    "js/math/hermite_spline.js",

    "js/rendering/render_defines.js",
    "js/rendering/render_utils.js",
    "js/rendering/wglv.js",
    "js/rendering/buffers.js",
    "js/scenes/entity.js",
    "js/scenes/camera.js",
    "js/rendering/textures.js",
    "js/rendering/sampler.js",
    "js/rendering/render_target.js",
    "js/rendering/shader.js",
    "js/rendering/shader_source.js",
    "js/rendering/material.js",
    "js/rendering/lighting.js",
    "js/rendering/meshes.js",
    "js/rendering/models.js",
    "js/rendering/sprite.js",
    "js/rendering/particles.js",
    "js/rendering/font.js",
    "js/rendering/text.js",
    "js/rendering/batching.js",
    "js/rendering/post_effects.js",

    "js/motion/motion_defines.js",
    "js/motion/motion_base.js",
    "js/motion/motion_action.js",
    "js/motion/motion_chain.js",
    "js/motion/motion_controller.js",

    "js/spine/spine_defines.js",
    "js/spine/spine_utils.js",
    "js/spine/spine_data.js",
    "js/spine/spine_attachments.js",
    "js/spine/spine_animation.js",
    "js/spine/spine_json.js",
    "js/spine/spine_skeleton.js",
    "js/spine/spine_animation_state.js",
    "js/spine/spine_model.js",
    "js/spine/spine_debug.js",

    "js/ux/text_effects.js",
    "js/ux/label.js",
    "js/ux/toggle.js",
    "js/ux/checkbox.js",
    "js/ux/button.js",

    "js/input/input_defines.js",
    "js/input/input_manager.js",

    "js/audio/audio_defines.js",
    "js/audio/audio_manager.js",

    "js/rendering/render_managers.js"
];

/*
    Strips comments, indentation and blank lines from JavaScript source.
    Runs of spaces become one space, or none next to punctuation. A line
    break is removed only after ; { , ( or [ (no semicolon can be inserted
    there), up to kMaxLineLength; every other one is kept. Throws an Error
    on an unterminated string, template, regular expression or comment.
*/
class Minifier
{
    static kMaxLineLength = 500;

    static #kJoinAfterChars = ";{,([";
    static #kRegexAfterChars = "(,=:[!&|?{};+-*%<>~^";
    static #kRegexAfterWords = ["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"];
    static #kTightChars = "{}()[];,:=<>!?&|*%^~.";
    static #kWordChar = /[A-Za-z0-9_$#\u0080-￿]/;

    static minify(src)
    {
        const lines = [];
        let line = "";
        let pendingSpace = false;
        let lastToken = ""; // The last punctuation char or word, to tell a regular expression from a division
        let i = 0;

        const flushLine = () =>
        {
            const t = line.trim();

            if (t.length > 0)
                lines.push(t);

            line = "";
            pendingSpace = false;
        };

        const emit = (text) =>
        {
            if (pendingSpace === true && line.length > 0)
            {
                const prev = line[line.length - 1];
                const next = text[0];
                const isTight = (Minifier.#kTightChars.includes(prev) === true || Minifier.#kTightChars.includes(next) === true);
                const isPlusMinus = ("+-".includes(prev) === true && "+-".includes(next) === true);

                if (isTight === false || isPlusMinus === true)
                    line += " ";
            }

            line += text;
            pendingSpace = false;
        };

        while (i < src.length)
        {
            const c = src[i];
            const n = src[i + 1];

            if (c === "\n")
            {
                flushLine();
                i++;
            }
            else if (c === " " || c === "\t" || c === "\r" || c === "\f" || c === "\v" || c === " " || c === "﻿")
            {
                pendingSpace = true;
                i++;
            }
            else if (c === "/" && n === "/")
            {
                while (i < src.length && src[i] !== "\n")
                    i++;
            }
            else if (c === "/" && n === "*")
            {
                const end = src.indexOf("*/", i + 2);

                if (end < 0)
                    throw new Error(`unterminated comment at ${Minifier.#where(src, i)}`);

                if (src.slice(i, end).includes("\n") === true)
                    flushLine(); // A comment with a line break counts as a line break
                else
                    pendingSpace = true;

                i = end + 2;
            }
            else if (c === "\"" || c === "'")
            {
                const end = Minifier.#skipString(src, i);
                emit(src.slice(i, end));
                lastToken = "\"";
                i = end;
            }
            else if (c === "`")
            {
                const end = Minifier.#skipTemplate(src, i);
                emit(src.slice(i, end));
                lastToken = "`";
                i = end;
            }
            else if (c === "/" && Minifier.#isRegexAfter(lastToken) === true)
            {
                const end = Minifier.#skipRegex(src, i);
                emit(src.slice(i, end));
                lastToken = ")"; // A division may follow
                i = end;
            }
            else if (Minifier.#kWordChar.test(c) === true)
            {
                let end = i + 1;

                while (end < src.length && Minifier.#kWordChar.test(src[end]) === true)
                    end++;

                const word = src.slice(i, end);
                emit(word);
                lastToken = word;
                i = end;
            }
            else
            {
                emit(c);
                lastToken = c;
                i++;
            }
        }

        flushLine();
            return Minifier.#joinLines(lines);
    }

    // *** Internal Methods ***

    // Joins each line onto the one before it when that one ends in a safe char and the result isn't too long
    static #joinLines(lines)
    {
        const out = [];
        let current = "";

        for (const line of lines)
        {
            const last = (current.length > 0) ? current[current.length - 1] : "";
            const width = current.length - current.lastIndexOf("\n") - 1; // Template literals can hold line breaks
            const canJoin = (last.length > 0 && Minifier.#kJoinAfterChars.includes(last) === true);

            if (canJoin === true && width + line.length <= Minifier.kMaxLineLength)
                current += line;
            else
            {
                if (current.length > 0)
                    out.push(current);

                current = line;
            }
        }

        if (current.length > 0)
            out.push(current);

            return out.join("\n") + "\n";
    }

    static #isRegexAfter(token)
    {
        if (token.length === 0)
            return true;

        if (token.length === 1 && Minifier.#kRegexAfterChars.includes(token) === true)
            return true;

        return Minifier.#kRegexAfterWords.includes(token);
    }

    // i is at the opening quote; returns the index just past the closing one
    static #skipString(src, i)
    {
        const quote = src[i];
        let j = i + 1;

        while (j < src.length)
        {
            const c = src[j];

            if (c === "\\")
                j += 2;
            else if (c === quote)
                return j + 1;
            else if (c === "\n")
                break;
            else
                j++;
        }

        throw new Error(`unterminated string at ${Minifier.#where(src, i)}`);
    }

    // i is at the opening backtick; returns the index just past the closing one
    static #skipTemplate(src, i)
    {
        let j = i + 1;

        while (j < src.length)
        {
            const c = src[j];

            if (c === "\\")
                j += 2;
            else if (c === "`")
                return j + 1;
            else if (c === "$" && src[j + 1] === "{")
                j = Minifier.#skipSubstitution(src, j + 2);
            else
                j++;
        }

        throw new Error(`unterminated template literal at ${Minifier.#where(src, i)}`);
    }

    // i is just past a template's "${"; returns the index just past its closing "}"
    static #skipSubstitution(src, i)
    {
        let depth = 1;
        let j = i;

        while (j < src.length)
        {
            const c = src[j];

            if (c === "\"" || c === "'")
                j = Minifier.#skipString(src, j);
            else if (c === "`")
                j = Minifier.#skipTemplate(src, j);
            else if (c === "{")
            {
                depth++;
                j++;
            }
            else if (c === "}")
            {
                depth--;
                j++;

                if (depth === 0)
                    return j;
            }
            else
                j++;
        }

        throw new Error(`unterminated \${ } in a template literal at ${Minifier.#where(src, i)}`);
    }

    // i is at the opening slash; returns the index just past the closing one (flags follow as a word)
    static #skipRegex(src, i)
    {
        let inClass = false;
        let j = i + 1;

        while (j < src.length)
        {
            const c = src[j];

            if (c === "\\")
                j += 2;
            else if (c === "\n")
                break;
            else
            {
                if (c === "[")
                    inClass = true;
                else if (c === "]")
                    inClass = false;
                else if (c === "/" && inClass === false)
                    return j + 1;

                j++;
            }
        }

        throw new Error(`unterminated regular expression at ${Minifier.#where(src, i)}`);
    }

    // "line L, column C" of index i
    static #where(src, i)
    {
        const before = src.slice(0, i);
        const line = before.split("\n").length;
        const column = i - before.lastIndexOf("\n");

        return `line ${line}, column ${column}`;
    }
}

// Reads one source file as LF text without a BOM or its leading "use strict"
function readSource(rel)
{
    let text = fs.readFileSync(path.join(kRoot, rel), "utf8");

    text = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    text = text.replace(/^\s*(["'])use strict\1;?[ \t]*\n/, "");

    return text.trimEnd() + "\n";
}

// Every .js file under js/, as "js/..." paths
function listJsFiles(dir, rel, out)
{
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }))
    {
        const childRel = rel + "/" + entry.name;

        if (entry.isDirectory() === true)
            listJsFiles(path.join(dir, entry.name), childRel, out);
        else if (entry.name.endsWith(".js") === true)
            out.push(childRel);
    }

    return out;
}

// Compiles (doesn't run) text; logs and returns false on a syntax error
function checkSyntax(text, filename)
{
    try
    {
        new vm.Script(text, { filename: filename });
    }
    catch (e)
    {
        console.error(`${filename}: ${e.message}`);
        console.error(e.stack.split("\n")[0]);
            return false;
    }

        return true;
}

function main()
{
    const missing = kFiles.filter((rel) => fs.existsSync(path.join(kRoot, rel)) === false);

    if (missing.length > 0)
    {
        console.error("Roll-up: listed in kFiles but not found:\n    " + missing.join("\n    "));
            return false;
    }

    const unlisted = listJsFiles(path.join(kRoot, "js"), "js", []).filter((rel) => kFiles.includes(rel) === false);

    if (unlisted.length > 0)
        console.warn("Roll-up: in js/ but not in kFiles, so left out:\n    " + unlisted.join("\n    "));

    const banner = `/* JW-Renderer: ${kFiles.length} files from js/, joined by build/rollup.js. Don't edit; edit js/ and run the roll-up again. */\n`;
    let parts = [banner, "\"use strict\";\n"];

    for (const rel of kFiles)
        parts.push(`\n// ---- ${rel} ----\n\n`, readSource(rel));

    const bundle = parts.join("");
    let minified = "";

    try
    {
        minified = banner + Minifier.minify(bundle);
    }
    catch (e)
    {
        console.error(`Roll-up: couldn't minify: ${e.message} (of ${kOutName}.js)`);
            return false;
    }

    const bundlePath = path.join(kOutDir, kOutName + ".js");
    const minPath = path.join(kOutDir, kOutName + ".min.js");

    if (checkSyntax(bundle, bundlePath) === false || checkSyntax(minified, minPath) === false)
        return false;

    fs.mkdirSync(kOutDir, { recursive: true });
    fs.writeFileSync(bundlePath, bundle, "utf8");
    fs.writeFileSync(minPath, minified, "utf8");

    const kb = (text) => (Buffer.byteLength(text, "utf8") / 1024).toFixed(1) + " KB";

    console.log(`Roll-up: ${kFiles.length} files`);
    console.log(`    dist/${kOutName}.js      ${kb(bundle)}`);
    console.log(`    dist/${kOutName}.min.js  ${kb(minified)}`);
        return true;
}

if (main() === false)
    process.exitCode = 1;
