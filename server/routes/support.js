// ============================================================
// FEATURE 6: PERSONALIZED SUPPORT - PostgreSQL Edition
// AI chat, cross-feature insights, personalized advice
// ============================================================
const express = require('express');
const router = express.Router();

module.exports = function (db, authenticateToken) {

    // POST /api/chat - Send message to AI support
    router.post('/chat', authenticateToken, async (req, res) => {
        try {
            const { message } = req.body;

            if (!message || message.trim().length === 0) {
                return res.status(400).json({ error: 'Message is required.' });
            }

            // Gather all user context for personalized response
            const context = await gatherUserContext(db, req.user.id);

            // Enrich with Python Wellness & Burnout dashboard context
            let pythonDashboard = null;
            try {
                const dashboardRes = await fetch(`http://localhost:8000/api/v1/dashboard/${req.user.id}`);
                if (dashboardRes.ok) {
                    pythonDashboard = await dashboardRes.json();
                }
            } catch (err) {
                console.warn('Failed to load Python dashboard context for chat:', err.message);
            }

            if (pythonDashboard) {
                context.wellness = {
                    wellness_score: pythonDashboard.wellness_score,
                    category: pythonDashboard.wellness_category
                };
                context.burnout = {
                    burnout_score: pythonDashboard.burnout_score,
                    risk_level: pythonDashboard.burnout_risk
                };
                context.financial_health = {
                    financial_health: pythonDashboard.financial_health,
                    budget_adherence: pythonDashboard.financial_health_details?.budget_adherence,
                    savings_score: pythonDashboard.financial_health_details?.savings_score,
                    forecast_score: pythonDashboard.financial_health_details?.forecast_score
                };
                context.expenses.current_total = pythonDashboard.current_month_summary?.total_spent_so_far;
                context.expenses.remaining = pythonDashboard.remaining_budget?.total_remaining;
                context.alerts = pythonDashboard.alerts;
                context.forecast = pythonDashboard.forecast;
            }

            // Generate AI response by proxying to the Python backend (Groq chatbot)
            let aiResponse = null;
            let suggestions = null;

            try {
                const chatRes = await fetch('http://localhost:8000/api/support/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: String(req.user.id), message, support_type: 'ai' })
                });

                if (chatRes.ok) {
                    const chatData = await chatRes.json();
                    aiResponse = chatData.message;
                    suggestions = chatData.suggested_actions;
                } else {
                    console.warn('Python chatbot API returned non-OK status:', chatRes.status);
                }
            } catch (err) {
                console.error('Failed to proxy chat to Python backend:', err.message);
            }

            if (!aiResponse) {
                // Fall back to rule-based response
                aiResponse = generateResponse(message, context);
            }
            if (!suggestions) {
                suggestions = getSuggestions(context);
            }

            // Save to chat history
            const date = new Date().toISOString().split('T')[0];
            await db.query(`
                INSERT INTO chat_history (user_id, date, user_message, ai_response, context)
                VALUES ($1, $2, $3, $4, $5)
            `, [req.user.id, date, message, aiResponse, JSON.stringify(context.summary)]);

            res.json({
                response: aiResponse,
                suggestions: suggestions
            });
        } catch (err) {
            console.error('Chat error:', err);
            res.status(500).json({ error: 'Failed to process message.' });
        }
    });

    // POST /api/support/peer/connect - Connect with a peer/mentor
    router.post('/peer/connect', authenticateToken, async (req, res) => {
        try {
            const pythonUrl = `http://localhost:8000/api/support/peer/connect`;
            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    user_id: String(req.user.id),
                    issue_category: req.body.issue_category || 'burnout',
                    description: req.body.description || 'Burnout risk is high. Automated connection request.'
                })
            };
            const response = await fetch(pythonUrl, options);
            const data = await response.json();
            res.status(response.status).json(data);
        } catch (err) {
            console.error('Peer connect proxy failed:', err.message);
            res.status(502).json({ error: 'Failed to connect with peer support.' });
        }
    });

    // GET /api/support/peer/leaderboard - Reputation leaderboard
    router.get('/peer/leaderboard', authenticateToken, async (req, res) => {
        try {
            const pythonUrl = `http://localhost:8000/api/support/peer/leaderboard`;
            const response = await fetch(pythonUrl);
            const data = await response.json();
            res.status(response.status).json(data);
        } catch (err) {
            console.error('Peer leaderboard proxy failed:', err.message);
            res.status(502).json({ error: 'Failed to fetch leaderboard.' });
        }
    });

    // GET /api/support/suggestions - Get personalized tips based on all data
    router.get('/suggestions', authenticateToken, async (req, res) => {
        try {
            const context = await gatherUserContext(db, req.user.id);
            const suggestions = generatePersonalizedSuggestions(context);

            // Store as recommendations
            const date = new Date().toISOString().split('T')[0];
            for (const s of suggestions) {
                await db.query(`
                    INSERT INTO recommendations (user_id, date, type, text)
                    VALUES ($1, $2, $3, $4)
                `, [req.user.id, date, s.type, s.text]);
            }

            res.json({
                suggestions,
                context_summary: context.summary
            });
        } catch (err) {
            console.error('Suggestions error:', err);
            res.status(500).json({ error: 'Failed to get suggestions.' });
        }
    });

    // GET /api/support/emergency - Crisis resources
    router.get('/emergency', authenticateToken, (req, res) => {
        res.json({
            message: 'If you\'re in crisis, please reach out for help immediately.',
            resources: [
                { name: '988 Suicide & Crisis Lifeline', phone: '988', description: 'Call or text 24/7' },
                { name: 'Crisis Text Line', phone: 'Text HOME to 741741', description: 'Free 24/7 text support' },
                { name: 'Campus Counseling Center', phone: 'Check your university website', description: 'Free for enrolled students' },
                { name: 'NAMI Helpline', phone: '1-800-950-6264', description: 'Mental health information and referrals' }
            ],
            reminder: 'You are not alone. Asking for help is a sign of strength, not weakness.'
        });
    });

    // POST /api/support/feedback - Rate helpfulness of advice
    router.post('/feedback', authenticateToken, async (req, res) => {
        try {
            const { recommendation_id, was_helpful, feedback } = req.body;

            if (recommendation_id === undefined || was_helpful === undefined) {
                return res.status(400).json({ error: 'recommendation_id and was_helpful are required.' });
            }

            await db.query(`
                UPDATE recommendations
                SET was_helpful = $1, feedback = $2
                WHERE id = $3 AND user_id = $4
            `, [was_helpful ? 1 : 0, feedback || '', recommendation_id, req.user.id]);

            res.json({ message: 'Thanks for the feedback! This helps us give better advice.' });
        } catch (err) {
            console.error('Feedback error:', err);
            res.status(500).json({ error: 'Failed to save feedback.' });
        }
    });

    // GET /api/chat/history - Get chat history
    router.get('/chat/history', authenticateToken, async (req, res) => {
        try {
            const { limit } = req.query;
            const messagesRes = await db.query(`
                SELECT id, date, user_message, ai_response, created_at
                FROM chat_history
                WHERE user_id = $1
                ORDER BY created_at DESC
                LIMIT $2
            `, [req.user.id, parseInt(limit, 10) || 20]);

            res.json(messagesRes.rows.reverse()); // Return in chronological order
        } catch (err) {
            console.error('Chat history error:', err);
            res.status(500).json({ error: 'Failed to get chat history.' });
        }
    });

    const { generateRecommendation, generatePurchaseAdvice } = require('../gemini');

    // GET /api/support/recommendation - Generate AI wellness & finance recommendation
    router.get('/recommendation', authenticateToken, async (req, res) => {
        try {
            const context = await gatherUserContext(db, req.user.id);

            // Extract parameters for prompt
            const latestHealth = context.health || { sleep_hours: 8, stress_level: 1, mood: 'neutral' };
            const totalSpent = (context.expenses || []).reduce((sum, e) => sum + (parseFloat(e.total) || 0), 0);
            const foodExpenseObj = (context.expenses || []).find(e => e.category === 'food');
            const foodExpense = foodExpenseObj ? parseFloat(foodExpenseObj.total) || 0 : 0;
            const foodPercent = totalSpent > 0 ? (foodExpense / totalSpent) * 100 : 0;

            const aiData = {
                sleep_hours: latestHealth.sleep_hours,
                stress_level: latestHealth.stress_level,
                mood: latestHealth.mood,
                monthly_pocket_money: context.user?.monthly_income || 0,
                total_spent: totalSpent,
                food_percent: foodPercent
            };

            const rec = await generateRecommendation(aiData);

            // Save to DB
            const date = new Date().toISOString().split('T')[0];
            await db.query(`
                INSERT INTO recommendations (user_id, date, type, text)
                VALUES ($1, $2, $3, $4)
            `, [req.user.id, date, rec.type, rec.message]);

            res.json({
                type: rec.type,
                message: rec.message,
                created_at: new Date().toISOString()
            });
        } catch (err) {
            console.error('Gemini recommendation error:', err);
            res.status(500).json({ error: 'Failed to generate recommendation.' });
        }
    });

    // POST /api/support/purchase-advice - Buy advisor
    router.post('/purchase-advice', authenticateToken, async (req, res) => {
        try {
            const { name, cost } = req.body;
            if (!name || cost === undefined) {
                return res.status(400).json({ error: 'Item name and cost are required.' });
            }

            const context = await gatherUserContext(db, req.user.id);

            // Financial analytics
            const monthlyPocketMoney = parseFloat(context.user?.monthly_income) || 0;
            const totalExpensesRes = await db.query(`
                SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE user_id = $1
            `, [req.user.id]);
            const totalExpenses = parseFloat(totalExpensesRes.rows[0].total) || 0;

            const remainingBalance = monthlyPocketMoney - totalExpenses;

            // Calculate safe daily spending
            const today = new Date();
            const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
            const remainingDays = Math.max(1, lastDay - today.getDate());
            const safeDailySpending = remainingBalance > 0 ? (remainingBalance / remainingDays) : 0;

            const aiContext = {
                remaining_balance: remainingBalance,
                safe_daily_spending: safeDailySpending,
                total_spent: totalExpenses
            };

            const advice = await generatePurchaseAdvice(aiContext, name, parseFloat(cost));

            res.json({
                affordable: advice.affordable,
                message: advice.message,
                remaining_balance: remainingBalance,
                safe_daily_spending: safeDailySpending
            });
        } catch (err) {
            console.error('Purchase advisor error:', err);
            res.status(500).json({ error: 'Failed to process purchase advice.' });
        }
    });

    return router;
};

// ============================================================
// HELPER: Gather all context about a user (PostgreSQL Edition)
// ============================================================
async function gatherUserContext(db, userId) {
    // User profile
    const userRes = await db.query('SELECT name, major, year, monthly_income, daily_budget FROM users WHERE id = $1', [userId]);
    const user = userRes.rows[0] || null;

    // Recent burnout score
    const burnoutRes = await db.query('SELECT score, alert_level FROM burnout_scores WHERE user_id = $1 ORDER BY date DESC LIMIT 1', [userId]);
    const burnout = burnoutRes.rows[0] || null;

    // Recent health
    const healthRes = await db.query('SELECT * FROM health_logs WHERE user_id = $1 ORDER BY date DESC LIMIT 7', [userId]);
    const health = healthRes.rows.map(h => ({
        ...h,
        sleep_hours: parseFloat(h.sleep_hours),
        stress_level: parseInt(h.stress_level, 10),
        study_hours: parseFloat(h.study_hours),
        exercise_minutes: parseInt(h.exercise_minutes, 10)
    }));

    // Expense patterns (last 7 days)
    const expensesRes = await db.query(`
        SELECT category, SUM(amount) as total
        FROM expenses WHERE user_id = $1 AND date::date >= (CURRENT_DATE - INTERVAL '7 days')
        GROUP BY category
    `, [userId]);
    const expenses = expensesRes.rows.map(r => ({ category: r.category, total: parseFloat(r.total) }));

    // Food spending
    const foodSpendRes = await db.query(`
        SELECT COALESCE(AVG(daily_total), 0) as avg_daily
        FROM (
            SELECT SUM(cost) as daily_total FROM food_logs
            WHERE user_id = $1 AND date::date >= (CURRENT_DATE - INTERVAL '7 days')
            GROUP BY date
        ) sub
    `, [userId]);
    const foodSpend = parseFloat(foodSpendRes.rows[0]?.avg_daily) || 0;

    // Past recommendations that worked
    const whatWorkedRes = await db.query(`
        SELECT type, text FROM recommendations
        WHERE user_id = $1 AND was_helpful = 1
        ORDER BY date DESC LIMIT 5
    `, [userId]);
    const whatWorked = whatWorkedRes.rows;

    // Exercise stats
    const exerciseStats = health.length > 0
        ? { avg: health.reduce((s, h) => s + h.exercise_minutes, 0) / health.length, days_zero: health.filter(h => h.exercise_minutes === 0).length }
        : { avg: 0, days_zero: 7 };

    // Sleep stats
    const sleepStats = health.length > 0
        ? { avg: health.reduce((s, h) => s + h.sleep_hours, 0) / health.length }
        : { avg: 0 };

    // Stress stats
    const stressStats = health.length > 0
        ? { avg: health.reduce((s, h) => s + h.stress_level, 0) / health.length }
        : { avg: 5 };

    return {
        user,
        burnout: burnout || { score: 0, alert_level: 'unknown' },
        health: health[0] || null,
        expenses,
        foodSpend,
        whatWorked,
        exercise: exerciseStats,
        sleep: sleepStats,
        stress: stressStats,
        summary: {
            burnout_score: burnout ? burnout.score : null,
            avg_sleep: sleepStats.avg,
            avg_stress: stressStats.avg,
            avg_exercise: exerciseStats.avg,
            daily_food_spend: foodSpend
        }
    };
}

// ============================================================
// RULE-BASED AI RESPONSE GENERATOR
// ============================================================
function generateResponse(message, context) {
    const msg = message.toLowerCase();
    const { burnout, sleep, stress, exercise, foodSpend, whatWorked, user } = context;

    // Stress / burnout related
    if (msg.includes('stress') || msg.includes('burnout') || msg.includes('overwhelm') || msg.includes('anxious')) {
        if (burnout.score >= 7) {
            return `I can see you're really struggling right now - your burnout score is ${burnout.score}/10. ` +
                `This is serious, and I want you to know it's okay to take a step back. ` +
                `Your sleep has been around ${sleep.avg.toFixed(1)} hours, which isn't enough for recovery. ` +
                `Here's what I'd suggest: 1) Take a 10-minute walk right now, 2) Set a hard stop time for studying tonight, ` +
                `3) Talk to someone you trust. You don't have to handle this alone.`;
        }
        if (burnout.score >= 4) {
            return `Your stress levels are elevated (avg ${stress.avg.toFixed(1)}/10). ` +
                `I notice you've been sleeping ${sleep.avg.toFixed(1)} hours - try adding 30 minutes tonight. ` +
                `A quick win: take a 5-minute break every 45 minutes of studying. Your brain needs recovery time to learn effectively.`;
        }
        return `Your current stress level is manageable (${stress.avg.toFixed(1)}/10). ` +
            `Keep your current habits going! If you feel it rising, remember: short breaks, movement, and sleep are your best tools.`;
    }

    // Sleep related
    if (msg.includes('sleep') || msg.includes('tired') || msg.includes('insomnia') || msg.includes('exhausted')) {
        const sleepAdvice = sleep.avg < 6
            ? `You're only averaging ${sleep.avg.toFixed(1)} hours of sleep - that's concerning. Your brain needs 7-8 hours to function well. `
            : `You're getting ${sleep.avg.toFixed(1)} hours - not bad! `;

        return sleepAdvice +
            `Tips that work for students: 1) Set a phone alarm at 10 PM to start winding down, ` +
            `2) No caffeine after 2 PM, 3) Keep your room cool and dark. ` +
            `Even 30 extra minutes of sleep improves memory and focus significantly.`;
    }

    // Money / budget related
    if (msg.includes('money') || msg.includes('budget') || msg.includes('spend') || msg.includes('expensive') || msg.includes('broke')) {
        const totalExpenses = (context.expenses || []).reduce((s, e) => s + (e.total || 0), 0);
        const dailySpend = totalExpenses / 7;

        let response = `Looking at your spending: you've spent ₹${totalExpenses.toFixed(2)} in the last 7 days (₹${dailySpend.toFixed(2)}/day). `;

        if (user?.daily_budget > 0 && dailySpend > user.daily_budget) {
            response += `That's above your ₹${user.daily_budget}/day budget. `;
        }

        if (foodSpend > 500) {
            response += `Your food spending (₹${foodSpend.toFixed(2)}/day) is the biggest opportunity to save. Try cooking at home - rice, beans, and eggs make a great ₹150 meal. `;
        }

        response += `Want me to suggest specific budget meals or help you find where to cut back?`;
        return response;
    }

    // Food related
    if (msg.includes('food') || msg.includes('eat') || msg.includes('hungry') || msg.includes('meal') || msg.includes('cook')) {
        if (foodSpend > 500) {
            return `You're spending about ₹${foodSpend.toFixed(2)}/day on food. The student sweet spot is ₹300-500/day. ` +
                `Here are some quick wins: breakfast (oatmeal + banana = ₹75), lunch (rice + beans = ₹125), ` +
                `dinner (pasta + sauce = ₹100). That's a full day for ₹300! Check the Food Recommendations section for more ideas.`;
        }
        return `You're doing well with food spending (₹${foodSpend.toFixed(2)}/day)! ` +
            `Make sure you're getting enough nutrition though. A balanced meal doesn't have to be expensive - ` +
            `rice, vegetables, and protein (eggs, beans, tofu) cover your basics.`;
    }

    // Exercise related
    if (msg.includes('exercise') || msg.includes('workout') || msg.includes('gym') || msg.includes('walk') || msg.includes('active')) {
        if (exercise.avg < 10) {
            const pastExerciseHelped = (whatWorked || []).some(w => w.type === 'exercise' || w.text.includes('walk') || w.text.includes('exercise'));
            let response = `I see you're not exercising much (avg ${exercise.avg.toFixed(0)} min/day). `;

            if (pastExerciseHelped) {
                response += `Remember, you told me before that exercise helped you feel better! `;
            }
            response += `Start super small: a 5-minute walk between classes. That's it. No gym needed. ` +
                `Even this tiny amount has been shown to reduce stress and improve focus.`;
            return response;
        }
        return `Nice! You're averaging ${exercise.avg.toFixed(0)} minutes of activity per day. ` +
            `Keep it up! Variety helps - try alternating between walking, stretching, and whatever you enjoy.`;
    }

    // Motivation / feeling down
    if (msg.includes('motivat') || msg.includes('give up') || msg.includes('can\'t') || msg.includes('hopeless') || msg.includes('fail')) {
        return `I hear you, and what you're feeling is valid. Being a student is genuinely hard. ` +
            `Here's what I know about YOU: you've been showing up and tracking your health - that takes commitment. ` +
            `Focus on just ONE small thing today. Not everything, just one thing. ` +
            `And remember: struggling doesn't mean failing. It means you're pushing through something difficult.`;
    }

    // Study related
    if (msg.includes('study') || msg.includes('exam') || msg.includes('assignment') || msg.includes('homework') || msg.includes('deadline')) {
        const latestHealth = context.health;
        let response = '';

        if (latestHealth && latestHealth.study_hours > 6) {
            response = `You've been studying ${latestHealth.study_hours} hours today - that's a lot! `;
        }

        response += `For effective studying: 1) Pomodoro technique (25 min on, 5 min off), ` +
            `2) Take a real break every 2 hours (walk, stretch, snack), ` +
            `3) Sleep > all-nighters (your brain consolidates memory during sleep). `;

        if (stress.avg >= 7) {
            response += `Your stress is high - make sure you're not just studying MORE but studying SMARTER.`;
        }

        return response;
    }

    // General greeting or unclear intent
    if (msg.includes('hello') || msg.includes('hi') || msg.includes('hey') || msg.length < 10) {
        return `Hey ${user?.name || 'there'}! How's your day going? ` +
            `I can help with budgeting, food ideas, stress management, study tips, or just chat. What's on your mind?`;
    }

    // Default: provide general personalized insight
    let defaultResponse = `Thanks for sharing, ${user?.name || 'friend'}. Based on what I know about you: `;

    if (burnout.score >= 4) {
        defaultResponse += `your stress levels are elevated, so prioritize rest. `;
    }
    if (sleep.avg < 7) {
        defaultResponse += `you could use more sleep (currently ${sleep.avg.toFixed(1)}hrs avg). `;
    }
    if (exercise.days_zero >= 5) {
        defaultResponse += `try to add a little movement to your day. `;
    }

    defaultResponse += `Is there something specific I can help you with? I can give advice on money, food, sleep, stress, exercise, or studying.`;

    return defaultResponse;
}

function getSuggestions(context) {
    const suggestions = [];

    if (context.burnout.score >= 4) {
        suggestions.push('How can I reduce my stress?');
    }
    if (context.sleep.avg < 7) {
        suggestions.push('Help me sleep better');
    }
    if (context.foodSpend > 400) {
        suggestions.push('Show me budget meal ideas');
    }
    if (context.exercise.days_zero >= 3) {
        suggestions.push('How do I start exercising?');
    }

    suggestions.push('What should I focus on today?');

    return suggestions.slice(0, 4);
}

function generatePersonalizedSuggestions(context) {
    const suggestions = [];
    const { burnout, sleep, stress, exercise, foodSpend, whatWorked } = context;

    if (burnout.score >= 7 && exercise.days_zero >= 3) {
        suggestions.push({
            type: 'exercise',
            text: 'Try movement, even 5 minutes helps. What time works for a short walk?',
            priority: 'high'
        });
    }

    if (foodSpend > 500 && stress.avg >= 6) {
        suggestions.push({
            type: 'food',
            text: `Stress eating? Your food spend is ₹${foodSpend.toFixed(2)}/day when stressed. Try these ₹150 meal alternatives you might like.`,
            priority: 'medium'
        });
    }

    if (sleep.avg < 6 && context.health && context.health.study_hours > 6) {
        suggestions.push({
            type: 'sleep',
            text: 'You\'re overworking and underslept. Rest actually improves learning. Set a 10 PM stop time tonight.',
            priority: 'high'
        });
    }

    if (whatWorked && whatWorked.length > 0) {
        const past = whatWorked[0];
        suggestions.push({
            type: 'reminder',
            text: `Remember when this helped you before: "${past.text}" - try it again!`,
            priority: 'medium'
        });
    }

    if (exercise.avg < 10 && burnout.score < 7) {
        suggestions.push({
            type: 'exercise',
            text: 'Start small: 10-minute walk today? It boosts mood and focus for hours.',
            priority: 'low'
        });
    }

    if (burnout.score <= 3 && sleep.avg >= 7) {
        suggestions.push({
            type: 'motivation',
            text: 'You\'re doing great! Your sleep and stress are well-managed. Keep this routine going.',
            priority: 'low'
        });
    }

    return suggestions;
}
