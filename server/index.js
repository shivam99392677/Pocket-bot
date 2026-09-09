// ============================================================
// POCKETBUDDY SERVER - PostgreSQL Edition
// Firebase auth handled client-side, PostgreSQL database backend
// ============================================================
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const db = require('./database/db');
const { initializeDatabase } = require('./database/setup');
const { seedBudgetMeals } = require('./database/seed');
const { createAuthMiddleware } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 5000;

// Auth middleware (decodes Firebase tokens + our JWT via PostgreSQL)
const authenticateToken = createAuthMiddleware(db);

// ---- Middleware ----
app.use(cors());
app.use(express.json());

// ---- Routes ----
app.use('/api/auth', require('./routes/auth')(db, authenticateToken));
app.use('/api/expenses', require('./routes/expenses')(db, authenticateToken));
app.use('/api/food', require('./routes/food')(db, authenticateToken));
app.use('/api/travel', require('./routes/travel')(db, authenticateToken));
app.use('/api/health', require('./routes/burnout')(db, authenticateToken));
app.use('/api/burnout', require('./routes/burnout')(db, authenticateToken));
app.use('/api/routine', require('./routes/routine')(db, authenticateToken));
app.use('/api/chat', require('./routes/support')(db, authenticateToken));
app.use('/api/support', require('./routes/support')(db, authenticateToken));

// ---- Proxy /api/v1 requests to Python FastAPI backend ----
app.all('/api/v1/*', authenticateToken, async (req, res) => {
    try {
        const reqPath = req.originalUrl;
        const pythonBaseUrl = process.env.PYTHON_BACKEND_URL || 'http://localhost:8000';
        const targetBase = (pythonBaseUrl.startsWith('http://') || pythonBaseUrl.startsWith('https://'))
            ? pythonBaseUrl
            : `http://${pythonBaseUrl}`;
        const pythonUrl = `${targetBase}${reqPath}`;
        const options = {
            method: req.method,
            headers: {
                'Content-Type': 'application/json'
            }
        };
        if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
            options.body = JSON.stringify(req.body);
        }
        const pythonResponse = await fetch(pythonUrl, options);
        const data = await pythonResponse.json();
        res.status(pythonResponse.status).json(data);
    } catch (err) {
        console.error('Proxy to Python failed:', err.message);
        res.status(502).json({ error: 'Failed to communicate with Python backend service.' });
    }
});

// ---- Static files (production) ----
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, '../client/build')));
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
    });
}

// ---- Health check ----
app.get('/api/health-check', async (req, res) => {
    try {
        await db.query('SELECT 1');
        res.json({ status: 'ok', db: 'postgresql', timestamp: new Date().toISOString() });
    } catch (err) {
        res.status(500).json({ status: 'error', db: 'postgresql_failed', error: err.message });
    }
});

// ---- Startup & Database Initialization ----
async function startServer() {
    try {
        await initializeDatabase(db);
        await seedBudgetMeals(db);
        console.log('✅ PostgreSQL Database schema initialized and seeded');

        app.listen(PORT, '0.0.0.0', () => {
            console.log(`\n🚀 PocketBuddy running → http://localhost:${PORT}`);
            console.log(`📊 DB: PostgreSQL (${process.env.DATABASE_URL ? 'DATABASE_URL' : process.env.PGHOST || 'localhost'})`);
            console.log(`🔐 Auth: Firebase (client-side) + JWT fallback\n`);
        });
    } catch (err) {
        console.error('Failed to initialize PostgreSQL database / start server:', err);
    }
}

if (!process.env.VERCEL) {
    startServer();
}

module.exports = app;
