// ============================================================
// AUTH ROUTES - PostgreSQL Edition
// Syncs Firebase & local user credentials with PostgreSQL
// ============================================================
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();

module.exports = function (db, authenticateToken) {

    // POST /api/auth/register - Fallback (non-Firebase) registration
    router.post('/register', async (req, res) => {
        try {
            const { email, password, name, major, year, monthly_income } = req.body;

            if (!email || !password || !name) {
                return res.status(400).json({ error: 'Email, password, and name are required.' });
            }

            const existingUserRes = await db.query('SELECT id FROM users WHERE email = $1', [email]);
            if (existingUserRes.rows.length > 0) {
                return res.status(400).json({ error: 'Email already registered.' });
            }

            const hashedPassword = await bcrypt.hash(password, 10);
            const income = monthly_income || 0;
            const dailyBudget = income > 0 ? Math.round((income / 30) * 100) / 100 : 0;

            const insertRes = await db.query(`
                INSERT INTO users (email, password, name, major, year, monthly_income, daily_budget)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id
            `, [email, hashedPassword, name, major || '', year || 1, income, dailyBudget]);

            const userId = insertRes.rows[0].id;

            const token = jwt.sign(
                { id: userId, email, name },
                process.env.JWT_SECRET,
                { expiresIn: '7d' }
            );

            res.status(201).json({
                message: 'Account created!',
                token,
                user: { id: userId, email, name, major, year }
            });
        } catch (err) {
            console.error('Register error:', err);
            res.status(500).json({ error: 'Server error during registration.' });
        }
    });

    // POST /api/auth/login - Fallback (non-Firebase) login
    router.post('/login', async (req, res) => {
        try {
            const { email, password } = req.body;

            if (!email || !password) {
                return res.status(400).json({ error: 'Email and password are required.' });
            }

            const userRes = await db.query('SELECT * FROM users WHERE email = $1', [email]);
            const user = userRes.rows[0];

            if (!user) {
                return res.status(401).json({ error: 'Invalid email or password.' });
            }

            if (user.password.startsWith('firebase:')) {
                return res.status(401).json({ error: 'This account uses Google sign-in. Use the Google button.' });
            }

            const valid = await bcrypt.compare(password, user.password);
            if (!valid) {
                return res.status(401).json({ error: 'Invalid email or password.' });
            }

            const token = jwt.sign(
                { id: user.id, email: user.email, name: user.name },
                process.env.JWT_SECRET,
                { expiresIn: '7d' }
            );

            res.json({
                message: 'Login successful!',
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    major: user.major,
                    year: user.year,
                    monthly_income: user.monthly_income,
                    daily_budget: user.daily_budget
                }
            });
        } catch (err) {
            console.error('Login error:', err);
            res.status(500).json({ error: 'Server error during login.' });
        }
    });

    // POST /api/auth/firebase-sync - Create/find user after Firebase login
    router.post('/firebase-sync', async (req, res) => {
        try {
            const { name, email, uid, major, student_type, year, monthly_income } = req.body;

            if (!email) {
                return res.status(400).json({ error: 'Email is required.' });
            }

            const userRes = await db.query('SELECT * FROM users WHERE email = $1', [email]);
            let user = userRes.rows[0];

            if (!user) {
                // Create new user from Firebase
                const displayName = name || email.split('@')[0];
                const income = monthly_income || 0;
                const dailyBudget = income > 0 ? Math.round((income / 30) * 100) / 100 : 0;

                const insertRes = await db.query(`
                    INSERT INTO users (email, password, name, major, student_type, year, monthly_income, daily_budget)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    RETURNING id
                `, [email, `firebase:${uid || 'user'}`, displayName, major || '', student_type || '', year || 1, income, dailyBudget]);

                user = {
                    id: insertRes.rows[0].id,
                    email,
                    name: displayName,
                    major: major || '',
                    student_type: student_type || '',
                    year: year || 1,
                    monthly_income: income,
                    daily_budget: dailyBudget
                };
            } else if (name && name !== user.name) {
                // Update name if changed
                await db.query('UPDATE users SET name = $1 WHERE id = $2', [name, user.id]);
                user.name = name;
            }

            res.json({
                message: 'User synced!',
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    major: user.major,
                    student_type: user.student_type,
                    year: user.year,
                    monthly_income: user.monthly_income,
                    daily_budget: user.daily_budget
                }
            });
        } catch (err) {
            console.error('Firebase sync error:', err);
            res.status(500).json({ error: 'Failed to sync user.' });
        }
    });

    // GET /api/auth/profile
    router.get('/profile', authenticateToken, async (req, res) => {
        try {
            const userRes = await db.query(`
                SELECT id, email, name, major, student_type, year, monthly_income, daily_budget, dietary_preferences, emergency_contact, created_at
                FROM users WHERE id = $1
            `, [req.user.id]);

            const user = userRes.rows[0];

            if (!user) return res.status(404).json({ error: 'User not found.' });
            res.json(user);
        } catch (err) {
            console.error('Get profile error:', err);
            res.status(500).json({ error: 'Failed to fetch profile.' });
        }
    });

    // PUT /api/auth/profile
    router.put('/profile', authenticateToken, async (req, res) => {
        try {
            const { name, major, student_type, year, monthly_income, daily_budget, dietary_preferences, emergency_contact } = req.body;

            await db.query(`
                UPDATE users SET
                    name = COALESCE($1, name),
                    major = COALESCE($2, major),
                    student_type = COALESCE($3, student_type),
                    year = COALESCE($4, year),
                    monthly_income = COALESCE($5, monthly_income),
                    daily_budget = COALESCE($6, daily_budget),
                    dietary_preferences = COALESCE($7, dietary_preferences),
                    emergency_contact = COALESCE($8, emergency_contact)
                WHERE id = $9
            `, [name, major, student_type, year, monthly_income, daily_budget, dietary_preferences, emergency_contact, req.user.id]);

            res.json({ message: 'Profile updated.' });
        } catch (err) {
            console.error('Update profile error:', err);
            res.status(500).json({ error: 'Failed to update profile.' });
        }
    });

    return router;
};
