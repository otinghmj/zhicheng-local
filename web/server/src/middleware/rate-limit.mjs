import { rateLimit } from 'express-rate-limit';

export const permissiveRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10_000,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});
