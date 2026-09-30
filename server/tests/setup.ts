import "dotenv/config";

// Tests create and delete real rows, so never let them touch a remote database.
// `npm test` loads .env.test (local Docker Postgres) before this file runs.
const databaseUrl = process.env.DATABASE_URL ?? "";
const host = (() => {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return "";
  }
})();

if (!["localhost", "127.0.0.1", "postgres", "postgres-test"].includes(host)) {
  throw new Error(
    `Refusing to run tests against non-local database host "${host || "<unset>"}". ` +
      "Run `npm run test:setup` and use `npm test` (which loads .env.test)."
  );
}
