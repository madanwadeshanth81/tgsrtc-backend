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

        const [existing] = await pool.query('SELECT id FROM staff WHERE id = ?', [id]);
        if (existing.length > 0) {
            return res.status(409).json({ success: false, message: `Staff with ID ${id} already exists.` });
        }

        await pool.query(
            `INSERT INTO staff (id, name, role, age, experience, health_score, fatigue_level, status, assigned_route, hours_worked, rest_hours, phone, blood_group, last_health_check, join_date, depot_location)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), CURDATE(), ?)`,
            [
                id, name, role, age || 35, experience || 5, healthScore || 85,
                fatigueLevel || 20, status || 'Off Duty', assignedRoute || null,
                hoursWorked || 0, restHours || 12, phone, bloodGroup || 'O+', depotLocation || 'MGBS, Hyderabad'
            ]
        );

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

        const [staffRows] = await pool.query('SELECT * FROM staff WHERE id = ?', [id]);
        if (staffRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Staff member not found.' });
        }

        const staff = staffRows[0];
        const leaveReason = reason || 'Medical Emergency / Acute Fatigue';

        // Update staff status to 'Emergency Leave', deallocate route
        await pool.query(
            `UPDATE staff SET 
                status = 'Emergency Leave', 
                assigned_route = NULL, 
                leave_reason = ? 
             WHERE id = ?`,
            [leaveReason, id]
        );

        // Cancel or unassign any active/scheduled shifts for this staff
        await pool.query(
            `UPDATE shifts SET 
                status = 'Cancelled', 
                notes = CONCAT(COALESCE(notes, ''), ' [CANCELLED: Driver applied Emergency Leave]') 
             WHERE (driver_id = ? OR conductor_id = ?) AND status IN ('Active', 'Scheduled')`,
            [id, id]
        );

        // Generate high-priority dispatcher alert in alerts table
        const alertId = `ALT-${Date.now().toString().slice(-4)}`;
        await pool.query(
            `INSERT INTO alerts (id, alert_type, title, message, time_ago, acknowledged, driver_id)
             VALUES (?, 'critical', 'Emergency Leave Dispatched', ?, 'Just now', FALSE, ?)`,
            [alertId, `EMERGENCY LEAVE: ${staff.role} ${staff.name} (${id}) granted emergency leave. Reason: "${leaveReason}". Shifts unassigned.`, id]
        );

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

        const [current] = await pool.query('SELECT * FROM staff WHERE id = ?', [id]);
        if (current.length === 0) {
            return res.status(404).json({ success: false, message: 'Staff member not found.' });
        }

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
                assignedRoute !== undefined ? assignedRoute : current[0].assigned_route,
                healthScore !== undefined ? healthScore : null,
                id
            ]
        );

        // If fatigue level exceeds 80%, auto-generate critical alert
        if (fatigueLevel && fatigueLevel >= 80) {
            const alertId = `ALT-${Date.now().toString().slice(-4)}`;
            await pool.query(
                `INSERT INTO alerts (id, alert_type, title, message, time_ago, acknowledged, driver_id)
                 VALUES (?, 'critical', 'High Fatigue Alert', ?, 'Just now', FALSE, ?)`,
                [alertId, `${current[0].role} ${current[0].name} (${id}) reached high fatigue level (${fatigueLevel}%). Immediate rest recommended.`, id]
            );
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
        const [current] = await pool.query('SELECT id, name, role FROM staff WHERE id = ?', [id]);
        if (current.length === 0) {
            return res.status(404).json({ success: false, message: 'Staff member not found in database.' });
        }

        const staffMember = current[0];

        // Clean up any active/scheduled shift dependencies
        await pool.query(
            `UPDATE shifts SET 
                driver_id = CASE WHEN driver_id = ? THEN NULL ELSE driver_id END,
                conductor_id = CASE WHEN conductor_id = ? THEN NULL ELSE conductor_id END
             WHERE driver_id = ? OR conductor_id = ?`,
            [id, id, id, id]
        );

        // Clean up alerts
        await pool.query('DELETE FROM alerts WHERE driver_id = ?', [id]);

        // Clean up incidents driver reference if any
        await pool.query('UPDATE incidents SET driver_id = NULL WHERE driver_id = ?', [id]);

        // Delete from staff table
        await pool.query('DELETE FROM staff WHERE id = ?', [id]);

        // Clean up user account if matching employee_id exists
        await pool.query('DELETE FROM users WHERE employee_id = ?', [id]);

        // Sync deletion in MongoDB
        const mongoStaff = getMongoCollection('staff');
        if (mongoStaff) await mongoStaff.deleteOne({ id });
        const mongoUsers = getMongoCollection('users');
        if (mongoUsers) await mongoUsers.deleteOne({ employee_id: id });
        const mongoAlerts = getMongoCollection('alerts');
        if (mongoAlerts) await mongoAlerts.deleteMany({ driver_id: id });

        console.log(`[STAFF] Deleted ${staffMember.role} '${staffMember.name}' (${id}) from MariaDB & MongoDB`);

        res.json({
            success: true,
            message: `${staffMember.role} '${staffMember.name}' (${id}) deleted successfully from database.`
        });
    } catch (err) {
        console.error('Delete staff error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete staff member', error: err.message });
    }
};
