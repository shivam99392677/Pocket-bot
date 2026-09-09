// ============================================================
// DATABASE SETUP - Creates all 9 tables for PocketBuddy in PostgreSQL
// ============================================================

async function initializeDatabase(pool) {
    // ---- TABLE 1: users ----
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            major TEXT DEFAULT '',
            student_type TEXT DEFAULT '',
            year INTEGER DEFAULT 1,
            monthly_income DOUBLE PRECISION DEFAULT 0,
            daily_budget DOUBLE PRECISION DEFAULT 0,
            dietary_preferences TEXT DEFAULT '[]',
            emergency_contact TEXT DEFAULT '',
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // ---- TABLE 2: expenses ----
    await pool.query(`
        CREATE TABLE IF NOT EXISTS expenses (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            amount DOUBLE PRECISION NOT NULL,
            category TEXT NOT NULL,
            description TEXT DEFAULT '',
            date TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // ---- TABLE 3: health_logs ----
    await pool.query(`
        CREATE TABLE IF NOT EXISTS health_logs (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            date TEXT NOT NULL,
            sleep_hours DOUBLE PRECISION DEFAULT 0,
            stress_level INTEGER DEFAULT 5,
            mood TEXT DEFAULT 'neutral',
            study_hours DOUBLE PRECISION DEFAULT 0,
            exercise_minutes INTEGER DEFAULT 0,
            social_activity INTEGER DEFAULT 0,
            energy_level INTEGER DEFAULT 5,
            notes TEXT DEFAULT '',
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT unique_user_health_date UNIQUE (user_id, date)
        );
    `);

    // ---- TABLE 4: travel_logs ----
    await pool.query(`
        CREATE TABLE IF NOT EXISTS travel_logs (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            date TEXT NOT NULL,
            origin TEXT NOT NULL,
            destination TEXT NOT NULL,
            mode TEXT NOT NULL,
            cost DOUBLE PRECISION DEFAULT 0,
            duration_minutes INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // ---- TABLE 5: food_logs ----
    await pool.query(`
        CREATE TABLE IF NOT EXISTS food_logs (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            date TEXT NOT NULL,
            meal_type TEXT DEFAULT 'other',
            food_name TEXT NOT NULL,
            cost DOUBLE PRECISION DEFAULT 0,
            calories INTEGER DEFAULT 0,
            is_homemade INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // ---- TABLE 6: burnout_scores ----
    await pool.query(`
        CREATE TABLE IF NOT EXISTS burnout_scores (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            date TEXT NOT NULL,
            baseline_sleep DOUBLE PRECISION DEFAULT 0,
            baseline_stress DOUBLE PRECISION DEFAULT 0,
            baseline_exercise DOUBLE PRECISION DEFAULT 0,
            current_sleep DOUBLE PRECISION DEFAULT 0,
            current_stress DOUBLE PRECISION DEFAULT 0,
            current_exercise DOUBLE PRECISION DEFAULT 0,
            score INTEGER DEFAULT 0,
            alert_level TEXT DEFAULT 'good',
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT unique_user_burnout_date UNIQUE (user_id, date)
        );
    `);

    // ---- TABLE 7: recommendations ----
    await pool.query(`
        CREATE TABLE IF NOT EXISTS recommendations (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            date TEXT NOT NULL,
            type TEXT NOT NULL,
            text TEXT NOT NULL,
            feedback TEXT DEFAULT NULL,
            was_helpful INTEGER DEFAULT NULL,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // ---- TABLE 8: chat_history ----
    await pool.query(`
        CREATE TABLE IF NOT EXISTS chat_history (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            date TEXT NOT NULL,
            user_message TEXT NOT NULL,
            ai_response TEXT NOT NULL,
            context TEXT DEFAULT '{}',
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // ---- TABLE 9: routine_goals ----
    await pool.query(`
        CREATE TABLE IF NOT EXISTS routine_goals (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            goal_type TEXT NOT NULL,
            current_value DOUBLE PRECISION DEFAULT 0,
            target_value DOUBLE PRECISION DEFAULT 0,
            weekly_target DOUBLE PRECISION DEFAULT 0,
            week_number INTEGER DEFAULT 1,
            status TEXT DEFAULT 'active',
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // ---- REFERENCE TABLE: budget_meals ----
    await pool.query(`
        CREATE TABLE IF NOT EXISTS budget_meals (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            cost DOUBLE PRECISION NOT NULL,
            calories INTEGER DEFAULT 0,
            category TEXT DEFAULT 'other',
            dietary_tags TEXT DEFAULT '[]',
            prep_time_minutes INTEGER DEFAULT 0,
            instructions TEXT DEFAULT '',
            is_vegetarian INTEGER DEFAULT 0,
            is_vegan INTEGER DEFAULT 0
        );
    `);

    return pool;
}

module.exports = { initializeDatabase };
