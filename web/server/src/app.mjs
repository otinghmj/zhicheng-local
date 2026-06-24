import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { permissiveRateLimit } from './middleware/rate-limit.mjs';
import { apiRouter } from './routes/api.mjs';
import { dataRouter } from './routes/data.mjs';
import { healthRouter } from './routes/health.mjs';
import { errorMiddleware } from './utils/errors.mjs';
import { handleMcpRequest } from './services/mcp-server.mjs';

export const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'connect-src': ["'self'", 'http://localhost:9222', 'http://localhost:9223', 'http://localhost:9224'],
    },
  },
}));
app.use(cors());
app.use(permissiveRateLimit);
app.use(express.json());
app.use('/api', healthRouter);
app.use('/api', apiRouter);
app.use('/api/data', dataRouter);
app.all('/mcp', async (req, res, next) => {
  try {
    await handleMcpRequest(req, res);
  } catch (error) {
    next(error);
  }
});

app.use(errorMiddleware);
