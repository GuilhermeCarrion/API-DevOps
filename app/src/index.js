const express = require('express');
const { Pool } = require('pg');
const { createClient } = require('redis');
const client = require('prom-client');

const PORT = process.env.PORT || 3000;
const CACHE_KEY = 'tasks:all';

const db = new Pool({ connectionString: process.env.DATABASE_URL });
const cache = createClient({ url: process.env.REDIS_URL });
cache.on('error', (err) => console.error('redis:', err.message));

// --- Métricas Prometheus ---
client.collectDefaultMetrics(); // CPU, memória, event loop, GC do Node
const httpRequests = new client.Counter({
  name: 'http_requests_total',
  help: 'Total de requisições HTTP',
  labelNames: ['method', 'route', 'status'],
});
const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duração das requisições HTTP',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2],
});
const cacheRequests = new client.Counter({
  name: 'cache_requests_total',
  help: 'Leituras do cache Redis por resultado',
  labelNames: ['result'],
});

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    // usa a rota declarada (/tasks/:id) e não a URL real, para não explodir a cardinalidade
    const labels = { method: req.method, route: req.route?.path || 'not_found', status: res.statusCode };
    httpRequests.inc(labels);
    end(labels);
  });
  next();
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.send(await client.register.metrics());
});

app.get('/health', async (req, res) => {
  await db.query('SELECT 1');
  await cache.ping();
  res.json({ status: 'ok' });
});

app.get('/tasks', async (req, res) => {
  const cached = await cache.get(CACHE_KEY);
  if (cached) {
    cacheRequests.inc({ result: 'hit' });
    return res.json(JSON.parse(cached));
  }
  cacheRequests.inc({ result: 'miss' });
  const { rows } = await db.query('SELECT * FROM tasks ORDER BY id');
  await cache.set(CACHE_KEY, JSON.stringify(rows), { EX: 30 });
  res.json(rows);
});

app.post('/tasks', async (req, res) => {
  const title = req.body?.title;
  if (typeof title !== 'string' || !title.trim() || title.length > 200) {
    return res.status(400).json({ error: 'title obrigatório (até 200 caracteres)' });
  }
  const { rows } = await db.query('INSERT INTO tasks (title) VALUES ($1) RETURNING *', [title.trim()]);
  await cache.del(CACHE_KEY);
  res.status(201).json(rows[0]);
});

app.patch('/tasks/:id', async (req, res) => {
  const { rows } = await db.query('UPDATE tasks SET done = NOT done WHERE id = $1 RETURNING *', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'não encontrada' });
  await cache.del(CACHE_KEY);
  res.json(rows[0]);
});

app.delete('/tasks/:id', async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'não encontrada' });
  await cache.del(CACHE_KEY);
  res.status(204).end();
});

// Rota para demonstrar o alerta de taxa de erro no Grafana
app.get('/simulate/error', (req, res) => res.status(500).json({ error: 'erro simulado' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'erro interno' });
});

async function start() {
  await cache.connect();
  await db.query(`CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    done BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  app.listen(PORT, () => console.log(`tarefas-api ouvindo na porta ${PORT}`));
}

// Se banco/cache não estiverem prontos, sai com erro e o Docker/Kubernetes reinicia o container
start().catch((err) => {
  console.error('falha ao iniciar:', err.message);
  process.exit(1);
});
