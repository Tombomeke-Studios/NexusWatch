/** The HTTP app: the route table under `/api`, plus `/health` at the root for Docker. */
import express, { type NextFunction, type Request, type Response } from 'express';
import { HttpError, collectorHealth, routes } from './routes.js';
import type { Ctx } from './views/ctx.js';

export function createApp(ctx: Ctx) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  const api = express.Router();
  for (const route of routes) {
    const method = route.method.toLowerCase() as 'get' | 'post' | 'patch';
    api[method](route.path, (req: Request, res: Response) => {
      const result = route.handle(ctx, {
        params: req.params as Record<string, string>,
        query: req.query as Record<string, string | undefined>,
        body: req.body,
      });
      if (result === null) res.status(204).end();
      else res.json(result);
    });
  }
  api.use((req: Request, res: Response) => {
    res.status(404).type('text/plain').send(`No such endpoint: ${req.method} /api${req.path}`);
  });

  app.get('/health', (_req, res) => {
    res.json(collectorHealth(ctx));
  });
  app.use('/api', api);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    void _next;
    if (err instanceof HttpError) {
      res.status(err.status).type('text/plain').send(err.message);
      return;
    }
    // A malformed JSON body arrives here from express.json().
    const status = (err as { status?: number }).status;
    if (status && status >= 400 && status < 500) {
      res.status(status).type('text/plain').send(err instanceof Error ? err.message : 'Bad request');
      return;
    }
    console.error('[collector] request failed:', err);
    res.status(500).type('text/plain').send('Internal error');
  });
  return app;
}
