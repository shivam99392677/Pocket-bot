// ============================================================
// FEATURE 3: TRAVEL OPTIONS - PostgreSQL Edition
// Track trips, find patterns, suggest cheaper alternatives
// ============================================================
const express = require('express');
const router = express.Router();

// Reference data: typical costs per transport mode
const TRANSPORT_COSTS = {
    uber: { avg_per_km: 15.00, base: 50.00 },
    taxi: { avg_per_km: 12.00, base: 40.00 },
    bus: { avg_per_trip: 15.00, monthly_pass: 400 },
    subway: { avg_per_trip: 20.00, monthly_pass: 600 },
    bike: { avg_per_trip: 0, monthly_rental: 150 },
    walk: { avg_per_trip: 0 },
    carpool: { avg_per_trip: 50.00 },
    drive: { avg_per_km: 7.00, parking: 50.00 }
};

module.exports = function (db, authenticateToken) {

    // POST /api/travel/log - Log a trip
    router.post('/log', authenticateToken, async (req, res) => {
        try {
            const { origin, destination, mode, cost, duration_minutes, date } = req.body;

            if (!origin || !destination || !mode) {
                return res.status(400).json({ error: 'Origin, destination, and mode are required.' });
            }

            const validModes = Object.keys(TRANSPORT_COSTS);
            if (!validModes.includes(mode.toLowerCase())) {
                return res.status(400).json({
                    error: `Invalid mode. Use: ${validModes.join(', ')}`
                });
            }

            const tripDate = date || new Date().toISOString().split('T')[0];

            const result = await db.query(`
                INSERT INTO travel_logs (user_id, date, origin, destination, mode, cost, duration_minutes)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id
            `, [req.user.id, tripDate, origin, destination, mode.toLowerCase(), cost || 0, duration_minutes || 0]);

            res.status(201).json({
                message: 'Trip logged!',
                trip: { id: result.rows[0].id, origin, destination, mode, cost, date: tripDate }
            });
        } catch (err) {
            console.error('Log travel error:', err);
            res.status(500).json({ error: 'Failed to log trip.' });
        }
    });

    // GET /api/travel/options - Get alternative transport options for common routes
    router.get('/options', authenticateToken, async (req, res) => {
        try {
            // Find user's most common routes
            const commonRoutesRes = await db.query(`
                SELECT origin, destination, mode, AVG(cost) as avg_cost, COUNT(*) as trip_count,
                       AVG(duration_minutes) as avg_duration
                FROM travel_logs
                WHERE user_id = $1 AND date::date >= (CURRENT_DATE - INTERVAL '30 days')
                GROUP BY origin, destination, mode
                ORDER BY trip_count DESC
                LIMIT 5
            `, [req.user.id]);

            const commonRoutes = commonRoutesRes.rows.map(r => ({
                origin: r.origin,
                destination: r.destination,
                mode: r.mode,
                avg_cost: parseFloat(r.avg_cost),
                trip_count: parseInt(r.trip_count, 10),
                avg_duration: parseFloat(r.avg_duration)
            }));

            // For each common route, suggest alternatives
            const routeOptions = commonRoutes.map(route => {
                const alternatives = [];

                // Compare with other modes
                for (const [mode, costs] of Object.entries(TRANSPORT_COSTS)) {
                    if (mode === route.mode) continue;

                    let estimatedCost = 0;
                    if (costs.avg_per_trip !== undefined) {
                        estimatedCost = costs.avg_per_trip;
                    } else if (costs.avg_per_km) {
                        // Rough estimate: assume 5km average trip
                        estimatedCost = costs.avg_per_km * 5 + (costs.base || 0);
                    }

                    const savings = route.avg_cost - estimatedCost;
                    if (savings > 0) {
                        alternatives.push({
                            mode,
                            estimated_cost: Math.round(estimatedCost * 100) / 100,
                            savings_per_trip: Math.round(savings * 100) / 100,
                            monthly_savings: Math.round(savings * route.trip_count * 100) / 100
                        });
                    }
                }

                // Sort alternatives by savings
                alternatives.sort((a, b) => b.savings_per_trip - a.savings_per_trip);

                return {
                    route: `${route.origin} → ${route.destination}`,
                    current_mode: route.mode,
                    current_avg_cost: Math.round(route.avg_cost * 100) / 100,
                    trips_per_month: route.trip_count,
                    alternatives: alternatives.slice(0, 3) // Top 3 alternatives
                };
            });

            res.json({
                common_routes: routeOptions,
                tip: routeOptions.length > 0
                    ? `Your most frequent trip is ${routeOptions[0].route}. Consider switching to save money!`
                    : 'Log more trips to get personalized transport recommendations.'
            });
        } catch (err) {
            console.error('Travel options error:', err);
            res.status(500).json({ error: 'Failed to get travel options.' });
        }
    });

    // GET /api/travel/savings - Show total savings potential
    router.get('/savings', authenticateToken, async (req, res) => {
        try {
            // Total travel spending last 30 days
            const totalSpendRes = await db.query(`
                SELECT COALESCE(SUM(cost), 0) as total, COUNT(*) as trips
                FROM travel_logs
                WHERE user_id = $1 AND date::date >= (CURRENT_DATE - INTERVAL '30 days')
            `, [req.user.id]);

            const totalSpend = {
                total: parseFloat(totalSpendRes.rows[0].total) || 0,
                trips: parseInt(totalSpendRes.rows[0].trips, 10) || 0
            };

            // Spending by mode
            const byModeRes = await db.query(`
                SELECT mode, SUM(cost) as total, COUNT(*) as trips, AVG(cost) as avg_cost
                FROM travel_logs
                WHERE user_id = $1 AND date::date >= (CURRENT_DATE - INTERVAL '30 days')
                GROUP BY mode
                ORDER BY total DESC
            `, [req.user.id]);

            const byMode = byModeRes.rows.map(r => ({
                mode: r.mode,
                total: parseFloat(r.total),
                trips: parseInt(r.trips, 10),
                avg_cost: parseFloat(r.avg_cost)
            }));

            // Calculate potential savings if switching expensive modes to cheaper ones
            let potentialSavings = 0;
            const suggestions = [];

            for (const modeData of byMode) {
                if (['uber', 'taxi', 'drive'].includes(modeData.mode)) {
                    // These could be replaced with bus/bike
                    const busCost = TRANSPORT_COSTS.bus.avg_per_trip * modeData.trips;
                    const savings = modeData.total - busCost;
                    if (savings > 0) {
                        potentialSavings += savings;
                        suggestions.push({
                            current: modeData.mode,
                            suggested: 'bus',
                            current_monthly_cost: Math.round(modeData.total * 100) / 100,
                            suggested_monthly_cost: Math.round(busCost * 100) / 100,
                            monthly_savings: Math.round(savings * 100) / 100
                        });
                    }
                }
            }

            // Check if a monthly pass makes sense
            const busTrips = byMode.find(m => m.mode === 'bus');
            let passRecommendation = null;
            if (busTrips && busTrips.trips >= 16) {
                const passCost = TRANSPORT_COSTS.bus.monthly_pass;
                const withoutPass = busTrips.total;
                if (withoutPass > passCost) {
                    passRecommendation = {
                        message: `You take ${busTrips.trips} bus trips/month. A monthly pass (₹${passCost}) would save you ₹${(withoutPass - passCost).toFixed(2)}!`,
                        savings: Math.round((withoutPass - passCost) * 100) / 100
                    };
                }
            }

            res.json({
                monthly_travel_spend: Math.round(totalSpend.total * 100) / 100,
                total_trips: totalSpend.trips,
                by_mode: byMode,
                potential_monthly_savings: Math.round(potentialSavings * 100) / 100,
                suggestions,
                pass_recommendation: passRecommendation
            });
        } catch (err) {
            console.error('Travel savings error:', err);
            res.status(500).json({ error: 'Failed to calculate savings.' });
        }
    });

    // GET /api/travel/patterns - Identify regular travel patterns
    router.get('/patterns', authenticateToken, async (req, res) => {
        try {
            // Most visited destinations
            const topDestinationsRes = await db.query(`
                SELECT destination, COUNT(*) as visits, AVG(cost) as avg_cost
                FROM travel_logs
                WHERE user_id = $1 AND date::date >= (CURRENT_DATE - INTERVAL '30 days')
                GROUP BY destination
                ORDER BY visits DESC
                LIMIT 5
            `, [req.user.id]);

            const topDestinations = topDestinationsRes.rows.map(r => ({
                destination: r.destination,
                visits: parseInt(r.visits, 10),
                avg_cost: parseFloat(r.avg_cost)
            }));

            // Travel by day of week
            const byDayOfWeekRes = await db.query(`
                SELECT
                    CASE EXTRACT(DOW FROM date::date)
                        WHEN 0 THEN 'Sunday'
                        WHEN 1 THEN 'Monday'
                        WHEN 2 THEN 'Tuesday'
                        WHEN 3 THEN 'Wednesday'
                        WHEN 4 THEN 'Thursday'
                        WHEN 5 THEN 'Friday'
                        WHEN 6 THEN 'Saturday'
                    END as day_name,
                    COUNT(*) as trips,
                    SUM(cost) as total_cost
                FROM travel_logs
                WHERE user_id = $1 AND date::date >= (CURRENT_DATE - INTERVAL '30 days')
                GROUP BY EXTRACT(DOW FROM date::date)
                ORDER BY EXTRACT(DOW FROM date::date)
            `, [req.user.id]);

            const byDayOfWeek = byDayOfWeekRes.rows.map(r => ({
                day_name: r.day_name,
                trips: parseInt(r.trips, 10),
                total_cost: parseFloat(r.total_cost)
            }));

            // Regular routes (same origin-destination, 2+ times)
            const regularRoutesRes = await db.query(`
                SELECT origin, destination, mode, COUNT(*) as frequency,
                       AVG(cost) as avg_cost, SUM(cost) as total_cost
                FROM travel_logs
                WHERE user_id = $1 AND date::date >= (CURRENT_DATE - INTERVAL '30 days')
                GROUP BY origin, destination, mode
                HAVING COUNT(*) >= 2
                ORDER BY frequency DESC
            `, [req.user.id]);

            const regularRoutes = regularRoutesRes.rows.map(r => ({
                origin: r.origin,
                destination: r.destination,
                mode: r.mode,
                frequency: parseInt(r.frequency, 10),
                avg_cost: parseFloat(r.avg_cost),
                total_cost: parseFloat(r.total_cost)
            }));

            res.json({
                top_destinations: topDestinations,
                by_day_of_week: byDayOfWeek,
                regular_routes: regularRoutes,
                insight: regularRoutes.length > 0
                    ? `You have ${regularRoutes.length} regular route(s). The most frequent is ${regularRoutes[0].origin} → ${regularRoutes[0].destination} (${regularRoutes[0].frequency}x/month).`
                    : 'Keep logging trips to discover your travel patterns!'
            });
        } catch (err) {
            console.error('Travel patterns error:', err);
            res.status(500).json({ error: 'Failed to analyze patterns.' });
        }
    });

    return router;
};
