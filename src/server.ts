import { createServer } from 'node:http';
import app from './app';
import { assertProductionConfiguration, env } from './config';
import { connectDatabase } from './db';
import { attachRealtime, closeRealtime } from './realtime';
import { startPaymentCleanup, stopPaymentCleanup } from './services/paymentCleanup';

async function main() {
  assertProductionConfiguration();
  await connectDatabase();
  startPaymentCleanup();
  const server = createServer(app);
  attachRealtime(server);
  server.listen(env.PORT, '0.0.0.0', () => {
    console.info(`AgriMove API listening on port ${env.PORT}.`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`${signal} received; closing API server.`);
    stopPaymentCleanup();
    void closeRealtime()
      .then(() => import('mongoose'))
      .then(({ default: mongoose }) => mongoose.disconnect())
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        console.error('API shutdown failed:', error);
        process.exit(1);
      });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  console.error('API startup failed:', error);
  process.exit(1);
});
