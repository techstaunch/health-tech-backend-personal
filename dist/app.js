"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const middleware_1 = require("./middleware");
const routes_1 = require("./routes");
const app = (0, express_1.default)();
app.use(middleware_1.installCORS);
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
app.use(middleware_1.installAuth);
app.use("/health", routes_1.healthRouter);
exports.default = app;
