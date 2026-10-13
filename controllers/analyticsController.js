import pool, { mongoose } from '../config/db.js';

const getMongoCollection = (name) => {
    try {
        if (mongoose.connection && mongoose.connection.readyState === 1) {
            return mongoose.connection.collection(name);
        }
    } catch (e) {}
    return null;
};

// Get Alerts
export const getAllAlerts = async (req, res) => {
    try {
        const { type, acknowledged } = req.query;

        // Try MongoDB first (Atlas cloud primary)
        const mongoAlerts = getMongoCollection('alerts');
        const mongoStaff = getMongoCollection('staff');

        if (mongoAlerts) {
            const filter = {};
            if (type) filter.alert_type = type;
            if (acknowledged !== undefined) {
                const ackVal = (acknowledged === 'true' || acknowledged === true || acknowledged === 1 || acknowledged === '1');
                filter.$or = [{ acknowledged: ackVal }, { acknowledged: ackVal ? 1 : 0 }];
            }

            const alerts = await mongoAlerts.find(filter).sort({ created_at: -1, id: -1 }).toArray();
            const staffList = mongoStaff ? await mongoStaff.find({}).toArray() : [];

            const formatted = alerts.map(r => {
                const driver = staffList.find(s => s.id === r.driver_id);
                return {
                    id: r.id,
                    type: r.alert_type,
                    title: r.title,
                    message: r.message,
                    time: r.time_ago || 'Recently',
                    acknowledged: Boolean(r.acknowledged),
                    driverId: r.driver_id,
                    driverName: driver ? driver.name : null
                };
            });

            return res.json({ success: true, count: formatted.length, data: formatted });
        }

        // MariaDB Fallback
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

        // Try MongoDB first
        const mongoAlerts = getMongoCollection('alerts');
        if (mongoAlerts) {
            await mongoAlerts.updateOne({ id }, { $set: { acknowledged: 1, updated_at: new Date() } });
        }

        // Try MariaDB fallback/sync
        try {
            await pool.query('UPDATE alerts SET acknowledged = TRUE WHERE id = ?', [id]);
        } catch (dbErr) {}

        res.json({ success: true, message: `Alert ${id} acknowledged.` });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to acknowledge alert', error: err.message });
    }
};

// Get Incidents
export const getAllIncidents = async (req, res) => {
    try {
        // Try MongoDB first
        const mongoIncidents = getMongoCollection('incidents');
        const mongoStaff = getMongoCollection('staff');
        const mongoRoutes = getMongoCollection('routes');

        if (mongoIncidents) {
            const incidents = await mongoIncidents.find({}).sort({ incident_date: -1 }).toArray();
            const staffList = mongoStaff ? await mongoStaff.find({}).toArray() : [];
            const routesList = mongoRoutes ? await mongoRoutes.find({}).toArray() : [];

            const formatted = incidents.map(r => {
                const driver = staffList.find(s => s.id === r.driver_id);
                const route = routesList.find(rt => rt.id === r.route_id);
                return {
                    id: r.id,
                    date: r.incident_date ? new Date(r.incident_date).toISOString().split('T')[0] : null,
                    type: r.incident_type || r.severity || 'Incident',
                    severity: r.severity,
                    driverId: r.driver_id,
                    driverName: driver ? driver.name : null,
                    routeId: r.route_id,
                    routeName: route ? route.name : null,
                    cause: r.cause || r.description,
                    fatigueRelated: Boolean(r.fatigue_related),
                    description: r.description
                };
            });

            return res.json({ success: true, count: formatted.length, data: formatted });
        }

        // MariaDB Fallback
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
        // Try MongoDB first
        const mongoMonthly = getMongoCollection('monthly_analytics');
        if (mongoMonthly) {
            const rows = await mongoMonthly.find({}).sort({ id: 1 }).toArray();
            const formatted = rows.map(r => ({
                month: r.month,
                avgFatigue: r.avg_fatigue,
                absenteeism: parseFloat(r.absenteeism || 0),
                incidents: r.incidents,
                shiftCompliance: r.shift_compliance,
                delays: r.delays,
                satisfaction: r.satisfaction
            }));
            return res.json({ success: true, data: formatted });
        }

        // MariaDB Fallback
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
        // Try MongoDB first
        const mongoStaff = getMongoCollection('staff');
        const mongoShifts = getMongoCollection('shifts');
        const mongoAlerts = getMongoCollection('alerts');
        const mongoIncidents = getMongoCollection('incidents');

        if (mongoStaff && mongoShifts && mongoAlerts) {
            const staff = await mongoStaff.find({}).toArray();
            const shifts = await mongoShifts.find({}).toArray();
            const alerts = await mongoAlerts.find({}).toArray();
            const incidents = mongoIncidents ? await mongoIncidents.find({}).toArray() : [];

            const totalStaff = staff.length;
            const totalDrivers = staff.filter(s => s.role === 'Driver').length;
            const totalConductors = staff.filter(s => s.role === 'Conductor').length;
            const onDuty = staff.filter(s => s.status === 'On Duty').length;
            const drivers = staff.filter(s => s.role === 'Driver' && typeof s.fatigue_level === 'number');
            const avgDriverFatigue = drivers.length > 0
                ? Math.round(drivers.reduce((acc, d) => acc + (d.fatigue_level || 0), 0) / drivers.length)
                : 0;
            const highFatigueCount = staff.filter(s => (s.fatigue_level || 0) >= 75).length;

            const totalShifts = shifts.length;
            const activeShifts = shifts.filter(s => s.status === 'Active').length;
            const scheduledShifts = shifts.filter(s => s.status === 'Scheduled').length;
            const completedShifts = shifts.filter(s => s.status === 'Completed').length;
            const avgFatigueRisk = shifts.length > 0
                ? Math.round(shifts.reduce((acc, s) => acc + (parseFloat(s.fatigue_risk) || 0), 0) / shifts.length)
                : 0;

            const totalAlerts = alerts.length;
            const unacknowledgedAlerts = alerts.filter(a => !a.acknowledged || a.acknowledged === 0).length;
            const criticalAlerts = alerts.filter(a => a.alert_type === 'critical' && (!a.acknowledged || a.acknowledged === 0)).length;

            const totalIncidents = incidents.length;
            const fatigueIncidents = incidents.filter(i => Boolean(i.fatigue_related)).length;

            return res.json({
                success: true,
                kpis: {
                    totalStaff,
                    totalDrivers,
                    totalConductors,
                    onDuty,
                    avgDriverFatigue,
                    highFatigueCount,
                    activeShifts,
                    scheduledShifts,
                    completedShifts,
                    avgFatigueRisk,
                    unacknowledgedAlerts,
                    criticalAlerts,
                    totalIncidents,
                    fatigueIncidents
                }
            });
        }

        // MariaDB Fallback
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
