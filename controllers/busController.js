import pool from '../config/db.js';

// Get all buses
export const getAllBuses = async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM buses ORDER BY bus_number ASC');
        const formatted = rows.map(r => ({
            busNumber: r.bus_number,
            depotName: r.depot_name,
            busType: r.bus_type,
            seatingCapacity: r.seating_capacity,
            status: r.status,
            fitnessExpiry: r.fitness_expiry ? r.fitness_expiry.toISOString().split('T')[0] : null,
            assignedRouteId: r.assigned_route_id
        }));
        res.json({ success: true, count: formatted.length, data: formatted });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch buses', error: err.message });
    }
};
