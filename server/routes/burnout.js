// ============================================================
// FEATURE 4: BURNOUT DETECTION - PostgreSQL Edition
// Daily check-ins, baseline comparison, early warning system
// ============================================================
const express = require('express');
const router = express.Router();

module.exports = function (db, authenticateToken) {

    // POST /api/health/checkin - Daily wellness check-in
    router.post('/checkin', authenticateToken, async (req, res) => {
        try {
            const { sleep_hours, stress_level, mood, study_hours, exercise_minutes, social_activity, energy_level, notes, date } = req.body;

            // Validate inputs
            if (sleep_hours === undefined || stress_level === undefined || !mood) {
                return res.status(400).json({ error: 'Sleep hours, stress level, and mood are required.' });
            }

            const validMoods = ['happy', 'neutral', 'anxious', 'sad', 'overwhelmed'];
            if (!validMoods.includes(mood.toLowerCase())) {
                return res.status(400).json({
                    error: `Invalid mood. Use: ${validMoods.join(', ')}`
                });
            }

            if (stress_level < 1 || stress_level > 10) {
                return res.status(400).json({ error: 'Stress level must be between 1 and 10.' });
            }

            const checkinDate = date || new Date().toISOString().split('T')[0];

            // Insert or update today's check-in (one per day)
            await db.query(`
                INSERT INTO health_logs (user_id, date, sleep_hours, stress_level, mood, study_hours, exercise_minutes, social_activity, energy_level, notes)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT(user_id, date) DO UPDATE SET
                    sleep_hours = EXCLUDED.sleep_hours,
                    stress_level = EXCLUDED.stress_level,
                    mood = EXCLUDED.mood,
                    study_hours = EXCLUDED.study_hours,
                    exercise_minutes = EXCLUDED.exercise_minutes,
                    social_activity = EXCLUDED.social_activity,
                    energy_level = EXCLUDED.energy_level,
                    notes = EXCLUDED.notes
            `, [
                req.user.id, checkinDate,
                sleep_hours, stress_level, mood.toLowerCase(),
                study_hours || 0, exercise_minutes || 0,
                social_activity || 0, energy_level || 5,
                notes || ''
            ]);

            // Calculate and store baseline burnout score
            const burnoutResult = await calculateBurnoutScore(db, req.user.id, checkinDate);

            // Try to overwrite with high-fidelity ML burnout prediction
            try {
                const pythonRes = await fetch(`http://localhost:8000/api/v1/burnout/${req.user.id}`);
                if (pythonRes.ok) {
                    const pythonData = await pythonRes.json();
                    const mlScore10 = Math.round(pythonData.burnout_score / 10);
                    let alertVal = "good";
                    if (pythonData.risk_level === "high") alertVal = "high";
                    else if (pythonData.risk_level === "medium") alertVal = "moderate";

                    await db.query(`
                        UPDATE burnout_scores
                        SET score = $1, alert_level = $2
                        WHERE user_id = $3 AND date = $4
                    `, [mlScore10, alertVal, req.user.id, checkinDate]);

                    burnoutResult.score = mlScore10;
                    burnoutResult.alert_level = alertVal;
                    burnoutResult.interpretation = pythonData.burnout_score >= 55 ? "High burnout risk detected by ML" : "Doing well";
                }
            } catch (err) {
                console.warn('Failed to overwrite with ML burnout score:', err.message);
            }

            res.status(201).json({
                message: 'Check-in recorded!',
                date: checkinDate,
                burnout: burnoutResult
            });
        } catch (err) {
            console.error('Health checkin error:', err);
            res.status(500).json({ error: 'Failed to record check-in.' });
        }
    });

    // GET /api/burnout/score - Get current burnout score
    router.get('/score', authenticateToken, async (req, res) => {
        try {
            // Count total check-in days
            const checkinCountRes = await db.query(`
                SELECT COUNT(*) as days FROM health_logs WHERE user_id = $1
            `, [req.user.id]);
            const checkinDays = parseInt(checkinCountRes.rows[0].days, 10);

            // Get most recent daily check-in log
            const latestCheckinRes = await db.query(`
                SELECT * FROM health_logs WHERE user_id = $1 ORDER BY date DESC LIMIT 1
            `, [req.user.id]);
            const latestCheckin = latestCheckinRes.rows[0] || null;

            let pythonBurnout = null;
            try {
                const resBurnout = await fetch(`http://localhost:8000/api/v1/burnout/${req.user.id}`);
                if (resBurnout.ok) {
                    pythonBurnout = await resBurnout.json();
                }
            } catch (err) {
                console.warn('Python burnout fetch failed:', err.message);
            }

            if (!pythonBurnout || pythonBurnout.burnout_score === 0) {
                return res.json({
                    score: null,
                    alert_level: 'unknown',
                    message: 'No burnout data yet. Complete daily check-ins for at least 7 days to get your score.',
                    days_logged: checkinDays,
                    days_needed: Math.max(0, 4 - checkinDays),
                    latest_checkin: latestCheckin
                });
            }

            // Map risk levels to Express alert levels
            let alert_level = "good";
            if (pythonBurnout.risk_level === "high") alert_level = "high";
            else if (pythonBurnout.risk_level === "medium") alert_level = "moderate";

            let interpretation = 'You\'re doing well! Keep maintaining your current habits.';
            if (pythonBurnout.burnout_score >= 75) {
                interpretation = 'Crisis mode - Please reach out to a counselor or trusted person immediately.';
                alert_level = 'crisis';
            } else if (pythonBurnout.burnout_score >= 55) {
                interpretation = 'High burnout risk - Take a break today. Consider seeking support.';
                alert_level = 'high';
            } else if (pythonBurnout.burnout_score >= 30) {
                interpretation = 'Getting stressed - Schedule breaks, prioritize sleep, and reduce workload.';
                alert_level = 'moderate';
            }

            res.json({
                score: Math.round(pythonBurnout.burnout_score / 10),
                alert_level: alert_level,
                date: new Date().toISOString().split('T')[0],
                interpretation,
                days_logged: checkinDays,
                latest_checkin: latestCheckin
            });
        } catch (err) {
            console.error('Burnout score error:', err);
            res.status(500).json({ error: 'Failed to get burnout score.' });
        }
    });

    // GET /api/burnout/alert - Get burnout warnings
    router.get('/alert', authenticateToken, async (req, res) => {
        try {
            const latestRes = await db.query(`
                SELECT * FROM burnout_scores
                WHERE user_id = $1
                ORDER BY date DESC LIMIT 1
            `, [req.user.id]);
            const latest = latestRes.rows[0];

            if (!latest || latest.score <= 3) {
                return res.json({ has_alert: false, message: 'You\'re doing well! Keep it up.' });
            }

            // Get recent health data for context
            const recentHealthRes = await db.query(`
                SELECT * FROM health_logs
                WHERE user_id = $1
                ORDER BY date DESC LIMIT 3
            `, [req.user.id]);
            const recentHealth = recentHealthRes.rows;

            // Build specific warnings based on what's declining
            const warnings = [];

            if (parseFloat(latest.current_sleep) < parseFloat(latest.baseline_sleep) - 1) {
                warnings.push({
                    type: 'sleep',
                    message: `Your sleep dropped to ${parseFloat(latest.current_sleep).toFixed(1)}hrs (baseline: ${parseFloat(latest.baseline_sleep).toFixed(1)}hrs). Try to get more rest.`
                });
            }

            if (parseFloat(latest.current_stress) > parseFloat(latest.baseline_stress) + 1.5) {
                warnings.push({
                    type: 'stress',
                    message: `Your stress level is ${parseFloat(latest.current_stress).toFixed(1)}/10 (baseline: ${parseFloat(latest.baseline_stress).toFixed(1)}/10). Consider taking breaks.`
                });
            }

            if (parseFloat(latest.current_exercise) < 10) {
                warnings.push({
                    type: 'exercise',
                    message: 'You haven\'t been exercising much. Even a 5-minute walk helps!'
                });
            }

            // Check for overwhelmed mood streak
            const overwhelmedDays = recentHealth.filter(h => h.mood === 'overwhelmed').length;
            if (overwhelmedDays >= 2) {
                warnings.push({
                    type: 'mood',
                    message: 'You\'ve been feeling overwhelmed for multiple days. Please consider talking to someone.'
                });
            }

            res.json({
                has_alert: true,
                score: latest.score,
                alert_level: latest.alert_level,
                warnings,
                recommendations: getRecoveryRecommendations(latest.score, warnings)
            });
        } catch (err) {
            console.error('Burnout alert error:', err);
            res.status(500).json({ error: 'Failed to get alert.' });
        }
    });

    // GET /api/burnout/trends - 30-day burnout trends
    router.get('/trends', authenticateToken, async (req, res) => {
        try {
            const { days } = req.query;
            const lookback = parseInt(days, 10) || 30;

            // Burnout scores over time
            const scoresRes = await db.query(`
                SELECT date, score, alert_level, current_sleep, current_stress, current_exercise
                FROM burnout_scores
                WHERE user_id = $1 AND date::date >= (CURRENT_DATE - ($2 || ' days')::interval)
                ORDER BY date ASC
            `, [req.user.id, lookback]);

            const scores = scoresRes.rows.map(r => ({
                ...r,
                current_sleep: parseFloat(r.current_sleep),
                current_stress: parseFloat(r.current_stress),
                current_exercise: parseFloat(r.current_exercise)
            }));

            // Health log trends
            const healthTrendsRes = await db.query(`
                SELECT date, sleep_hours, stress_level, mood, exercise_minutes, energy_level
                FROM health_logs
                WHERE user_id = $1 AND date::date >= (CURRENT_DATE - ($2 || ' days')::interval)
                ORDER BY date ASC
            `, [req.user.id, lookback]);

            const healthTrends = healthTrendsRes.rows.map(h => ({
                ...h,
                sleep_hours: parseFloat(h.sleep_hours),
                stress_level: parseInt(h.stress_level, 10),
                exercise_minutes: parseInt(h.exercise_minutes, 10),
                energy_level: parseInt(h.energy_level, 10)
            }));

            // Calculate averages for the period
            const avgSleep = healthTrends.reduce((sum, h) => sum + h.sleep_hours, 0) / (healthTrends.length || 1);
            const avgStress = healthTrends.reduce((sum, h) => sum + h.stress_level, 0) / (healthTrends.length || 1);
            const avgExercise = healthTrends.reduce((sum, h) => sum + h.exercise_minutes, 0) / (healthTrends.length || 1);

            // Mood distribution
            const moodCounts = {};
            healthTrends.forEach(h => {
                moodCounts[h.mood] = (moodCounts[h.mood] || 0) + 1;
            });

            res.json({
                burnout_scores: scores,
                health_trends: healthTrends,
                averages: {
                    sleep: Math.round(avgSleep * 10) / 10,
                    stress: Math.round(avgStress * 10) / 10,
                    exercise_minutes: Math.round(avgExercise)
                },
                mood_distribution: moodCounts,
                period_days: lookback,
                total_checkins: healthTrends.length
            });
        } catch (err) {
            console.error('Burnout trends error:', err);
            res.status(500).json({ error: 'Failed to get trends.' });
        }
    });

    // GET /api/burnout/recommendations - What to do about burnout
    router.get('/recommendations', authenticateToken, async (req, res) => {
        try {
            let pythonRecs = null;
            try {
                const resRecs = await fetch(`http://localhost:8000/api/v1/recommendations/${req.user.id}`);
                if (resRecs.ok) {
                    pythonRecs = await resRecs.json();
                }
            } catch (err) {
                console.warn('Failed to load Python recommendations:', err.message);
            }

            if (pythonRecs) {
                const list = [...(pythonRecs.financial || []), ...(pythonRecs.wellness || []), ...(pythonRecs.productivity || [])];
                return res.json({
                    recommendations: list,
                    priority: list.length > 3 ? 'high' : 'medium'
                });
            }

            const latestRes = await db.query(`
                SELECT * FROM burnout_scores WHERE user_id = $1 ORDER BY date DESC LIMIT 1
            `, [req.user.id]);
            const latest = latestRes.rows[0];

            const recentHealthRes = await db.query(`
                SELECT * FROM health_logs WHERE user_id = $1 ORDER BY date DESC LIMIT 7
            `, [req.user.id]);
            const recentHealth = recentHealthRes.rows;

            if (!latest) {
                return res.json({
                    recommendations: ['Start with daily check-ins to build your baseline!'],
                    priority: 'low'
                });
            }

            const recs = getRecoveryRecommendations(latest.score, []);

            // Add personalized tips based on specific data
            if (recentHealth.length > 0) {
                const avgStudy = recentHealth.reduce((s, h) => s + parseFloat(h.study_hours), 0) / recentHealth.length;
                if (avgStudy > 8) {
                    recs.push('You\'re studying ' + avgStudy.toFixed(1) + ' hours/day on average. Schedule breaks every 45 minutes.');
                }
            }

            res.json({
                score: latest.score,
                alert_level: latest.alert_level,
                recommendations: recs,
                priority: latest.score >= 7 ? 'high' : latest.score >= 4 ? 'medium' : 'low'
            });
        } catch (err) {
            console.error('Burnout recommendations error:', err);
            res.status(500).json({ error: 'Failed to get recommendations.' });
        }
    });

    return router;
};

// ============================================================
// BURNOUT SCORE ALGORITHM - PostgreSQL Edition
// ============================================================
async function calculateBurnoutScore(db, userId, date) {
    const dayCountRes = await db.query(`
        SELECT COUNT(*) as days FROM health_logs WHERE user_id = $1
    `, [userId]);
    const dayCount = parseInt(dayCountRes.rows[0].days, 10);

    // Need at least 7 days for a baseline
    if (dayCount < 7) {
        return {
            score: null,
            message: `Need ${7 - dayCount} more days of data to calculate burnout score.`,
            days_until_baseline: 7 - dayCount
        };
    }

    // STEP 1: Get baseline (first 7 days of data)
    const baselineRes = await db.query(`
        SELECT
            AVG(sleep_hours) as avg_sleep,
            AVG(stress_level) as avg_stress,
            AVG(exercise_minutes) as avg_exercise
        FROM (
            SELECT sleep_hours, stress_level, exercise_minutes
            FROM health_logs
            WHERE user_id = $1
            ORDER BY date ASC
            LIMIT 7
        ) sub
    `, [userId]);
    const baseline = baselineRes.rows[0];
    const bSleep = parseFloat(baseline.avg_sleep) || 0;
    const bStress = parseFloat(baseline.avg_stress) || 0;
    const bExercise = parseFloat(baseline.avg_exercise) || 0;

    // STEP 2: Get current averages (last 7 days)
    const currentRes = await db.query(`
        SELECT
            AVG(sleep_hours) as avg_sleep,
            AVG(stress_level) as avg_stress,
            AVG(exercise_minutes) as avg_exercise
        FROM health_logs
        WHERE user_id = $1 AND date::date >= ($2::date - INTERVAL '7 days')
    `, [userId, date]);
    const current = currentRes.rows[0];
    const cSleep = parseFloat(current.avg_sleep) || 0;
    const cStress = parseFloat(current.avg_stress) || 0;
    const cExercise = parseFloat(current.avg_exercise) || 0;

    // Get today's mood
    const todayMoodRes = await db.query(`
        SELECT mood FROM health_logs WHERE user_id = $1 AND date = $2
    `, [userId, date]);
    const todayMood = todayMoodRes.rows[0];

    // Count days with no exercise in last 7 days
    const noExerciseDaysRes = await db.query(`
        SELECT COUNT(*) as days
        FROM health_logs
        WHERE user_id = $1 AND date::date >= ($2::date - INTERVAL '7 days') AND exercise_minutes < 5
    `, [userId, date]);
    const noExerciseDays = parseInt(noExerciseDaysRes.rows[0].days, 10);

    // STEP 3: Calculate penalties
    let score = 0;

    // Sleep penalty: +2 if sleeping 1.5+ hours less than baseline
    const sleepDrop = bSleep - cSleep;
    if (sleepDrop > 1.5) score += 2;

    // Stress penalty: +2 if stress is 2+ points above baseline
    const stressRise = cStress - bStress;
    if (stressRise > 2) score += 2;

    // Exercise penalty: +1 if less than 2 days of exercise in last 7
    if (noExerciseDays >= 5) score += 1;

    // Mood penalty: +2 if currently overwhelmed
    if (todayMood && todayMood.mood === 'overwhelmed') score += 2;

    // Additional: +1 if mood is anxious or sad
    if (todayMood && (todayMood.mood === 'anxious' || todayMood.mood === 'sad')) score += 1;

    // STEP 4: Determine alert level
    let alertLevel = 'good';
    if (score >= 10) alertLevel = 'crisis';
    else if (score >= 7) alertLevel = 'high';
    else if (score >= 4) alertLevel = 'moderate';
    else alertLevel = 'good';

    // STEP 5: Store the score
    await db.query(`
        INSERT INTO burnout_scores (user_id, date, baseline_sleep, baseline_stress, baseline_exercise, current_sleep, current_stress, current_exercise, score, alert_level)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT(user_id, date) DO UPDATE SET
            baseline_sleep = EXCLUDED.baseline_sleep,
            baseline_stress = EXCLUDED.baseline_stress,
            baseline_exercise = EXCLUDED.baseline_exercise,
            current_sleep = EXCLUDED.current_sleep,
            current_stress = EXCLUDED.current_stress,
            current_exercise = EXCLUDED.current_exercise,
            score = EXCLUDED.score,
            alert_level = EXCLUDED.alert_level
    `, [
        userId, date,
        bSleep, bStress, bExercise,
        cSleep, cStress, cExercise,
        score, alertLevel
    ]);

    return {
        score,
        alert_level: alertLevel,
        interpretation: getAlertInterpretation(score),
        baseline: { sleep: bSleep, stress: bStress },
        current: { sleep: cSleep, stress: cStress }
    };
}

// ---- Interpret alert levels ----
function getAlertInterpretation(score) {
    if (score >= 10) return 'Crisis mode - Please reach out to a counselor or trusted person immediately.';
    if (score >= 7) return 'High burnout risk - Take a break today. Consider seeking support.';
    if (score >= 4) return 'Getting stressed - Schedule breaks, prioritize sleep, and reduce workload if possible.';
    return 'You\'re doing well! Keep maintaining your current habits.';
}

// ---- Recovery recommendations based on score ----
function getRecoveryRecommendations(score, warnings) {
    const recs = [];

    if (score >= 7) {
        recs.push('Talk to someone you trust - a friend, family member, or counselor.');
        recs.push('Take today off from studying if possible. Rest is productive.');
        recs.push('Try a 10-minute walk outside. Fresh air helps reset your mind.');
    }

    if (score >= 4) {
        recs.push('Use the Pomodoro technique: 25 min work, 5 min break.');
        recs.push('Set a hard stop time tonight - no studying after 9 PM.');
        recs.push('Do one thing you enjoy today, even if it\'s just 15 minutes.');
    }

    if (score < 4) {
        recs.push('You\'re doing great! Keep your current routine going.');
        recs.push('Consider helping a friend who might be struggling.');
    }

    const hasNoSleep = warnings.some(w => w.type === 'sleep');
    const hasNoExercise = warnings.some(w => w.type === 'exercise');

    if (hasNoSleep) {
        recs.push('Try to get to bed 30 minutes earlier tonight.');
        recs.push('Avoid screens 1 hour before bed.');
    }

    if (hasNoExercise) {
        recs.push('Even a 5-minute stretch or walk counts as exercise!');
    }

    return recs;
}
