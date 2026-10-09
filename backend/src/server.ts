import { buildApp } from './app.js';
import { resolvePort } from './port.js';

const port = resolvePort(process.env.PORT);
const app = buildApp();

try {
  await app.listen({ port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
