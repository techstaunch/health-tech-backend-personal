import express from "express";
import { installAuth, installCORS } from "./middleware";
import { healthRouter } from "./routes";

const app = express();

app.use(installCORS);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(installAuth);

app.use("/health", healthRouter);

export default app;
