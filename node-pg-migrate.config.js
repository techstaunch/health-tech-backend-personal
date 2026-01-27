require("dotenv").config();

module.exports = {
  databaseUrl:
    process.env.DATABASE_URL || {
      host: process.env.PG_HOST,
      port: Number(process.env.PG_PORT),
      database: process.env.PG_DATABASE,
      user: process.env.PG_USER,
      password: process.env.PG_PASSWORD,
      ssl:
        process.env.PG_SSL === "true"
          ? { rejectUnauthorized: false }
          : false
    },
  migrationsDir: "migrations",
  direction: "up",
  log: console.log
};
