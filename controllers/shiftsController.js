import pool, { mongoose } from '../config/db.js';

const getMongoCollection = (name) => {
    try {
        if (mongoose.connection && mongoose.connection.readyState === 1) {
            return mongoose.connection.collection(name);
        }
    } catch (e) {}
    return null;
};

// Get shifts with driver, conductor, route joins
export const getAllShifts = async (req, res) => {
    try {
        const { date, status, driverId } = req.query;

        // Try MongoDB first (Atlas cloud primary)
        const mongoShifts = getMongoCollection('shifts');
        const mongoStaff = getMongoCollection('staff');
        const mongoRoutes = getMongoCollection('routes');

        if (mongoShifts) {
            const filter = {};
            if (date) {
                filter.$or = [
                    { shift_date: new Date(date) },
                    { shift_date: { $gte: new Date(date + 'T00:00:00.000Z'), $lte: new Date(date + 'T23:59:59.999Z') } },
                    { shift_date: date }
                ];
            }
            if (status) filter.status = status;
            if (driverId) filter.driver_id = driverId;

            const shifts = await mongoShifts.find(filter).sort({ shift_date: -1, start_time: 1 }).toArray();
            const staffList = mongoStaff ? await mongoStaff.find({}).toArray() : [];
            const routesList = mongoRoutes ? await mongoRoutes.find({}).toArray() : [];

            const formatted = shifts.map(r => {
                const driver = staffList.find(s => s.id === r.driver_id);
                const conductor = staffList.find(s => s.id === r.conductor_id);
                const route = routesList.find(rt => rt.id === r.route_id);

                let dateStr = null;
                if (r.shift_date) {
                    try {
                        dateStr = new Date(r.shift_date).toISOString().split('T')[0];
                    } catch (e) {
                        dateStr = String(r.shift_date).split('T')[0];
                    }
                }

                return {
                    id: r.id,
                    driverId: r.driver_id,
                    driverName: driver ? driver.name : (r.driver_name || r.driver_id),
                    conductorId: r.conductor_id,
                    conductorName: conductor ? conductor.name : (r.conductor_name || r.conductor_id),
                    routeId: r.route_id,
                    routeName: route ? route.name : (r.route_name || r.route_id),
                    origin: route ? route.origin : '',
                    destination: route ? route.destination : '',
                    busNumber: r.bus_number,
                    date: dateStr,
                    startTime: r.start_time ? String(r.start_time).slice(0, 5) : '06:00',
                    endTime: r.end_time ? String(r.end_time).slice(0, 5) : '14:00',
                    status: r.status,
                    fatigueRisk: r.fatigue_risk,
                    notes: r.notes
                };
            });

            return res.json({ success: true, count: formatted.length, data: formatted });
        }

        // MariaDB Fallback
        let query = `
            SELECT s.*, 
                   d.name as driver_name, d.fatigue_level as driver_fatigue,
                   c.name as conductor_name,
                   r.name as route_name, r.origin, r.destination, r.distance
            FROM shifts s
            JOIN staff d ON s.driver_id = d.id
            JOIN staff c ON s.conductor_id = c.id
            JOIN routes r ON s.route_id = r.id
            WHERE 1=1
        `;
        const params = [];

        if (date) {
            query += ' AND s.shift_date = ?';
            params.push(date);
        }
        if (status) {
            query += ' AND s.status = ?';
            params.push(status);
        }
        if (driverId) {
            query += ' AND s.driver_id = ?';
            params.push(driverId);
        }

        query += ' ORDER BY s.shift_date DESC, s.start_time ASC';
        const [rows] = await pool.query(query, params);

        const formatted = rows.map(r => ({
            id: r.id,
            driverId: r.driver_id,
            driverName: r.driver_name,
            conductorId: r.conductor_id,
            conductorName: r.conductor_name,
            routeId: r.route_id,
            routeName: r.route_name,
            origin: r.origin,
            destination: r.destination,
            busNumber: r.bus_number,
            date: r.shift_date ? r.shift_date.toISOString().split('T')[0] : null,
            startTime: r.start_time.slice(0, 5),
            endTime: r.end_time.slice(0, 5),
            status: r.status,
            fatigueRisk: r.fatigue_risk,
            notes: r.notes
        }));

        res.json({ success: true, count: formatted.length, data: formatted });
    } catch (err) {
        console.error('Error fetching shifts:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch shifts', error: err.message });
    }
};

// Create new Shift with Automated Fatigue Risk Calculation
export const createShift = async (req, res) => {
    try {
        const { driverId, conductorId, routeId, busNumber, date, startTime, endTime, notes } = req.body;

        if (!driverId || !conductorId || !routeId || !date || !startTime || !endTime) {
            return res.status(400).json({ success: false, message: 'Driver, conductor, route, date, and times are mandatory.' });
        }

        let driver = null;
        let route = null;

        // Try MongoDB first
        const mongoStaff = getMongoCollection('staff');
        const mongoRoutes = getMongoCollection('routes');
        const mongoShifts = getMongoCollection('shifts');
        const mongoAlerts = getMongoCollection('alerts');

        if (mongoStaff && mongoRoutes) {
            driver = await mongoStaff.findOne({ id: driverId });
            route = await mongoRoutes.findOne({ id: routeId });
        }

        // Fallback to MySQL if needed
        if (!driver || !route) {
            try {
                const [driverRows] = await pool.query('SELECT fatigue_level, rest_hours, hours_worked FROM staff WHERE id = ?', [driverId]);
                const [routeRows] = await pool.query('SELECT difficulty, terrain, distance FROM routes WHERE id = ?', [routeId]);
                if (driverRows.length > 0) driver = driverRows[0];
                if (routeRows.length > 0) route = routeRows[0];
            } catch (e) {}
        }

        if (!driver || !route) {
            return res.status(404).json({ success: false, message: 'Driver or Route not found.' });
        }

        // Fatigue Risk Heuristic Algorithm
        const driverRest = typeof driver.rest_hours === 'number' ? driver.rest_hours : parseFloat(driver.rest_hours || 8);
        const driverFatigue = typeof driver.fatigue_level === 'number' ? driver.fatigue_level : parseFloat(driver.fatigue_level || 20);
        const routeDiff = typeof route.difficulty === 'number' ? route.difficulty : parseFloat(route.difficulty || 4);

        let restPenalty = driverRest < 8 ? 25 : (driverRest < 10 ? 15 : 0);
        let terrainMultiplier = route.terrain === 'Ghat' ? 1.4 : (route.terrain === 'Urban' ? 1.2 : 1.0);
        let calculatedRisk = Math.min(100, Math.round((driverFatigue * 0.5) + (routeDiff * 6 * terrainMultiplier * 0.3) + restPenalty));

        const shiftId = `SHF${Date.now().toString().slice(-4)}`;

        // Save in MongoDB
        if (mongoShifts) {
            await mongoShifts.insertOne({
                id: shiftId,
                driver_id: driverId,
                conductor_id: conductorId,
                route_id: routeId,
                bus_number: busNumber || null,
                shift_date: new Date(date),
                start_time: startTime.length === 5 ? `${startTime}:00` : startTime,
                end_time: endTime.length === 5 ? `${endTime}:00` : endTime,
                status: 'Scheduled',
                fatigue_risk: calculatedRisk,
                notes: notes || 'Scheduled via TGSRTC Dispatch',
                created_at: new Date(),
                updated_at: new Date()
            });

            if (calculatedRisk >= 80 && mongoAlerts) {
                const alertId = `ALT-${Date.now().toString().slice(-4)}`;
                await mongoAlerts.insertOne({
                    id: alertId,
                    alert_type: 'critical',
                    title: 'High Fatigue Risk Assignment',
                    message: `Shift ${shiftId} on Route ${routeId} has a high fatigue risk score of ${calculatedRisk}%. Caution advised.`,
                    time_ago: 'Just now',
                    acknowledged: 0,
                    driver_id: driverId,
                    created_at: new Date(),
                    updated_at: new Date()
                });
            }
        }

        // Also save to MySQL pool if available
        try {
            await pool.query(
                `INSERT INTO shifts (id, driver_id, conductor_id, route_id, bus_number, shift_date, start_time, end_time, status, fatigue_risk, notes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Scheduled', ?, ?)`,
                [shiftId, driverId, conductorId, routeId, busNumber || null, date, startTime, endTime, calculatedRisk, notes || 'Scheduled via TGSRTC Dispatch']
            );

            if (calculatedRisk >= 80) {
                const alertId = `ALT-${Date.now().toString().slice(-4)}`;
                await pool.query(
                    `INSERT INTO alerts (id, alert_type, title, message, time_ago, acknowledged, driver_id)
                     VALUES (?, 'critical', 'High Fatigue Risk Assignment', ?, 'Just now', FALSE, ?)`,
                    [alertId, `Shift ${shiftId} on Route ${routeId} has a high fatigue risk score of ${calculatedRisk}%. Caution advised.`, driverId]
                );
            }
        } catch (dbErr) {}

        res.status(201).json({
            success: true,
            message: `Shift ${shiftId} scheduled successfully. Calculated fatigue risk: ${calculatedRisk}%`,
            id: shiftId,
            fatigueRisk: calculatedRisk
        });
    } catch (err) {
        console.error('Error scheduling shift:', err);
        res.status(500).json({ success: false, message: err.message || 'Failed to schedule shift', error: err.message });
    }
};

// Update Shift Status (e.g. Scheduled -> Active -> Completed)
export const updateShiftStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const validStatuses = ['Scheduled', 'Active', 'Completed', 'Cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: `Status must be one of: ${validStatuses.join(', ')}` });
        }

        let shift = null;

        // Try MongoDB first
        const mongoShifts = getMongoCollection('shifts');
        const mongoStaff = getMongoCollection('staff');

        if (mongoShifts) {
            shift = await mongoShifts.findOne({ id });
            if (shift) {
                await mongoShifts.updateOne({ id }, { $set: { status, updated_at: new Date() } });

                if (mongoStaff) {
                    if (status === 'Active') {
                        await mongoStaff.updateMany(
                            { id: { $in: [shift.driver_id, shift.conductor_id] } },
                            { $set: { status: 'On Duty', assigned_route: shift.route_id, updated_at: new Date() } }
                        );
                    } else if (status === 'Completed' || status === 'Cancelled') {
                        await mongoStaff.updateMany(
                            { id: { $in: [shift.driver_id, shift.conductor_id] } },
                            { $set: { status: 'Off Duty', assigned_route: null, updated_at: new Date() } }
                        );
                    }
                }
            }
        }

        // Try MySQL fallback/sync
        try {
            const [shiftRows] = await pool.query('SELECT * FROM shifts WHERE id = ?', [id]);
            if (shiftRows.length > 0) {
                const s = shiftRows[0];
                await pool.query('UPDATE shifts SET status = ? WHERE id = ?', [status, id]);
                if (status === 'Active') {
                    await pool.query("UPDATE staff SET status = 'On Duty', assigned_route = ? WHERE id IN (?, ?)", [s.route_id, s.driver_id, s.conductor_id]);
                } else if (status === 'Completed' || status === 'Cancelled') {
                    await pool.query("UPDATE staff SET status = 'Off Duty', assigned_route = NULL WHERE id IN (?, ?)", [s.driver_id, s.conductor_id]);
                }
                if (!shift) shift = s;
            }
        } catch (dbErr) {}

        if (!shift) {
            return res.status(404).json({ success: false, message: 'Shift not found.' });
        }

        res.json({ success: true, message: `Shift ${id} updated to ${status}.` });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to update shift status', error: err.message });
    }
};
