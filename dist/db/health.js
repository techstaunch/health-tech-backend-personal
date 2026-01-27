"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkDbHealth = void 0;
const index_1 = require("./index");
const checkDbHealth = async () => {
    try {
        await index_1.pool.query("SELECT 1");
        return { status: "up" };
    }
    catch (err) {
        return {
            status: "down",
            error: err instanceof Error ? err.message : "Unknown error",
        };
    }
};
exports.checkDbHealth = checkDbHealth;
