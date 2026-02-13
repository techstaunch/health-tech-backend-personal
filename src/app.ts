import express from "express";
import { installAuth, installCORS } from "./middleware";
import { healthRouter } from "./routes";
import agentRoutes from "./routes/agent.routes";
import voiceToTextRoutes from "./voice-to-text/routes/voice-to-text.routes";
import hybridSearchRoutes from "./routes/hybrid-search.routes";

const app = express();

app.use(installCORS);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(installAuth);

app.use("/health", healthRouter);
app.use("/api/agent", agentRoutes);
app.use("/api/agent", agentRoutes);
app.use("/api/voice-to-text", voiceToTextRoutes);
app.use("/api/search", hybridSearchRoutes);

export default app;
