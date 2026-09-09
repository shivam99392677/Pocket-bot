// ============================================================
// POSTGRESQL DATABASE CONNECTION POOL
// Configured via DATABASE_URL or individual PG environment variables
// ============================================================
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

const poolConfig = connectionString
    ? { connectionString }
    : {
        host: process.env.PGHOST || 'localhost',
        port: parseInt(process.env.PGPORT || '5432', 10),
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || 'postgres',
        database: process.env.PGDATABASE || 'pocketbuddy',
    };

// Enable SSL in production if DATABASE_URL contains sslmode or NODE_ENV is production
if (process.env.NODE_ENV === 'production' && connectionString && !connectionString.includes('sslmode=disable')) {
    poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client:', err);
});

module.exports = pool;
