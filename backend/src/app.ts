import Fastify, { type FastifyInstance } from 'fastify';
import { EMPTY_TAG_INDEX, type TagIndex } from './search/tag-index.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** The tag index; empty until the server has built it from the database at startup. */
    tagIndex: TagIndex;
  }
}

export interface AppOptions {
  logger?: boolean;
}

export function buildApp({ logger = true }: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger });

  app.decorate('tagIndex', EMPTY_TAG_INDEX);
  app.addHook('onClose', async () => app.tagIndex.dispose());

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
