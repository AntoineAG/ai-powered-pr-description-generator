"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelCache = void 0;
class ModelCache {
    constructor(builder) {
        this.builder = builder;
        this.map = new Map();
    }
    getOrBuild(name) {
        const existing = this.map.get(name);
        if (existing)
            return existing;
        const built = this.builder(name);
        this.map.set(name, built);
        return built;
    }
}
exports.ModelCache = ModelCache;
