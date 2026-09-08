'use strict';

/**
 * Ruin Runner — server entry point.
 * Serves the game and a small leaderboard API.
 * Cloudways injects PORT; the app reads it and binds to 0.0.0.0.
 */

const path = require('path');
const express = require('express');
const compression = require('compression');
const helmet = require('helmet');

const leaderboard = require('./routes/leaderboard');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
      },
    },
  })
);

app.use(compression());
app.use(express.json({ limit: '10kb' }));

app.use('/api', leaderboard);

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

app.get('/healthz', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const server = app.listen(PORT, HOST, () => {
  console.log(`Ruin Runner live on http://${HOST}:${PORT}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
