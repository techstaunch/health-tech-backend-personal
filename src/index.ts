import "dotenv/config";
import app from "./app";
import logger from "./logger";

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  logger.info(`Backend running on port ${PORT}`);
});
