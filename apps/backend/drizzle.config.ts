import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db.ts',
  out: './migrations',
  driver: 'd1',
  dbCredentials: {
    wranglerConfigPath: 'wrangler.toml',
    dbName: 'main-db',
  },
} satisfies Config;