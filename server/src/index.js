import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import './db.js';
import { seedIfEmpty } from './seed.js';
import authRoutes from './auth.js';
import patientRoutes from './routes/patients.js';
import appointmentRoutes from './routes/appointments.js';
import eventRoutes from './routes/events.js';
import planRoutes from './routes/plans.js';
import painRoutes from './routes/pain.js';
import miscRoutes from './routes/misc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

seedIfEmpty();

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'rehab-center', ts: Date.now() }));
app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/plans', planRoutes);
app.use('/api', painRoutes);
app.use('/api', miscRoutes);

// 生产模式：托管前端构建产物（SPA 回退）
const STATIC_DIR = process.env.STATIC_DIR || path.resolve(__dirname, '../../public');
if (fs.existsSync(STATIC_DIR)) {
  app.use(express.static(STATIC_DIR));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    return res.sendFile(path.join(STATIC_DIR, 'index.html'));
  });
}

// 统一错误处理
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ error: '服务器内部错误' });
});

const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, () => console.log(`rehab-center server listening on :${PORT}`));
