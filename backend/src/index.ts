import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { closeDbPool, initializeMariaDbSchema } from './db/pool.js';
import { apiRouter } from './routes/api.js';

async function startServer() {
  try {
    await initializeMariaDbSchema();
    console.log(
      `[WikiBridge Backend] Connected to MariaDB at ${config.mariadb.host}:${config.mariadb.port}/${config.mariadb.database}`
    );
  } catch (err) {
    console.warn(
      '[WikiBridge Backend] Warning: Could not initialize MariaDB on startup (ensure MariaDB is running):',
      err instanceof Error ? err.message : err
    );
  }

  const app = express();
  app.disable('x-powered-by');

  // Allow Manifest V3 chrome-extension:// origins, moz-extension://, and Wikipedia domains
  app.use(
    cors({
      origin: (origin, callback) => {
        if (
          !origin ||
          origin.startsWith('chrome-extension://') ||
          origin.startsWith('moz-extension://') ||
          /^https:\/\/([a-z-]+\.)?wikipedia\.org$/i.test(origin) ||
          /^http:\/\/localhost(:\d+)?$/i.test(origin)
        ) {
          callback(null, true);
        } else {
          callback(null, true);
        }
      },
      methods: ['GET', 'POST', 'OPTIONS'],
    })
  );

  app.use(express.json({ limit: '2mb' }));
  app.use('/api', apiRouter);

  const server = app.listen(config.port, () => {
    console.log(
      `[WikiBridge Backend] Listening on http://localhost:${config.port} | LLM=${config.llmEnabled ? config.geminiModel : 'heuristic-fallback'}`
    );
  });

  const shutdown = async () => {
    server.close();
    await closeDbPool();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch((err) => {
  console.error('[WikiBridge Backend] Fatal error:', err);
  process.exit(1);
});
