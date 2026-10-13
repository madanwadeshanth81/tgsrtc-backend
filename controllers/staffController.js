import pool, { mongoose } from '../config/db.js';

const getMongoCollection = (name) => {
    try {
        if (mongoose.connection && mongoose.connection.readyState === 1) {
            return mongoose.connection.collection(name);
        }
    } catch (e) {}
    return null;
};

// Get all staff (drivers & conductors) with filtering
export const getAllStaff = async (req, res) => {
    try {
        const { role, status, minFatigue } = req.query;

        // Try MongoDB first (Atlas cloud primary)
        const mongoStaff = getMongoCollection('staff');
        if (mongoStaff) {
            const filter = {};
            if (role) filter.role = role;
            if (status) filter.status = status;
            if (minFatigue) filter.fatigue_level = { $gte: parseInt(minFatigue) };

            const rows = await mongoStaff.find(filter).sort({ fatigue_level: -1, name: 1 }).toArray();
            const formatted = rows.map(r => ({
                id: r.id,
                name: r.name,
                role: r.role,
                age: r.age,
                experience: r.experience,
                healthScore: r.health_score,
                fatigueLevel: r.fatigue_level,
                status: r.status,
                assignedRoute: r.assigned_route,
                hoursWorked: parseFloat(r.hours_worked || 0),
                restHours: parseFloat(r.rest_hours || 0),
                phone: r.phone,
                bloodGroup: r.blood_group,
                lastHealthCheck: r.last_health_check ? new Date(r.last_health_check).toISOString().split('T')[0] : null,
                joinDate: r.join_date ? new Date(r.join_date).toISOString().split('T')[0] : null,
                depotLocation: r.depot_location,
                leaveReason: r.leave_reason || null
            }));
            return res.json({ success: true, count: formatted.length, data: formatted });
        }

        // MariaDB Fallback
        let query = 'SELECT * FROM staff WHERE 1=1';
        const params = [];

        if (role) {
            query += ' AND role = ?';
            params.push(role);
        }
        if (status) {
            query += ' AND status = ?';
            params.push(status);
        }
        if (minFatigue) {
            query += ' AND fatigue_level >= ?';
            params.push(parseInt(minFatigue));
        }

        query += ' ORDER BY fatigue_level DESC, name ASC';
        const [rows] = await pool.query(query, params);

        const formatted = rows.map(r => ({
            id: r.id,
            name: r.name,
            role: r.role,
            age: r.age,
            experience: r.experience,
            healthScore: r.health_score,
            fatigueLevel: r.fatigue_level,
            status: r.status,
            assignedRoute: r.assigned_route,
            hoursWorked: parseFloat(r.hours_worked),
            restHours: parseFloat(r.rest_hours),
            phone: r.phone,
            bloodGroup: r.blood_group,
            lastHealthCheck: r.last_health_check ? r.last_health_check.toISOString().split('T')[0] : null,
            joinDate: r.join_date ? r.join_date.toISOString().split('T')[0] : null,
            depotLocation: r.depot_location,
            leaveReason: r.leave_reason || null
        }));

        res.json({ success: true, count: formatted.length, data: formatted });
    } catch (err) {
        console.error('Error fetching staff:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch staff directory', error: err.message });
    }
};

// Get single staff by ID
export const getStaffById = async (req, res) => {
    try {
        const { id } = req.params;

        // Try MongoDB first
        const mongoStaff = getMongoCollection('staff');
        if (mongoStaff) {
            const r = await mongoStaff.findOne({ id });
            if (r) {
                return res.json({
                    success: true,
                    data: {
                        id: r.id,
                        name: r.name,
                        role: r.role,
                        age: r.age,
                        experience: r.experience,
                        healthScore: r.health_score,
                        fatigueLevel: r.fatigue_level,
                        status: r.status,
                        assignedRoute: r.assigned_route,
                        hoursWorked: parseFloat(r.hours_worked || 0),
                        restHours: parseFloat(r.rest_hours || 0),
                        phone: r.phone,
                        bloodGroup: r.blood_group,
                        lastHealthCheck: r.last_health_check ? new Date(r.last_health_check).toISOString().split('T')[0] : null,
                        joinDate: r.join_date ? new Date(r.join_date).toISOString().split('T')[0] : null,
                        depotLocation: r.depot_location,
                        leaveReason: r.leave_reason || null
                    }
                });
            }
        }

        // MariaDB Fallback
        const [rows] = await pool.query('SELECT * FROM staff WHERE id = ?', [id]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Staff member not found.' });
        }
        const r = rows[0];
        res.json({
            success: true,
            data: {
                id: r.id,
                name: r.name,
                role: r.role,
                age: r.age,
                experience: r.experience,
                healthScore: r.health_score,
                fatigueLevel: r.fatigue_level,
                status: r.status,
                assignedRoute: r.assigned_route,
                hoursWorked: parseFloat(r.hours_worked),
                restHours: parseFloat(r.rest_hours),
                phone: r.phone,
                bloodGroup: r.blood_group,
                lastHealthCheck: r.last_health_check ? r.last_health_check.toISOString().split('T')[0] : null,
                joinDate: r.join_date ? r.join_date.toISOString().split('T')[0] : null,
                depotLocation: r.depot_location,
                leaveReason: r.leave_reason || null
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch staff record', error: err.message });
    }
};

// Create new Driver / Conductor
export const createStaff = async (req, res) => {
    try {
        const { id, name, role, age, experience, healthScore, fatigueLevel, status, assignedRoute, hoursWorked, restHours, phone, bloodGroup, depotLocation } = req.body;

        if (!id || !name || !role || !phone) {
            return res.status(400).json({ success: false, message: 'ID, name, role, and phone are mandatory.' });
        }

        // Try MongoDB first
        const mongoStaff = getMongoCollection('staff');
        if (mongoStaff) {
            const existing = await mongoStaff.findOne({ id });
            if (existing) {
                return res.status(409).json({ success: false, message: `Staff with ID ${id} already exists.` });
            }

            await mongoStaff.insertOne({
                id,
                name,
                role,
                age: age || 35,
                experience: experience || 5,
                health_score: healthScore || 85,
                fatigue_level: fatigueLevel || 20,
                status: status || 'Off Duty',
                assigned_route: assignedRoute || null,
                hours_worked: hoursWorked || 0,
                rest_hours: restHours || 12,
                phone,
                blood_group: bloodGroup || 'O+',
                last_health_check: new Date(),
                join_date: new Date(),
                depot_location: depotLocation || 'MGBS, Hyderabad',
                created_at: new Date(),
                updated_at: new Date()
            });
        }

        // Sync with MariaDB if available
        try {
            const [existing] = await pool.query('SELECT id FROM staff WHERE id = ?', [id]);
            if (existing.length === 0) {
                await pool.query(
                    `INSERT INTO staff (id, name, role, age, experience, health_score, fatigue_level, status, assigned_route, hours_worked, rest_hours, phone, blood_group, last_health_check, join_date, depot_location)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), CURDATE(), ?)`,
                    [
                        id, name, role, age || 35, experience || 5, healthScore || 85,
                        fatigueLevel || 20, status || 'Off Duty', assignedRoute || null,
                        hoursWorked || 0, restHours || 12, phone, bloodGroup || 'O+', depotLocation || 'MGBS, Hyderabad'
                    ]
                );
            }
        } catch (dbErr) {}

        res.status(201).json({ success: true, message: `${role} ${name} enrolled successfully.`, id });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to register staff', error: err.message });
    }
};

// Apply Emergency Leave
export const applyEmergencyLeave = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const leaveReason = reason || 'Medical Emergency / Acute Fatigue';

        let staff = null;

        // Try MongoDB first
        const mongoStaff = getMongoCollection('staff');
        const mongoShifts = getMongoCollection('shifts');
        const mongoAlerts = getMongoCollection('alerts');

        if (mongoStaff) {
            staff = await mongoStaff.findOne({ id });
            if (staff) {
                await mongoStaff.updateOne(
                    { id },
                    { $set: { status: 'Emergency Leave', assigned_route: null, leave_reason: leaveReason, updated_at: new Date() } }
                );

                if (mongoShifts) {
                    await mongoShifts.updateMany(
                        { $or: [{ driver_id: id }, { conductor_id: id }], status: { $in: ['Active', 'Scheduled'] } },
                        { $set: { status: 'Cancelled', notes: `[CANCELLED: Staff applied Emergency Leave]`, updated_at: new Date() } }
                    );
                }

                if (mongoAlerts) {
                    const alertId = `ALT-${Date.now().toString().slice(-4)}`;
                    await mongoAlerts.insertOne({
                        id: alertId,
                        alert_type: 'critical',
                        title: 'Emergency Leave Dispatched',
                        message: `EMERGENCY LEAVE: ${staff.role} ${staff.name} (${id}) granted emergency leave. Reason: "${leaveReason}". Shifts unassigned.`,
                        time_ago: 'Just now',
                        acknowledged: 0,
                        driver_id: id,
                        created_at: new Date(),
                        updated_at: new Date()
                    });
                }
            }
        }

        // Try MariaDB fallback / sync
        try {
            const [staffRows] = await pool.query('SELECT * FROM staff WHERE id = ?', [id]);
            if (staffRows.length > 0) {
                const s = staffRows[0];
                if (!staff) staff = s;
                await pool.query(
                    `UPDATE staff SET status = 'Emergency Leave', assigned_route = NULL, leave_reason = ? WHERE id = ?`,
                    [leaveReason, id]
                );
                await pool.query(
                    `UPDATE shifts SET status = 'Cancelled', notes = CONCAT(COALESCE(notes, ''), ' [CANCELLED: Staff applied Emergency Leave]') WHERE (driver_id = ? OR conductor_id = ?) AND status IN ('Active', 'Scheduled')`,
                    [id, id]
                );
                const alertId = `ALT-${Date.now().toString().slice(-4)}`;
                await pool.query(
                    `INSERT INTO alerts (id, alert_type, title, message, time_ago, acknowledged, driver_id) VALUES (?, 'critical', 'Emergency Leave Dispatched', ?, 'Just now', FALSE, ?)`,
                    [alertId, `EMERGENCY LEAVE: ${s.role} ${s.name} (${id}) granted emergency leave. Reason: "${leaveReason}". Shifts unassigned.`, id]
                );
            }
        } catch (dbErr) {}

        if (!staff) {
            return res.status(404).json({ success: false, message: 'Staff member not found.' });
        }

        res.json({
            success: true,
            message: `Emergency Leave applied for ${staff.name} (${id}). Roster unassigned and depot supervisor alerted.`,
            leaveReason
        });
    } catch (err) {
        console.error('Error applying emergency leave:', err);
        res.status(500).json({ success: false, message: 'Failed to process emergency leave', error: err.message });
    }
};

// Update Staff (Status, Fatigue, Hours, Health)
export const updateStaff = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, fatigueLevel, hoursWorked, restHours, assignedRoute, healthScore } = req.body;

        let current = null;

        // Try MongoDB first
        const mongoStaff = getMongoCollection('staff');
        const mongoAlerts = getMongoCollection('alerts');

        if (mongoStaff) {
            current = await mongoStaff.findOne({ id });
            if (current) {
                const updateDoc = { updated_at: new Date() };
                if (status !== undefined) updateDoc.status = status;
                if (fatigueLevel !== undefined) updateDoc.fatigue_level = fatigueLevel;
                if (hoursWorked !== undefined) updateDoc.hours_worked = hoursWorked;
                if (restHours !== undefined) updateDoc.rest_hours = restHours;
                if (assignedRoute !== undefined) updateDoc.assigned_route = assignedRoute;
                if (healthScore !== undefined) updateDoc.health_score = healthScore;

                await mongoStaff.updateOne({ id }, { $set: updateDoc });

                if (fatigueLevel && fatigueLevel >= 80 && mongoAlerts) {
                    const alertId = `ALT-${Date.now().toString().slice(-4)}`;
                    await mongoAlerts.insertOne({
                        id: alertId,
                        alert_type: 'critical',
                        title: 'High Fatigue Alert',
                        message: `${current.role} ${current.name} (${id}) reached high fatigue level (${fatigueLevel}%). Immediate rest recommended.`,
                        time_ago: 'Just now',
                        acknowledged: 0,
                        driver_id: id,
                        created_at: new Date(),
                        updated_at: new Date()
                    });
                }
            }
        }

        // Try MariaDB fallback/sync
        try {
            const [rows] = await pool.query('SELECT * FROM staff WHERE id = ?', [id]);
            if (rows.length > 0) {
                if (!current) current = rows[0];
                await pool.query(
                    `UPDATE staff SET 
                        status = COALESCE(?, status),
                        fatigue_level = COALESCE(?, fatigue_level),
                        hours_worked = COALESCE(?, hours_worked),
                        rest_hours = COALESCE(?, rest_hours),
                        assigned_route = ?,
                        health_score = COALESCE(?, health_score)
                     WHERE id = ?`,
                    [
                        status !== undefined ? status : null,
                        fatigueLevel !== undefined ? fatigueLevel : null,
                        hoursWorked !== undefined ? hoursWorked : null,
                        restHours !== undefined ? restHours : null,
                        assignedRoute !== undefined ? assignedRoute : rows[0].assigned_route,
                        healthScore !== undefined ? healthScore : null,
                        id
                    ]
                );

                if (fatigueLevel && fatigueLevel >= 80) {
                    const alertId = `ALT-${Date.now().toString().slice(-4)}`;
                    await pool.query(
                        `INSERT INTO alerts (id, alert_type, title, message, time_ago, acknowledged, driver_id)
                         VALUES (?, 'critical', 'High Fatigue Alert', ?, 'Just now', FALSE, ?)`,
                        [alertId, `${rows[0].role} ${rows[0].name} (${id}) reached high fatigue level (${fatigueLevel}%). Immediate rest recommended.`, id]
                    );
                }
            }
        } catch (dbErr) {}

        if (!current) {
            return res.status(404).json({ success: false, message: 'Staff member not found.' });
        }

        res.json({ success: true, message: `Staff ${id} updated successfully.` });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to update staff record', error: err.message });
    }
};

// Delete staff member (Driver or Conductor)
export const deleteStaff = async (req, res) => {
    try {
        const { id } = req.params;

        let staffMember = null;

        // Clean up in MongoDB
        const mongoStaff = getMongoCollection('staff');
        const mongoUsers = getMongoCollection('users');
        const mongoAlerts = getMongoCollection('alerts');
        const mongoShifts = getMongoCollection('shifts');

        if (mongoStaff) {
            staffMember = await mongoStaff.findOne({ id });
            if (staffMember) {
                await mongoStaff.deleteOne({ id });
                if (mongoUsers) await mongoUsers.deleteOne({ employee_id: id });
                if (mongoAlerts) await mongoAlerts.deleteMany({ driver_id: id });
                if (mongoShifts) {
                    await mongoShifts.updateMany({ driver_id: id }, { $set: { driver_id: null } });
                    await mongoShifts.updateMany({ conductor_id: id }, { $set: { conductor_id: null } });
                }
            }
        }

        // Clean up in MariaDB
        try {
            const [current] = await pool.query('SELECT id, name, role FROM staff WHERE id = ?', [id]);
            if (current.length > 0) {
                if (!staffMember) staffMember = current[0];
                await pool.query(
                    `UPDATE shifts SET 
                        driver_id = CASE WHEN driver_id = ? THEN NULL ELSE driver_id END,
                        conductor_id = CASE WHEN conductor_id = ? THEN NULL ELSE conductor_id END
                     WHERE driver_id = ? OR conductor_id = ?`,
                    [id, id, id, id]
                );
                await pool.query('DELETE FROM alerts WHERE driver_id = ?', [id]);
                await pool.query('UPDATE incidents SET driver_id = NULL WHERE driver_id = ?', [id]);
                await pool.query('DELETE FROM staff WHERE id = ?', [id]);
                await pool.query('DELETE FROM users WHERE employee_id = ?', [id]);
            }
        } catch (dbErr) {}

        if (!staffMember) {
            return res.status(404).json({ success: false, message: 'Staff member not found in database.' });
        }

        res.json({
            success: true,
            message: `${staffMember.role} '${staffMember.name}' (${id}) deleted successfully from database.`
        });
    } catch (err) {
        console.error('Delete staff error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete staff member', error: err.message });
    }
};
