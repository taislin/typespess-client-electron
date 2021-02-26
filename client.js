(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
(function (process,global){(function (){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Atom = require("./lib/atom.js");
const IconRenderer = require("./lib/icon_renderer.js");
const PanelManager = require("./lib/panels/manager.js");
const Component = require("./lib/component.js");
const EventEmitter = require("events");
const Sound = require("./lib/sound.js");
const Matrix = require("./lib/matrix.js");
const { Eye, Plane } = require("./lib/eye.js");
const isElectron = require("is-electron");

class TypespessClient extends EventEmitter {
    constructor(wsurl, resRoot = "") {
        super();
        if (!wsurl) {
            wsurl = "ws" + window.location.origin.substring(4);
        }
        if (isElectron()) {
            wsurl = "ws://localhost:1713";
        }
        this.resRoot = resRoot;
        this.wsurl = wsurl;
        this.atoms_by_netid = {};
        this.atoms = [];
        this.visible_tiles = new Set();
        this.dirty_atoms = [];
        this.glide_size = 10;
        this.icon_meta_load_queue = {};
        this.icon_metas = {};
        this.components = {};
        this.panel_classes = {};
        this.eyes = {};
        this.server_time_to_client = 0;
        this.audio_buffers = new Map();
        this.playing_sounds = new Map();
        this.soft_shadow_resolution = 8;
        if (!global.is_bs_editor_env && global.AudioContext) {
            this.audio_ctx = new AudioContext();
        }
        this.importModule(require("./lib/lighting.js"));
    }
    handle_login() {
        this.connection.send(JSON.stringify({ login: "guest" + Math.floor(Math.random() * 1000000) }));
        this.login_finish();
    }
    login() {
        if (global.is_bs_editor_env) {
            throw new Error("Client should not be started in editor mode");
        }
        this.connection = new WebSocket(this.wsurl);
        this.panel_manager = new PanelManager(this);
        this.connection.addEventListener("open", () => {
            this.handle_login();
        });
        window.addEventListener("mousedown", () => {
            // damn it chrome
            this.audio_ctx.resume();
        }, { once: true });
    }
    login_finish() {
        if (global.is_bs_editor_env) {
            throw new Error("Client should not be started in editor mode");
        }
        this.connection.addEventListener("message", this.handleSocketMessage.bind(this));
        requestAnimationFrame(this.anim_loop.bind(this)); // Start the rendering loop
        const networked_down = new Set();
        document.addEventListener("keydown", (e) => {
            if (e.target.localName !== "input" && this.connection) {
                networked_down.add(e.key);
                this.connection.send(JSON.stringify({ keydown: { key: e.key, id: e.target.id } }));
            }
        });
        document.addEventListener("keyup", (e) => {
            if ((e.target.localName !== "input" && this.connection) || networked_down.has(e.key)) {
                networked_down.delete(e.key);
                this.connection.send(JSON.stringify({ keyup: { key: e.key, id: e.target.id } }));
            }
        });
        window.addEventListener("blur", () => {
            for (const key of networked_down) {
                this.connection.send(JSON.stringify({ keyup: { key } }));
                networked_down.delete(key);
            }
        });
    }
    importModule(mod) {
        if (mod.components) {
            for (const componentName in mod.components) {
                if (Object.prototype.hasOwnProperty.call(mod.components, componentName)) {
                    if (this.components[componentName]) {
                        throw new Error(`Component ${componentName} already exists!`);
                    }
                    if (mod.components[componentName].name !== componentName) {
                        throw new Error(`Component name mismatch! Named ${componentName} in map and constructor is named ${mod.components[componentName].name}`);
                    }
                    this.components[componentName] = mod.components[componentName];
                }
            }
        }
        if (mod.panel_classes) {
            for (const class_name in mod.panel_classes) {
                if (Object.prototype.hasOwnProperty.call(mod.panel_classes, class_name)) {
                    if (this.panel_classes[class_name]) {
                        throw new Error(`Panel class ${class_name} already exists!`);
                    }
                    if (mod.panel_classes[class_name].name !== class_name) {
                        throw new Error(`Panel class name mismatch! Named ${class_name} in map and constructor is named ${mod.panel_classes[class_name].name}`);
                    }
                    this.panel_classes[class_name] = mod.panel_classes[class_name];
                }
            }
        }
        if (mod.now instanceof Function) {
            mod.now(this);
        }
    }
    update_atoms(obj, timestamp) {
        for (let i = 0; i < obj.update_atoms.length; i++) {
            const inst = obj.update_atoms[i];
            const atom = this.atoms_by_netid[inst.network_id];
            if (!atom) {
                continue;
            }
            const oldx = atom.x;
            const oldy = atom.y;
            for (const key in inst) {
                if (!Object.prototype.hasOwnProperty.call(inst, key)) {
                    continue;
                }
                if (key === "appearance" || key === "network_id" || key === "overlays" || key === "components") {
                    continue;
                }
                atom[key] = inst[key];
            }
            atom.glide = new Atom.Glide(atom, { oldx, oldy, lasttime: timestamp });
            if (inst.overlays) {
                for (const key in inst.overlays) {
                    if (!Object.prototype.hasOwnProperty.call(inst.overlays, key)) {
                        continue;
                    }
                    atom.set_overlay(key, inst.overlays[key]);
                }
            }
            if (inst.components) {
                this.update_components(inst, atom);
            }
        }
    }
    update_components(inst, atom) {
        for (const component_name in inst.components) {
            if (!Object.prototype.hasOwnProperty.call(inst.components, component_name)) {
                continue;
            }
            for (const key in inst.components[component_name]) {
                if (!Object.prototype.hasOwnProperty.call(inst.components[component_name], key)) {
                    continue;
                }
                atom.components[component_name][key] = inst.components[component_name][key];
            }
        }
    }
    delete_atoms(obj) {
        for (let i = 0; i < obj.delete_atoms.length; i++) {
            const atom = this.atoms_by_netid[obj.delete_atoms[i]];
            if (!atom) {
                continue;
            }
            atom.del();
        }
    }
    update_eye(obj, timestamp) {
        for (const [id, props] of Object.entries(obj.eye)) {
            const eye = this.eyes[id];
            if (!eye) {
                continue;
            }
            const oldx = eye.origin.x;
            const oldy = eye.origin.y;
            Object.assign(eye.origin, props);
            eye.origin.glide = new Atom.Glide(eye.origin, {
                oldx,
                oldy,
                lasttime: timestamp,
            });
        }
    }
    to_chat(obj) {
        const cw = document.getElementById("chatwindow");
        let do_scroll = false;
        if (cw.scrollTop + cw.clientHeight >= cw.scrollHeight) {
            do_scroll = true;
        }
        for (const item of obj.to_chat) {
            const newdiv = document.createElement("div");
            newdiv.innerHTML = item;
            document.getElementById("chatwindow").appendChild(newdiv);
        }
        if (do_scroll) {
            cw.scrollTop = cw.scrollHeight - cw.clientHeight;
        }
    }
    handleSocketMessage(event) {
        const obj = JSON.parse(event.data);
        const timestamp = performance.now();
        if (obj.create_atoms) {
            for (let i = 0; i < obj.create_atoms.length; i++) {
                // eslint-disable-next-line no-new
                new Atom(this, obj.create_atoms[i]);
            }
        }
        if (obj.update_atoms) {
            this.update_atoms(obj, timestamp);
        }
        if (obj.delete_atoms) {
            this.delete_atoms(obj);
        }
        if (obj.timestamp) {
            this.server_time_to_client = timestamp - obj.timestamp;
        }
        if (obj.add_tiles) {
            for (const tile of obj.add_tiles) {
                this.visible_tiles.add(tile);
            }
        }
        if (obj.remove_tiles) {
            for (const tile of obj.remove_tiles) {
                this.visible_tiles.delete(tile);
            }
        }
        if (obj.eye) {
            this.update_eye(obj, timestamp);
        }
        if (obj.to_chat) {
            this.to_chat(obj);
        }
        if (obj.panel) {
            this.panel_manager.handle_message(obj.panel);
        }
        if (obj.sound) {
            if (obj.sound.play) {
                for (const sound of obj.sound.play) {
                    if (this.playing_sounds.get(sound.id)) {
                        continue;
                    }
                    new Sound(this, sound).start();
                }
            }
            if (obj.sound.stop) {
                for (const id of obj.sound.stop) {
                    const sound = this.playing_sounds.get(id);
                    if (sound) {
                        sound.stop();
                    }
                }
            }
        }
        this.atoms.sort(Atom.atom_comparator);
        return obj;
    }
}
// This is pretty much identical to the function on the server's lib/utils.js
const _chain_parent = Symbol("_chain_parent");
const _chain_spliced = Symbol("_chain_spliced");
TypespessClient.chain_func = function (func1, func2) {
    if (typeof func2 === "undefined") {
        throw new Error("Chaining undefined function!");
    }
    function chained_func(...args) {
        while (chained_func[_chain_parent] && chained_func[_chain_parent][_chain_spliced]) {
            chained_func[_chain_parent] = chained_func[_chain_parent][_chain_parent];
        }
        const prev = (...override_args) => {
            if (!chained_func[_chain_parent]) {
                return;
            }
            if (override_args.length) {
                return chained_func[_chain_parent].call(this, ...override_args);
            }
            else {
                return chained_func[_chain_parent].call(this, ...args);
            }
        };
        if (chained_func[_chain_spliced]) {
            return prev();
        }
        return func2.call(this, prev, ...args);
    }
    chained_func.splice = function () {
        chained_func[_chain_spliced] = true;
    };
    chained_func[_chain_spliced] = false;
    chained_func[_chain_parent] = func1;
    return chained_func;
};
TypespessClient.dropdown = function (elem1, elem2, { point = [], autoremove = true } = {}) {
    let rect;
    if (point) {
        rect = {
            x: point[0],
            y: point[1],
            width: 0,
            height: 0,
            left: point[0],
            right: point[0],
            top: point[1],
            bottom: point[1],
        };
    }
    else {
        rect = elem1.getBoundingClientRect();
    }
    const [viewport_width, viewport_height] = [
        document.documentElement.clientWidth,
        document.documentElement.clientHeight,
    ];
    elem2.style.position = "fixed";
    elem2.style.visibility = "hidden";
    elem1.appendChild(elem2);
    const dropdown_rect = elem2.getBoundingClientRect();
    let flip_horizontal = false;
    let flip_vertical = false;
    const sideways = elem1.classList.contains("dropdown-item");
    if ((sideways ? rect.right : rect.left) + dropdown_rect.width >= viewport_width - 10) {
        flip_horizontal = true;
    }
    if ((sideways ? rect.top : rect.bottom) + dropdown_rect.height >= viewport_height - 10 &&
        (sideways ? rect.top : rect.bottom) >= viewport_width / 2) {
        flip_vertical = true;
    }
    const dropdown_x = sideways && !flip_horizontal ? rect.right : rect.left;
    const dropdown_y = !sideways && !flip_vertical ? rect.bottom : rect.top;
    if (flip_horizontal) {
        elem2.style.right = viewport_width - dropdown_x + "px";
        elem2.style.maxWidth = dropdown_x - 10 + "px";
    }
    else {
        elem2.style.left = dropdown_x + "px";
        elem2.style.maxWidth = viewport_width - dropdown_x - 10 + "px";
    }
    if (flip_vertical) {
        elem2.style.bottom = viewport_height - dropdown_y + "px";
        elem2.style.maxHeight = dropdown_y - 10 + "px";
    }
    else {
        elem2.style.top = dropdown_y + "px";
        elem2.style.maxHeight = viewport_height - dropdown_y - 10 + "px";
    }
    if (!sideways && rect.width) {
        elem2.style.minWidth = rect.width + "px";
    }
    if (autoremove) {
        elem2.tabIndex = -1;
        if (!elem2.dataset.hasDropdownFocusoutListener) {
            elem2.dataset.hasDropdownFocusoutListener = true;
            elem2.addEventListener("focusout", () => {
                setTimeout(() => {
                    if (elem2 !== document.activeElement &&
                        !elem2.contains(document.activeElement) &&
                        elem1.contains(elem2)) {
                        elem1.removeChild(elem2);
                    }
                }, 0);
            });
        }
    }
    elem2.style.visibility = "";
    if (autoremove) {
        elem2.focus();
    }
};
TypespessClient.prototype.enqueue_icon_meta_load = require("./lib/icon_loader.js");
TypespessClient.prototype.anim_loop = require("./lib/renderer.js");
TypespessClient.prototype.get_audio_buffer = require("./lib/audio_loader.js");
TypespessClient.Atom = Atom;
TypespessClient.Component = Component;
TypespessClient.IconRenderer = IconRenderer;
TypespessClient.Sound = Sound;
TypespessClient.Matrix = Matrix;
TypespessClient.Eye = Eye;
TypespessClient.Plane = Plane;
module.exports = TypespessClient;

}).call(this)}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./lib/atom.js":2,"./lib/audio_loader.js":3,"./lib/component.js":4,"./lib/eye.js":5,"./lib/icon_loader.js":6,"./lib/icon_renderer.js":7,"./lib/lighting.js":8,"./lib/matrix.js":9,"./lib/panels/manager.js":10,"./lib/renderer.js":12,"./lib/sound.js":13,"_process":40,"electron":36,"events":37,"is-electron":38}],2:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const IconRenderer = require("./icon_renderer.js");
const Matrix = require("./matrix.js");
const EventEmitter = require("events");
class Atom extends EventEmitter {
    constructor(client, instobj) {
        super();
        if (!Object.prototype.hasOwnProperty.call(instobj, "x")) {
            instobj.x = 0;
        }
        if (!Object.prototype.hasOwnProperty.call(instobj, "y")) {
            instobj.y = 0;
        }
        this.client = client;
        this.directional = instobj.directional;
        this.main_icon_renderer = new IconRenderer(this);
        this.overlays = {};
        this.overlay_renderers_list = [];
        this.overlay_renderers = {};
        for (const key in instobj) {
            if (!Object.prototype.hasOwnProperty.call(instobj, key)) {
                continue;
            }
            if (key === "overlays" || key === "components" || key === "component_vars") {
                continue;
            }
            this[key] = instobj[key];
        }
        this.is_destroyed = false;
        this.client.atoms.push(this);
        if (this.network_id) {
            this.client.atoms_by_netid[this.network_id] = this;
        }
        this.eye_id = instobj.eye_id || "";
        this.eye = client.eyes[this.eye_id];
        if (this.eye) {
            this.eye.atoms.add(this);
        }
        this.mark_dirty();
        if (instobj.overlays) {
            for (const key in instobj.overlays) {
                if (!Object.prototype.hasOwnProperty.call(instobj.overlays, key)) {
                    continue;
                }
                this.set_overlay(key, instobj.overlays[key]);
            }
        }
        this.components = {};
        for (const component_name of instobj.components || []) {
            if (!Object.prototype.hasOwnProperty.call(client.components, component_name)) {
                console.warn(`Server passed an unknown networked component '${component_name}'! Yell at the devs of your server.`);
                continue;
            }
            const Ctor = client.components[component_name];
            this.components[component_name] = new Ctor(this, instobj.component_vars ? instobj.component_vars[component_name] : {});
        }
    }
    del() {
        this.is_destroyed = true;
        if (this.eye) {
            this.eye.atoms.delete(this);
            const plane = this.get_plane();
            if (plane) {
                plane.atoms.delete(this);
            }
        }
        this.client.atoms.splice(this.client.atoms.indexOf(this), 1);
        delete this.client.atoms_by_netid[this.network_id];
        for (const tcomponent of Object.values(this.components)) {
            const component = tcomponent;
            component.destroy();
        }
    }
    get_plane_id() {
        // eslint-disable-next-line eqeqeq -- otherwise it wont work
        if (this.screen_loc_x != null || this.screen_loc_y != null) {
            return "ui";
        }
        return "";
    }
    get_plane() {
        return this.eye && this.eye.planes.get(this.get_plane_id());
    }
    mark_dirty() {
        const plane = this.get_plane();
        if (plane) {
            plane.dirty_atoms.add(this);
        }
    }
    set_overlay(key, value) {
        let overlay_renderer;
        if (this.overlays[key] && !value) {
            delete this.overlays[key];
            overlay_renderer = this.overlay_renderers[key];
            const idx = this.overlay_renderers_list.indexOf(overlay_renderer);
            if (idx !== -1) {
                this.overlay_renderers_list.splice(idx, 1);
            }
            delete this.overlay_renderers[key];
            this.mark_dirty();
            return;
        }
        if (!this.overlays[key] && value) {
            this.overlays[key] = value;
            overlay_renderer = new IconRenderer(this);
            this.overlay_renderers_list.push(overlay_renderer);
            this.overlay_renderers[key] = overlay_renderer;
            overlay_renderer.parent = this.main_icon_renderer;
        }
        else if (this.overlays[key] && value) {
            overlay_renderer = this.overlay_renderers[key];
            this.overlays[key] = value;
        }
        else {
            return;
        }
        overlay_renderer.overlay_layer = value.overlay_layer || 0;
        for (const prop of ["icon", "icon_state", "dir", "color", "alpha", "offset_x", "offset_y"]) {
            overlay_renderer[prop] = value[prop];
        }
        this.overlay_renderers_list.sort((a, b) => {
            return a.overlay_layer - b.overlay_layer;
        });
    }
    get_displacement(timestamp) {
        let dispx = 0;
        let dispy = 0;
        // eslint-disable-next-line eqeqeq
        if (this.screen_loc_x != null) {
            dispx = this.screen_loc_x;
            dispy = this.screen_loc_y;
        }
        else {
            let glidex = 0;
            let glidey = 0;
            this.update_glide(timestamp);
            if (this.glide) {
                glidex = this.glide.x;
                glidey = this.glide.y;
            }
            dispx = this.x + glidex;
            dispy = this.y + glidey;
        }
        return { dispx, dispy };
    }
    get_transform() {
        return Matrix.identity;
    }
    update_glide(timestamp) {
        if (!this.glide) {
            return;
        }
        this.glide.update(timestamp);
    }
    is_mouse_over(x, y) {
        for (const overlay of this.overlay_renderers_list) {
            if (overlay.is_mouse_over(x, y)) {
                return true;
            }
        }
        return this.main_icon_renderer.is_mouse_over(x, y);
    }
    on_render_tick(timestamp) {
        for (const overlay of this.overlay_renderers_list) {
            overlay.on_render_tick(timestamp);
        }
        return this.main_icon_renderer.on_render_tick(timestamp);
    }
    draw(ctx, timestamp) {
        for (const overlay of this.overlay_renderers_list) {
            overlay.draw(ctx, timestamp);
        }
        let i;
        for (i = 0; i < this.overlay_renderers_list.length; i++) {
            const overlay = this.overlay_renderers_list[i];
            if (overlay.overlay_layer >= 0) {
                break;
            }
            overlay.draw(ctx, timestamp);
        }
        this.main_icon_renderer.draw(ctx, timestamp);
        for (; i < this.overlay_renderers_list.length; i++) {
            const overlay = this.overlay_renderers_list[i];
            overlay.draw(ctx, timestamp);
        }
    }
    get_bounds() {
        let bounds = this.main_icon_renderer.get_bounds();
        for (const overlay of this.overlay_renderers_list) {
            const overlay_bounds = overlay.get_bounds();
            if (!overlay_bounds) {
                continue;
            }
            if (!bounds) {
                bounds = overlay_bounds;
                continue;
            }
            if (overlay_bounds.x < bounds.x) {
                bounds.width += bounds.x - overlay_bounds.x;
                bounds.x = overlay_bounds.x;
            }
            if (overlay_bounds.y < bounds.y) {
                bounds.height += bounds.y - overlay_bounds.y;
                bounds.y = overlay_bounds.y;
            }
            bounds.width = Math.max(bounds.width, overlay_bounds.x - bounds.x + overlay_bounds.width);
            bounds.height = Math.max(bounds.height, overlay_bounds.y - bounds.y + overlay_bounds.height);
        }
        return bounds;
    }
    get_transformed_bounds() {
        const transform = this.get_transform();
        const bounds = this.get_bounds();
        if (!bounds) {
            return bounds;
        }
        const corners = [
            [bounds.x, bounds.y],
            [bounds.x + bounds.width, bounds.y],
            [bounds.x, bounds.y + bounds.height],
            [bounds.x + bounds.width, bounds.y + bounds.height],
        ];
        let [left, right, top, bottom] = [Infinity, -Infinity, -Infinity, Infinity];
        for (const corner of corners) {
            const transformed_corner = transform.multiply_array([corner[0] - 0.5, corner[1] - 0.5]);
            transformed_corner[0] += 0.5;
            transformed_corner[1] += 0.5;
            left = Math.min(left, transformed_corner[0]);
            right = Math.max(right, transformed_corner[0]);
            top = Math.max(top, transformed_corner[1]);
            bottom = Math.min(bottom, transformed_corner[1]);
        }
        return {
            x: left,
            y: bottom,
            width: right - left,
            height: top - bottom,
        };
    }
    fully_load(forced_directional = false) {
        const promises = [];
        promises.push(this.main_icon_renderer.fully_load(forced_directional));
        for (const overlay of this.overlay_renderers_list) {
            promises.push(overlay.fully_load(forced_directional));
        }
        return Promise.all(promises);
    }
    get icon() {
        return this.main_icon_renderer.icon;
    }
    set icon(val) {
        this.main_icon_renderer.icon = val;
    }
    get icon_state() {
        return this.main_icon_renderer.icon_state;
    }
    set icon_state(val) {
        this.main_icon_renderer.icon_state = val;
    }
    get dir() {
        return this.main_icon_renderer.dir;
    }
    set dir(val) {
        this.main_icon_renderer.dir = val;
    }
    get color() {
        return this.main_icon_renderer.color;
    }
    set color(val) {
        this.main_icon_renderer.color = val;
    }
    get alpha() {
        return this.main_icon_renderer.alpha;
    }
    set alpha(val) {
        this.main_icon_renderer.alpha = val;
    }
    get c() {
        return this.components;
    }
}
class Glide {
    constructor(object, params) {
        this.object = object;
        this.lasttime = params.lasttime || performance.now();
        this.x = 0;
        this.y = 0;
        if (params.oldx === +params.oldx &&
            params.oldy === +params.oldy &&
            (params.oldx !== object.x || params.oldy !== object.y) &&
            Math.abs(Math.max(object.x - params.oldx, object.y - params.oldy)) <= 1.5001) {
            let pgx = (object.glide && object.glide.x) || 0;
            if (Math.sign(pgx) === params.oldx - object.x) {
                pgx = 0;
            }
            let pgy = (object.glide && object.glide.y) || 0;
            if (Math.sign(pgy) === params.oldy - object.y) {
                pgy = 0;
            }
            Object.assign(this, {
                x: params.oldx - object.x + pgx,
                y: params.oldy - object.y + pgy,
            });
            return this;
        }
        return object.glide;
    }
    update(timestamp) {
        let glidex = this.x;
        let glidey = this.y;
        let glide_size = +this.object.glide_size;
        if (glide_size !== glide_size) {
            glide_size = this.object.client.glide_size;
        }
        if (glide_size !== glide_size || glide_size === 0) {
            this.object.glide = null;
            return;
        }
        const dist = Math.max((glide_size * (timestamp - this.lasttime)) / 1000, 0);
        this.lasttime = timestamp;
        if (Math.abs(glidex) < dist) {
            glidex = 0;
        }
        else {
            glidex -= Math.sign(glidex) * dist;
        }
        if (Math.abs(glidey) < dist) {
            glidey = 0;
        }
        else {
            glidey -= Math.sign(glidey) * dist;
        }
        this.x = glidex;
        this.y = glidey;
        if (glidex === 0 && glidey === 0) {
            this.object.glide = void 0;
        }
    }
}
Atom.Glide = Glide;
Atom.atom_comparator = function (a, b) {
    if (!a && !b) {
        return 0;
    }
    if (!a) {
        return 1;
    }
    if (!b) {
        return -1;
    }
    let comparison = a.layer - b.layer;
    if (comparison === 0) {
        comparison = b.y - a.y;
    }
    if (comparison === 0) {
        if (a.network_id > b.network_id) {
            comparison = 1;
        }
        else if (a.network_id < b.network_id) {
            comparison = -1;
        }
    }
    return comparison;
};
module.exports = Atom;

},{"./icon_renderer.js":7,"./matrix.js":9,"events":37}],3:[function(require,module,exports){
"use strict";
function get_audio_buffer(client, url) {
    const old_buf = client.audio_buffers.get(url);
    if (old_buf) {
        return old_buf;
    }
    const promise = new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", client.resRoot + url, true);
        xhr.responseType = "arraybuffer";
        xhr.onload = () => {
            const data = xhr.response;
            resolve(client.audio_ctx.decodeAudioData(data));
        };
        xhr.onerror = (err) => {
            reject(err);
        };
        xhr.send();
    });
    client.audio_buffers.set(url, promise);
    return promise;
}
module.exports = get_audio_buffer;

},{}],4:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const EventEmitter = require("events");
class Component extends EventEmitter {
    constructor(atom, template) {
        super();
        if (template) {
            Object.assign(this, template);
        }
        Object.defineProperty(this, "atom", {
            enumerable: false,
            configurable: false,
            writable: false,
            value: atom,
        });
    }
    get a() {
        return this.atom;
    }
    destroy() { return; }
}
module.exports = Component;

},{"events":37}],5:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Atom = require("./atom.js");
const EventEmitter = require("events");
class Eye extends EventEmitter {
    constructor(client, id) {
        super();
        this.client = client;
        this.id = id;
        this.planes = new Map();
        this.atoms = new Set();
        this.last_planes = new WeakMap();
        if (client.eyes[id]) {
            throw new Error(`duplicate plane of id ${id}`);
        }
        client.eyes[id] = this;
        for (const atom of client.atoms) {
            if (atom.eye_id === id) {
                atom.eye = this;
                this.atoms.add(atom);
            }
        }
        this.mouse_over_atom = null;
        this.last_mouse_event = null;
        this.origin = {
            x: 0,
            y: 0,
            glide_size: 10,
            update_glide: Atom.prototype.update_glide,
            client: this.client,
            get_displacement: Atom.prototype.get_displacement,
        };
    }
    draw(timestamp) {
        if (!this.canvas) {
            return;
        }
        const ctx = this.canvas.getContext("2d");
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        for (const atom of this.atoms) {
            atom.on_render_tick(timestamp);
            const last_plane = this.last_planes.get(atom);
            const plane = atom.get_plane();
            if (last_plane !== plane) {
                if (last_plane) {
                    last_plane.atoms.delete(atom);
                }
                if (plane) {
                    plane.atoms.add(atom);
                }
                this.last_planes.set(atom, plane);
            }
        }
        for (const plane of [...this.planes.values()].sort((a, b) => {
            return a.z_index - b.z_index;
        })) {
            plane.draw(ctx, timestamp);
        }
        if (this.last_mouse_event) {
            this.handle_mousemove(this.last_mouse_event, timestamp);
        }
    }
    get_world_draw_pos(x, y, timestamp) {
        let { dispx, dispy } = (this.origin &&
            this.origin.get_displacement &&
            this.origin.get_displacement(timestamp)) || { dispx: 0, dispy: 0 };
        dispx = Math.round(dispx * 32) / 32;
        dispy = Math.round(dispy * 32) / 32;
        return [(x - dispx + 7) * 32, -(y - dispy - 7) * 32];
    }
    screen_to_world(x, y, timestamp) {
        const { dispx, dispy } = (this.origin &&
            this.origin.get_displacement &&
            this.origin.get_displacement(timestamp)) || { dispx: 0, dispy: 0 };
        return [x / 32 - 7 + dispx, -y / 32 + 8 + dispy];
    }
    create_click_handlers() {
        this.canvas.addEventListener("mousedown", this.handle_mousedown.bind(this));
        this.canvas.addEventListener("mouseover", this.handle_mouseout.bind(this));
        this.canvas.addEventListener("mousemove", this.handle_mousemove.bind(this));
        this.canvas.addEventListener("mouseout", this.handle_mouseout.bind(this));
    }
    get_mouse_target(e, timestamp = performance.now()) {
        const rect = e.target.getBoundingClientRect();
        const clickX = ((e.clientX - rect.left) / rect.width) * e.target.width;
        const clickY = ((e.clientY - rect.top) / rect.height) * e.target.height;
        let localX;
        let localY;
        // Iterate through the atoms from top to bottom.
        let clickedAtom;
        for (const plane of [...this.planes.values()].sort((a, b) => {
            return b.z_index - a.z_index;
        })) {
            if (plane.no_click) {
                continue;
            }
            const [originx, originy] = plane.calculate_origin(timestamp);
            const [offsetx, offsety] = plane.calculate_composite_offset(timestamp);
            const loc = `[${Math.floor((clickX - offsetx) / 32 + originx)},${Math.floor((-clickY + plane.canvas.height + offsety) / 32 + originy)}]`;
            const tile = plane.tiles.get(loc);
            if (!tile) {
                continue;
            } //there's nothing there.
            for (const atom of [...tile].sort((a, b) => {
                return Atom.atom_comparator(b, a);
            })) {
                if (typeof atom.mouse_opacity === "undefined") {
                    atom.mouse_opacity = 1;
                }
                if (atom.mouse_opacity === 0) {
                    continue;
                }
                let { dispx, dispy } = atom.get_displacement(timestamp);
                dispx = Math.round(dispx * 32) / 32;
                dispy = Math.round(dispy * 32) / 32;
                const [scrx, scry] = [
                    Math.round((dispx - originx) * 32 + offsetx),
                    Math.round(plane.canvas.height - (dispy - originy) * 32 - 32 + offsety),
                ];
                localX = (clickX - scrx) / 32;
                localY = 1 - (clickY - scry) / 32;
                [localX, localY] = atom
                    .get_transform(timestamp)
                    .inverse()
                    .multiply_array([localX - 0.5, localY - 0.5]);
                localX += 0.5;
                localY += 0.5;
                const bounds = atom.get_bounds(timestamp);
                if ((bounds &&
                    localX >= bounds.x &&
                    localX < bounds.x + bounds.width &&
                    localY >= bounds.y &&
                    localY < bounds.y + bounds.height &&
                    atom.mouse_opacity === 2) ||
                    atom.is_mouse_over(localX, localY, timestamp)) {
                    clickedAtom = atom;
                    break;
                }
            }
            if (clickedAtom) {
                break;
            }
        }
        const [world_x, world_y] = this.screen_to_world(clickX, clickY, timestamp);
        return {
            atom: clickedAtom,
            x: localX,
            y: localY,
            ctrlKey: e.ctrlKey,
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            button: e.button,
            world_x,
            world_y,
        };
    }
    handle_mousedown(e) {
        e.preventDefault();
        const start_meta = this.get_mouse_target(e);
        const start_time = performance.now();
        const mouseup = (e2) => {
            if (e2.button !== e.button) {
                return;
            }
            document.removeEventListener("mouseup", mouseup);
            const end_time = performance.now();
            const end_meta = this.get_mouse_target(e2);
            if (end_time - start_time < 200 || end_meta.atom === start_meta.atom) {
                if (this.client.connection) {
                    this.client.connection.send(JSON.stringify({
                        click_on: Object.assign({}, start_meta, {
                            atom: start_meta && start_meta.atom && start_meta.atom.network_id,
                        }),
                    }));
                }
                return;
            }
            this.client.connection.send(JSON.stringify({
                drag: {
                    from: Object.assign({}, start_meta, {
                        atom: start_meta && start_meta.atom && start_meta.atom.network_id,
                    }),
                    to: Object.assign({}, end_meta, {
                        atom: end_meta && end_meta.atom && end_meta.atom.network_id,
                    }),
                },
            }));
        };
        document.addEventListener("mouseup", mouseup);
    }
    handle_mouseover(e) {
        this.last_mouse_event = e;
        const meta = this.get_mouse_target(e);
        const old = this.mouse_over_atom;
        if (this.mouse_over_atom) {
            this.mouse_over_atom.emit("mouseout");
        }
        this.mouse_over_atom = meta.atom;
        if (this.mouse_over_atom) {
            this.mouse_over_atom.emit("mouseover", Object.assign(meta, { original_event: e }));
            this.emit("mouse_over_atom_changed", old, this.mouse_over_atom);
        }
    }
    handle_mouseout() {
        const old = this.mouse_over_atom;
        if (this.mouse_over_atom) {
            this.mouse_over_atom.emit("mouseout");
        }
        this.mouse_over_atom = null;
        this.last_mouse_event = null;
        if (old) {
            this.emit("mouse_over_atom_changed", old, null);
        }
    }
    handle_mousemove(e, timestamp = performance.now()) {
        this.last_mouse_event = e;
        const meta = this.get_mouse_target(e, timestamp);
        if (meta.atom !== this.mouse_over_atom) {
            if (this.mouse_over_atom) {
                this.mouse_over_atom.emit("mouseout");
            }
            const old = this.mouse_over_atom;
            this.mouse_over_atom = meta.atom;
            if (this.mouse_over_atom) {
                this.mouse_over_atom.emit("mouseover", Object.assign(meta, { original_event: e }));
            }
            this.emit("mouse_over_atom_changed", old, this.mouse_over_atom);
        }
        else {
            if (this.mouse_over_atom) {
                this.mouse_over_atom.emit("mousemove", Object.assign(meta, { original_event: e }));
            }
        }
    }
}
class Plane {
    constructor(eye, id) {
        this.z_index = 0;
        this.canvas = document.createElement("canvas");
        this.draw_canvas = document.createElement("canvas");
        this.mask_canvas = document.createElement("canvas");
        this.atoms = new Set();
        this.dirty_atoms = new Set();
        this.last_draw = new Map();
        this.tiles = new Map();
        this.eye = eye;
        this.client = eye.client;
        this.id = id;
        eye.planes.set(id, this);
    }
    draw(eye_ctx, timestamp) {
        this.size_canvases();
        this.draw_objects(timestamp);
        this.composite_plane(eye_ctx, timestamp);
    }
    draw_objects(timestamp) {
        // I know what you're thinking. "Why not use just one canvas and clip()?"
        // Well it doesn't seem to work so well in firefox if I do that.
        const ctx = this.canvas.getContext("2d");
        const dctx = this.draw_canvas.getContext("2d");
        const mctx = this.mask_canvas.getContext("2d");
        this.client.emit("before_draw", ctx, timestamp);
        const [originx, originy] = this.calculate_origin();
        const dirty_tiles = new Set();
        if (this.last_originx !== null && this.last_originy !== null) {
            const offsetx = originx - this.last_originx;
            const offsety = originy - this.last_originy;
            if (offsetx !== 0 || offsety !== 0) {
                dctx.clearRect(0, 0, this.draw_canvas.width, this.draw_canvas.height);
                dctx.drawImage(this.canvas, -offsetx * 32, offsety * 32);
                ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                ctx.drawImage(this.draw_canvas, 0, 0);
            }
            const twidth = this.canvas.width / 32;
            const theight = this.canvas.height / 32;
            for (let x = Math.floor(originx); x < Math.ceil(originx + twidth); x++) {
                for (let y = Math.floor(originy); y < Math.ceil(originy + theight); y++) {
                    dirty_tiles.add(`[${x},${y}]`);
                }
            }
            for (let x = Math.ceil(this.last_originx); x < Math.floor(this.last_originx + twidth); x++) {
                for (let y = Math.ceil(this.last_originy); y < Math.floor(this.last_originy + theight); y++) {
                    dirty_tiles.delete(`[${x},${y}]`);
                }
            }
        }
        this.last_originx = originx;
        this.last_originy = originy;
        for (const [atom, lastbounds] of this.last_draw) {
            let dirty = false;
            if (!this.atoms.has(atom)) {
                for (let x = Math.floor(lastbounds.x); x < Math.ceil(lastbounds.x + lastbounds.width); x++) {
                    for (let y = Math.floor(lastbounds.y); y < Math.ceil(lastbounds.y + lastbounds.height); y++) {
                        const loc = `[${x},${y}]`;
                        const set = this.tiles.get(loc);
                        if (set) {
                            set.delete(atom);
                        }
                    }
                }
                this.last_draw.delete(atom);
                dirty = true;
            }
            else {
                const newbounds = atom.get_transformed_bounds(timestamp);
                if (newbounds) {
                    let { dispx, dispy } = atom.get_displacement(timestamp);
                    dispx = Math.round(dispx * 32) / 32;
                    dispy = Math.round(dispy * 32) / 32;
                    newbounds.x += dispx;
                    newbounds.y += dispy;
                    newbounds.transform = atom.get_transform(timestamp);
                    if (newbounds.x !== lastbounds.x ||
                        newbounds.y !== lastbounds.y ||
                        newbounds.width !== lastbounds.width ||
                        newbounds.height !== lastbounds.height ||
                        !newbounds.transform.equals(lastbounds.transform)) {
                        for (let x = Math.floor(lastbounds.x); x < Math.ceil(lastbounds.x + lastbounds.width); x++) {
                            for (let y = Math.floor(lastbounds.y); y < Math.ceil(lastbounds.y + lastbounds.height); y++) {
                                const loc = `[${x},${y}]`;
                                const set = this.tiles.get(loc);
                                if (set) {
                                    set.delete(atom);
                                }
                            }
                        }
                        for (let x = Math.floor(newbounds.x); x < Math.ceil(newbounds.x + newbounds.width); x++) {
                            for (let y = Math.floor(newbounds.y); y < Math.ceil(newbounds.y + newbounds.height); y++) {
                                const loc = `[${x},${y}]`;
                                let set = this.tiles.get(loc);
                                if (!set) {
                                    set = new Set();
                                    this.tiles.set(loc, set);
                                }
                                set.add(atom);
                                dirty_tiles.add(`[${x},${y}]`);
                            }
                        }
                        this.last_draw.set(atom, newbounds);
                        dirty = true;
                    }
                }
                else {
                    for (let x = Math.floor(lastbounds.x); x < Math.ceil(lastbounds.x + lastbounds.width); x++) {
                        for (let y = Math.floor(lastbounds.y); y < Math.ceil(lastbounds.y + lastbounds.height); y++) {
                            const loc = `[${x},${y}]`;
                            const set = this.tiles.get(loc);
                            if (set) {
                                set.delete(atom);
                            }
                        }
                    }
                    this.last_draw.delete(atom);
                    dirty = true;
                }
            }
            if (dirty) {
                for (let x = Math.floor(lastbounds.x); x < Math.ceil(lastbounds.x + lastbounds.width); x++) {
                    for (let y = Math.floor(lastbounds.y); y < Math.ceil(lastbounds.y + lastbounds.height); y++) {
                        dirty_tiles.add(`[${x},${y}]`);
                    }
                }
            }
        }
        for (const natom of this.atoms) {
            const atom = natom;
            let add_to_tiles = false;
            if (this.last_draw.has(atom)) {
                if (!this.dirty_atoms.has(atom)) {
                    continue;
                }
            }
            else {
                add_to_tiles = true;
            }
            const bounds = atom.get_transformed_bounds(timestamp);
            if (!bounds) {
                continue;
            }
            let { dispx, dispy } = atom.get_displacement(timestamp);
            dispx = Math.round(dispx * 32) / 32;
            dispy = Math.round(dispy * 32) / 32;
            bounds.x += dispx;
            bounds.y += dispy;
            bounds.transform = atom.get_transform(timestamp);
            for (let x = Math.floor(bounds.x); x < Math.ceil(bounds.x + bounds.width); x++) {
                for (let y = Math.floor(bounds.y); y < Math.ceil(bounds.y + bounds.height); y++) {
                    const loc = `[${x},${y}]`;
                    if (add_to_tiles) {
                        let set = this.tiles.get(loc);
                        if (!set) {
                            set = new Set();
                            this.tiles.set(loc, set);
                        }
                        set.add(atom);
                    }
                    dirty_tiles.add(loc);
                }
            }
            this.last_draw.set(atom, bounds);
        }
        this.dirty_atoms.clear();
        dctx.clearRect(0, 0, this.draw_canvas.width, this.draw_canvas.height);
        mctx.clearRect(0, 0, this.mask_canvas.width, this.mask_canvas.height);
        mctx.fillStyle = "#ffffff";
        for (const ntile of dirty_tiles) {
            const tile = ntile;
            const [x, y] = JSON.parse(tile);
            mctx.fillRect((x - originx) * 32, this.mask_canvas.height - (y - originy) * 32 - 32, 32, 32);
        }
        for (const natom of [...this.atoms].sort(Atom.atom_comparator)) {
            if (!natom) {
                continue;
            }
            const atom = natom;
            const bounds = atom.get_transformed_bounds(timestamp);
            if (!bounds) {
                continue;
            }
            let { dispx, dispy } = atom.get_displacement(timestamp);
            dispx = Math.round(dispx * 32) / 32;
            dispy = Math.round(dispy * 32) / 32;
            bounds.x += dispx;
            bounds.y += dispy;
            let should_draw = false;
            for (let x = Math.floor(bounds.x); x < Math.ceil(bounds.x + bounds.width); x++) {
                for (let y = Math.floor(bounds.y); y < Math.ceil(bounds.y + bounds.height); y++) {
                    if (dirty_tiles.has(`[${x},${y}]`)) {
                        should_draw = true;
                        break;
                    }
                }
                if (should_draw) {
                    break;
                }
            }
            if (!should_draw) {
                continue;
            }
            dispx -= originx;
            dispy -= originy;
            dctx.save();
            dctx.translate(Math.round(dispx * 32), Math.round(this.canvas.height - dispy * 32 - 32));
            const tr = atom.get_transform(timestamp);
            dctx.translate(16, 16);
            dctx.transform(tr.a, -tr.b, -tr.c, tr.d, tr.e * 32, -tr.f * 32);
            dctx.translate(-16, -16);
            atom.draw(dctx, timestamp);
            dctx.restore();
        }
        ctx.globalCompositeOperation = "destination-out";
        ctx.drawImage(this.mask_canvas, 0, 0);
        ctx.globalCompositeOperation = "source-over";
        dctx.globalCompositeOperation = "destination-in";
        dctx.drawImage(this.mask_canvas, 0, 0);
        dctx.globalCompositeOperation = "source-over";
        ctx.drawImage(this.draw_canvas, 0, 0);
        this.client.emit("after_draw", ctx, timestamp);
    }
    calculate_origin() {
        return [0, 0];
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    calculate_composite_offset(timestamp) {
        return [0, 0];
    }
    composite_plane(eye_ctx, timestamp) {
        const [ox, oy] = this.calculate_composite_offset(timestamp);
        eye_ctx.drawImage(this.canvas, ox, oy);
    }
    calculate_canvas_size() {
        return [this.eye.canvas.width, this.eye.canvas.height];
    }
    size_canvases() {
        const [width, height] = this.calculate_canvas_size();
        if (width !== this.canvas.width || height !== this.canvas.height) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.draw_canvas.width = width;
            this.draw_canvas.height = height;
            this.mask_canvas.width = width;
            this.mask_canvas.height = height;
            return true;
        }
        return false;
    }
}
class WorldPlane extends Plane {
    constructor(eye, id) {
        super(eye, id);
    }
    calculate_canvas_size() {
        return [Math.ceil(this.eye.canvas.width / 32 + 2) * 32, Math.ceil(this.eye.canvas.height / 32 + 2) * 32];
    }
    calculate_origin() {
        const [ox, oy] = [Math.round(this.eye.origin.x), Math.round(this.eye.origin.y)];
        return [ox - Math.floor((this.canvas.width / 32 - 1) / 2), oy - Math.floor((this.canvas.height / 32 - 1) / 2)];
    }
    calculate_composite_offset(timestamp) {
        const [originx, originy] = this.calculate_origin();
        let { dispx, dispy } = this.eye.origin && this.eye.origin.get_displacement
            ? this.eye.origin.get_displacement(timestamp)
            : { dispx: 0, dispy: 0 };
        dispx = Math.round(dispx * 32) / 32;
        dispy = Math.round(dispy * 32) / 32;
        return [originx * 32 - dispx * 32 + 7 * 32, -originy * 32 + dispy * 32 - 9 * 32];
    }
}
class LightingPlane extends WorldPlane {
    constructor(eye, id) {
        super(eye, id);
        this.no_click = true;
    }
    composite_plane(eye_ctx, timestamp) {
        const dctx = this.draw_canvas.getContext("2d");
        const ctx = this.canvas.getContext("2d");
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.globalCompositeOperation = "source-over";
        dctx.clearRect(0, 0, this.draw_canvas.width, this.draw_canvas.height);
        dctx.globalCompositeOperation = "copy";
        dctx.drawImage(eye_ctx.canvas, 0, 0);
        dctx.globalCompositeOperation = "source-over";
        eye_ctx.globalCompositeOperation = "multiply";
        super.composite_plane(eye_ctx, timestamp);
        eye_ctx.globalCompositeOperation = "destination-in";
        eye_ctx.drawImage(this.draw_canvas, 0, 0);
        eye_ctx.globalCompositeOperation = "source-over";
    }
}
Plane.World = WorldPlane;
Plane.Lighting = LightingPlane;
module.exports = { Eye, Plane };

},{"./atom.js":2,"events":37}],6:[function(require,module,exports){
"use strict";
function enqueue_icon_meta_load(client, newIcon) {
    if (!newIcon) {
        newIcon = "icons/error.png";
        console.info("MISSING ICON: Icon not defined!");
    }
    if (client.icon_meta_load_queue[newIcon]) {
        return client.icon_meta_load_queue[newIcon];
    }
    const promise = new Promise((resolve, reject) => {
        const meta = {};
        meta.width = 32;
        meta.height = 32;
        meta.__image_object = new Image();
        const fullpath = client.resRoot + newIcon;
        meta.__image_object.src = fullpath;
        meta.__image_object.addEventListener("load", () => {
            meta.__image_object.canvas = document.createElement("canvas");
            meta.__image_object.ctx = meta.__image_object.canvas.getContext("2d");
            meta.__image_object.canvas.width = meta.__image_object.width;
            meta.__image_object.canvas.height = meta.__image_object.height;
            meta.__image_object.ctx.drawImage(meta.__image_object, 0, 0);
            meta.__image_data = meta.__image_object.ctx.getImageData(0, 0, meta.width, meta.height);
            meta.width = meta.__image_object.width;
            meta.height = meta.__image_object.height;
            resolve();
            client.icon_meta_load_queue[newIcon] = void 0;
        });
        meta.__image_object.addEventListener("error", (error) => {
            reject(error || new Error(`Loading failed for ${newIcon}`));
        });
        client.icon_metas[newIcon] = meta;
    });
    client.icon_meta_load_queue[newIcon] = promise;
    return promise;
}
module.exports = enqueue_icon_meta_load;

},{}],7:[function(require,module,exports){
"use strict";
const CHANGE_LEVEL_NONE = 0;
const CHANGE_LEVEL_DIR = 1;
const CHANGE_LEVEL_ICON_STATE = 2;
const CHANGE_LEVEL_ICON = 3;
const color_canvas = document.createElement("canvas");
class IconRenderer {
    constructor(obj) {
        if (!obj.client) {
            this.client = obj;
        }
        else {
            this.client = obj.client;
        }
        this.atom = obj;
        this._overlay_layer = 0;
        this.change_level = 0;
        this._offset_x = 0;
        this._offset_y = 0;
        if (!this.dir) {
            this.dir = 1;
        }
    }
    // Returns a promise that is resolved when the icon is fully loaded (json and image)
    fully_load(forced_directional = false) {
        if (this.icon_meta || !this.icon) {
            return Promise.resolve();
        }
        if (this.icon && this.icon_state && this.icon.search(".png") === -1) {
            if (this.atom.directional === true || forced_directional === true ||
                (this.icon.search("icons/mob/") !== -1 && this.icon.search("icons/mob/under/") === -1)) {
                this.icon = `${this.icon}${this.icon_state}/${this.icon_state}-dir${this.dir}.png`;
            }
            else {
                this.icon = `${this.icon}${this.icon_state}.png`;
            }
        }
        return this.client.enqueue_icon_meta_load(this.client, this.icon);
    }
    get_bounds() {
        if (!this.icon_meta) {
            return;
        }
        const offset = this.get_offset();
        return {
            x: offset[0],
            y: 1 - this.icon_meta.height / 32 + offset[1],
            width: this.icon_meta.width / 32,
            height: this.icon_meta.height / 32,
        };
    }
    check_levels() {
        if (this.icon !== this.last_icon) {
            this.change_level = Math.max(this.change_level, CHANGE_LEVEL_ICON);
            this.last_icon = this.icon;
        }
        else if (this.icon_state !== this.last_icon_state) {
            this.change_level = Math.max(this.change_level, CHANGE_LEVEL_ICON_STATE);
            this.last_icon_state = this.icon_state;
        }
        else if (this.dir !== this.last_dir) {
            this.change_level = Math.max(this.change_level, CHANGE_LEVEL_DIR);
            this.last_dir = this.dir;
        }
    }
    on_render_tick() {
        this.check_levels();
        if (this.change_level >= CHANGE_LEVEL_NONE && this.atom) {
            this.atom.mark_dirty();
        }
        if (this.change_level >= CHANGE_LEVEL_DIR) {
            this.icon_meta = this.atom.client.icon_metas[this.icon];
            if (typeof this.icon_meta === "undefined") {
                this.change_level = CHANGE_LEVEL_NONE;
                const enqueued_icon = this.icon;
                if (this.icon && this.icon_state && this.icon.search(".png") === -1) {
                    if (this.atom.directional === true ||
                        (this.icon.search("icons/mob/") !== -1 && this.icon.search("icons/mob/under/") === -1)) {
                        this.icon = `${this.icon}${this.icon_state}/${this.icon_state}-dir${this.dir}.png`;
                    }
                    else {
                        this.icon = `${this.icon}${this.icon_state}.png`;
                    }
                }
                else if (this.icon_state === "") {
                    return;
                } //if theres no icon state - don't draw.
                if (!this.icon) {
                    this.icon = "icons/nothing.png";
                }
                this.atom.client
                    .enqueue_icon_meta_load(this.atom.client, this.icon)
                    .then(() => {
                    if (this.icon === enqueued_icon) {
                        this.change_level = CHANGE_LEVEL_ICON;
                    }
                })
                    .catch((err) => {
                    console.error(err);
                });
                this.change_level = CHANGE_LEVEL_NONE;
                return;
            }
        }
        this.change_level = CHANGE_LEVEL_NONE;
        this.icon_frame = 0;
    }
    draw(ctx) {
        if (!this.icon_meta || !this.icon_meta.__image_object) {
            return;
        }
        let image = this.icon_meta.__image_object;
        let tcolor = null;
        if (this.color) {
            tcolor = this.color;
        }
        else if (this.icon_meta.color) {
            tcolor = this.icon_meta.color;
        }
        if (tcolor) {
            color_canvas.width = Math.max(color_canvas.width, this.icon_meta.width);
            color_canvas.height = Math.max(color_canvas.height, this.icon_meta.height);
            const cctx = color_canvas.getContext("2d");
            cctx.clearRect(0, 0, this.icon_meta.width + 1, this.icon_meta.height + 1);
            cctx.fillStyle = this.color;
            cctx.globalCompositeOperation = "source-over";
            cctx.drawImage(image, 0, 0, this.icon_meta.width, this.icon_meta.height, 0, 0, this.icon_meta.width, this.icon_meta.height);
            cctx.globalCompositeOperation = "multiply";
            cctx.fillRect(0, 0, this.icon_meta.width, this.icon_meta.height);
            cctx.globalCompositeOperation = "destination-in";
            cctx.drawImage(image, 0, 0, this.icon_meta.width, this.icon_meta.height, 0, 0, this.icon_meta.width, this.icon_meta.height);
            cctx.globalCompositeOperation = "source-over";
            image = color_canvas;
        }
        const offset = this.get_offset();
        ctx.drawImage(image, 0, 0, this.icon_meta.width, this.icon_meta.height, Math.round(offset[0] * 32), Math.round(-offset[1] * 32), this.icon_meta.width, this.icon_meta.height);
    }
    is_mouse_over(x, y) {
        if (!this.icon_meta || !this.icon_meta.__image_data) {
            return false;
        }
        const offset = this.get_offset();
        x -= offset[0];
        y -= offset[1];
        const pxx = Math.floor(x * 32);
        const pxy = Math.floor(32 - y * 32);
        if (pxx < 0 || pxy < 0 || pxx > this.icon_meta.width || pxy > this.icon_meta.height) {
            return false;
        }
        const idx = 3 + 4 * (pxx + pxy * this.icon_meta.__image_data.width);
        return this.icon_meta.__image_data.data[idx] > 0;
    }
    get icon() {
        if (this._icon === null && this.parent) {
            return this.parent.icon;
        }
        return this._icon;
    }
    set icon(val) {
        this._icon = val;
    }
    get icon_state() {
        if (this._icon_state === null && this.parent) {
            return this.parent.icon_state;
        }
        let icon_state = this._icon_state;
        if (this.parent) {
            icon_state = ("" + icon_state).replace(/\[parent\]/g, this.parent.icon_state);
        }
        return icon_state;
    }
    set icon_state(val) {
        this._icon_state = val;
    }
    get dir() {
        if (this._dir === null && this.parent) {
            return this.parent.dir;
        }
        return this._dir;
    }
    set dir(val) {
        this._dir = val;
    }
    get overlay_layer() {
        return this._overlay_layer;
    }
    set overlay_layer(val) {
        if (val === this._overlay_layer) {
            return;
        }
        this._overlay_layer = val;
        if (this.atom) {
            this.atom.mark_dirty();
        }
    }
    get offset_x() {
        return this._offset_x;
    }
    set offset_x(val) {
        if (val === this._offset_x) {
            return;
        }
        this._offset_x = +val || 0;
        if (this.atom) {
            this.atom.mark_dirty();
        }
    }
    get offset_y() {
        return this._offset_y;
    }
    set offset_y(val) {
        if (val === this._offset_y) {
            return;
        }
        this._offset_y = +val || 0;
        if (this.atom) {
            this.atom.mark_dirty();
        }
    }
    get_offset() {
        let dx = this.offset_x;
        let dy = this.offset_y;
        if (this.icon_meta && this.icon_meta.directional_offset) {
            const world_amt = this.icon_meta.directional_offset / 32;
            if (this.dir & 1) {
                dy += world_amt;
            }
            if (this.dir & 2) {
                dy -= world_amt;
            }
            if (this.dir & 4) {
                dx += world_amt;
            }
            if (this.dir & 8) {
                dx -= world_amt;
            }
        }
        return [dx, dy];
    }
    get color() {
        if (this._color === null && this.parent) {
            return this.parent.color;
        }
        return this._color;
    }
    set color(val) {
        if (val === this._color) {
            return;
        }
        this._color = "" + val;
        if (this.atom) {
            this.atom.mark_dirty();
        }
    }
    get alpha() {
        return this._alpha;
    }
    set alpha(val) {
        if (val === this._alpha) {
            return;
        }
        this._alpha = "" + val;
        if (this.atom) {
            this.atom.mark_dirty();
        }
    }
}
module.exports = IconRenderer;

},{}],8:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { Component } = require("../index.js");
class LightingObject extends Component {
    constructor(atom, template) {
        super(atom, template);
        this.atom.draw = this.draw.bind(this);
        this.atom.get_bounds = this.get_bounds.bind(this);
        this.atom.on_render_tick = this.on_render_tick.bind(this);
        this.atom.is_mouse_over = () => { return false; };
        this.atom.get_plane_id = () => {
            return "lighting";
        };
        this.canvas = document.createElement("canvas");
        this.random_angle_offset = Math.random();
        this.soft_shadow_radius = 1 / 8;
    }
    on_render_tick(timestamp) {
        const disp = this.a.get_displacement(timestamp);
        if (this.color !== this.last_color) {
            this.dirty = true;
        }
        else if (this.radius !== this.last_radius) {
            this.dirty = true;
        }
        else if (this.shadows_list !== this.last_shadows_list) {
            this.dirty = true;
        }
        else if (!this.last_disp || this.last_disp.dispx !== disp.dispx || this.last_disp.dispy !== disp.dispy) {
            this.dirty = true;
        }
        else if (this.a.client.soft_shadow_resolution !== this.last_resolution) {
            this.random_angle_offset = Math.random();
            this.dirty = true;
        }
        if (this.dirty) {
            this.a.mark_dirty();
        }
        this.last_color = this.color;
        this.last_radius = this.radius;
        this.last_shadows_list = this.shadows_list;
        this.last_disp = disp;
    }
    get_bounds() {
        return {
            x: -this.radius,
            y: -this.radius,
            width: this.radius * 2 + 1,
            height: this.radius * 2 + 1,
        };
    }
    draw(ctx, timestamp) {
        if (
        // eslint-disable-next-line eqeqeq
        this.atom.screen_loc_x != null ||
            this.radius !== +this.radius ||
            !this.enabled) {
            return;
        }
        if (this.dirty) {
            this.last_resolution = this.a.client.soft_shadow_resolution;
            this.canvas.width = 32 + this.radius * 64;
            this.canvas.height = 32 + this.radius * 64;
            const bctx = this.canvas.getContext("2d");
            bctx.fillStyle = "black";
            bctx.fillRect(0, 0, bctx.width, bctx.height);
            const c = this.canvas.width * 0.5;
            let { dispx, dispy } = this.atom.get_displacement(timestamp);
            dispx = Math.round(dispx * 32) / 32;
            dispy = Math.round(dispy * 32) / 32;
            if (dispx !== +dispx || dispy !== +dispy) {
                return;
            }
            const sample_points = [];
            if (this.soft_shadow_radius <= 0 || this.a.client.soft_shadow_resolution <= 1) {
                sample_points.push([dispx, dispy]);
            }
            else {
                for (let i = 0; i < this.a.client.soft_shadow_resolution; i++) {
                    const angle = ((i + this.random_angle_offset) * Math.PI * 2) / this.a.client.soft_shadow_resolution;
                    sample_points.push([
                        dispx + Math.cos(angle) * this.soft_shadow_radius,
                        dispy + Math.sin(angle) * this.soft_shadow_radius,
                    ]);
                }
            }
            bctx.fillStyle = "black";
            bctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            const rgb = Math.ceil(255 / sample_points.length);
            bctx.fillStyle = `rgb(${rgb},${rgb},${rgb})`;
            bctx.globalCompositeOperation = "lighter";
            for (let i = 0; i < sample_points.length; i++) {
                const [point_x, point_y] = sample_points[i];
                const cx = c + Math.round((point_x - dispx) * 32);
                const cy = c - Math.round((point_y - dispy) * 32);
                const wall_offset_x = Math.round(-16 - point_x * 32);
                const wall_offset_y = Math.round(16 + point_y * 32);
                const walls = [];
                for (const shadow of this.shadows_list) {
                    const wall = {};
                    wall.x1 = shadow.x1 * 32 + wall_offset_x;
                    wall.y1 = -shadow.y2 * 32 + wall_offset_y;
                    wall.x2 = shadow.x2 * 32 + wall_offset_x;
                    wall.y2 = -shadow.y1 * 32 + wall_offset_y;
                    wall.base_width = wall.x2 - wall.x1;
                    wall.base_height = wall.y2 - wall.y1;
                    wall.used_horizontally = false;
                    wall.used_vertically = false;
                    if (wall.x1 < 0 && wall.y1 < 0 && wall.x2 > 0 && wall.y2 > 0) {
                        continue;
                    }
                    let hdist = Math.min(Math.abs(wall.x1), Math.abs(wall.x2));
                    let vdist = Math.min(Math.abs(wall.y1), Math.abs(wall.y2));
                    if (wall.x1 <= 0 && wall.x2 >= 0) {
                        hdist = 0;
                    }
                    if (wall.y1 <= 0 && wall.y2 >= 0) {
                        vdist = 0;
                    }
                    wall.dist = hdist + vdist;
                    walls.push(wall);
                }
                walls.sort((a, b) => {
                    return a.dist - b.dist;
                });
                for (let j = 0; j < walls.length; j++) {
                    const wall1 = walls[j];
                    if (wall1.used_horizontally || wall1.used_vertically) {
                        continue;
                    }
                    for (let k = j + 1; k < walls.length; k++) {
                        const wall2 = walls[k];
                        if (wall2.used_vertically && wall2.used_horizontally) {
                            continue;
                        }
                        if ((wall1.x1 > 0 &&
                            wall1.x1 === wall2.x1 &&
                            (wall1.y1 === wall2.y2 || wall1.y2 === wall2.y1)) ||
                            (wall1.y1 > 0 &&
                                wall1.y1 === wall2.y1 &&
                                (wall1.x1 === wall2.x2 || wall1.x2 === wall2.x1)) ||
                            (wall1.x2 < 0 &&
                                wall1.x2 === wall2.x2 &&
                                (wall1.y1 === wall2.y2 || wall1.y2 === wall2.y1)) ||
                            (wall1.y2 < 0 && wall1.y2 === wall2.y2 && (wall1.x1 === wall2.x2 || wall1.x2 === wall2.x1))) {
                            if (wall1.x1 === wall2.x1 || wall1.x2 === wall2.x2) {
                                if (wall2.used_vertically) {
                                    continue;
                                }
                                wall2.used_vertically = true;
                            }
                            if (wall1.y1 === wall2.y1 || wall1.y2 === wall2.y2) {
                                if (wall2.used_horizontally) {
                                    continue;
                                }
                                wall2.used_horizontally = true;
                            }
                            wall1.x1 = Math.min(wall1.x1, wall2.x1);
                            wall1.y1 = Math.min(wall1.y1, wall2.y1);
                            wall1.x2 = Math.max(wall1.x2, wall2.x2);
                            wall1.y2 = Math.max(wall1.y2, wall2.y2);
                        }
                    }
                }
                bctx.beginPath();
                for (const wall of walls) {
                    if (wall.used_horizontally || wall.used_vertically) {
                        continue;
                    }
                    let sx = 1;
                    let sy = 1;
                    let flip = false;
                    let x1 = wall.x1;
                    let y1 = wall.y1;
                    let x2 = wall.x2;
                    let y2 = wall.y2;
                    const path = []; // So if I'm batching this all together the whole thing has to be one direction otherwise weird winding rule stuff happens
                    if (wall.x2 < 0) {
                        sx = -1;
                        [x1, x2] = [-x2, -x1];
                    }
                    if (wall.y2 < 0) {
                        sy = -1;
                        [y1, y2] = [-y2, -y1];
                    }
                    if (x1 <= 0 && x2 >= 0) {
                        flip = sx !== sy;
                        path.push([cx + x1 * sx, cy + (y1 + wall.base_height) * sy]);
                        path.push([cx + x1 * sx, cy + y1 * sy]);
                        let scalar = (this.radius * 32 + 48) / y1;
                        path.push([cx + x1 * sx * scalar, cy + y1 * sy * scalar]);
                        scalar = (this.radius * 32 + 48) / y1;
                        path.push([cx + x2 * sx * scalar, cy + y1 * sy * scalar]);
                        path.push([cx + x2 * sx, cy + y1 * sy]);
                        path.push([cx + x2 * sx, cy + (y1 + wall.base_height) * sy]);
                    }
                    else if (y1 <= 0 && y2 >= 0) {
                        flip = sx === sy;
                        path.push([cx + (x1 + wall.base_width) * sx, cy + y1 * sy]);
                        path.push([cx + x1 * sx, cy + y1 * sy]);
                        let scalar = (this.radius * 32 + 48) / x1;
                        path.push([cx + x1 * sx * scalar, cy + y1 * sy * scalar]);
                        scalar = (this.radius * 32 + 48) / x1;
                        path.push([cx + x1 * sx * scalar, cy + y2 * sy * scalar]);
                        path.push([cx + x1 * sx, cy + y2 * sy]);
                        path.push([cx + (x1 + wall.base_width) * sx, cy + y2 * sy]);
                    }
                    else {
                        // eslint-disable-next-line eqeqeq
                        flip = sx != sy;
                        path.push([cx + (x1 + wall.base_width) * sx, cy + (y1 + wall.base_height) * sy]);
                        path.push([cx + (x1 + wall.base_width) * sx, cy + y2 * sy]);
                        path.push([cx + x1 * sx, cy + y2 * sy]);
                        let scalar = (this.radius * 32 + 48) / Math.max(x1, y2);
                        path.push([cx + x1 * sx * scalar, cy + y2 * sy * scalar]);
                        path.push([cx + (this.radius * 32 + 48) * sx, cy + (this.radius * 32 + 48) * sy]);
                        scalar = (this.radius * 32 + 48) / Math.max(x2, y1);
                        path.push([cx + x2 * sx * scalar, cy + y1 * sy * scalar]);
                        path.push([cx + x2 * sx, cy + y1 * sy]);
                        path.push([cx + x2 * sx, cy + (y1 + wall.base_height) * sy]);
                    }
                    if (!flip) {
                        // draw it in a way that makes sure it winds in the right direction
                        for (let j = 0; j < path.length; j++) {
                            if (j === 0) {
                                bctx.moveTo(path[j][0], path[j][1]);
                            }
                            else {
                                bctx.lineTo(path[j][0], path[j][1]);
                            }
                        }
                    }
                    else {
                        for (let j = path.length - 1; j >= 0; j--) {
                            if (j === path.length - 1) {
                                bctx.moveTo(path[j][0], path[j][1]);
                            }
                            else {
                                bctx.lineTo(path[j][0], path[j][1]);
                            }
                        }
                    }
                    bctx.closePath();
                }
                bctx.fill();
            }
            bctx.fillStyle = "white";
            bctx.globalCompositeOperation = "difference";
            bctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            bctx.globalCompositeOperation = "multiply";
            const gradient = bctx.createRadialGradient(c, c, 0, c, c, c);
            gradient.addColorStop(0, this.color);
            gradient.addColorStop(1, "black");
            bctx.fillStyle = gradient;
            bctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            bctx.globalCompositeOperation = "source-over";
            this.dirty = false;
        }
        ctx.globalCompositeOperation = "lighter";
        ctx.drawImage(this.canvas, -this.radius * 32, -this.radius * 32);
        ctx.globalCompositeOperation = "source-over";
    }
}
module.exports.components = { LightingObject };

},{"../index.js":1}],9:[function(require,module,exports){
"use strict";
// the only functional programming in the whole project
class Matrix {
    constructor(a, b, c, d, e, f) {
        this.a = a;
        this.b = b;
        this.c = c;
        this.d = d;
        this.e = e;
        this.f = f;
        Object.freeze(this);
    }
    multiply(m2) {
        const a1 = this.a, b1 = this.b, c1 = this.c, d1 = this.d, e1 = this.e, f1 = this.f;
        const a2 = m2.a, b2 = m2.b, c2 = m2.c, d2 = m2.d, e2 = m2.e, f2 = m2.f;
        // https://www.wolframalpha.com/input/?i=%7B%7Ba,c,e%7D,%7Bb,d,f%7D,%7B0,0,1%7D%7D+*+%7B%7BA,C,E%7D,%7BB,D,F%7D,%7B0,0,1%7D%7D
        return new Matrix(a1 * a2 + b2 * c1, a2 * b1 + b2 * d1, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2, e1 + a1 * e2 + c1 * f2, b1 * e2 + f1 + d1 * f2);
    }
    multiply_array(m2) {
        const a1 = this.a, b1 = this.b, c1 = this.c, d1 = this.d, e1 = this.e, f1 = this.f;
        if (m2 instanceof Array) {
            return [m2[0] * a1 + m2[1] * c1 + e1, m2[0] * b1 + m2[1] * d1 + f1];
        }
    }
    inverse() {
        const a = this.a, b = this.b, c = this.c, d = this.d, e = this.e, f = this.f;
        // https://www.wolframalpha.com/input/?i=inverse+of+%7B%7Ba,c,e%7D,%7Bb,d,f%7D,%7B0,0,1%7D%7D
        return new Matrix(d / (a * d - b * c), b / (b * c - a * d), c / (b * c - a * d), a / (a * d - b * c), (d * e - c * f) / (b * c - a * d), (b * e - a * f) / (a * d - b * c));
    }
    translate(dx = 0, dy = 0) {
        return this.multiply(new Matrix(1, 0, 0, 1, dx, dy));
    }
    rotate(angle, ox = 0, oy = 0) {
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        return this.translate(-ox, -oy).multiply(new Matrix(c, s, -s, c, 0, 0)).translate(ox, oy);
    }
    scale(sx, sy, ox = 0, oy = 0) {
        if (typeof sy === "undefined") {
            sy = sx;
        }
        return this.translate(-ox, -oy).multiply(new Matrix(sx, 0, 0, sy, 0, 0)).translate(ox, oy);
    }
    equals(other) {
        return (other.a === this.a &&
            other.b === this.b &&
            other.c === this.c &&
            other.d === this.d &&
            other.e === this.e &&
            other.f === this.f);
    }
}
Matrix.identity = new Matrix(1, 0, 0, 1, 0, 0);
module.exports = Matrix;

},{}],10:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Panel = require("./panel.js");
const EventEmitter = require("events");
class PanelManager extends EventEmitter {
    constructor(client) {
        super();
        this.client = client;
        this.panels = {};
    }
    send_message(obj) {
        if (!this.client.connection) {
            return;
        }
        this.client.connection.send(JSON.stringify({ panel: obj }));
    }
    create_client_panel(obj) {
        const panel = new Panel(this, null, obj);
        this.emit("create", panel, obj);
        return panel;
    }
    handle_message(obj) {
        if (obj.create) {
            for (const id in obj.create) {
                if (!Object.prototype.hasOwnProperty.call(obj.create, id)) {
                    continue;
                }
                if (this.panels[id]) {
                    console.warn(`The server tried to open a panel with the same ID ${id} twice! ${JSON.stringify(obj.create[id])}`);
                }
                const panel = new Panel(this, id, obj.create[id]);
                this.emit("create", panel, obj.create[id]);
            }
        }
        if (obj.message) {
            for (const message of obj.message) {
                const panel = this.panels[message.id];
                if (!panel) {
                    continue;
                }
                panel.emit("message", message.contents);
            }
        }
        if (obj.close) {
            for (const id of obj.close) {
                const panel = this.panels[id];
                if (!panel) {
                    continue;
                }
                panel.close();
            }
        }
    }
}
module.exports = PanelManager;

},{"./panel.js":11,"events":37}],11:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const EventEmitter = require("events");
class Panel extends EventEmitter {
    constructor(manager, id, { width = 400, height = 400, title = "", can_close = true, content_class = "" } = {}) {
        super();
        const left = document.documentElement.clientWidth / 2 - width / 2;
        const top = document.documentElement.clientHeight / 2 - height / 2;
        this.container_obj = document.createElement("div");
        Object.assign(this.container_obj.style, {
            width: width + "px",
            height: height + "px",
            left: left + "px",
            top: top + "px",
        });
        this.container_obj.classList.add("uiframe-container");
        this.panel_obj = document.createElement("div");
        this.panel_obj.classList.add("uiframe");
        this.panel_obj.tabIndex = -1;
        this.header_obj = document.createElement("div");
        this.header_obj.classList.add("uiframe-header");
        this.title_node = document.createTextNode(title);
        this.header_obj.appendChild(this.title_node);
        this.content_obj = document.createElement("div");
        this.content_obj.classList.add("uiframe-content");
        this.panel_obj.appendChild(this.header_obj);
        this.panel_obj.appendChild(this.content_obj);
        this.container_obj.appendChild(this.panel_obj);
        document.getElementById("uiframes-container").appendChild(this.container_obj);
        this.header_obj.addEventListener("mousedown", this._start_drag.bind(this));
        this.container_obj.addEventListener("mousedown", this._start_resize.bind(this));
        this.container_obj.addEventListener("mousemove", this._container_mousemove.bind(this));
        this.container_obj.addEventListener("mouseout", this._container_mouseout.bind(this));
        this.content_obj.addEventListener("click", this.click.bind(this));
        this.can_close = can_close;
        this.manager = manager;
        manager.panels[id] = this;
        this.id = id;
        if (can_close) {
            this.close_button = document.createElement("div");
            this.close_button.classList.add("uiframe-close-button");
            this.header_obj.appendChild(this.close_button);
            this.close_button.addEventListener("click", () => {
                this.close();
            });
            this.close_button.addEventListener("mousedown", (e) => {
                e.preventDefault();
            });
        }
        if (content_class) {
            const Ctor = manager.client.panel_classes[content_class];
            if (Ctor) {
                this.content_controller = new Ctor(this, this.manager);
            }
            else {
                console.warn(`${content_class} is a nonexistent panel class`);
            }
        }
    }
    _start_drag(e) {
        if (e.defaultPrevented) {
            return;
        }
        if (e.target !== this.header_obj) {
            return;
        }
        const pad = (this.container_obj.offsetWidth - this.panel_obj.offsetWidth) / 2;
        e.preventDefault();
        this.panel_obj.focus();
        let lastclientx = e.clientX;
        let lastclienty = e.clientY;
        const mousemove = (e2) => {
            const dx = e2.clientX - lastclientx;
            const dy = e2.clientY - lastclienty;
            lastclientx = e2.clientX;
            lastclienty = e2.clientY;
            const { left: oldleft, top: oldtop } = this.container_obj.getBoundingClientRect();
            this.container_obj.style.left =
                Math.min(document.documentElement.clientWidth - 160 - pad, Math.max(-pad, oldleft + dx)) + "px";
            this.container_obj.style.top =
                Math.min(document.documentElement.clientHeight - 35 - pad, Math.max(-pad, oldtop + dy)) + "px";
            this.emit("move");
        };
        this.mouseup(mousemove);
    }
    _resize_meta(e) {
        const out = {
            drag_right: false,
            drag_left: false,
            drag_up: false,
            drag_down: false,
            cursor: "default",
            can_resize: false,
        };
        this.e_target_in_container(e, out);
        out.can_resize = out.drag_right || out.drag_left || out.drag_up || out.drag_down;
        return out;
    }
    e_target_in_container(e, out) {
        const pad = (this.container_obj.offsetWidth - this.panel_obj.offsetWidth) / 2;
        const width = this.panel_obj.offsetWidth;
        const height = this.panel_obj.offsetHeight;
        if (e.target === this.container_obj) {
            if (e.offsetX < pad) {
                out.drag_left = true;
            }
            if (e.offsetY < pad) {
                out.drag_up = true;
            }
            if (e.offsetX > width + pad) {
                out.drag_right = true;
            }
            if (e.offsetY > height + pad) {
                out.drag_down = true;
            }
            if ((out.drag_left && out.drag_down) || (out.drag_up && out.drag_right)) {
                out.cursor = "nesw-resize";
            }
            else if ((out.drag_left && out.drag_up) || (out.drag_down && out.drag_right)) {
                out.cursor = "nwse-resize";
            }
            else if (out.drag_left || out.drag_right) {
                out.cursor = "ew-resize";
            }
            else if (out.drag_up || out.drag_down) {
                out.cursor = "ns-resize";
            }
        }
    }
    _start_resize(e) {
        // bring the panel into focus
        if (this.container_obj !== document.getElementById("uiframes-container").lastChild) {
            document.getElementById("uiframes-container").appendChild(this.container_obj);
        }
        const resize_meta = this._resize_meta(e);
        if (!resize_meta.can_resize) {
            return;
        }
        const pad = (this.container_obj.offsetWidth - this.panel_obj.offsetWidth) / 2;
        e.preventDefault();
        this.panel_obj.focus();
        let lastclientx = e.clientX;
        let lastclienty = e.clientY;
        const mousemove = (e3) => {
            const dx = e3.clientX - lastclientx;
            const dy = e3.clientY - lastclienty;
            lastclientx = e3.clientX;
            lastclienty = e3.clientY;
            const { left: oldleft, top: oldtop } = this.container_obj.getBoundingClientRect();
            if (resize_meta.drag_left) {
                this.container_obj.style.left =
                    Math.min(document.documentElement.clientWidth - 160 - pad, Math.max(-pad, oldleft + dx)) + "px";
                this.container_obj.style.width = Math.max(160, this.panel_obj.clientWidth - dx) + "px";
            }
            else if (resize_meta.drag_right) {
                this.container_obj.style.width = Math.max(160, this.panel_obj.clientWidth + dx) + "px";
            }
            if (resize_meta.drag_up) {
                this.container_obj.style.top =
                    Math.min(document.documentElement.clientHeight - 35 - pad, Math.max(-pad, oldtop + dy)) + "px";
                this.container_obj.style.height = Math.max(35, this.panel_obj.clientHeight - dy) + "px";
            }
            else if (resize_meta.drag_down) {
                this.container_obj.style.height = Math.max(35, this.panel_obj.clientHeight + dy) + "px";
            }
            this.emit("resize");
        };
        this.mouseup(mousemove);
    }
    mouseup(mousemove) {
        const mouseup = () => {
            document.removeEventListener("mousemove", mousemove);
            document.removeEventListener("mouseup", mouseup);
        };
        document.addEventListener("mousemove", mousemove);
        document.addEventListener("mouseup", mouseup);
    }
    _container_mousemove(e) {
        const resize_meta = this._resize_meta(e);
        this.container_obj.style.cursor = resize_meta.cursor;
    }
    _container_mouseout() {
        this.container_obj.style.cursor = "default";
    }
    get title() {
        return this.title_node.textContent;
    }
    set title(val) {
        this.title_node.textContent = val;
    }
    send_message(message) {
        if (!this.id) {
            throw new Error("Cannot send a panel message without an ID!");
        }
        this.manager.send_message({
            message: [{ id: this.id, contents: message }],
        });
    }
    close() {
        if (this.id) {
            this.manager.send_message({ close: [this.id] });
            if (this.manager.panels[this.id] === this) {
                this.manager.panels[this.id] = null;
            }
        }
        document.getElementById("uiframes-container").removeChild(this.container_obj);
        this.emit("close");
    }
    click(e) {
        const target = e.target.closest(".button");
        if (this.is_valid_button(target)) {
            if (target.dataset.message) {
                this.send_message(JSON.parse(target.dataset.message));
            }
            if (target.dataset.radioGroup) {
                for (const selected of this.content_obj.querySelectorAll(`.button.selected[data-radio-group='${target.dataset.radioGroup}']`)) {
                    selected.classList.remove("selected");
                }
                target.classList.add("selected");
                if (target.dataset.radioValue) {
                    this.send_message({
                        [target.dataset.radioGroup]: target.dataset.radioValue,
                    });
                }
            }
            if (target.dataset.toggle) {
                target.classList.toggle("on");
                const on = target.classList.contains("on");
                if (target.dataset.toggle !== "1" && target.dataset.toggle !== "true") {
                    this.send_message(build_message(target.dataset.toggle, on));
                }
            }
        }
    }
    is_valid_button(elem) {
        return (elem &&
            elem.classList &&
            elem.classList.contains("button") &&
            !elem.classList.contains("disabled") &&
            !elem.classList.contains("selected"));
    }
    $(sel) {
        return this.content_obj.querySelector(sel);
    }
    $$(sel) {
        return this.content_obj.querySelectorAll(sel);
    }
}
function build_message(path, val) {
    let obj;
    const ret_obj = obj;
    const split = path.split(/./g);
    for (let i = 0; i < split.length - 1; i++) {
        obj[split[i]] = obj = {};
    }
    obj[split[split.length - 1]] = val;
    return ret_obj;
}
module.exports = Panel;

},{"events":37}],12:[function(require,module,exports){
"use strict";
function anim_loop(timestamp) {
    for (const eye of Object.values(this.eyes)) {
        if (eye) {
            const teye = eye;
            teye.draw(timestamp);
        }
    }
    if (this.audio_ctx) {
        for (const sound of this.playing_sounds.values()) {
            sound.update_spatial(sound.emitter, timestamp);
        }
    }
    requestAnimationFrame(anim_loop.bind(this));
}
module.exports = anim_loop;

},{}],13:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Sound {
    constructor(client, sndobj) {
        this.client = client;
        if (typeof sndobj.emitter === "string") {
            sndobj.emitter = this.client.atoms_by_netid[sndobj.emitter];
        }
        this.emitter = sndobj.emitter;
        this.id = sndobj.id || "id" + Math.random();
        this.client.playing_sounds.set(this.id, this);
        this.buffer_promise = this.client.get_audio_buffer(client, sndobj.path);
        if (!this.client.audio_ctx) {
            return;
        }
        this.source = this.client.audio_ctx.createBufferSource();
        if (sndobj.detune) {
            this.source.detune.value = sndobj.detune;
        }
        if (sndobj.playback_rate) {
            this.source.playbackRate.value = sndobj.playback_rate;
        }
        if (sndobj.loop) {
            this.source.loop = true;
        }
        this.apply_effects(sndobj, this.source).connect(this.client.audio_ctx.destination);
    }
    emit_from() {
        throw new Error("Method not implemented.");
    }
    apply_effects(sndobj, node) {
        if (sndobj.volume) {
            node = this.apply_volume(sndobj.volume, node);
        }
        if (sndobj.emitter) {
            node = this.apply_spatial(sndobj.emitter, node);
        }
        return node;
    }
    apply_volume(amount, node) {
        const gain = this.client.audio_ctx.createGain();
        gain.gain.value = amount;
        node.connect(gain);
        return gain;
    }
    apply_spatial(emitter, node) {
        this.spatial_node = this.client.audio_ctx.createPanner();
        this.spatial_node.panningModel = "HRTF";
        node.connect(this.spatial_node);
        this.update_spatial(emitter, performance.now());
        return this.spatial_node;
    }
    update_spatial(emitter, timestamp) {
        if (this.spatial_node) {
            const eye = emitter.eye || this.client.eyes[emitter.eye_id || ""];
            if (!eye) {
                return;
            }
            const eye_disp = eye.origin.get_displacement(timestamp);
            if (eye_disp.dispx !== +eye_disp.dispx || eye_disp.dispy !== +eye_disp.dispy) {
                return;
            }
            if (emitter.x !== +emitter.x || emitter.y !== +emitter.y) {
                return;
            }
            this.spatial_node.setPosition(emitter.x - eye_disp.dispx, 0, -emitter.y + eye_disp.dispy);
        }
    }
    start() {
        if (!this.client.audio_ctx) {
            return;
        }
        this.buffer_promise.then((buf) => {
            if (!this.source) {
                return;
            }
            this.source.buffer = buf;
            this.source.addEventListener("ended", this.ended.bind(this));
            this.source.start();
            this.stop = () => {
                this.source.stop();
                this.source = null;
            };
        });
    }
    stop() {
        this.ended();
        this.source = null;
    }
    ended() {
        this.client.playing_sounds.delete(this.id);
    }
}
module.exports = Sound;

},{}],14:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { Component } = require("../client/index.js");
class Tooltip extends Component {
    constructor(atom, template) {
        super(atom, template);
        this.a.on("mouseover", this.mouseover.bind(this));
        this.a.on("mouseout", this.mouseout.bind(this));
        this.a.on("mousemove", this.mousemove.bind(this));
        this.alert_div = document.createElement("div");
        this.alert_div.classList.add("tooltip");
        this.alert_div.classList.add(this.theme || "midnight");
        this.alert_div.innerHTML = '<div class="content"><h1 class="title"></h1><p class="desc"></p></div>';
        this.title_elem = this.alert_div.querySelector(".title");
        this.desc_elem = this.alert_div.querySelector(".desc");
    }
    mouseover(e) {
        this.title_elem.textContent = this.a.name;
        this.desc_elem.textContent = this.desc;
        const elem = document.createElement("div");
        elem.classList.add("dropdown", "tooltip-wrapper");
        elem.appendChild(this.alert_div);
        document.body.appendChild(elem);
        this.mousemove(e);
    }
    mouseout() {
        if (this.alert_div.parentNode && this.alert_div.parentNode.parentNode) {
            this.alert_div.parentNode.parentNode.removeChild(this.alert_div.parentNode);
        }
        if (this.alert_div.parentNode) {
            this.alert_div.parentNode.removeChild(this.alert_div);
        }
    }
    mousemove(e) {
        if (this.alert_div.parentNode) {
            this.alert_div.parentNode.style.left = e.original_event.clientX + "px";
            this.alert_div.parentNode.style.top = e.original_event.clientY + "px";
        }
    }
}
module.exports.components = { Tooltip };

},{"../client/index.js":1}],15:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { Component, chain_func } = require("../client/index.js");
class CarbonMob extends Component {
    constructor(atom, template) {
        super(atom, template);
        this.a.get_transform = chain_func(this.a.get_transform, this.get_transform.bind(this));
        this.last_timestamp = 0;
        this.lying_direction = -1;
        this.interpolated_lying = this.lying ? 1 : 0;
        this.last_jitter = -Infinity;
        this.last_jitter_x = 0;
        this.last_jitter_y = 0;
    }
    get_transform(prev, timestamp) {
        let transform = prev();
        const timestamp_diff = timestamp - this.last_timestamp;
        if (timestamp_diff > 0) {
            if (this.lying) {
                if (this.interpolated_lying === 0) {
                    this.lying_direction = Math.random() < 0.5 ? 1 : -1;
                }
                this.interpolated_lying = Math.min(this.interpolated_lying + timestamp_diff / 150, 1);
            }
            else {
                this.interpolated_lying = Math.max(this.interpolated_lying - timestamp_diff / 150, 0);
            }
            this.last_timestamp = timestamp;
        }
        transform = transform
            .translate(0, -this.interpolated_lying * 0.1875)
            .rotate(this.lying_direction * this.interpolated_lying * Math.PI * 0.5);
        const jitter_diff = timestamp - this.last_jitter;
        if (jitter_diff < 2400) {
            const curr_amt = Math.abs(((((jitter_diff / 200 - 1) % 2) + 2) % 2) - 1);
            transform = transform.translate(Math.round(this.last_jitter_x * curr_amt * 32) / 32, Math.round(this.last_jitter_y * curr_amt * 32) / 32);
        }
        if (this.jitteriness && jitter_diff >= 2000) {
            const amplitude = Math.min(4, this.jitteriness / 100 + 1) / 32;
            this.last_jitter_x = (Math.random() - 0.5) * amplitude * 2;
            this.last_jitter_y = (Math.random() - 0.5) * amplitude * 6;
            this.last_jitter = timestamp;
        }
        return transform;
    }
}
module.exports.components = { CarbonMob };

},{"../client/index.js":1}],16:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { Component, chain_func } = require("../client/index.js");
class GridDisplay extends Component {
    constructor(atom, template) {
        super(atom, template);
        this.a.get_bounds = chain_func(this.a.get_bounds, this.get_bounds.bind(this));
        this.a.draw = chain_func(this.a.draw, this.draw.bind(this));
        this.a.is_mouse_over = chain_func(this.a.is_mouse_over, this.is_mouse_over.bind(this));
    }
    get_bounds(prev) {
        const bounds = prev();
        if (!bounds) {
            return bounds;
        }
        bounds.width += (this.width - 1) * this.offset_x * 32;
        bounds.height += (this.height - 1) * this.offset_y * 32;
        return bounds;
    }
    draw(prev, ctx) {
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                ctx.save();
                ctx.translate(x * this.offset_x * 32, -y * this.offset_y * 32);
                prev(); // you can call prev() more than once, and I found a reason to. Woo!
                ctx.restore();
            }
        }
    }
    is_mouse_over(prev, x, y) {
        for (let ox = 0; ox < this.width; ox++) {
            for (let oy = 0; oy < this.height; oy++) {
                if (prev(x - ox, y - oy)) {
                    return true;
                }
            }
        }
        return false;
    }
}
module.exports.components = { GridDisplay };

},{"../client/index.js":1}],17:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { Atom, chain_func, Plane } = require("../client/index.js");
module.exports.ParallaxPlane = class ParallaxPlane extends Plane {
    constructor(eye, id) {
        super(eye, id);
        this.no_click = true;
        this.parallax_velocity = [0, 0];
        this.parallax_offset = [0, 0];
        this.parallax_velocity_lasttimestamp = -1;
        for (let x = 0; x < 2; x++) {
            for (let y = 0; y < 2; y++) {
                for (let layer = 1; layer <= 2; layer++) {
                    const parallax_atom = new Atom(this.client, {
                        icon: "icons/effects/",
                        icon_state: "parallax",
                        layer: -10 + layer,
                        eye_id: eye.id,
                    });
                    parallax_atom.get_plane_id = () => {
                        return "parallax";
                    };
                    parallax_atom.get_displacement = function get_displacement(timestamp) {
                        const origin_disp = this.eye &&
                            this.eye.origin &&
                            this.eye.origin.get_displacement &&
                            this.eye.origin.get_displacement(timestamp);
                        let dispx = 0;
                        let dispy = 0;
                        if (origin_disp) {
                            dispx = -(origin_disp.dispx + this.get_plane().parallax_offset[0]) * layer;
                            dispy = -(origin_disp.dispy + this.get_plane().parallax_offset[1]) * layer;
                        }
                        dispx = ((dispx % 480) - 480) % 480;
                        dispy = ((dispy % 480) + 480) % 480;
                        dispx += x * 480;
                        dispy += y * 480;
                        dispx /= 32;
                        dispy /= 32;
                        return { dispx, dispy };
                    };
                    parallax_atom.draw = chain_func(parallax_atom.draw, function (prev, ctx) {
                        ctx.globalCompositeOperation = "lighten";
                        prev();
                        ctx.globalCompositeOperation = "source-over";
                    });
                }
            }
        }
    }
    draw_objects(timestamp) {
        if (this.parallax_velocity_lasttimestamp !== -1) {
            const diff = (timestamp - this.parallax_velocity_lasttimestamp) / 1000;
            this.parallax_offset[0] += this.parallax_velocity[0] * diff;
            this.parallax_offset[1] += this.parallax_velocity[1] * diff;
        }
        this.parallax_velocity_lasttimestamp = timestamp;
        super.draw_objects(timestamp);
    }
    composite_plane(eye_ctx, timestamp) {
        const mctx = this.mask_canvas.getContext("2d");
        mctx.clearRect(0, 0, eye_ctx.canvas.width, eye_ctx.canvas.height);
        mctx.fillStyle = "#ffffff";
        const { dispx, dispy } = (this.eye.origin &&
            this.eye.origin.get_displacement &&
            this.eye.origin.get_displacement(timestamp)) || { dispx: 0, dispy: 0 };
        for (const tile of this.client.visible_tiles) {
            const [x, y] = JSON.parse(tile);
            mctx.fillRect(Math.round((x - dispx + 7) * 32), Math.round(-(y - dispy - 7) * 32), 32, 32);
        }
        mctx.globalCompositeOperation = "source-in";
        super.composite_plane(mctx, timestamp);
        mctx.globalCompositeOperation = "source-over";
        eye_ctx.globalCompositeOperation = "destination-over";
        eye_ctx.drawImage(this.mask_canvas, 0, 0);
        eye_ctx.globalCompositeOperation = "source-over";
    }
};

},{"../client/index.js":1}],18:[function(require,module,exports){
"use strict";
const preload_list = ["icons/error.png"];
module.exports = async function preload(client) {
    for (const path of preload_list) {
        if (!client.icon_metas[path]) {
            await client.enqueue_icon_meta_load(client, path);
        }
    }
};

},{}],19:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { chain_func, Component } = require("../client/index.js");
const PROGRESSBAR_HEIGHT = 6 / 32;
const _progress_bars = Symbol("_progress_bars");
class ProgressBar extends Component {
    constructor(atom, template) {
        super(atom, template);
        atom.get_displacement = this.get_displacement.bind(this);
        atom.get_plane_id = this.get_plane_id.bind(this);
        atom.on_render_tick = chain_func(atom.on_render_tick, this.on_render_tick.bind(this));
    }
    update_offset(timestamp) {
        if (this.target_offset_y && this.target_offset_y < this.offset_y && this.last_timestamp) {
            this.offset_y = Math.max(this.target_offset_y, this.offset_y - (timestamp - this.last_timestamp) / 640);
        }
        if (!this.attached_atom) {
            this.attached_atom = this.atom.client.atoms_by_netid[this.attached_atom_id];
            if (!this.attached_atom[_progress_bars]) {
                this.attached_atom[_progress_bars] = [];
            }
            this.target_offset_y = 1 + PROGRESSBAR_HEIGHT * this.attached_atom[_progress_bars].length;
            if (this.attached_atom[_progress_bars].length) {
                const prev_bar = this.attached_atom[_progress_bars][this.attached_atom[_progress_bars].length - 1];
                if (prev_bar.c.ProgressBar.offset_y) {
                    this.offset_y = prev_bar.c.ProgressBar.offset_y + PROGRESSBAR_HEIGHT;
                }
                else {
                    this.offset_y = this.target_offset_y;
                }
            }
            else {
                this.offset_y = this.target_offset_y;
            }
            this.attached_atom[_progress_bars].push(this.atom);
        }
        this.last_timestamp = timestamp;
    }
    get_plane_id() {
        if (this.attached_atom) {
            return this.attached_atom.get_plane_id();
        }
    }
    get_displacement(timestamp) {
        this.update_offset(timestamp);
        if (this.attached_atom) {
            const disp = this.attached_atom.get_displacement(timestamp);
            disp.dispy += this.offset_y;
            return disp;
        }
        return null;
    }
    on_render_tick(prev, timestamp) {
        this.update_offset(timestamp);
        const percentage = (timestamp - (this.time_begin + this.atom.client.server_time_to_client)) / this.delay;
        this.atom.icon_state = `prog_bar_${Math.max(0, Math.min(100, Math.round(percentage * 20) * 5))}`;
        this.atom.icon = `icons/effects/progressbar/${this.atom.icon_state}.png`;
        prev();
    }
    destroy() {
        super.destroy();
        if (this.attached_atom && this.attached_atom[_progress_bars]) {
            const list = this.attached_atom[_progress_bars];
            const idx = list.indexOf(this.atom);
            if (idx !== -1) {
                list.splice(idx, 1);
                for (let i = idx; i < list.length; i++) {
                    list[i].components.ProgressBar.target_offset_y -= PROGRESSBAR_HEIGHT;
                }
            }
        }
    }
}
module.exports.components = { ProgressBar };

},{"../client/index.js":1}],20:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { Component, chain_func } = require("../client/index.js");
class Projectile extends Component {
    constructor(atom, template) {
        super(atom, template);
        this.a.get_transform = chain_func(this.a.get_transform, this.get_transform.bind(this));
        this.a.get_displacement = chain_func(this.a.get_displacement, this.get_displacement.bind(this));
    }
    get_transform(prev) {
        return prev().rotate(((this.angle - 90) * Math.PI) / 180);
    }
    get_displacement(prev, timestamp) {
        const dt = timestamp - this.a.client.server_time_to_client - this.last_process;
        let dispx = this.a.x;
        let dispy = this.a.y;
        const dist_to_move = (this.speed * dt) / 1000;
        const rad_angle = (this.angle * Math.PI) / 180;
        dispx += Math.cos(rad_angle) * dist_to_move;
        dispy += Math.sin(rad_angle) * dist_to_move;
        return { dispx, dispy };
    }
}
module.exports.components = { Projectile };

},{"../client/index.js":1}],21:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { Component, chain_func } = require("../client/index.js");
class SplashScreen extends Component {
    constructor(atom, template) {
        super(atom, template);
        this.fading = false;
        this.fade_start = 0;
        this.fade_len = 1500;
        this.a.del = chain_func(this.a.del, this.del.bind(this));
        this.a.on_render_tick = chain_func(this.a.on_render_tick, this.on_render_tick.bind(this));
        this.a.draw = chain_func(this.a.draw, this.draw.bind(this));
    }
    on_render_tick(prev) {
        prev();
        if (this.fading) {
            this.a.mark_dirty();
        }
    }
    draw(prev, ctx, timestamp) {
        const old_alpha = ctx.globalAlpha;
        if (this.fading) {
            ctx.globalAlpha *= 1 - (1 / this.fade_len) * (timestamp - this.fade_start);
        }
        prev();
        ctx.globalAlpha = old_alpha;
    }
    del(prev) {
        this.fading = true;
        this.fade_start = performance.now();
        setTimeout(prev, this.fade_len);
    }
}
module.exports.components = { SplashScreen };

},{"../client/index.js":1}],22:[function(require,module,exports){
(function (global){(function (){
"use strict";
module.exports.now = function (client) {
    if (global.is_bs_editor_env) {
        module.exports = client;
    }
    window.addEventListener("load", () => {
        const input_elem = document.getElementById("main-text-input");
        document.addEventListener("keydown", (e) => {
            if (e.target.localName === "input" || !client.connection) {
                return;
            }
            // the e.preventDefault() is for stopping the character being typed into the input
            if (e.key === "o") {
                input_elem.dataset.inputting = "ooc";
                input_elem.disabled = false;
                input_elem.focus();
                e.preventDefault();
            }
            else if (e.key === "t") {
                input_elem.dataset.inputting = "say";
                input_elem.disabled = false;
                input_elem.focus();
                e.preventDefault();
            }
        });
        input_elem.parentElement.addEventListener("click", (e) => {
            if (!e.defaultPrevented) {
                input_elem.blur();
                const div = document.createElement("div");
                div.textContent = "Use 'o' for OOC, and 't' for speech.";
                const cw = document.getElementById("chatwindow");
                let do_scroll = false;
                if (cw.scrollTop + cw.clientHeight >= cw.scrollHeight) {
                    do_scroll = true;
                }
                cw.appendChild(div);
                if (do_scroll) {
                    cw.scrollTop = cw.scrollHeight - cw.clientHeight;
                }
            }
        });
        input_elem.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                input_elem.blur();
                input_elem.dataset.inputting = null;
                input_elem.value = "";
                input_elem.disabled = true;
                e.preventDefault();
            }
            else if (e.key === "Enter") {
                if (client.connection && input_elem.dataset.inputting === "ooc") {
                    client.connection.send(JSON.stringify({ ooc_message: input_elem.value }));
                }
                else if (client.connection && input_elem.dataset.inputting === "say") {
                    client.connection.send(JSON.stringify({ say_message: input_elem.value }));
                }
                input_elem.blur();
                input_elem.dataset.inputting = null;
                input_elem.value = "";
                input_elem.disabled = true;
                e.preventDefault();
            }
        });
        input_elem.addEventListener("input", () => {
            const text = input_elem.value;
            if (text.startsWith(";")) {
                input_elem.classList.add("radio");
            }
            else {
                input_elem.classList.remove("radio");
            }
        });
    });
};

}).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],23:[function(require,module,exports){
"use strict";
class AdminPanel {
    constructor(panel) {
        this.panel = panel;
        this.panel.on("message", this.message_handler.bind(this));
        this.panel.content_obj.innerHTML = `
<input type="text" placeholder="Search..." class="button search-field">
<div class='tools-list'>
</div>
`;
        this.panel.$(".search-field").addEventListener("input", (e) => {
            const term = e.target.value;
            for (const item of this.panel.$$(".tool-entry")) {
                if (item.dataset.searchString.includes(term)) {
                    item.style.display = "block";
                }
                else {
                    item.style.display = "none";
                }
            }
        });
    }
    message_handler(msg) {
        if (msg.tools) {
            this.tools = msg.tools;
            this.populate_tools();
        }
    }
    populate_tools() {
        for (const [key, tval] of Object.entries(this.tools).sort((ta, tb) => {
            const a = ta;
            const b = tb;
            const part1 = a[1].name === b[1].name ? 0 : -1;
            return a[1].name > b[1].name ? 1 : part1;
        })) {
            const val = tval;
            const template_elem = document.createElement("div");
            template_elem.classList.add("tool-entry");
            template_elem.style.borderBottom = "1px solid grey";
            template_elem.innerHTML = `
<div style='font-weight:bold'>${val.name}</div>
<div><i>${val.desc || ""}</i></div>
<div class='buttons'></div>
`;
            template_elem.dataset.searchString = key + val.name;
            this.panel.$(".tools-list").appendChild(template_elem);
            const buttons_list = template_elem.querySelector(".buttons");
            for (const button of val.buttons) {
                const elem = document.createElement("div");
                elem.classList.add("button");
                elem.textContent = button;
                elem.dataset.message = JSON.stringify({ button_tool: key, button });
                buttons_list.appendChild(elem);
            }
        }
    }
}
module.exports.panel_classes = { AdminPanel };

},{}],24:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ReagentBinding = require("./reagent_binding.js");
class ChemDispenserPanel {
    constructor(panel) {
        this.panel = panel;
        this.panel.on("message", this.handle_message.bind(this));
        this.dispense_list_container = document.createElement("div");
        this.dispense_list_container.classList.add("status-display");
        this.panel.content_obj.appendChild(this.dispense_list_container);
        this.dispense_amounts = document.createElement("div");
        this.dispense_list_container.appendChild(this.dispense_amounts);
        this.dispense_list = document.createElement("div");
        this.dispense_list_container.appendChild(this.dispense_list);
        this.reagents_list_container = document.createElement("div");
        this.reagents_list_container.classList.add("status-display");
        this.reagents_list_container.innerHTML = `
<div class='has-no-container' style='color:red'>No container loaded</div>
<div class='has-container'>
	<div class='button float-right' data-message='{"eject": true}'>Eject</div>
	<div class='float-right'><span class='total-volume'></span> / <span class='maximum-volume'></span></div>
	<div class='reagents-list'></div>
</div>
`;
        this.panel.content_obj.appendChild(this.reagents_list_container);
        this.reagent_binding = new ReagentBinding(this.panel, this.reagents_list_container);
        for (const amt of [1, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 300]) {
            const button = document.createElement("div");
            button.classList.add("button");
            button.dataset.radioGroup = "dispense_amount";
            button.dataset.radioValue = amt;
            button.innerText = `${amt}`;
            this.dispense_amounts.appendChild(button);
        }
    }
    handle_message(message) {
        if (message.dispensable_reagents) {
            this.dispense_list.innerHTML = "";
            message.dispensable_reagents.sort();
            for (const [reagent, name] of message.dispensable_reagents) {
                const button = document.createElement("div");
                button.classList.add("button");
                button.style.width = "125px";
                button.style.margin = "2px 0";
                button.innerText = name;
                button.dataset.message = JSON.stringify({ dispense: reagent });
                this.dispense_list.appendChild(button);
            }
        }
        if (message.dispense_amount && message.dispense_amount !== this.dispense_amount) {
            this.dispense_amount = message.dispense_amount;
            for (const child of this.dispense_amounts.childNodes) {
                if (child.dataset.radioValue === this.dispense_amount) {
                    child.classList.add("selected");
                }
                else {
                    child.classList.remove("selected");
                }
            }
        }
    }
}
module.exports.panel_classes = { ChemDispenserPanel };

},{"./reagent_binding.js":30}],25:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class LatejoinPanel {
    constructor(panel) {
        this.panel = panel;
        this.panel.on("message", this.handle_message.bind(this));
        this.panel.header_obj.classList.add("center");
        this.panel.content_obj.classList.add("flex-vertical", "wrap");
        this.job_elems = {};
        this.jobs = {};
        this.department_elems = {};
        for (const department of Object.keys(departments)) {
            const { name, color } = departments[department];
            const elem = document.createElement("fieldset");
            elem.classList.add("status-display", "center");
            const legend = document.createElement("legend");
            legend.style.color = color;
            legend.textContent = name;
            elem.appendChild(legend);
            this.panel.content_obj.appendChild(elem);
            this.department_elems[department] = elem;
        }
    }
    handle_message(message) {
        if (message.jobs) {
            for (const id of Object.keys(message.jobs)) {
                const job = this.jobs[id] || {};
                Object.assign(job, message.jobs[id]);
                let elem = this.job_elems[id];
                if (!elem) {
                    elem = document.createElement("div");
                    this.job_elems[id] = elem;
                    const button = document.createElement("div");
                    button.classList.add("button");
                    button.dataset.message = JSON.stringify({ join: id });
                    const department_elem = this.department_elems[job.departments[0] || "misc"];
                    if (job.departments.lastIndexOf("command") > 0) {
                        button.style.fontWeight = "bold";
                        department_elem.insertBefore(elem, department_elem.firstChild);
                    }
                    else {
                        department_elem.appendChild(elem);
                    }
                    elem.appendChild(button);
                    elem.button = button;
                }
                elem.button.textContent = `${job.title} (${job.current_positions}/${job.total_positions !== -1 ? job.total_positions : "∞"})`;
                if (job.current_positions >= job.total_positions && job.total_positions !== -1) {
                    elem.style.display = "none";
                }
                else {
                    elem.style.display = "block";
                }
            }
        }
    }
}
const departments = {
    misc: {
        name: "Miscellaneous",
        color: "#ffffff",
    },
};
module.exports.panel_classes = { LatejoinPanel };

},{}],26:[function(require,module,exports){
"use strict";
class LoginPanel {
    constructor(panel) {
        this.panel = panel;
        this.panel.content_obj.classList.add("center");
        this.panel.header_obj.classList.add("center");
        this.connection = panel.manager.client.connection;
        this.message_handler = this.message_handler.bind(this);
        this.connection.addEventListener("message", this.message_handler);
    }
    message_handler(e) {
        const obj = JSON.parse(e.data);
        if (obj.login_type === "debug") {
            let div = document.createElement("div");
            div.classList.add("vertical-margins");
            const text_input = document.createElement("input");
            text_input.type = "text";
            text_input.maxLength = 30;
            text_input.value = localStorage.getItem("debug_username");
            text_input.placeholder = "Nickname";
            div.appendChild(text_input);
            this.panel.content_obj.appendChild(div);
            div = document.createElement("div");
            div.classList.add("vertical-margins");
            const button = document.createElement("div");
            button.classList.add("button");
            button.textContent = "Connect";
            button.addEventListener("click", () => {
                localStorage.setItem("debug_username", text_input.value);
                this.connection.send(JSON.stringify({ login: text_input.value }));
                this.login_finish();
            });
            div.appendChild(button);
            this.panel.content_obj.appendChild(div);
        }
        else if (obj.valid === true) {
            if (obj.autojoin) {
                this.connection.send(JSON.stringify({ login: obj.logged_in_as }));
                this.login_finish();
            }
        }
        else if (obj.login_type === "database") {
            const div = document.createElement("div");
            div.classList.add("vertical-margins");
            const text_input = document.createElement("input");
            text_input.type = "text";
            text_input.maxLength = 30;
            text_input.placeholder = "Username";
            text_input.value = localStorage.getItem("stored_username");
            div.appendChild(text_input);
            const div2 = document.createElement("p");
            div.appendChild(div2);
            const password_input = document.createElement("input");
            password_input.type = "password";
            password_input.maxLength = 30;
            password_input.placeholder = "Password";
            password_input.value = localStorage.getItem("stored_password");
            div.appendChild(password_input);
            const div3 = document.createElement("p");
            div.appendChild(div3);
            const button = document.createElement("div");
            button.classList.add("button");
            button.textContent = "Login";
            button.addEventListener("click", () => {
                this.connection.send(JSON.stringify({ name: text_input.value, password: password_input.value, request_check: true }));
                localStorage.setItem("stored_username", text_input.value);
            });
            div.appendChild(button);
            this.panel.content_obj.appendChild(div);
            if (obj.value === true && obj.logged_in_as === text_input.value) {
                this.connection.send(JSON.stringify({ login: text_input.value }));
                this.login_finish();
            }
        }
        else {
            this.panel.content_obj.getElementsByClassName("logged-in")[0].style.display = "none";
            this.panel.content_obj.getElementsByClassName("not-logged-in")[0].style.display = "block";
            this.panel.content_obj.getElementsByClassName("connect-button")[0].classList.add("disabled");
        }
    }
    login_finish() {
        this.connection.removeEventListener("message", this.message_handler);
        this.panel.manager.client.login_finish();
        this.panel.close();
    }
}
module.exports.panel_classes = { LoginPanel };

},{}],27:[function(require,module,exports){
"use strict";
class MachineWirePanel {
    constructor(panel) {
        this.panel = panel;
        this.panel.on("message", this.handle_message.bind(this));
        this.panel.content_obj.innerHTML = `
			<div class='status-display wires_list'>

			</div>
			<div class='status-display status_text' style='display: none'>

			</div>
		`;
    }
    handle_message(msg) {
        if (msg.wires) {
            for (const wire of msg.wires) {
                if (!this.panel.$(`.wire-color-${wire.color}`)) {
                    const elem = document.createElement("tr");
                    elem.classList.add("zebrastripe", "flex", "flex-horizontal", `wire-color-${wire.color}`);
                    elem.innerHTML = `
						<span class='wire-color' style='color: ${wire.color}'>${wire.color}</span>
						<div class='button wire-pulse-button' style='margin-left: auto' data-message='{"pulse":"${wire.color}"}' title="Requires multitool">Pulse</div>
						<div class='button wire-cut-button' data-message='{"cut":"${wire.color}"}' title="Requires wirecutters"></div>
					`;
                    this.panel.$(".wires_list").appendChild(elem);
                    if (this.item_type !== "Multitool") {
                        this.panel.$(`.wire-color-${wire.color} .wire-pulse-button`).classList.add("disabled");
                    }
                    if (this.item_type !== "Wirecutters") {
                        this.panel.$(`.wire-color-${wire.color} .wire-cut-button`).classList.add("disabled");
                    }
                }
                if (typeof wire.cut !== "undefined") {
                    this.panel.$(`.wire-color-${wire.color} .wire-cut-button`).textContent = wire.cut ? "Mend" : "Cut";
                }
            }
        }
        this.handle_other_messages(msg);
    }
    handle_other_messages(msg) {
        if (typeof msg.item_type !== "undefined") {
            this.item_type = msg.item_type;
            for (const elem of this.panel.$$(".wire-cut-button")) {
                if (this.item_type === "Wirecutters") {
                    elem.classList.remove("disabled");
                }
                else {
                    elem.classList.add("disabled");
                }
            }
            for (const elem of this.panel.$$(".wire-pulse-button")) {
                if (this.item_type === "Multitool") {
                    elem.classList.remove("disabled");
                }
                else {
                    elem.classList.add("disabled");
                }
            }
        }
        if (typeof msg.status_text !== "undefined") {
            if (typeof msg.status_text === "undefined") {
                this.panel.$(".status_text").style.display = "none";
            }
            else {
                this.panel.$(".status_text").style.display = "block";
            }
            this.panel.$(".status_text").innerHTML = msg.status_text;
        }
    }
}
module.exports.panel_classes = { MachineWirePanel };

},{}],28:[function(require,module,exports){
"use strict";
class NewPlayerPanel {
    constructor(panel) {
        this.panel = panel;
        this.panel.on("message", this.handle_message.bind(this));
        this.build_content();
        this.update_timer = this.update_timer.bind(this);
        this.update_timer();
    }
    handle_message(message) {
        if (typeof message.latejoin !== "undefined") {
            [...this.panel.content_obj.getElementsByClassName("pregame")].forEach((item) => (item.style.display = message.latejoin ? "none" : "block"));
            [...this.panel.content_obj.getElementsByClassName("latejoin")].forEach((item) => (item.style.display = message.latejoin ? "block" : "none"));
        }
        if (typeof message.start_at !== "undefined") {
            this.start_at = message.start_at;
            this.update_timer();
        }
    }
    update_timer() {
        this.timer_timeout = setTimeout(this.update_timer, 50);
        if (typeof this.start_at === "undefined") {
            this.panel.$(".timer").textContent = "Delayed";
        }
        else {
            const time_left = this.start_at - (performance.now() - this.panel.manager.client.server_time_to_client);
            if (time_left < 0) {
                this.panel.$(".timer").textContent = "SOON";
            }
            else {
                this.panel.$(".timer").textContent = (time_left / 1000).toFixed(1);
            }
        }
    }
    build_content() {
        this.panel.header_obj.classList.add("center");
        this.panel.content_obj.classList.add("center");
        this.panel.content_obj.innerHTML = `
			<div class="vertical-margins"><div class='button' data-message='{"setup_character":true}'>Character & Preferences</div></div>
			<div class="pregame vertical-margins">
				Starting in: <span class='timer'></span>
			</div>
			<div class="latejoin vertical-margins"><div class='button' data-message='{"latejoin":true}'>Join Game</div></div>
			<div class="vertical-margins"><div class='button' data-message='{"observe":true}'>Observe</div></div>
		`;
    }
}
module.exports.panel_classes = { NewPlayerPanel };

},{}],29:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { Atom, dropdown } = require("../../client/index.js");
const job_pref_settings = ["NEVER", "Low", "Medium", "High"];
const job_pref_colors = ["red", "orange", "green", "slateblue"];
class PreferencesPanel {
    constructor(panel) {
        this.panel = panel;
        this.panel.header_obj.classList.add("center");
        this.panel.content_obj.innerHTML = `
<div class='center'>
	<div class='button' data-radio-group='tab' data-tab='character'>Character Setup</div>
	<div class='button' data-radio-group='tab' data-tab='job-preferences'>Job Preferences</div>
	<div class='button' data-radio-group='tab' data-tab='preferences'>Preferences</div>
</div>
<hr>
<div class='tabcontent' style='display: none' data-tab='character'>

<div class='status-display float-right' style='width:128px;height:128px;margin-left: 10;padding:0;position:relative'>
	<canvas class='preview-down' style='width:64px; position:absolute; top:0;left:0'></canvas>
	<canvas class='preview-right' style='width:64px; position:absolute; top:0;right:0'></canvas>
	<canvas class='preview-up' style='width:64px; position:absolute; bottom:0;left:0'></canvas>
	<canvas class='preview-left' style='width:64px; position:absolute; bottom:0;right:0'></canvas>
</div>
<div class='status-display'>
	<h2>Identity</h2>
	<div><div class='button property-be_random_name'>Always Random Name</div></div>
	<table>
	<tr>
		<td>Name:</td>
		<td><input type='text' class='button nopress nocenter property-name' maxlength=42></td>
		<td><div class='button yellow' data-message='{"randomize_name":"human"}'>Random</div></td>
	</tr>
	<tr>
		<td>Gender:</td>
		<td><div class='button property-gender dropdown'>Male</div></td>
	</tr>
	<tr>
		<td>Age:</td>
		<td><input class='button nopress nocenter property-age' type='number' min=17 max=85></td>
	</tr>
	</table>
</div>

<div class='status-display'>
	<h2>Body</h2>
	<div class='flex-horizontal wrap appearance-properties-container'>
		<div>
			<h3>Skin Tone</h3>
			<div><div class='button property-skin_tone dropdown'>caucasian2</div></div>
		</div>
		<div>
			<h3>Hair Style</h3>
			<div><div class='button property-hair dropdown'>Bald</div></div>
			<div><div class='button property-hair_color dropdown'>Color</div></div>
		</div>
	</div>
</div>

</div>
<div class='tabcontent' style='display: none' data-tab='job-preferences'>

<div class='job-list' style='color: #000000;display:grid;grid-auto-flow:column'></div>

</div>
<div class='tabcontent' style='display: none' data-tab='preferences'>

<input type="range" min="1" max="16" step="1" class="shadow-quality-slider" value=8>

</div>`;
        [...this.panel.$$('.button[data-radio-group="tab"]')].forEach((item) => {
            item.addEventListener("click", () => {
                this.show_tab(item.dataset.tab);
            });
        });
        const name_field = this.panel.$(".property-name");
        name_field.addEventListener("input", () => {
            this.panel.send_message({ char_prefs: { name: name_field.value } });
        });
        const gender_dropdown = this.panel.$(".property-gender");
        gender_dropdown.addEventListener("click", (e) => {
            if (e.defaultPrevented) {
                return;
            }
            const genders = { male: "Male", female: "Female" };
            const menu = document.createElement("div");
            menu.classList.add("dropdown-content");
            for (const [id, name] of Object.entries(genders)) {
                const item = document.createElement("div");
                item.classList.add("button", "dropdown-item");
                if (id === this.char_prefs.gender) {
                    item.classList.add("selected");
                }
                item.textContent = name;
                item.addEventListener("click", (e2) => {
                    this.panel.send_message({ char_prefs: { gender: id } });
                    e2.preventDefault();
                    this.char_prefs.gender = id;
                    gender_dropdown.textContent = name;
                    this.update_previews();
                });
                menu.appendChild(item);
            }
            dropdown(gender_dropdown, menu);
        });
        const hair_dropdown = this.panel.$(".property-hair");
        hair_dropdown.addEventListener("click", (e) => {
            if (e.defaultPrevented) {
                return;
            }
            const menu = document.createElement("div");
            menu.classList.add("dropdown-content");
            let sel_elem = null;
            for (const [id, tobj] of Object.entries(this.sprite_accessories.hair)) {
                const obj = tobj;
                const item = document.createElement("div");
                item.classList.add("button", "dropdown-item");
                item.style.height = "64px";
                if (id === this.char_prefs.hair_style) {
                    item.classList.add("selected");
                    sel_elem = item;
                }
                const text = document.createElement("span");
                text.textContent = obj.name;
                const preview = this.create_preview({
                    prefs_modifier: (prefs) => {
                        prefs.hair_style = id;
                    },
                });
                preview.style.float = "left";
                preview.style.height = "64px";
                item.appendChild(preview);
                item.appendChild(text);
                item.addEventListener("click", (e3) => {
                    this.panel.send_message({ char_prefs: { hair_style: id } });
                    e3.preventDefault();
                    this.char_prefs.hair_style = id;
                    hair_dropdown.textContent = obj.name;
                    this.update_previews();
                });
                menu.appendChild(item);
            }
            dropdown(hair_dropdown, menu);
            if (sel_elem) {
                sel_elem.scrollIntoView({ behavior: "auto" });
            }
        });
        const skin_tone_dropdown = this.panel.$(".property-skin_tone");
        skin_tone_dropdown.addEventListener("click", (e) => {
            if (e.defaultPrevented) {
                return;
            }
            const menu = document.createElement("div");
            menu.classList.add("dropdown-content");
            let sel_elem = null;
            for (const id of Object.keys(this.skin_tones)) {
                const item = document.createElement("div");
                item.classList.add("button", "dropdown-item");
                item.style.height = "64px";
                if (id === this.char_prefs.skin_tone) {
                    item.classList.add("selected");
                    sel_elem = item;
                }
                const text = document.createElement("span");
                text.textContent = id;
                const preview = this.create_preview({
                    prefs_modifier: (prefs) => {
                        prefs.skin_tone = id;
                    },
                });
                preview.style.float = "left";
                preview.style.height = "64px";
                item.appendChild(preview);
                item.appendChild(text);
                item.addEventListener("click", (e4) => {
                    this.panel.send_message({ char_prefs: { skin_tone: id } });
                    e4.preventDefault();
                    this.char_prefs.skin_tone = id;
                    skin_tone_dropdown.textContent = id;
                    this.update_previews();
                });
                menu.appendChild(item);
            }
            dropdown(skin_tone_dropdown, menu);
            if (sel_elem) {
                sel_elem.scrollIntoView({ behavior: "auto" });
            }
        });
        const hair_color_dropdown = this.panel.$(".property-hair_color");
        hair_color_dropdown.addEventListener("click", (e) => {
            if (e.defaultPrevented) {
                return;
            }
            const menu = document.createElement("div");
            menu.classList.add("dropdown-content");
            let sel_elem = null;
            for (const id of Object.keys(this.hair_colors)) {
                const item = document.createElement("div");
                item.classList.add("button", "dropdown-item");
                item.style.width = "96px";
                item.style.height = "24px";
                item.style.backgroundColor = this.hair_colors[id];
                if (this.hair_colors[id] === this.char_prefs.hair_color) {
                    item.classList.add("selected");
                    sel_elem = item;
                }
                const text = document.createElement("span");
                text.textContent = id;
                item.appendChild(text);
                item.addEventListener("click", (e5) => {
                    this.panel.send_message({ char_prefs: { hair_color: this.hair_colors[id] } });
                    e5.preventDefault();
                    this.char_prefs.hair_color = this.hair_colors[id];
                    hair_color_dropdown.textContent = id;
                    hair_color_dropdown.style.backgroundColor = this.char_prefs.hair_color;
                    this.update_previews();
                });
                menu.appendChild(item);
            }
            dropdown(hair_color_dropdown, menu);
            if (sel_elem) {
                sel_elem.scrollIntoView({ behavior: "auto" });
            }
        });
        this.panel.$(".property-age").addEventListener("input", (e) => {
            const age = Math.round(+e.target.value);
            this.panel.send_message({ char_prefs: { age } });
        });
        const shadow_quality_slider = this.panel.$(".shadow-quality-slider");
        shadow_quality_slider.value = this.panel.manager.client.soft_shadow_resolution;
        shadow_quality_slider.addEventListener("input", () => {
            const desired_res = +shadow_quality_slider.value;
            this.panel.manager.client.soft_shadow_resolution = desired_res;
            localStorage.setItem("shadow_resolution", String(desired_res));
            for (const atom of this.panel.manager.client.atoms) {
                if (atom && atom.c && atom.c.LightingObject) {
                    atom.mark_dirty();
                }
            }
        });
        this.panel.on("message", this.handle_message.bind(this));
        this.char_prefs = {};
    }
    show_tab(tab) {
        [...this.panel.$$(".tabcontent")].forEach((item) => {
            item.style.display = "none";
        });
        const tab_obj = this.panel.$(`.tabcontent[data-tab='${tab}']`);
        if (tab_obj) {
            tab_obj.style.display = "block";
        }
    }
    msg_char_prefs(msg) {
        Object.assign(this.char_prefs, msg.char_prefs);
        if (msg.char_prefs.name) {
            this.panel.$(".property-name").value = msg.char_prefs.name;
        }
        if (msg.char_prefs.gender) {
            this.panel.$(".property-gender").textContent = msg.char_prefs.gender === "male" ? "Male" : "Female";
        }
        if (msg.char_prefs.age) {
            this.panel.$(".property-age").value = msg.char_prefs.age;
        }
        if (msg.char_prefs.skin_tone) {
            this.panel.$(".property-skin_tone").textContent = msg.char_prefs.skin_tone;
        }
        if (msg.char_prefs.hair_color) {
            this.panel.$(".property-hair_color").style.backgroundColor = msg.char_prefs.hair_color;
        }
        if (msg.char_prefs.hair_style) {
            this.panel.$(".property-hair").textContent = this.sprite_accessories.hair[msg.char_prefs.hair_style].name;
        }
        this.update_previews();
    }
    handle_message(msg) {
        if (msg.sprite_accessories) {
            this.sprite_accessories = msg.sprite_accessories;
        }
        if (msg.skin_tones) {
            this.skin_tones = msg.skin_tones;
        }
        if (msg.hair_colors) {
            this.hair_colors = msg.hair_colors;
        }
        if (msg.set_tab) {
            [...this.panel.$$(".button[data-radio-group='tab']")].forEach((item) => {
                item.classList.remove("selected");
            });
            this.panel.$(`.button[data-radio-group='tab'][data-tab='${msg.set_tab}']`).classList.add("selected");
            this.show_tab(msg.set_tab);
        }
        if (msg.char_prefs) {
            this.msg_char_prefs(msg);
        }
        if (Object.prototype.hasOwnProperty.call(msg, "name_valid")) {
            const elem = this.panel.$(".property-name");
            if (msg.name_valid) {
                elem.classList.remove("red");
            }
            else {
                elem.classList.add("red");
            }
        }
        if (msg.name_correction) {
            const elem = this.panel.$(".property-name");
            if (elem.value === msg.name_correction[0]) {
                elem.value = msg.name_correction[1];
            }
        }
        if (msg.job_preferences) {
            this.handle_prefs(msg);
        }
    }
    handle_prefs(msg) {
        this.job_preferences = msg.job_preferences;
        if (msg.job_metas) {
            this.job_metas = msg.job_metas;
        }
        // alright now we order the jobs.
        const job_order = [...Object.keys(this.job_metas)];
        job_order.sort((a, b) => {
            const ameta = this.job_metas[a];
            const bmeta = this.job_metas[b];
            const department_diff = department_order.indexOf(ameta.departments[0] || "misc") -
                department_order.indexOf(bmeta.departments[0] || "misc");
            if (department_diff !== 0) {
                return department_diff;
            }
            if (ameta.departments.includes("command") && !bmeta.departments.includes("command")) {
                return -1;
            }
            if (!ameta.departments.includes("command") && bmeta.departments.includes("command")) {
                return 1;
            }
            return 0;
        });
        this.panel.$(".job-list").style.gridTemplateRows = `repeat(${Math.ceil(job_order.length / 2)}, auto)`;
        for (const key of job_order) {
            const meta = this.job_metas[key];
            const elem = document.createElement("div");
            elem.style.minWidth = "280";
            elem.style.backgroundColor = meta.selection_color;
            elem.dataset.jobKey = key;
            const setting = this.job_preferences[key];
            elem.innerHTML = `
<div style='text-align:right;width:180;display:inline-block;padding-right:3px'>${meta.name}</div>
<div style='display:inline-block' class='job-pref-button-container'></div>`;
            const job_pref_button_container = elem.querySelector(".job-pref-button-container");
            const job_pref_button = document.createElement("div");
            job_pref_button_container.appendChild(job_pref_button);
            job_pref_button.classList.add("button", "dropdown", "white", "job-selection-button");
            if (key === "nomad") {
                this.do_nomad_job(key, setting, job_pref_button);
            }
            else {
                this.do_other_job(key, setting, job_pref_button);
            }
            this.panel.$(".job-list").appendChild(elem);
        }
    }
    do_other_job(key, setting, job_pref_button) {
        job_pref_button.style.visibility = "hidden";
        job_pref_button.classList.add("affected-by-assistant");
        job_pref_button.style.color = job_pref_colors[setting];
        job_pref_button.textContent = job_pref_settings[setting];
        job_pref_button.addEventListener("click", (e) => {
            if (e.defaultPrevented) {
                return;
            }
            const menu = document.createElement("div");
            menu.classList.add("dropdown-content");
            for (let i = 0; i <= 3; i++) {
                const item = document.createElement("div");
                item.classList.add("button", "dropdown-item", "white");
                if (i === this.job_preferences[key]) {
                    item.classList.add("selected");
                }
                item.textContent = job_pref_settings[i];
                item.style.color = job_pref_colors[i];
                item.addEventListener("click", (e6) => {
                    this.panel.send_message({ job_preferences: { [key]: i } });
                    e6.preventDefault();
                    job_pref_button.textContent = job_pref_settings[i];
                    job_pref_button.style.color = job_pref_colors[i];
                    this.job_preferences[key] = i;
                    if (i === 3) {
                        for (const [otherjob, level] of Object.entries(this.job_preferences)) {
                            if (level === 3 && otherjob !== key) {
                                this.job_preferences[otherjob] = 2;
                                const otherelem = this.panel.$(`.job-list div[data-job-key="${otherjob}"] .job-selection-button`);
                                if (otherelem) {
                                    otherelem.textContent = job_pref_settings[2];
                                    otherelem.style.color = job_pref_colors[2];
                                }
                            }
                        }
                    }
                });
                menu.appendChild(item);
            }
            dropdown(job_pref_button, menu);
        });
    }
    do_nomad_job(key, setting, job_pref_button) {
        if (setting) {
            job_pref_button.style.color = "green";
            job_pref_button.textContent = "Yes";
        }
        else {
            job_pref_button.style.color = "red";
            job_pref_button.textContent = "No";
        }
    }
    update_previews() {
        this.create_preview({ canvas: this.panel.$(".preview-down"), dir: 1 });
        this.create_preview({ canvas: this.panel.$(".preview-right"), dir: 3 });
        this.create_preview({ canvas: this.panel.$(".preview-up"), dir: 2 });
        this.create_preview({ canvas: this.panel.$(".preview-left"), dir: 4 });
    }
    create_preview({ canvas = null, dir = 1, modifier = null, prefs_modifier = null } = {}) {
        const atom = new Atom(this.panel.manager.client, { dir });
        const prefs = JSON.parse(JSON.stringify(this.char_prefs));
        if (prefs_modifier) {
            prefs_modifier(prefs);
        }
        for (const part of [
            "torso",
            "groin",
            "l_arm",
            "r_arm",
            "l_leg",
            "r_leg",
            "r_hand",
            "l_hand",
            "r_foot",
            "l_foot",
            "head",
        ]) {
            let icon_state = part;
            let partic = part;
            icon_state += prefs.gender === "female" ? "_f" : "_m";
            partic += prefs.gender === "female" ? "_f" : "_m";
            let color = null;
            if (this.skin_tones) {
                color = this.skin_tones[prefs.skin_tone];
            }
            atom.set_overlay(`limb_${part}`, {
                icon: `icons/mob/human_body/${partic}/${partic}-dir${dir}.png`,
                icon_state,
                color,
            });
        }
        const hair_style = this.sprite_accessories.hair[prefs.hair_style];
        if (hair_style) {
            atom.set_overlay("hair", {
                icon: `${hair_style.base_icon}/${hair_style.icon_state}-dir${dir}.png`,
                icon_state: hair_style.icon_state,
                color: this.char_prefs.hair_color,
                overlay_layer: 14,
            });
        }
        if (modifier) {
            modifier(atom);
        }
        if (!canvas) {
            canvas = document.createElement("canvas");
        }
        canvas.width = 32;
        canvas.height = 32;
        let ts = performance.now();
        atom.on_render_tick(ts);
        atom.fully_load().then(() => {
            ts = performance.now();
            atom.on_render_tick(ts);
            const ctx = canvas.getContext("2d");
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            atom.draw(ctx, ts);
            atom.del();
        });
        return canvas;
    }
}
const department_order = ["misc", "command", "supply", "service", "eng", "med", "sci", "sec", "synth"];
module.exports.now = (client) => {
    const shadow_pref = localStorage.getItem("shadow_resolution");
    if (typeof shadow_pref !== "undefined") {
        client.soft_shadow_resolution = +shadow_pref;
    }
};
module.exports.panel_classes = { PreferencesPanel };

},{"../../client/index.js":1}],30:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class ReagentBinding {
    constructor(panel, elem, props) {
        Object.assign(this, {
            path: "beaker",
        }, props);
        this.elem = elem;
        this.message_handler = this.message_handler.bind(this);
        this.panel = panel;
        this.reagent_elems = {};
        this.panel.on("message", this.message_handler);
        for (const e of this.elem.querySelectorAll(".has-container")) {
            e.style.display = "none";
        }
        for (const e of this.elem.querySelectorAll(".has-no-container")) {
            e.style.display = "visible";
        }
    }
    message_handler(obj) {
        for (const split of this.path.split(".")) {
            if (!obj || !Object.prototype.hasOwnProperty.call(obj, split)) {
                return;
            }
            obj = obj[split];
        }
        if (!obj) {
            this.handle_no_obj_message();
        }
        else {
            this.handle_obj_message(obj);
        }
    }
    handle_no_obj_message() {
        for (const e of this.elem.querySelectorAll(".has-container")) {
            e.style.display = "none";
        }
        for (const e of this.elem.querySelectorAll(".has-no-container")) {
            e.style.display = null;
        }
        for (const e of Object.values(this.reagent_elems)) {
            if (!e) {
                continue;
            }
            this.elem.querySelector(".reagents-list").removeChild(e);
        }
        this.reagent_elems = {};
    }
    handle_obj_message(obj) {
        for (const e of this.elem.querySelectorAll(".has-container")) {
            e.style.display = null;
        }
        for (const e of this.elem.querySelectorAll(".has-no-container")) {
            e.style.display = "none";
        }
        if (typeof obj.temperature !== "undefined") {
            [...this.elem.querySelectorAll(".temperature")].forEach((item) => {
                item.textContent = +obj.temperature.toFixed(1);
            });
        }
        if (typeof obj.holder_name !== "undefined") {
            [...this.elem.querySelectorAll(".holder-name")].forEach((item) => {
                item.textContent = obj.holder_name;
            });
        }
        if (typeof obj.total_volume !== "undefined") {
            [...this.elem.querySelectorAll(".total-volume")].forEach((item) => {
                item.textContent = obj.total_volume;
            });
        }
        if (typeof obj.maximum_volume !== "undefined") {
            [...this.elem.querySelectorAll(".maximum-volume")].forEach((item) => {
                item.textContent = obj.maximum_volume;
            });
        }
        if (obj.reagents) {
            this.check_reagents(obj);
        }
    }
    check_reagents(obj) {
        const reagents_list = this.elem.querySelector(".reagents-list");
        for (const [key, robj] of Object.entries(obj.reagents)) {
            if (!robj) {
                if (this.reagent_elems[key]) {
                    reagents_list.removeChild(this.reagent_elems[key]);
                    delete this.reagent_elems[key];
                }
                continue;
            }
            let elem = this.reagent_elems[key];
            if (!elem) {
                elem = this.build_entry( /*key, robj*/);
                reagents_list.appendChild(elem);
                this.reagent_elems[key] = elem;
            }
            this.update_entry(key, robj, elem);
        }
    }
    build_entry( /*id, obj*/) {
        const elem = document.createElement("div");
        elem.classList.add("zebrastripe");
        elem.style.padding = "2px 0";
        return elem;
    }
    update_entry(id, obj, elem) {
        elem.textContent = `${+obj.volume.toFixed(2)} unit${obj.volume === 1 ? "" : "s"} of ${obj.name}`;
    }
    close() {
        for (const e of this.elem.querySelectorAll(".has-container")) {
            e.style.display = "none";
        }
        for (const e of this.elem.querySelectorAll(".has-no-container")) {
            e.style.display = "visible";
        }
        this.panel.removeListener("message", this.message_handler);
    }
}
module.exports = ReagentBinding;

},{}],31:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { Atom } = require("../../client/index.js");
class SpawnObjectPanel {
    constructor(panel) {
        this.panel = panel;
        this.panel.on("message", this.message_handler.bind(this));
        this.panel.content_obj.innerHTML = `
<input type="text" placeholder="Search..." class="button search-field">
<div class='templates-list'>
</div>
`;
        this.panel.$(".search-field").addEventListener("input", (e) => {
            const term = e.target.value;
            for (const item of this.panel.$$(".template-entry")) {
                if (item.dataset.searchString.includes(term)) {
                    item.style.display = "block";
                }
                else {
                    item.style.display = "none";
                }
            }
        });
        this.panel.content_obj.addEventListener("click", (e) => {
            const button = e.target.closest(".spawn-button");
            if (button) {
                const template_name = button.closest(".template-entry").dataset.templateKey;
                this.panel.send_message({ spawn: template_name });
            }
        });
        if (this.panel.manager.client.server_templates) {
            this.templates = this.panel.manager.client.server_templates;
            this.populate_templates();
        }
    }
    message_handler(msg) {
        if (msg.templates) {
            this.templates = msg.templates;
            this.panel.manager.client.server_templates = msg.templates;
            this.populate_templates();
        }
    }
    populate_templates() {
        for (const [tkey, tval] of Object.entries(this.templates).sort((a, b) => {
            const part1 = a[0] === b[0] ? 0 : -1;
            return a[0] > b[0] ? 1 : part1;
        })) {
            const key = tkey;
            const val = tval;
            const template_elem = document.createElement("div");
            template_elem.classList.add("template-entry");
            template_elem.style.borderBottom = "1px solid grey";
            template_elem.innerHTML = `
<canvas class='item-preview float-left' width=32 height=32></canvas>
<div class='button spawn-button float-right' dataset-template>Spawn</div>
<div><b>${val.vars.name}</b></div>
<div>
	<i>${key}</i>
</div>
`;
            template_elem.dataset.templateKey = key;
            template_elem.dataset.searchString = key + val.vars.name;
            this.panel.$(".templates-list").appendChild(template_elem);
            const preview = template_elem.querySelector(".item-preview");
            setTimeout(() => {
                // alright we need to build some images
                const instobj = Object.assign({}, val.vars);
                instobj.components = (val.components || []).filter((i) => {
                    return this.panel.manager.client.components[i];
                });
                instobj.component_vars = val.vars.components;
                if (val.vars.components && val.vars.components.Tangible) {
                    instobj.directional = val.vars.components.Tangible.directional;
                }
                else {
                    instobj.directional = false;
                }
                const a = new Atom(this.panel.manager.client, instobj); // quick and dirty
                a.on_render_tick(0);
                a.fully_load(instobj.directional).then(() => {
                    a.on_render_tick(0);
                    a.draw(preview.getContext("2d"), 0);
                    a.del();
                });
            }, 1);
        }
    }
}
module.exports.panel_classes = { SpawnObjectPanel };

},{"../../client/index.js":1}],32:[function(require,module,exports){
(function (global){(function (){
"use strict";
class StackCraftPanel {
    constructor(panel) {
        this.panel = panel;
        this.civilization = null;
        this.panel.on("message", this.handle_message.bind(this));
        const amount_elem = document.createElement("div");
        amount_elem.appendChild(document.createTextNode("amount: "));
        amount_elem.appendChild((this.amount_node = document.createTextNode("")));
        this.panel.content_obj.appendChild(amount_elem);
        this.recipes_elem = document.createElement("div");
        this.panel.content_obj.appendChild(this.recipes_elem);
    }
    handle_message(message) {
        if (message.civilization) {
            this.civilization = message.civilization;
        }
        if (message.recipes) {
            this.recipes = message.recipes;
            this.build_recipes();
        }
        if (message.amount) {
            this.amount_node.textContent = message.amount;
        }
        if (message.build_limit) {
            this.recipes[message.build_limit.index].build_limit = message.build_limit.build_limit;
            this.build_recipe(message.build_limit.index);
        }
    }
    build_recipes() {
        this.recipes_elem.innerHTML = "";
        for (let i = 0; i < this.recipes.length; i++) {
            const recipe = this.recipes[i];
            if (typeof recipe === "undefined") {
                this.recipes_elem.appendChild(document.createElement("hr"));
            }
            //else if (this.recipe_check_tech(recipe) === 1) {
            else {
                const recipe_elem = document.createElement("div");
                recipe_elem.classList.add("small-vertical-margins");
                this.recipes_elem.appendChild(recipe_elem);
                this.build_recipe(i);
            }
        }
    }
    build_recipe(i) {
        const elem = this.recipes_elem.childNodes[i];
        if (elem.innerHTML) {
            elem.innerHTML = "";
        }
        const recipe = this.recipes[i];
        const main_button_elem = document.createElement("div");
        main_button_elem.innerText = `${recipe.res_amount && recipe.res_amount > 1 ? `${recipe.res_amount}x ` : ""}${recipe.name} (costs ${recipe.cost})`;
        main_button_elem.classList.add("button");
        if (recipe.build_limit <= 0) {
            main_button_elem.classList.add("disabled");
        }
        main_button_elem.dataset.message = JSON.stringify({ build: i, amount: 1 });
        elem.appendChild(main_button_elem);
    }
    recipe_check_tech(recipe) {
        if (!recipe.age1 || !recipe.age2 || !recipe.age2 || !recipe.last_age) {
            return 0;
        }
        if (global.Tworld.age > recipe.last_age) {
            return 0;
        }
        if (typeof this.civilization === "undefined" || this.civilization === "") {
            console.log("No civ");
            if (global.Tworld.age1 >= recipe.age1 &&
                global.Tworld.age2 >= recipe.age2 &&
                global.Tworld.age3 >= recipe.age3) {
                return 1;
            }
            else {
                return 0;
            }
        }
        else {
            console.log("Yes civ");
            if (global.Tworld.civilizations[this.civilization]) {
                const currciv = global.Tworld.civilizations[this.civilization];
                if (currciv.research_ind >= global.Tworld.age1 &&
                    currciv.research_mil >= global.Tworld.age1 &&
                    currciv.research_hlt >= global.Tworld.age3) {
                    return 1;
                }
                else {
                    return 0;
                }
            }
            else {
                return 0;
            }
        }
    }
}
module.exports.panel_classes = { StackCraftPanel };

}).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],33:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { Atom } = require("../../client/index.js");
class StripPanel {
    constructor(panel) {
        this.panel = panel;
        this.panel.on("message", this.handle_message.bind(this));
        this.panel.content_obj.innerHTML = `
			<table class='item-table'></table>
		`;
        this.covered = {};
        this.cached_appearances = {};
    }
    handle_message(msg) {
        if (msg.layout) {
            const table = this.panel.$(".item-table");
            let i = 0;
            for (const slotkey of msg.layout) {
                const name = msg.layout_names[i];
                i++;
                const tr = document.createElement("tr");
                table.appendChild(tr);
                if (typeof slotkey === "undefined") {
                    tr.innerHTML = "<td colspan=3>&nbsp;</td>";
                    continue;
                }
                tr.dataset.slot = slotkey;
                tr.innerHTML = `
<td>${name}</td>
<td>
	<div class='button strip-button'>
		<canvas style='display:none;height:16px;float:left' width=32 height=32 class='item-appearance'></canvas>
		<span class='item-name'>Empty</span>
	</div>
</td>
<td><div class='button internals-button' style='display:none' data-message="${JSON.stringify({
                    slot_internals: slotkey,
                })}">Disable Internals</div></td>
				`;
                tr.querySelector(".strip-button").dataset.message = JSON.stringify({
                    slot: slotkey,
                });
            }
        }
        if (msg.covered) {
            for (const [slot, val] of Object.entries(msg.covered)) {
                if (!this.panel.$(`tr[data-slot=${slot}]`)) {
                    continue;
                }
                this.covered[slot] = val;
                const item_name_elem = this.panel.$(`tr[data-slot=${slot}] .item-name`);
                const strip_button_elem = this.panel.$(`tr[data-slot=${slot}] .strip-button`);
                if (val) {
                    item_name_elem.textContent = "Obscured";
                    strip_button_elem.classList.add("disabled");
                    strip_button_elem.style.color = "inherit";
                }
                else {
                    strip_button_elem.classList.remove("disabled");
                }
            }
        }
        if (msg.item_names) {
            for (const [slot, newname] of Object.entries(msg.item_names)) {
                if (!this.panel.$(`tr[data-slot=${slot}]`)) {
                    continue;
                }
                if (!this.covered[slot]) {
                    this.panel.$(`tr[data-slot=${slot}] .item-name`).textContent = newname || "Empty";
                    if (newname) {
                        this.panel.$(`tr[data-slot=${slot}] .strip-button`).style.color = "inherit";
                    }
                    else {
                        this.panel.$(`tr[data-slot=${slot}] .strip-button`).style.color = "grey";
                    }
                }
            }
        }
        if (msg.item_appearances) {
            for (const [slot, newappearance] of Object.entries(msg.item_appearances)) {
                if (!this.panel.$(`tr[data-slot=${slot}]`)) {
                    continue;
                }
                const canvas = this.panel.$(`tr[data-slot=${slot}] .item-appearance`);
                const do_clear = !this.cached_appearances[slot];
                this.cached_appearances[slot] = newappearance;
                if (newappearance) {
                    canvas.style.display = "inline-block";
                    const ctx = canvas.getContext("2d");
                    const a = new Atom(this.panel.manager.client, newappearance); // quick and dirty
                    if (do_clear) {
                        ctx.clearRect(0, 0, 32, 32);
                    }
                    a.on_render_tick(0);
                    a.fully_load().then(() => {
                        if (newappearance === this.cached_appearances[slot]) {
                            ctx.clearRect(0, 0, 32, 32);
                            a.on_render_tick(0);
                            a.draw(ctx, 0);
                        }
                        a.del();
                    });
                }
                else {
                    canvas.style.display = "none";
                }
            }
        }
    }
}
module.exports.panel_classes = { StripPanel };

},{"../../client/index.js":1}],34:[function(require,module,exports){
(function (global){(function (){
"use strict";
const TypespessClient = require("./client/index.js");
const { Eye, Plane } = TypespessClient;
const { ParallaxPlane } = require("./code/parallax.js");
// Just a small little polyfill for Edge (fuck you edge by the way)
for (const collection_class of [HTMLCollection, NodeList, DOMTokenList]) {
    if (!collection_class.prototype[Symbol.iterator]) {
        collection_class.prototype[Symbol.iterator] = Array.prototype[Symbol.iterator];
    }
}
const client = new TypespessClient();
client.importModule(require("./code/alert.js"));
client.importModule(require("./code/carbon_mob.js"));
client.importModule(require("./code/hud.js"));
client.importModule(require("./code/progress_bar.js"));
client.importModule(require("./code/projectile.js"));
client.importModule(require("./code/splash_screen.js"));
client.importModule(require("./code/text_input.js"));
client.importModule(require("./code/ui/admin_menu.js"));
client.importModule(require("./code/ui/chem_dispenser.js"));
client.importModule(require("./code/ui/latejoin.js"));
client.importModule(require("./code/ui/login.js"));
client.importModule(require("./code/ui/machine_wires.js"));
client.importModule(require("./code/ui/new_player.js"));
client.importModule(require("./code/ui/preferences.js"));
client.importModule(require("./code/ui/spawn_object.js"));
client.importModule(require("./code/ui/stack_craft.js"));
client.importModule(require("./code/ui/strip.js"));
if (global.is_bs_editor_env) {
    module.exports = client;
}
else {
    client.handle_login = function () {
        this.panel_manager.create_client_panel({
            title: "Login",
            can_close: false,
            content_class: "LoginPanel",
            width: 250,
            height: 400,
        });
    };
    require("./code/preload.js")(client);
    window.addEventListener("load", () => {
        const eye = new Eye(client, "");
        const main_plane = new Plane.World(eye, "");
        main_plane.z_index = 0;
        const ui_plane = new Plane(eye, "ui");
        ui_plane.z_index = 10000;
        const lighting_plane = new Plane.Lighting(eye, "lighting");
        lighting_plane.z_index = 5000;
        const parallax_plane = new ParallaxPlane(eye, "parallax");
        parallax_plane.z_index = 9999;
        eye.canvas = document.getElementById("mainlayer");
        eye.create_click_handlers();
        eye.on("mouse_over_atom_changed", (to) => {
            const doc = document.getElementById("hovering-atom");
            if (doc) {
                if (to) {
                    doc.textContent = to.name;
                }
                else {
                    doc.textContent = "";
                }
            }
        });
        client.login();
    });
}

}).call(this)}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./client/index.js":1,"./code/alert.js":14,"./code/carbon_mob.js":15,"./code/hud.js":16,"./code/parallax.js":17,"./code/preload.js":18,"./code/progress_bar.js":19,"./code/projectile.js":20,"./code/splash_screen.js":21,"./code/text_input.js":22,"./code/ui/admin_menu.js":23,"./code/ui/chem_dispenser.js":24,"./code/ui/latejoin.js":25,"./code/ui/login.js":26,"./code/ui/machine_wires.js":27,"./code/ui/new_player.js":28,"./code/ui/preferences.js":29,"./code/ui/spawn_object.js":31,"./code/ui/stack_craft.js":32,"./code/ui/strip.js":33}],35:[function(require,module,exports){

},{}],36:[function(require,module,exports){
(function (process,__dirname){(function (){
var fs = require('fs')
var path = require('path')

var pathFile = path.join(__dirname, 'path.txt')

function getElectronPath () {
  if (fs.existsSync(pathFile)) {
    var executablePath = fs.readFileSync(pathFile, 'utf-8')
    if (process.env.ELECTRON_OVERRIDE_DIST_PATH) {
      return path.join(process.env.ELECTRON_OVERRIDE_DIST_PATH, executablePath)
    }
    return path.join(__dirname, 'dist', executablePath)
  } else {
    throw new Error('Electron failed to install correctly, please delete node_modules/electron and try installing again')
  }
}

module.exports = getElectronPath()

}).call(this)}).call(this,require('_process'),"/../node_modules/electron")
},{"_process":40,"fs":35,"path":39}],37:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

var R = typeof Reflect === 'object' ? Reflect : null
var ReflectApply = R && typeof R.apply === 'function'
  ? R.apply
  : function ReflectApply(target, receiver, args) {
    return Function.prototype.apply.call(target, receiver, args);
  }

var ReflectOwnKeys
if (R && typeof R.ownKeys === 'function') {
  ReflectOwnKeys = R.ownKeys
} else if (Object.getOwnPropertySymbols) {
  ReflectOwnKeys = function ReflectOwnKeys(target) {
    return Object.getOwnPropertyNames(target)
      .concat(Object.getOwnPropertySymbols(target));
  };
} else {
  ReflectOwnKeys = function ReflectOwnKeys(target) {
    return Object.getOwnPropertyNames(target);
  };
}

function ProcessEmitWarning(warning) {
  if (console && console.warn) console.warn(warning);
}

var NumberIsNaN = Number.isNaN || function NumberIsNaN(value) {
  return value !== value;
}

function EventEmitter() {
  EventEmitter.init.call(this);
}
module.exports = EventEmitter;
module.exports.once = once;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._eventsCount = 0;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
var defaultMaxListeners = 10;

function checkListener(listener) {
  if (typeof listener !== 'function') {
    throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof listener);
  }
}

Object.defineProperty(EventEmitter, 'defaultMaxListeners', {
  enumerable: true,
  get: function() {
    return defaultMaxListeners;
  },
  set: function(arg) {
    if (typeof arg !== 'number' || arg < 0 || NumberIsNaN(arg)) {
      throw new RangeError('The value of "defaultMaxListeners" is out of range. It must be a non-negative number. Received ' + arg + '.');
    }
    defaultMaxListeners = arg;
  }
});

EventEmitter.init = function() {

  if (this._events === undefined ||
      this._events === Object.getPrototypeOf(this)._events) {
    this._events = Object.create(null);
    this._eventsCount = 0;
  }

  this._maxListeners = this._maxListeners || undefined;
};

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function setMaxListeners(n) {
  if (typeof n !== 'number' || n < 0 || NumberIsNaN(n)) {
    throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received ' + n + '.');
  }
  this._maxListeners = n;
  return this;
};

function _getMaxListeners(that) {
  if (that._maxListeners === undefined)
    return EventEmitter.defaultMaxListeners;
  return that._maxListeners;
}

EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
  return _getMaxListeners(this);
};

EventEmitter.prototype.emit = function emit(type) {
  var args = [];
  for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
  var doError = (type === 'error');

  var events = this._events;
  if (events !== undefined)
    doError = (doError && events.error === undefined);
  else if (!doError)
    return false;

  // If there is no 'error' event listener then throw.
  if (doError) {
    var er;
    if (args.length > 0)
      er = args[0];
    if (er instanceof Error) {
      // Note: The comments on the `throw` lines are intentional, they show
      // up in Node's output if this results in an unhandled exception.
      throw er; // Unhandled 'error' event
    }
    // At least give some kind of context to the user
    var err = new Error('Unhandled error.' + (er ? ' (' + er.message + ')' : ''));
    err.context = er;
    throw err; // Unhandled 'error' event
  }

  var handler = events[type];

  if (handler === undefined)
    return false;

  if (typeof handler === 'function') {
    ReflectApply(handler, this, args);
  } else {
    var len = handler.length;
    var listeners = arrayClone(handler, len);
    for (var i = 0; i < len; ++i)
      ReflectApply(listeners[i], this, args);
  }

  return true;
};

function _addListener(target, type, listener, prepend) {
  var m;
  var events;
  var existing;

  checkListener(listener);

  events = target._events;
  if (events === undefined) {
    events = target._events = Object.create(null);
    target._eventsCount = 0;
  } else {
    // To avoid recursion in the case that type === "newListener"! Before
    // adding it to the listeners, first emit "newListener".
    if (events.newListener !== undefined) {
      target.emit('newListener', type,
                  listener.listener ? listener.listener : listener);

      // Re-assign `events` because a newListener handler could have caused the
      // this._events to be assigned to a new object
      events = target._events;
    }
    existing = events[type];
  }

  if (existing === undefined) {
    // Optimize the case of one listener. Don't need the extra array object.
    existing = events[type] = listener;
    ++target._eventsCount;
  } else {
    if (typeof existing === 'function') {
      // Adding the second element, need to change to array.
      existing = events[type] =
        prepend ? [listener, existing] : [existing, listener];
      // If we've already got an array, just append.
    } else if (prepend) {
      existing.unshift(listener);
    } else {
      existing.push(listener);
    }

    // Check for listener leak
    m = _getMaxListeners(target);
    if (m > 0 && existing.length > m && !existing.warned) {
      existing.warned = true;
      // No error code for this since it is a Warning
      // eslint-disable-next-line no-restricted-syntax
      var w = new Error('Possible EventEmitter memory leak detected. ' +
                          existing.length + ' ' + String(type) + ' listeners ' +
                          'added. Use emitter.setMaxListeners() to ' +
                          'increase limit');
      w.name = 'MaxListenersExceededWarning';
      w.emitter = target;
      w.type = type;
      w.count = existing.length;
      ProcessEmitWarning(w);
    }
  }

  return target;
}

EventEmitter.prototype.addListener = function addListener(type, listener) {
  return _addListener(this, type, listener, false);
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.prependListener =
    function prependListener(type, listener) {
      return _addListener(this, type, listener, true);
    };

function onceWrapper() {
  if (!this.fired) {
    this.target.removeListener(this.type, this.wrapFn);
    this.fired = true;
    if (arguments.length === 0)
      return this.listener.call(this.target);
    return this.listener.apply(this.target, arguments);
  }
}

function _onceWrap(target, type, listener) {
  var state = { fired: false, wrapFn: undefined, target: target, type: type, listener: listener };
  var wrapped = onceWrapper.bind(state);
  wrapped.listener = listener;
  state.wrapFn = wrapped;
  return wrapped;
}

EventEmitter.prototype.once = function once(type, listener) {
  checkListener(listener);
  this.on(type, _onceWrap(this, type, listener));
  return this;
};

EventEmitter.prototype.prependOnceListener =
    function prependOnceListener(type, listener) {
      checkListener(listener);
      this.prependListener(type, _onceWrap(this, type, listener));
      return this;
    };

// Emits a 'removeListener' event if and only if the listener was removed.
EventEmitter.prototype.removeListener =
    function removeListener(type, listener) {
      var list, events, position, i, originalListener;

      checkListener(listener);

      events = this._events;
      if (events === undefined)
        return this;

      list = events[type];
      if (list === undefined)
        return this;

      if (list === listener || list.listener === listener) {
        if (--this._eventsCount === 0)
          this._events = Object.create(null);
        else {
          delete events[type];
          if (events.removeListener)
            this.emit('removeListener', type, list.listener || listener);
        }
      } else if (typeof list !== 'function') {
        position = -1;

        for (i = list.length - 1; i >= 0; i--) {
          if (list[i] === listener || list[i].listener === listener) {
            originalListener = list[i].listener;
            position = i;
            break;
          }
        }

        if (position < 0)
          return this;

        if (position === 0)
          list.shift();
        else {
          spliceOne(list, position);
        }

        if (list.length === 1)
          events[type] = list[0];

        if (events.removeListener !== undefined)
          this.emit('removeListener', type, originalListener || listener);
      }

      return this;
    };

EventEmitter.prototype.off = EventEmitter.prototype.removeListener;

EventEmitter.prototype.removeAllListeners =
    function removeAllListeners(type) {
      var listeners, events, i;

      events = this._events;
      if (events === undefined)
        return this;

      // not listening for removeListener, no need to emit
      if (events.removeListener === undefined) {
        if (arguments.length === 0) {
          this._events = Object.create(null);
          this._eventsCount = 0;
        } else if (events[type] !== undefined) {
          if (--this._eventsCount === 0)
            this._events = Object.create(null);
          else
            delete events[type];
        }
        return this;
      }

      // emit removeListener for all listeners on all events
      if (arguments.length === 0) {
        var keys = Object.keys(events);
        var key;
        for (i = 0; i < keys.length; ++i) {
          key = keys[i];
          if (key === 'removeListener') continue;
          this.removeAllListeners(key);
        }
        this.removeAllListeners('removeListener');
        this._events = Object.create(null);
        this._eventsCount = 0;
        return this;
      }

      listeners = events[type];

      if (typeof listeners === 'function') {
        this.removeListener(type, listeners);
      } else if (listeners !== undefined) {
        // LIFO order
        for (i = listeners.length - 1; i >= 0; i--) {
          this.removeListener(type, listeners[i]);
        }
      }

      return this;
    };

function _listeners(target, type, unwrap) {
  var events = target._events;

  if (events === undefined)
    return [];

  var evlistener = events[type];
  if (evlistener === undefined)
    return [];

  if (typeof evlistener === 'function')
    return unwrap ? [evlistener.listener || evlistener] : [evlistener];

  return unwrap ?
    unwrapListeners(evlistener) : arrayClone(evlistener, evlistener.length);
}

EventEmitter.prototype.listeners = function listeners(type) {
  return _listeners(this, type, true);
};

EventEmitter.prototype.rawListeners = function rawListeners(type) {
  return _listeners(this, type, false);
};

EventEmitter.listenerCount = function(emitter, type) {
  if (typeof emitter.listenerCount === 'function') {
    return emitter.listenerCount(type);
  } else {
    return listenerCount.call(emitter, type);
  }
};

EventEmitter.prototype.listenerCount = listenerCount;
function listenerCount(type) {
  var events = this._events;

  if (events !== undefined) {
    var evlistener = events[type];

    if (typeof evlistener === 'function') {
      return 1;
    } else if (evlistener !== undefined) {
      return evlistener.length;
    }
  }

  return 0;
}

EventEmitter.prototype.eventNames = function eventNames() {
  return this._eventsCount > 0 ? ReflectOwnKeys(this._events) : [];
};

function arrayClone(arr, n) {
  var copy = new Array(n);
  for (var i = 0; i < n; ++i)
    copy[i] = arr[i];
  return copy;
}

function spliceOne(list, index) {
  for (; index + 1 < list.length; index++)
    list[index] = list[index + 1];
  list.pop();
}

function unwrapListeners(arr) {
  var ret = new Array(arr.length);
  for (var i = 0; i < ret.length; ++i) {
    ret[i] = arr[i].listener || arr[i];
  }
  return ret;
}

function once(emitter, name) {
  return new Promise(function (resolve, reject) {
    function eventListener() {
      if (errorListener !== undefined) {
        emitter.removeListener('error', errorListener);
      }
      resolve([].slice.call(arguments));
    };
    var errorListener;

    // Adding an error listener is not optional because
    // if an error is thrown on an event emitter we cannot
    // guarantee that the actual event we are waiting will
    // be fired. The result could be a silent way to create
    // memory or file descriptor leaks, which is something
    // we should avoid.
    if (name !== 'error') {
      errorListener = function errorListener(err) {
        emitter.removeListener(name, eventListener);
        reject(err);
      };

      emitter.once('error', errorListener);
    }

    emitter.once(name, eventListener);
  });
}

},{}],38:[function(require,module,exports){
(function (process){(function (){
// https://github.com/electron/electron/issues/2288
function isElectron() {
    // Renderer process
    if (typeof window !== 'undefined' && typeof window.process === 'object' && window.process.type === 'renderer') {
        return true;
    }

    // Main process
    if (typeof process !== 'undefined' && typeof process.versions === 'object' && !!process.versions.electron) {
        return true;
    }

    // Detect the user agent when the `nodeIntegration` option is set to true
    if (typeof navigator === 'object' && typeof navigator.userAgent === 'string' && navigator.userAgent.indexOf('Electron') >= 0) {
        return true;
    }

    return false;
}

module.exports = isElectron;

}).call(this)}).call(this,require('_process'))
},{"_process":40}],39:[function(require,module,exports){
(function (process){(function (){
// 'path' module extracted from Node.js v8.11.1 (only the posix part)
// transplited with Babel

// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

function assertPath(path) {
  if (typeof path !== 'string') {
    throw new TypeError('Path must be a string. Received ' + JSON.stringify(path));
  }
}

// Resolves . and .. elements in a path with directory names
function normalizeStringPosix(path, allowAboveRoot) {
  var res = '';
  var lastSegmentLength = 0;
  var lastSlash = -1;
  var dots = 0;
  var code;
  for (var i = 0; i <= path.length; ++i) {
    if (i < path.length)
      code = path.charCodeAt(i);
    else if (code === 47 /*/*/)
      break;
    else
      code = 47 /*/*/;
    if (code === 47 /*/*/) {
      if (lastSlash === i - 1 || dots === 1) {
        // NOOP
      } else if (lastSlash !== i - 1 && dots === 2) {
        if (res.length < 2 || lastSegmentLength !== 2 || res.charCodeAt(res.length - 1) !== 46 /*.*/ || res.charCodeAt(res.length - 2) !== 46 /*.*/) {
          if (res.length > 2) {
            var lastSlashIndex = res.lastIndexOf('/');
            if (lastSlashIndex !== res.length - 1) {
              if (lastSlashIndex === -1) {
                res = '';
                lastSegmentLength = 0;
              } else {
                res = res.slice(0, lastSlashIndex);
                lastSegmentLength = res.length - 1 - res.lastIndexOf('/');
              }
              lastSlash = i;
              dots = 0;
              continue;
            }
          } else if (res.length === 2 || res.length === 1) {
            res = '';
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          if (res.length > 0)
            res += '/..';
          else
            res = '..';
          lastSegmentLength = 2;
        }
      } else {
        if (res.length > 0)
          res += '/' + path.slice(lastSlash + 1, i);
        else
          res = path.slice(lastSlash + 1, i);
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === 46 /*.*/ && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
}

function _format(sep, pathObject) {
  var dir = pathObject.dir || pathObject.root;
  var base = pathObject.base || (pathObject.name || '') + (pathObject.ext || '');
  if (!dir) {
    return base;
  }
  if (dir === pathObject.root) {
    return dir + base;
  }
  return dir + sep + base;
}

var posix = {
  // path.resolve([from ...], to)
  resolve: function resolve() {
    var resolvedPath = '';
    var resolvedAbsolute = false;
    var cwd;

    for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
      var path;
      if (i >= 0)
        path = arguments[i];
      else {
        if (cwd === undefined)
          cwd = process.cwd();
        path = cwd;
      }

      assertPath(path);

      // Skip empty entries
      if (path.length === 0) {
        continue;
      }

      resolvedPath = path + '/' + resolvedPath;
      resolvedAbsolute = path.charCodeAt(0) === 47 /*/*/;
    }

    // At this point the path should be resolved to a full absolute path, but
    // handle relative paths to be safe (might happen when process.cwd() fails)

    // Normalize the path
    resolvedPath = normalizeStringPosix(resolvedPath, !resolvedAbsolute);

    if (resolvedAbsolute) {
      if (resolvedPath.length > 0)
        return '/' + resolvedPath;
      else
        return '/';
    } else if (resolvedPath.length > 0) {
      return resolvedPath;
    } else {
      return '.';
    }
  },

  normalize: function normalize(path) {
    assertPath(path);

    if (path.length === 0) return '.';

    var isAbsolute = path.charCodeAt(0) === 47 /*/*/;
    var trailingSeparator = path.charCodeAt(path.length - 1) === 47 /*/*/;

    // Normalize the path
    path = normalizeStringPosix(path, !isAbsolute);

    if (path.length === 0 && !isAbsolute) path = '.';
    if (path.length > 0 && trailingSeparator) path += '/';

    if (isAbsolute) return '/' + path;
    return path;
  },

  isAbsolute: function isAbsolute(path) {
    assertPath(path);
    return path.length > 0 && path.charCodeAt(0) === 47 /*/*/;
  },

  join: function join() {
    if (arguments.length === 0)
      return '.';
    var joined;
    for (var i = 0; i < arguments.length; ++i) {
      var arg = arguments[i];
      assertPath(arg);
      if (arg.length > 0) {
        if (joined === undefined)
          joined = arg;
        else
          joined += '/' + arg;
      }
    }
    if (joined === undefined)
      return '.';
    return posix.normalize(joined);
  },

  relative: function relative(from, to) {
    assertPath(from);
    assertPath(to);

    if (from === to) return '';

    from = posix.resolve(from);
    to = posix.resolve(to);

    if (from === to) return '';

    // Trim any leading backslashes
    var fromStart = 1;
    for (; fromStart < from.length; ++fromStart) {
      if (from.charCodeAt(fromStart) !== 47 /*/*/)
        break;
    }
    var fromEnd = from.length;
    var fromLen = fromEnd - fromStart;

    // Trim any leading backslashes
    var toStart = 1;
    for (; toStart < to.length; ++toStart) {
      if (to.charCodeAt(toStart) !== 47 /*/*/)
        break;
    }
    var toEnd = to.length;
    var toLen = toEnd - toStart;

    // Compare paths to find the longest common path from root
    var length = fromLen < toLen ? fromLen : toLen;
    var lastCommonSep = -1;
    var i = 0;
    for (; i <= length; ++i) {
      if (i === length) {
        if (toLen > length) {
          if (to.charCodeAt(toStart + i) === 47 /*/*/) {
            // We get here if `from` is the exact base path for `to`.
            // For example: from='/foo/bar'; to='/foo/bar/baz'
            return to.slice(toStart + i + 1);
          } else if (i === 0) {
            // We get here if `from` is the root
            // For example: from='/'; to='/foo'
            return to.slice(toStart + i);
          }
        } else if (fromLen > length) {
          if (from.charCodeAt(fromStart + i) === 47 /*/*/) {
            // We get here if `to` is the exact base path for `from`.
            // For example: from='/foo/bar/baz'; to='/foo/bar'
            lastCommonSep = i;
          } else if (i === 0) {
            // We get here if `to` is the root.
            // For example: from='/foo'; to='/'
            lastCommonSep = 0;
          }
        }
        break;
      }
      var fromCode = from.charCodeAt(fromStart + i);
      var toCode = to.charCodeAt(toStart + i);
      if (fromCode !== toCode)
        break;
      else if (fromCode === 47 /*/*/)
        lastCommonSep = i;
    }

    var out = '';
    // Generate the relative path based on the path difference between `to`
    // and `from`
    for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
      if (i === fromEnd || from.charCodeAt(i) === 47 /*/*/) {
        if (out.length === 0)
          out += '..';
        else
          out += '/..';
      }
    }

    // Lastly, append the rest of the destination (`to`) path that comes after
    // the common path parts
    if (out.length > 0)
      return out + to.slice(toStart + lastCommonSep);
    else {
      toStart += lastCommonSep;
      if (to.charCodeAt(toStart) === 47 /*/*/)
        ++toStart;
      return to.slice(toStart);
    }
  },

  _makeLong: function _makeLong(path) {
    return path;
  },

  dirname: function dirname(path) {
    assertPath(path);
    if (path.length === 0) return '.';
    var code = path.charCodeAt(0);
    var hasRoot = code === 47 /*/*/;
    var end = -1;
    var matchedSlash = true;
    for (var i = path.length - 1; i >= 1; --i) {
      code = path.charCodeAt(i);
      if (code === 47 /*/*/) {
          if (!matchedSlash) {
            end = i;
            break;
          }
        } else {
        // We saw the first non-path separator
        matchedSlash = false;
      }
    }

    if (end === -1) return hasRoot ? '/' : '.';
    if (hasRoot && end === 1) return '//';
    return path.slice(0, end);
  },

  basename: function basename(path, ext) {
    if (ext !== undefined && typeof ext !== 'string') throw new TypeError('"ext" argument must be a string');
    assertPath(path);

    var start = 0;
    var end = -1;
    var matchedSlash = true;
    var i;

    if (ext !== undefined && ext.length > 0 && ext.length <= path.length) {
      if (ext.length === path.length && ext === path) return '';
      var extIdx = ext.length - 1;
      var firstNonSlashEnd = -1;
      for (i = path.length - 1; i >= 0; --i) {
        var code = path.charCodeAt(i);
        if (code === 47 /*/*/) {
            // If we reached a path separator that was not part of a set of path
            // separators at the end of the string, stop now
            if (!matchedSlash) {
              start = i + 1;
              break;
            }
          } else {
          if (firstNonSlashEnd === -1) {
            // We saw the first non-path separator, remember this index in case
            // we need it if the extension ends up not matching
            matchedSlash = false;
            firstNonSlashEnd = i + 1;
          }
          if (extIdx >= 0) {
            // Try to match the explicit extension
            if (code === ext.charCodeAt(extIdx)) {
              if (--extIdx === -1) {
                // We matched the extension, so mark this as the end of our path
                // component
                end = i;
              }
            } else {
              // Extension does not match, so our result is the entire path
              // component
              extIdx = -1;
              end = firstNonSlashEnd;
            }
          }
        }
      }

      if (start === end) end = firstNonSlashEnd;else if (end === -1) end = path.length;
      return path.slice(start, end);
    } else {
      for (i = path.length - 1; i >= 0; --i) {
        if (path.charCodeAt(i) === 47 /*/*/) {
            // If we reached a path separator that was not part of a set of path
            // separators at the end of the string, stop now
            if (!matchedSlash) {
              start = i + 1;
              break;
            }
          } else if (end === -1) {
          // We saw the first non-path separator, mark this as the end of our
          // path component
          matchedSlash = false;
          end = i + 1;
        }
      }

      if (end === -1) return '';
      return path.slice(start, end);
    }
  },

  extname: function extname(path) {
    assertPath(path);
    var startDot = -1;
    var startPart = 0;
    var end = -1;
    var matchedSlash = true;
    // Track the state of characters (if any) we see before our first dot and
    // after any path separator we find
    var preDotState = 0;
    for (var i = path.length - 1; i >= 0; --i) {
      var code = path.charCodeAt(i);
      if (code === 47 /*/*/) {
          // If we reached a path separator that was not part of a set of path
          // separators at the end of the string, stop now
          if (!matchedSlash) {
            startPart = i + 1;
            break;
          }
          continue;
        }
      if (end === -1) {
        // We saw the first non-path separator, mark this as the end of our
        // extension
        matchedSlash = false;
        end = i + 1;
      }
      if (code === 46 /*.*/) {
          // If this is our first dot, mark it as the start of our extension
          if (startDot === -1)
            startDot = i;
          else if (preDotState !== 1)
            preDotState = 1;
      } else if (startDot !== -1) {
        // We saw a non-dot and non-path separator before our dot, so we should
        // have a good chance at having a non-empty extension
        preDotState = -1;
      }
    }

    if (startDot === -1 || end === -1 ||
        // We saw a non-dot character immediately before the dot
        preDotState === 0 ||
        // The (right-most) trimmed path component is exactly '..'
        preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
      return '';
    }
    return path.slice(startDot, end);
  },

  format: function format(pathObject) {
    if (pathObject === null || typeof pathObject !== 'object') {
      throw new TypeError('The "pathObject" argument must be of type Object. Received type ' + typeof pathObject);
    }
    return _format('/', pathObject);
  },

  parse: function parse(path) {
    assertPath(path);

    var ret = { root: '', dir: '', base: '', ext: '', name: '' };
    if (path.length === 0) return ret;
    var code = path.charCodeAt(0);
    var isAbsolute = code === 47 /*/*/;
    var start;
    if (isAbsolute) {
      ret.root = '/';
      start = 1;
    } else {
      start = 0;
    }
    var startDot = -1;
    var startPart = 0;
    var end = -1;
    var matchedSlash = true;
    var i = path.length - 1;

    // Track the state of characters (if any) we see before our first dot and
    // after any path separator we find
    var preDotState = 0;

    // Get non-dir info
    for (; i >= start; --i) {
      code = path.charCodeAt(i);
      if (code === 47 /*/*/) {
          // If we reached a path separator that was not part of a set of path
          // separators at the end of the string, stop now
          if (!matchedSlash) {
            startPart = i + 1;
            break;
          }
          continue;
        }
      if (end === -1) {
        // We saw the first non-path separator, mark this as the end of our
        // extension
        matchedSlash = false;
        end = i + 1;
      }
      if (code === 46 /*.*/) {
          // If this is our first dot, mark it as the start of our extension
          if (startDot === -1) startDot = i;else if (preDotState !== 1) preDotState = 1;
        } else if (startDot !== -1) {
        // We saw a non-dot and non-path separator before our dot, so we should
        // have a good chance at having a non-empty extension
        preDotState = -1;
      }
    }

    if (startDot === -1 || end === -1 ||
    // We saw a non-dot character immediately before the dot
    preDotState === 0 ||
    // The (right-most) trimmed path component is exactly '..'
    preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
      if (end !== -1) {
        if (startPart === 0 && isAbsolute) ret.base = ret.name = path.slice(1, end);else ret.base = ret.name = path.slice(startPart, end);
      }
    } else {
      if (startPart === 0 && isAbsolute) {
        ret.name = path.slice(1, startDot);
        ret.base = path.slice(1, end);
      } else {
        ret.name = path.slice(startPart, startDot);
        ret.base = path.slice(startPart, end);
      }
      ret.ext = path.slice(startDot, end);
    }

    if (startPart > 0) ret.dir = path.slice(0, startPart - 1);else if (isAbsolute) ret.dir = '/';

    return ret;
  },

  sep: '/',
  delimiter: ':',
  win32: null,
  posix: null
};

posix.posix = posix;

module.exports = posix;

}).call(this)}).call(this,require('_process'))
},{"_process":40}],40:[function(require,module,exports){
// shim for using process in browser
var process = module.exports = {};

// cached from whatever global is present so that test runners that stub it
// don't break things.  But we need to wrap it in a try catch in case it is
// wrapped in strict mode code which doesn't define any globals.  It's inside a
// function because try/catches deoptimize in certain engines.

var cachedSetTimeout;
var cachedClearTimeout;

function defaultSetTimout() {
    throw new Error('setTimeout has not been defined');
}
function defaultClearTimeout () {
    throw new Error('clearTimeout has not been defined');
}
(function () {
    try {
        if (typeof setTimeout === 'function') {
            cachedSetTimeout = setTimeout;
        } else {
            cachedSetTimeout = defaultSetTimout;
        }
    } catch (e) {
        cachedSetTimeout = defaultSetTimout;
    }
    try {
        if (typeof clearTimeout === 'function') {
            cachedClearTimeout = clearTimeout;
        } else {
            cachedClearTimeout = defaultClearTimeout;
        }
    } catch (e) {
        cachedClearTimeout = defaultClearTimeout;
    }
} ())
function runTimeout(fun) {
    if (cachedSetTimeout === setTimeout) {
        //normal enviroments in sane situations
        return setTimeout(fun, 0);
    }
    // if setTimeout wasn't available but was latter defined
    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedSetTimeout(fun, 0);
    } catch(e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
            return cachedSetTimeout.call(null, fun, 0);
        } catch(e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
            return cachedSetTimeout.call(this, fun, 0);
        }
    }


}
function runClearTimeout(marker) {
    if (cachedClearTimeout === clearTimeout) {
        //normal enviroments in sane situations
        return clearTimeout(marker);
    }
    // if clearTimeout wasn't available but was latter defined
    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedClearTimeout(marker);
    } catch (e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
            return cachedClearTimeout.call(null, marker);
        } catch (e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
            return cachedClearTimeout.call(this, marker);
        }
    }



}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    if (!draining || !currentQueue) {
        return;
    }
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = runTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    runClearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        runTimeout(drainQueue);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;
process.prependListener = noop;
process.prependOnceListener = noop;

process.listeners = function (name) { return [] }

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}]},{},[34]);
