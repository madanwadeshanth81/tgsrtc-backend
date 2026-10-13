import pool from '../config/db.js';

// Get shifts with driver, conductor, route joins
export const getAllShifts = async (req, res) => {
    try {
        const { date, status, driverId } = req.query;
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

        // Fetch driver and route to evaluate fatigue risk
        const [driverRows] = await pool.query('SELECT fatigue_level, rest_hours, hours_worked FROM staff WHERE id = ?', [driverId]);
        const [routeRows] = await pool.query('SELECT difficulty, terrain, distance FROM routes WHERE id = ?', [routeId]);

        if (driverRows.length === 0 || routeRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Driver or Route not found.' });
        }

        const driver = driverRows[0];
        const route = routeRows[0];

        // Fatigue Risk Heuristic Algorithm
        // Base = driver current fatigue (50% weight) + route difficulty factor (30% weight) + low rest penalty (20% weight)
        let restPenalty = driver.rest_hours < 8 ? 25 : (driver.rest_hours < 10 ? 15 : 0);
        let terrainMultiplier = route.terrain === 'Ghat' ? 1.4 : (route.terrain === 'Urban' ? 1.2 : 1.0);
        let calculatedRisk = Math.min(100, Math.round((driver.fatigue_level * 0.5) + (route.difficulty * 6 * terrainMultiplier * 0.3) + restPenalty));

        // Verify busNumber exists in buses table if provided, otherwise set to null
        let validatedBusNumber = null;
        if (busNumber && busNumber.trim()) {
            const [busRows] = await pool.query('SELECT bus_number FROM buses WHERE bus_number = ?', [busNumber.trim()]);
            if (busRows.length > 0) {
                validatedBusNumber = busRows[0].bus_number;
            }
        }

        const shiftId = `SHF${Date.now().toString().slice(-4)}`;

        await pool.query(
            `INSERT INTO shifts (id, driver_id, conductor_id, route_id, bus_number, shift_date, start_time, end_time, status, fatigue_risk, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Scheduled', ?, ?)`,
            [shiftId, driverId, conductorId, routeId, validatedBusNumber, date, startTime, endTime, calculatedRisk, notes || 'Scheduled via TGSRTC Dispatch']
        );

        // If calculated risk > 80%, create an automated fatigue alert
        if (calculatedRisk >= 80) {
            const alertId = `ALT-${Date.now().toString().slice(-4)}`;
            await pool.query(
                `INSERT INTO alerts (id, alert_type, title, message, time_ago, acknowledged, driver_id)
                 VALUES (?, 'critical', 'High Fatigue Risk Assignment', ?, 'Just now', FALSE, ?)`,
                [alertId, `Shift ${shiftId} on Route ${routeId} has a high fatigue risk score of ${calculatedRisk}%. Caution advised.`, driverId]
            );
        }

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

        const [shiftRows] = await pool.query('SELECT * FROM shifts WHERE id = ?', [id]);
        if (shiftRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Shift not found.' });
        }

        const shift = shiftRows[0];
        await pool.query('UPDATE shifts SET status = ? WHERE id = ?', [status, id]);

        // When shift is Active, update staff status to On Duty
        if (status === 'Active') {
            await pool.query("UPDATE staff SET status = 'On Duty', assigned_route = ? WHERE id IN (?, ?)", [shift.route_id, shift.driver_id, shift.conductor_id]);
        } else if (status === 'Completed' || status === 'Cancelled') {
            await pool.query("UPDATE staff SET status = 'Off Duty', assigned_route = NULL WHERE id IN (?, ?)", [shift.driver_id, shift.conductor_id]);
        }

        res.json({ success: true, message: `Shift ${id} updated to ${status}.` });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to update shift status', error: err.message });
    }
};
