'use strict';

/**
 * Leaderboard API.
 * Scores persist to data/scores.json (created on first write, gitignored so
 * redeploys via git pull never wipe your players' scores).
 */

const fs = require('fs/promises');
const path = require('path');
const express = require('express');

const router = express.Router();
const FILE = path.join(__dirname, '..', 'data', 'scores.json');
const TOP_RETURNED = 10;
const MAX_KEPT = 50;

let cache = null;
let writing = Promise.resolve();

async function load() {
  try {
    const raw = await fs.readFile(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    cache = Array.isArray(parsed) ? parsed : [];
  } catch {
    cache = [];
  }
}

function save() {
  // serialize writes so concurrent submissions don't clobber the file
  writing = writing.then(async () => {
    try {
      await fs.mkdir(path.dirname(FILE), { recursive: true });
      await fs.writeFile(FILE, JSON.stringify(cache, null, 2));
    } catch (err) {
      console.error('Could not persist scores:', err.message);
    }
  });
  return writing;
}

function sanitizeName(input) {
  const name = String(input ?? '')
    .replace(/[<>&"'`]/g, '')
    .trim()
    .slice(0, 16);
  return name || 'Runner';
}

router.get('/leaderboard', async (_req, res) => {
  if (!cache) await load();
  res.json({ scores: cache.slice(0, TOP_RETURNED) });
});

router.post('/score', async (req, res) => {
  if (!cache) await load();

  const name = sanitizeName(req.body && req.body.name);
  const score = Math.floor(Number(req.body && req.body.score));

  if (!Number.isFinite(score) || score < 0 || score > 99999999) {
    return res.status(400).json({ error: 'Invalid score.' });
  }

  cache.push({ name, score, at: Date.now() });
  cache.sort((a, b) => b.score - a.score);
  cache = cache.slice(0, MAX_KEPT);
  await save();

  res.json({ scores: cache.slice(0, TOP_RETURNED) });
});

module.exports = router;
