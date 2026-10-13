import pool from '../config/db.js';

// Get all routes joined with bus vehicle details and timings
export const getAllRoutes = async (req, res) => {
    try {
        const { terrain, minDifficulty } = req.query;
        let query = `
            SELECT r.*, 
                   b.bus_number as registration_number,
                   b.fleet_code as bus_number,
                   b.bus_type,
                   b.depot_name,
                   b.status as bus_status
            FROM routes r
            LEFT JOIN buses b ON b.assigned_route_id = r.id
            WHERE 1=1
        `;
        const params = [];

        if (terrain) {
            query += ' AND r.terrain = ?';
            params.push(terrain);
        }
        if (minDifficulty) {
            query += ' AND r.difficulty >= ?';
            params.push(parseInt(minDifficulty));
        }

        query += ' ORDER BY r.id ASC';
        const [rows] = await pool.query(query, params);

        const formatted = rows.map(r => ({
            id: r.id,
            name: r.name,
            origin: r.origin,
            destination: r.destination,
            distance: r.distance,
            difficulty: r.difficulty,
            trafficIndex: parseFloat(r.traffic_index),
            avgDuration: r.avg_duration,
            terrain: r.terrain,
            incidents: r.incidents_count,
            avgDelay: r.avg_delay,
            // Bus Fleet & Timing additions
            busNumber: r.bus_number || `BUS-${r.id.replace('RTE-', '1')}`,
            registrationNumber: r.registration_number || `TS-09-Z-${r.id.replace('RTE-', '10')}`,
            busType: r.bus_type || 'Super Luxury Express',
            depotName: r.depot_name || 'MGBS Depot',
            firstBus: r.first_bus ? r.first_bus.slice(0, 5) : '05:30',
            lastBus: r.last_bus ? r.last_bus.slice(0, 5) : '22:30',
            frequencyMins: r.frequency_mins || 20,
            busTimings: `${r.first_bus ? r.first_bus.slice(0, 5) : '05:30'} AM – ${r.last_bus ? r.last_bus.slice(0, 5) : '10:30'} PM (Every ${r.frequency_mins || 20}m)`
        }));

        res.json({ success: true, count: formatted.length, data: formatted });
    } catch (err) {
        console.error('Error fetching routes:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch routes', error: err.message });
    }
};

// Create Route
export const createRoute = async (req, res) => {
    try {
        const { id, name, origin, destination, distance, difficulty, trafficIndex, avgDuration, terrain, firstBus, lastBus, frequencyMins } = req.body;
        if (!id || !name || !origin || !destination) {
            return res.status(400).json({ success: false, message: 'ID, name, origin, and destination are required.' });
        }

        await pool.query(
            `INSERT INTO routes (id, name, origin, destination, distance, difficulty, traffic_index, avg_duration, terrain, first_bus, last_bus, frequency_mins)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id, name, origin, destination, distance || 100, difficulty || 4,
                trafficIndex || 5.0, avgDuration || 120, terrain || 'Highway',
                firstBus || '05:30:00', lastBus || '22:30:00', frequencyMins || 20
            ]
        );

        res.status(201).json({ success: true, message: `Route ${id} created successfully.` });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to create route', error: err.message });
    }
};
