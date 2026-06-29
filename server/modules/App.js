const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const { requireAuth } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const bootstrapRoutes = require('./routes/bootstrap');
const ticketRoutes = require('./routes/tickets');
const noteRoutes = require('./routes/notes');
const templateRoutes = require('./routes/templates');
const statusRoutes = require('./routes/statuses');
const orderRoutes = require('./routes/orders');

function createApp() {
  const app = express();

  app.use(helmet());
  app.use(compression());
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
      credentials: true, // required: cs.js's fetch() uses credentials: 'include'
    })
  );

  // General API rate limit — generous, just a backstop against runaway
  // loops/bugs in a client, not meant to throttle normal usage.
  app.use(
    '/api/',
    rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false })
  );

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  // Login/logout are unauthenticated by definition.
  app.use('/api/cs/auth', authRoutes);

  // Everything else under /api/cs requires a valid session.
  app.use('/api/cs', requireAuth);
  app.use('/api/cs', bootstrapRoutes);
  app.use('/api/cs', ticketRoutes);
  app.use('/api/cs', noteRoutes);
  app.use('/api/cs', templateRoutes);
  app.use('/api/cs', statusRoutes);
  app.use('/api/cs', orderRoutes);

  // Centralized error handler — keeps stack traces out of API responses.
  app.use((err, req, res, next) => {
    console.error(err);
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ error: err.publicMessage || 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };