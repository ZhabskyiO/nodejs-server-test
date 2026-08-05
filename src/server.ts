import { buildApp } from './app.js';
import { loadConfig } from './platform/config.js';

/**
 * Process entrypoint: bind the port and shut down cleanly. All wiring lives in
 * buildApp() so tests can reuse it without a listening socket.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp({ config });

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'shutting down');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.apiPort, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error('failed to start server:', err);
  process.exit(1);
});
