import pool from '../config/db.js';

// Get Alerts
export const getAllAlerts = async (req, res) => {
    try {
        const { type, acknowledged } = req.query;
        let query = 'SELECT a.*, s.name as driver_name FROM alerts a LEFT JOIN staff s ON a.driver_id = s.id WHERE 1=1';
        const params = [];

        if (type) {
            query += ' AND a.alert_type = ?';
            params.push(type);
        }
        if (acknowledged !== undefined) {
            query += ' AND a.acknowledged = ?';
            params.push(acknowledged === 'true' ? 1 : 0);
        }

        query += ' ORDER BY a.created_at DESC, a.id DESC';
        const [rows] = await pool.query(query, params);

        const formatted = rows.map(r => ({
            id: r.id,
            type: r.alert_type,
            title: r.title,
            message: r.message,
            time: r.time_ago,
            acknowledged: Boolean(r.acknowledged),
            driverId: r.driver_id,
            driverName: r.driver_name
        }));

        res.json({ success: true, count: formatted.length, data: formatted });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch alerts', error: err.message });
    }
};

// Acknowledge alert
export const acknowledgeAlert = async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('UPDATE alerts SET acknowledged = TRUE WHERE id = ?', [id]);
        res.json({ success: true, message: `Alert ${id} acknowledged.` });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to acknowledge alert', error: err.message });
    }
};

// Get Incidents
export const getAllIncidents = async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT i.*, s.name as driver_name, r.name as route_name 
            FROM incidents i 
            LEFT JOIN staff s ON i.driver_id = s.id 
            LEFT JOIN routes r ON i.route_id = r.id
            ORDER BY i.incident_date DESC
        `);

        const formatted = rows.map(r => ({
            id: r.id,
            date: r.incident_date ? r.incident_date.toISOString().split('T')[0] : null,
            type: r.incident_type,
            severity: r.severity,
            driverId: r.driver_id,
            driverName: r.driver_name,
            routeId: r.route_id,
            routeName: r.route_name,
            cause: r.cause,
            fatigueRelated: Boolean(r.fatigue_related),
            description: r.description
        }));

        res.json({ success: true, count: formatted.length, data: formatted });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch incidents', error: err.message });
    }
};

// Get Monthly Analytics
export const getMonthlyAnalytics = async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM monthly_analytics ORDER BY id ASC');
        const formatted = rows.map(r => ({
            month: r.month,
            avgFatigue: r.avg_fatigue,
            absenteeism: parseFloat(r.absenteeism),
            incidents: r.incidents,
            shiftCompliance: r.shift_compliance,
            delays: r.delays,
            satisfaction: r.satisfaction
        }));
        res.json({ success: true, data: formatted });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch monthly analytics', error: err.message });
    }
};

// Summary KPIs for Dashboard
export const getDashboardSummary = async (req, res) => {
    try {
        const [[staffStats]] = await pool.query(`
            SELECT 
                COUNT(*) as totalStaff,
                SUM(CASE WHEN role = 'Driver' THEN 1 ELSE 0 END) as totalDrivers,
                SUM(CASE WHEN role = 'Conductor' THEN 1 ELSE 0 END) as totalConductors,
                SUM(CASE WHEN status = 'On Duty' THEN 1 ELSE 0 END) as onDuty,
                AVG(CASE WHEN role = 'Driver' THEN fatigue_level ELSE NULL END) as avgDriverFatigue,
                SUM(CASE WHEN fatigue_level >= 75 THEN 1 ELSE 0 END) as highFatigueCount
            FROM staff
        `);

        const [[shiftStats]] = await pool.query(`
            SELECT 
                COUNT(*) as totalShifts,
                SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) as activeShifts,
                SUM(CASE WHEN status = 'Scheduled' THEN 1 ELSE 0 END) as scheduledShifts,
                SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as completedShifts,
                AVG(fatigue_risk) as avgFatigueRisk
            FROM shifts
        `);

        const [[alertStats]] = await pool.query(`
            SELECT 
                COUNT(*) as totalAlerts,
                SUM(CASE WHEN acknowledged = FALSE THEN 1 ELSE 0 END) as unacknowledgedAlerts,
                SUM(CASE WHEN alert_type = 'critical' AND acknowledged = FALSE THEN 1 ELSE 0 END) as criticalAlerts
            FROM alerts
        `);

        const [[incidentStats]] = await pool.query(`
            SELECT 
                COUNT(*) as totalIncidents,
                SUM(CASE WHEN fatigue_related = TRUE THEN 1 ELSE 0 END) as fatigueIncidents
            FROM incidents
        `);

        res.json({
            success: true,
            kpis: {
                totalStaff: staffStats.totalStaff || 0,
                totalDrivers: staffStats.totalDrivers || 0,
                totalConductors: staffStats.totalConductors || 0,
                onDuty: staffStats.onDuty || 0,
                avgDriverFatigue: Math.round(staffStats.avgDriverFatigue || 0),
                highFatigueCount: staffStats.highFatigueCount || 0,
                activeShifts: shiftStats.activeShifts || 0,
                scheduledShifts: shiftStats.scheduledShifts || 0,
                completedShifts: shiftStats.completedShifts || 0,
                avgFatigueRisk: Math.round(shiftStats.avgFatigueRisk || 0),
                unacknowledgedAlerts: alertStats.unacknowledgedAlerts || 0,
                criticalAlerts: alertStats.criticalAlerts || 0,
                totalIncidents: incidentStats.totalIncidents || 0,
                fatigueIncidents: incidentStats.fatigueIncidents || 0
            }
        });
    } catch (err) {
        console.error('Error fetching dashboard summary:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch dashboard summary', error: err.message });
    }
};
