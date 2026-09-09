// ============================================================
// FEATURE 5: HEALTHY ROUTINE - PostgreSQL Edition
// Gradual habit building, progress tracking, adaptive goals
// ============================================================
const express = require('express');
const router = express.Router();

module.exports = function (db, authenticateToken) {

    // POST /api/routine/goal - Set a new wellness goal
    router.post('/goal', authenticateToken, async (req, res) => {
        try {
            const { goal_type, target_value } = req.body;

            const validGoalTypes = ['sleep', 'exercise', 'stress', 'study', 'hydration'];
            if (!validGoalTypes.includes(goal_type)) {
                return res.status(400).json({
                    error: `Invalid goal type. Use: ${validGoalTypes.join(', ')}`
                });
            }

            if (!target_value || target_value <= 0) {
                return res.status(400).json({ error: 'Target value must be positive.' });
            }

            // Get user's current baseline from health logs
            const baselineRes = await db.query(`
                SELECT
                    AVG(sleep_hours) as avg_sleep,
                    AVG(exercise_minutes) as avg_exercise,
                    AVG(stress_level) as avg_stress,
                    AVG(study_hours) as avg_study
                FROM health_logs
                WHERE user_id = $1 AND date::date >= (CURRENT_DATE - INTERVAL '7 days')
            `, [req.user.id]);

            const baseline = baselineRes.rows[0];

            // Determine current value based on goal type
            let currentValue = 0;
            switch (goal_type) {
                case 'sleep': currentValue = parseFloat(baseline?.avg_sleep) || 6; break;
                case 'exercise': currentValue = parseFloat(baseline?.avg_exercise) || 0; break;
                case 'stress': currentValue = parseFloat(baseline?.avg_stress) || 5; break;
                case 'study': currentValue = parseFloat(baseline?.avg_study) || 0; break;
                default: currentValue = 0;
            }

            // Calculate weekly target (gradual increase over 4 weeks)
            // Move 25% closer to goal each week
            const gap = target_value - currentValue;
            const weeklyTarget = currentValue + (gap * 0.25); // Week 1 target

            // Deactivate any existing goals of same type
            await db.query(`
                UPDATE routine_goals SET status = 'completed'
                WHERE user_id = $1 AND goal_type = $2 AND status = 'active'
            `, [req.user.id, goal_type]);

            // Create new goal
            const result = await db.query(`
                INSERT INTO routine_goals (user_id, goal_type, current_value, target_value, weekly_target, week_number, status)
                VALUES ($1, $2, $3, $4, $5, 1, 'active')
                RETURNING id
            `, [req.user.id, goal_type, currentValue, target_value, weeklyTarget]);

            res.status(201).json({
                message: 'Goal set! We\'ll build up gradually over 4 weeks.',
                goal: {
                    id: result.rows[0].id,
                    goal_type,
                    current_value: Math.round(currentValue * 10) / 10,
                    target_value,
                    week_1_target: Math.round(weeklyTarget * 10) / 10,
                    plan: buildGradualPlan(goal_type, currentValue, target_value)
                }
            });
        } catch (err) {
            console.error('Set goal error:', err);
            res.status(500).json({ error: 'Failed to set goal.' });
        }
    });

    // GET /api/routine/plan - Get current weekly routine plan
    router.get('/plan', authenticateToken, async (req, res) => {
        try {
            // Get all active goals
            const goalsRes = await db.query(`
                SELECT * FROM routine_goals
                WHERE user_id = $1 AND status = 'active'
            `, [req.user.id]);
            const goals = goalsRes.rows.map(g => ({
                ...g,
                current_value: parseFloat(g.current_value),
                target_value: parseFloat(g.target_value),
                weekly_target: parseFloat(g.weekly_target)
            }));

            if (goals.length === 0) {
                return res.json({
                    has_plan: false,
                    message: 'No active goals. Set a goal to get started!',
                    suggested_goals: [
                        { type: 'sleep', suggestion: 'Try to get 7-8 hours of sleep' },
                        { type: 'exercise', suggestion: 'Start with 10-15 minutes of walking' },
                        { type: 'stress', suggestion: 'Reduce stress with breaks and mindfulness' }
                    ]
                });
            }

            // Get recent health data to check progress
            const recentHealthRes = await db.query(`
                SELECT * FROM health_logs
                WHERE user_id = $1 AND date::date >= (CURRENT_DATE - INTERVAL '7 days')
                ORDER BY date DESC
            `, [req.user.id]);

            const recentHealth = recentHealthRes.rows.map(h => ({
                ...h,
                sleep_hours: parseFloat(h.sleep_hours),
                exercise_minutes: parseInt(h.exercise_minutes, 10),
                stress_level: parseInt(h.stress_level, 10),
                study_hours: parseFloat(h.study_hours)
            }));

            // Build weekly plan for each goal
            const plan = goals.map(goal => {
                // Check progress toward this week's target
                let currentAvg = 0;
                if (recentHealth.length > 0) {
                    switch (goal.goal_type) {
                        case 'sleep':
                            currentAvg = recentHealth.reduce((s, h) => s + h.sleep_hours, 0) / recentHealth.length;
                            break;
                        case 'exercise':
                            currentAvg = recentHealth.reduce((s, h) => s + h.exercise_minutes, 0) / recentHealth.length;
                            break;
                        case 'stress':
                            currentAvg = recentHealth.reduce((s, h) => s + h.stress_level, 0) / recentHealth.length;
                            break;
                        case 'study':
                            currentAvg = recentHealth.reduce((s, h) => s + h.study_hours, 0) / recentHealth.length;
                            break;
                    }
                }

                const progressPercent = goal.weekly_target > 0
                    ? Math.min(100, Math.round((currentAvg / goal.weekly_target) * 100))
                    : 0;

                return {
                    goal_type: goal.goal_type,
                    week_number: goal.week_number,
                    weekly_target: Math.round(goal.weekly_target * 10) / 10,
                    current_average: Math.round(currentAvg * 10) / 10,
                    final_target: goal.target_value,
                    progress_percent: progressPercent,
                    on_track: progressPercent >= 70,
                    daily_tips: getDailyTips(goal.goal_type, goal.weekly_target, currentAvg)
                };
            });

            res.json({
                has_plan: true,
                goals: plan,
                overall_message: getOverallMessage(plan)
            });
        } catch (err) {
            console.error('Get plan error:', err);
            res.status(500).json({ error: 'Failed to get routine plan.' });
        }
    });

    // POST /api/routine/checkin - Log routine completion (separate from health check-in)
    router.post('/checkin', authenticateToken, async (req, res) => {
        try {
            const { goal_type, value } = req.body;

            if (!goal_type || value === undefined) {
                return res.status(400).json({ error: 'Goal type and value are required.' });
            }

            // Find the active goal
            const goalRes = await db.query(`
                SELECT * FROM routine_goals
                WHERE user_id = $1 AND goal_type = $2 AND status = 'active'
            `, [req.user.id, goal_type]);
            const goal = goalRes.rows[0];

            if (!goal) {
                return res.status(404).json({ error: `No active ${goal_type} goal found.` });
            }

            // Check if it's time to advance to next week (every 7 days)
            const goalAgeRes = await db.query(`
                SELECT EXTRACT(DAY FROM (NOW() - created_at)) as days_active
                FROM routine_goals WHERE id = $1
            `, [goal.id]);

            const daysActive = parseFloat(goalAgeRes.rows[0]?.days_active || 0);
            const expectedWeek = Math.floor(daysActive / 7) + 1;

            if (expectedWeek > goal.week_number && expectedWeek <= 4) {
                // Advance to next week with increased target
                const gap = parseFloat(goal.target_value) - parseFloat(goal.current_value);
                const newWeeklyTarget = parseFloat(goal.current_value) + (gap * 0.25 * expectedWeek);

                await db.query(`
                    UPDATE routine_goals SET week_number = $1, weekly_target = $2
                    WHERE id = $3
                `, [expectedWeek, newWeeklyTarget, goal.id]);

                goal.weekly_target = newWeeklyTarget;
            }

            // Celebrate if target met
            const weeklyTarget = parseFloat(goal.weekly_target);
            const metTarget = value >= weeklyTarget;

            res.json({
                message: metTarget ? '🎉 Great job! You hit your target!' : 'Logged! Keep pushing toward your goal.',
                goal_type,
                value,
                weekly_target: weeklyTarget,
                met_target: metTarget,
                encouragement: metTarget
                    ? 'You\'re building this habit! Consistency is key.'
                    : `You're at ${value}, target is ${weeklyTarget}. Small steps count!`
            });
        } catch (err) {
            console.error('Routine checkin error:', err);
            res.status(500).json({ error: 'Failed to log routine check-in.' });
        }
    });

    // GET /api/routine/progress - Track progress over time
    router.get('/progress', authenticateToken, async (req, res) => {
        try {
            const goalsRes = await db.query(`
                SELECT * FROM routine_goals WHERE user_id = $1 ORDER BY created_at DESC
            `, [req.user.id]);
            const goals = goalsRes.rows.map(g => ({
                ...g,
                current_value: parseFloat(g.current_value),
                target_value: parseFloat(g.target_value),
                weekly_target: parseFloat(g.weekly_target)
            }));

            // Get health data for progress calculation
            const healthDataRes = await db.query(`
                SELECT date, sleep_hours, exercise_minutes, stress_level, study_hours
                FROM health_logs
                WHERE user_id = $1
                ORDER BY date ASC
            `, [req.user.id]);

            const healthData = healthDataRes.rows.map(h => ({
                date: h.date,
                sleep_hours: parseFloat(h.sleep_hours),
                exercise_minutes: parseInt(h.exercise_minutes, 10),
                stress_level: parseInt(h.stress_level, 10),
                study_hours: parseFloat(h.study_hours)
            }));

            // Calculate week-over-week progress for each goal type
            const progress = goals.map(goal => {
                const relevantData = healthData.map(h => {
                    switch (goal.goal_type) {
                        case 'sleep': return { date: h.date, value: h.sleep_hours };
                        case 'exercise': return { date: h.date, value: h.exercise_minutes };
                        case 'stress': return { date: h.date, value: h.stress_level };
                        case 'study': return { date: h.date, value: h.study_hours };
                        default: return { date: h.date, value: 0 };
                    }
                });

                // Progress toward final target
                const recentAvg = relevantData.slice(-7).reduce((s, d) => s + d.value, 0) / Math.max(relevantData.slice(-7).length, 1);
                const startValue = goal.current_value;
                const targetValue = goal.target_value;
                const totalProgress = targetValue !== startValue
                    ? Math.round(((recentAvg - startValue) / (targetValue - startValue)) * 100)
                    : 100;

                return {
                    goal_type: goal.goal_type,
                    status: goal.status,
                    start_value: Math.round(goal.current_value * 10) / 10,
                    current_average: Math.round(recentAvg * 10) / 10,
                    target_value: goal.target_value,
                    week_number: goal.week_number,
                    progress_percent: Math.max(0, Math.min(100, totalProgress)),
                    data_points: relevantData.slice(-14) // Last 2 weeks of data
                };
            });

            res.json({
                goals: progress,
                total_active_goals: goals.filter(g => g.status === 'active').length,
                total_completed: goals.filter(g => g.status === 'completed').length
            });
        } catch (err) {
            console.error('Routine progress error:', err);
            res.status(500).json({ error: 'Failed to get progress.' });
        }
    });

    // GET /api/routine/tips - Get daily tips based on current state
    router.get('/tips', authenticateToken, async (req, res) => {
        try {
            // Get latest health data
            const latestRes = await db.query(`
                SELECT * FROM health_logs WHERE user_id = $1 ORDER BY date DESC LIMIT 1
            `, [req.user.id]);
            const latest = latestRes.rows[0];

            // Get active goals
            const goalsRes = await db.query(`
                SELECT goal_type, weekly_target FROM routine_goals
                WHERE user_id = $1 AND status = 'active'
            `, [req.user.id]);
            const goals = goalsRes.rows;

            const tips = [];

            if (!latest) {
                tips.push('Start your day with a check-in! Track your sleep and mood.');
                tips.push('Set your first wellness goal to build healthy habits.');
            } else {
                // Contextual tips based on data
                if (parseFloat(latest.sleep_hours) < 6) {
                    tips.push('You slept less than 6 hours. Try a 20-minute nap between classes.');
                    tips.push('Avoid caffeine after 2 PM to improve tonight\'s sleep.');
                }
                if (parseInt(latest.stress_level, 10) >= 7) {
                    tips.push('High stress today. Try 5 deep breaths right now (box breathing: 4-4-4-4).');
                    tips.push('Step outside for 2 minutes. A change of scenery helps reset your mind.');
                }
                if (parseInt(latest.exercise_minutes, 10) === 0) {
                    tips.push('No exercise today yet. A 10-minute walk between classes counts!');
                }
                if (latest.mood === 'anxious') {
                    tips.push('Feeling anxious? Write down 3 things in your control right now.');
                }
                if (parseFloat(latest.study_hours) > 6) {
                    tips.push('You\'ve studied a lot today. Remember: rest makes studying more effective.');
                }

                // Goal-based tips
                goals.forEach(g => {
                    if (g.goal_type === 'sleep') {
                        tips.push(`Sleep goal: aim for ${parseFloat(g.weekly_target)} hours tonight. Set an alarm to start winding down.`);
                    }
                    if (g.goal_type === 'exercise') {
                        tips.push(`Exercise goal: ${parseFloat(g.weekly_target)} minutes. Even stretching at your desk helps!`);
                    }
                });
            }

            // Always include one motivational tip
            const motivations = [
                'Small progress is still progress. You\'re doing better than you think.',
                'Consistency beats perfection. Show up every day, even imperfectly.',
                'Your well-being matters. It\'s okay to prioritize yourself.',
                'One day at a time. You don\'t have to solve everything today.',
                'Remember: you\'re not alone. Reach out when you need support.'
            ];
            tips.push(motivations[Math.floor(Math.random() * motivations.length)]);

            res.json({
                tips: tips.slice(0, 5), // Max 5 tips
                date: new Date().toISOString().split('T')[0]
            });
        } catch (err) {
            console.error('Routine tips error:', err);
            res.status(500).json({ error: 'Failed to get tips.' });
        }
    });

    return router;
};

// ---- Build a 4-week gradual plan ----
function buildGradualPlan(goalType, current, target) {
    const gap = target - current;
    const weeks = [];

    for (let week = 1; week <= 4; week++) {
        const weekTarget = current + (gap * 0.25 * week);
        let description = '';

        switch (goalType) {
            case 'sleep':
                description = `Target ${weekTarget.toFixed(1)} hours of sleep per night`;
                break;
            case 'exercise':
                description = `Target ${Math.round(weekTarget)} minutes of activity per day`;
                break;
            case 'stress':
                description = `Aim for stress level below ${Math.round(weekTarget)}/10`;
                break;
            case 'study':
                description = `Study ${weekTarget.toFixed(1)} hours per day`;
                break;
        }

        weeks.push({ week, target: Math.round(weekTarget * 10) / 10, description });
    }

    return weeks;
}

// ---- Get daily tips for a specific goal ----
function getDailyTips(goalType, target, current) {
    const tips = [];

    switch (goalType) {
        case 'sleep':
            if (current < target) {
                tips.push('Try going to bed 15 minutes earlier tonight.');
                tips.push('No screens 30 minutes before bed.');
            } else {
                tips.push('Great sleep pattern! Keep your bedtime consistent.');
            }
            break;
        case 'exercise':
            if (current < target) {
                tips.push('Take the stairs instead of elevator today.');
                tips.push('A 10-minute walk between classes adds up!');
            } else {
                tips.push('You\'re hitting your exercise target! Try mixing up activities.');
            }
            break;
        case 'stress':
            tips.push('Try one mindfulness break today (even 2 minutes helps).');
            tips.push('Write down your top 3 priorities for today - focus only on those.');
            break;
    }

    return tips;
}

// ---- Get overall motivational message ----
function getOverallMessage(plan) {
    const onTrackCount = plan.filter(p => p.on_track).length;
    const totalGoals = plan.length;

    if (onTrackCount === totalGoals) return '🌟 Amazing! You\'re on track with all your goals!';
    if (onTrackCount >= totalGoals / 2) return '👍 Good progress! Keep pushing on the goals that need attention.';
    return '💪 Every day is a new chance. Focus on one small win today.';
}
