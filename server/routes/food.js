// ============================================================
// FEATURE 2: RECOMMENDED FOOD - PostgreSQL Edition
// Track food spending, suggest budget meals, analyze diet
// ============================================================
const express = require('express');
const router = express.Router();

module.exports = function (db, authenticateToken) {

    // POST /api/food/log - Log a meal
    router.post('/log', authenticateToken, async (req, res) => {
        try {
            const { food_name, cost, calories, meal_type, is_homemade, date } = req.body;

            if (!food_name) {
                return res.status(400).json({ error: 'Food name is required.' });
            }

            const mealDate = date || new Date().toISOString().split('T')[0];
            const validMealTypes = ['breakfast', 'lunch', 'dinner', 'snack', 'other'];
            const type = validMealTypes.includes(meal_type) ? meal_type : 'other';

            const result = await db.query(`
                INSERT INTO food_logs (user_id, date, meal_type, food_name, cost, calories, is_homemade)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id
            `, [req.user.id, mealDate, type, food_name, cost || 0, calories || 0, is_homemade ? 1 : 0]);

            res.status(201).json({
                message: 'Meal logged!',
                food: { id: result.rows[0].id, food_name, cost, calories, meal_type: type, date: mealDate }
            });
        } catch (err) {
            console.error('Log food error:', err);
            res.status(500).json({ error: 'Failed to log meal.' });
        }
    });

    // GET /api/food/recommendations - Get personalized meal suggestions
    router.get('/recommendations', authenticateToken, async (req, res) => {
        try {
            // Step 1: Calculate user's average daily food spend (last 7 days)
            const spendDataRes = await db.query(`
                SELECT COALESCE(SUM(cost), 0) as total, COUNT(DISTINCT date) as days
                FROM food_logs
                WHERE user_id = $1 AND date::date >= (CURRENT_DATE - INTERVAL '7 days')
            `, [req.user.id]);

            const spendData = spendDataRes.rows[0];
            const daysWithData = parseInt(spendData.days, 10) || 1;
            const dailyFoodSpend = (parseFloat(spendData.total) || 0) / daysWithData;

            // Step 2: Get user dietary preferences
            const userRes = await db.query('SELECT dietary_preferences FROM users WHERE id = $1', [req.user.id]);
            const user = userRes.rows[0];

            let preferences = [];
            try {
                preferences = JSON.parse(user?.dietary_preferences || '[]');
            } catch (e) {
                preferences = [];
            }

            // Step 3: Build meal query based on budget and preferences
            let mealQuery = 'SELECT * FROM budget_meals WHERE 1=1';
            const params = [];
            let paramIdx = 1;

            let maxCost = 250;
            if (dailyFoodSpend <= 300) {
                maxCost = 300;
            } else if (dailyFoodSpend <= 500) {
                maxCost = 350;
            } else {
                maxCost = 200; // Show cheaper options for overspenders
            }

            mealQuery += ` AND cost <= $${paramIdx++}`;
            params.push(maxCost);

            // Apply dietary filters
            if (preferences.includes('vegetarian')) {
                mealQuery += ' AND is_vegetarian = 1';
            }
            if (preferences.includes('vegan')) {
                mealQuery += ' AND is_vegan = 1';
            }

            mealQuery += ' ORDER BY RANDOM() LIMIT 10';

            const mealsRes = await db.query(mealQuery, params);
            const meals = mealsRes.rows.map(m => ({
                ...m,
                cost: parseFloat(m.cost)
            }));

            // Step 4: Build response with context
            let advice = '';
            if (dailyFoodSpend > 500) {
                advice = `You're spending ₹${dailyFoodSpend.toFixed(2)}/day on food. The recommended budget for students is ₹300-500/day. Here are some tasty meals that'll save you money:`;
            } else if (dailyFoodSpend < 300) {
                advice = `Great job! You're spending ₹${dailyFoodSpend.toFixed(2)}/day on food, which is within budget. Make sure you're still eating healthy! Here are some nutritious options:`;
            } else {
                advice = `You're spending ₹${dailyFoodSpend.toFixed(2)}/day on food, which is reasonable. Here are some options to keep it balanced:`;
            }

            res.json({
                daily_food_spend: Math.round(dailyFoodSpend * 100) / 100,
                recommended_budget: { min: 300, max: 500 },
                advice,
                meals,
                savings_potential: dailyFoodSpend > 400 ? Math.round((dailyFoodSpend - 350) * 30 * 100) / 100 : 0
            });
        } catch (err) {
            console.error('Food recommendations error:', err);
            res.status(500).json({ error: 'Failed to get recommendations.' });
        }
    });

    // GET /api/food/budget-analysis - Compare actual spend vs budget
    router.get('/budget-analysis', authenticateToken, async (req, res) => {
        try {
            // Daily breakdown for last 7 days
            const dailySpendRes = await db.query(`
                SELECT date, SUM(cost) as total, COUNT(*) as meals
                FROM food_logs
                WHERE user_id = $1 AND date::date >= (CURRENT_DATE - INTERVAL '7 days')
                GROUP BY date
                ORDER BY date ASC
            `, [req.user.id]);

            const dailySpend = dailySpendRes.rows.map(r => ({
                date: r.date,
                total: parseFloat(r.total),
                meals: parseInt(r.meals, 10)
            }));

            // By meal type
            const byMealTypeRes = await db.query(`
                SELECT meal_type, AVG(cost) as avg_cost, COUNT(*) as count
                FROM food_logs
                WHERE user_id = $1 AND date::date >= (CURRENT_DATE - INTERVAL '7 days')
                GROUP BY meal_type
            `, [req.user.id]);

            const byMealType = byMealTypeRes.rows.map(r => ({
                meal_type: r.meal_type,
                avg_cost: parseFloat(r.avg_cost),
                count: parseInt(r.count, 10)
            }));

            // Homemade vs bought
            const homemadeStatsRes = await db.query(`
                SELECT
                    SUM(CASE WHEN is_homemade = 1 THEN 1 ELSE 0 END) as homemade_count,
                    SUM(CASE WHEN is_homemade = 0 THEN 1 ELSE 0 END) as bought_count,
                    AVG(CASE WHEN is_homemade = 1 THEN cost ELSE NULL END) as avg_homemade_cost,
                    AVG(CASE WHEN is_homemade = 0 THEN cost ELSE NULL END) as avg_bought_cost
                FROM food_logs
                WHERE user_id = $1 AND date::date >= (CURRENT_DATE - INTERVAL '7 days')
            `, [req.user.id]);

            const h = homemadeStatsRes.rows[0];
            const homemadeStats = {
                homemade_count: parseInt(h.homemade_count || 0, 10),
                bought_count: parseInt(h.bought_count || 0, 10),
                avg_homemade_cost: h.avg_homemade_cost ? parseFloat(h.avg_homemade_cost) : null,
                avg_bought_cost: h.avg_bought_cost ? parseFloat(h.avg_bought_cost) : null
            };

            const totalSpent = dailySpend.reduce((sum, d) => sum + d.total, 0);
            const avgDaily = dailySpend.length > 0 ? totalSpent / dailySpend.length : 0;

            res.json({
                total_7_days: Math.round(totalSpent * 100) / 100,
                daily_average: Math.round(avgDaily * 100) / 100,
                recommended_daily: 400, // ₹300-500 range, middle = ₹400
                daily_breakdown: dailySpend,
                by_meal_type: byMealType,
                homemade_vs_bought: homemadeStats,
                tip: avgDaily > 500
                    ? 'Try cooking at home more! Homemade meals cost 50-70% less on average.'
                    : avgDaily < 200
                        ? 'You\'re under budget - make sure you\'re eating enough!'
                        : 'You\'re in a good range. Keep it up!'
            });
        } catch (err) {
            console.error('Food budget analysis error:', err);
            res.status(500).json({ error: 'Failed to analyze food budget.' });
        }
    });

    // GET /api/food/log - Get food log history
    router.get('/log', authenticateToken, async (req, res) => {
        try {
            const { days } = req.query;
            const lookback = parseInt(days, 10) || 7;

            const logsRes = await db.query(`
                SELECT * FROM food_logs
                WHERE user_id = $1 AND date::date >= (CURRENT_DATE - ($2 || ' days')::interval)
                ORDER BY date DESC, created_at DESC
            `, [req.user.id, lookback]);

            res.json(logsRes.rows.map(r => ({
                ...r,
                cost: parseFloat(r.cost)
            })));
        } catch (err) {
            console.error('Food log error:', err);
            res.status(500).json({ error: 'Failed to get food log.' });
        }
    });

    return router;
};
