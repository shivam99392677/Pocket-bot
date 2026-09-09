// ============================================================
// FEATURE 1: EXPENSE MANAGEMENT - PostgreSQL Edition
// Track spending, categorize, show trends, alert overspending
// ============================================================
const express = require('express');
const router = express.Router();

module.exports = function (db, authenticateToken) {

    // POST /api/expenses - Add a new expense
    router.post('/', authenticateToken, async (req, res) => {
        try {
            const { amount, category, description, date } = req.body;

            if (!amount || !category) {
                return res.status(400).json({ error: 'Amount and category are required.' });
            }

            // Valid categories for student expenses
            const validCategories = ['food', 'transport', 'entertainment', 'utilities', 'education', 'health', 'other'];
            if (!validCategories.includes(category.toLowerCase())) {
                return res.status(400).json({
                    error: `Invalid category. Use one of: ${validCategories.join(', ')}`
                });
            }

            const expenseDate = date || new Date().toISOString().split('T')[0];

            const result = await db.query(`
                INSERT INTO expenses (user_id, amount, category, description, date)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id
            `, [req.user.id, amount, category.toLowerCase(), description || '', expenseDate]);

            const newExpenseId = result.rows[0].id;

            // Check if today's spending exceeds daily average * 1.5
            const alert = await checkSpendingAlert(db, req.user.id, expenseDate);

            res.status(201).json({
                message: 'Expense added!',
                expense: { id: newExpenseId, amount, category, description, date: expenseDate },
                alert // Will be null if no alert needed
            });
        } catch (err) {
            console.error('Add expense error:', err);
            res.status(500).json({ error: 'Failed to add expense.' });
        }
    });

    // GET /api/expenses - List all expenses (with optional date filter)
    router.get('/', authenticateToken, async (req, res) => {
        try {
            const { start_date, end_date, category, limit } = req.query;
            let query = 'SELECT id, user_id, amount, category, description, date, created_at FROM expenses WHERE user_id = $1';
            const params = [req.user.id];
            let paramIdx = 2;

            if (start_date) {
                query += ` AND date >= $${paramIdx++}`;
                params.push(start_date);
            }
            if (end_date) {
                query += ` AND date <= $${paramIdx++}`;
                params.push(end_date);
            }
            if (category) {
                query += ` AND category = $${paramIdx++}`;
                params.push(category.toLowerCase());
            }

            query += ' ORDER BY date DESC';

            if (limit) {
                query += ` LIMIT $${paramIdx++}`;
                params.push(parseInt(limit, 10));
            }

            const expensesRes = await db.query(query, params);
            res.json(expensesRes.rows);
        } catch (err) {
            console.error('List expenses error:', err);
            res.status(500).json({ error: 'Failed to fetch expenses.' });
        }
    });

    // GET /api/expenses/summary - Total spending + breakdown by category
    router.get('/summary', authenticateToken, async (req, res) => {
        try {
            const { days } = req.query;
            const lookbackDays = parseInt(days, 10) || 30;

            // Total spending in period
            const totalRes = await db.query(`
                SELECT COALESCE(SUM(amount), 0) as total
                FROM expenses
                WHERE user_id = $1 AND date::date >= (CURRENT_DATE - ($2 || ' days')::interval)
            `, [req.user.id, lookbackDays]);

            const total = parseFloat(totalRes.rows[0].total) || 0;

            // Breakdown by category
            const byCategoryRes = await db.query(`
                SELECT category, SUM(amount) as total, COUNT(*) as count
                FROM expenses
                WHERE user_id = $1 AND date::date >= (CURRENT_DATE - ($2 || ' days')::interval)
                GROUP BY category
                ORDER BY total DESC
            `, [req.user.id, lookbackDays]);

            const byCategory = byCategoryRes.rows.map(r => ({
                category: r.category,
                total: parseFloat(r.total),
                count: parseInt(r.count, 10)
            }));

            // Daily average
            const dailyAvg = total / lookbackDays;

            // Get user's daily budget for comparison
            const userRes = await db.query('SELECT daily_budget FROM users WHERE id = $1', [req.user.id]);
            const dailyBudget = userRes.rows[0]?.daily_budget || 0;

            res.json({
                period_days: lookbackDays,
                total_spent: Math.round(total * 100) / 100,
                daily_average: Math.round(dailyAvg * 100) / 100,
                daily_budget: dailyBudget,
                over_budget: dailyAvg > dailyBudget && dailyBudget > 0,
                by_category: byCategory
            });
        } catch (err) {
            console.error('Expense summary error:', err);
            res.status(500).json({ error: 'Failed to get summary.' });
        }
    });

    // GET /api/expenses/trends - 7-day and 30-day spending trends
    router.get('/trends', authenticateToken, async (req, res) => {
        try {
            // Last 7 days - daily totals
            const last7DaysRes = await db.query(`
                SELECT date, SUM(amount) as daily_total
                FROM expenses
                WHERE user_id = $1 AND date::date >= (CURRENT_DATE - INTERVAL '7 days')
                GROUP BY date
                ORDER BY date ASC
            `, [req.user.id]);

            const last7Days = last7DaysRes.rows.map(r => ({
                date: r.date,
                daily_total: parseFloat(r.daily_total)
            }));

            // Last 30 days - weekly totals
            const last30DaysRes = await db.query(`
                SELECT
                    TO_CHAR(date::date, 'IW') as week_number,
                    MIN(date) as week_start,
                    SUM(amount) as weekly_total
                FROM expenses
                WHERE user_id = $1 AND date::date >= (CURRENT_DATE - INTERVAL '30 days')
                GROUP BY TO_CHAR(date::date, 'IW')
                ORDER BY week_start ASC
            `, [req.user.id]);

            const last30Days = last30DaysRes.rows.map(r => ({
                week_number: r.week_number,
                week_start: r.week_start,
                weekly_total: parseFloat(r.weekly_total)
            }));

            // Compare this week vs last week
            const thisWeekRes = await db.query(`
                SELECT COALESCE(SUM(amount), 0) as total
                FROM expenses
                WHERE user_id = $1 AND date::date >= (CURRENT_DATE - INTERVAL '7 days')
            `, [req.user.id]);

            const lastWeekRes = await db.query(`
                SELECT COALESCE(SUM(amount), 0) as total
                FROM expenses
                WHERE user_id = $1 AND date::date >= (CURRENT_DATE - INTERVAL '14 days') AND date::date < (CURRENT_DATE - INTERVAL '7 days')
            `, [req.user.id]);

            const thisWeekTotal = parseFloat(thisWeekRes.rows[0].total) || 0;
            const lastWeekTotal = parseFloat(lastWeekRes.rows[0].total) || 0;

            // Calculate trend percentage
            let trendPercent = 0;
            if (lastWeekTotal > 0) {
                trendPercent = Math.round(((thisWeekTotal - lastWeekTotal) / lastWeekTotal) * 100);
            }

            res.json({
                daily: last7Days,
                weekly: last30Days,
                this_week_total: Math.round(thisWeekTotal * 100) / 100,
                last_week_total: Math.round(lastWeekTotal * 100) / 100,
                trend_percent: trendPercent,
                trend_direction: trendPercent > 0 ? 'up' : trendPercent < 0 ? 'down' : 'stable'
            });
        } catch (err) {
            console.error('Expense trends error:', err);
            res.status(500).json({ error: 'Failed to get trends.' });
        }
    });

    // DELETE /api/expenses/:id - Delete an expense
    router.delete('/:id', authenticateToken, async (req, res) => {
        try {
            const result = await db.query('DELETE FROM expenses WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);

            if (result.rowCount === 0) {
                return res.status(404).json({ error: 'Expense not found.' });
            }
            res.json({ message: 'Expense deleted.' });
        } catch (err) {
            console.error('Delete expense error:', err);
            res.status(500).json({ error: 'Failed to delete expense.' });
        }
    });

    return router;
};

// ---- HELPER: Check if today's spending is abnormally high ----
async function checkSpendingAlert(db, userId, date) {
    // Get 7-day average
    const avgResult = await db.query(`
        SELECT COALESCE(AVG(daily_total), 0) as avg_daily
        FROM (
            SELECT SUM(amount) as daily_total
            FROM expenses
            WHERE user_id = $1 AND date::date >= ($2::date - INTERVAL '7 days') AND date::date < $2::date
            GROUP BY date
        ) sub
    `, [userId, date]);

    // Get today's total
    const todayResult = await db.query(`
        SELECT COALESCE(SUM(amount), 0) as today_total
        FROM expenses
        WHERE user_id = $1 AND date = $2
    `, [userId, date]);

    const avgDaily = parseFloat(avgResult.rows[0]?.avg_daily) || 0;
    const todayTotal = parseFloat(todayResult.rows[0]?.today_total) || 0;

    // Alert if spending 50% more than average
    if (avgDaily > 0 && todayTotal > avgDaily * 1.5) {
        return {
            type: 'overspending',
            message: `You've spent ₹${todayTotal.toFixed(2)} today, which is ${Math.round((todayTotal / avgDaily - 1) * 100)}% above your daily average of ₹${avgDaily.toFixed(2)}.`
        };
    }

    return null;
}
