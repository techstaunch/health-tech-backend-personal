"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.installCORS = exports.installAuth = void 0;
var installAuth_1 = require("./installAuth");
Object.defineProperty(exports, "installAuth", { enumerable: true, get: function () { return __importDefault(installAuth_1).default; } });
var installCORS_1 = require("./installCORS");
Object.defineProperty(exports, "installCORS", { enumerable: true, get: function () { return __importDefault(installCORS_1).default; } });
