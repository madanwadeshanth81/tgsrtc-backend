import pool, { mongoose } from '../config/db.js';

const getMongoCollection = (name) => {
    try {
        if (mongoose.connection && mongoose.connection.readyState === 1) {
            return mongoose.connection.collection(name);
        }
    } catch (e) {}
    return null;
};

// Get all routes joined with bus vehicle details and timings
export const getAllRoutes = async (req, res) => {
    try {
        const { terrain, minDifficulty } = req.query;

        // Try MongoDB first (Atlas cloud primary)
        const mongoRoutes = getMongoCollection('routes');
        const mongoBuses = getMongoCollection('buses');

        if (mongoRoutes) {
            const filter = {};
            if (terrain) filter.terrain = terrain;
            if (minDifficulty) filter.difficulty = { $gte: parseInt(minDifficulty) };

            const routesList = await mongoRoutes.find(filter).sort({ id: 1 }).toArray();
            const busesList = mongoBuses ? await mongoBuses.find({}).toArray() : [];

            const formatted = routesList.map(r => {
                const b = busesList.find(bus => bus.assigned_route_id === r.id);
                const routeIdStr = r.id ? String(r.id) : 'RTE-101';
                const routeNum = routeIdStr.replace('RTE-', '');
                const busNum = b?.fleet_code || r.bus_number || `BUS-${routeNum}`;
                const regNum = b?.bus_number || r.registration_number || `TS-09-Z-10${routeNum.slice(-2)}`;
                const busType = b?.bus_type || r.bus_type || 'Super Luxury Express';
                const depotName = b?.depot_name || r.depot_name || 'MGBS Depot';
                const firstBus = r.first_bus ? String(r.first_bus).slice(0, 5) : '05:30';
                const lastBus = r.last_bus ? String(r.last_bus).slice(0, 5) : '22:30';
                const frequencyMins = r.frequency_mins || 20;

                return {
                    id: r.id,
                    name: r.name,
                    origin: r.origin,
                    destination: r.destination,
                    distance: r.distance,
                    difficulty: r.difficulty,
                    trafficIndex: parseFloat(r.traffic_index) || 0,
                    avgDuration: r.avg_duration,
                    terrain: r.terrain,
                    incidents: r.incidents_count || 0,
                    avgDelay: r.avg_delay || 0,
                    busNumber: busNum,
                    registrationNumber: regNum,
                    busType: busType,
                    depotName: depotName,
                    firstBus: firstBus,
                    lastBus: lastBus,
                    frequencyMins: frequencyMins,
                    busTimings: `${firstBus} AM – ${lastBus} PM (Every ${frequencyMins}m)`
                };
            });

            return res.json({ success: true, count: formatted.length, data: formatted });
        }

        // MariaDB Fallback
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
            trafficIndex: parseFloat(r.traffic_index) || 0,
            avgDuration: r.avg_duration,
            terrain: r.terrain,
            incidents: r.incidents_count || 0,
            avgDelay: r.avg_delay || 0,
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

        // Sync with MongoDB
        const mongoRoutes = getMongoCollection('routes');
        if (mongoRoutes) {
            await mongoRoutes.updateOne(
                { id },
                {
                    $set: {
                        id,
                        name,
                        origin,
                        destination,
                        distance: distance || 100,
                        difficulty: difficulty || 4,
                        traffic_index: trafficIndex || 5.0,
                        avg_duration: avgDuration || 120,
                        terrain: terrain || 'Highway',
                        first_bus: firstBus || '05:30:00',
                        last_bus: lastBus || '22:30:00',
                        frequency_mins: frequencyMins || 20,
                        incidents_count: 0,
                        avg_delay: 0,
                        updated_at: new Date()
                    },
                    $setOnInsert: { created_at: new Date() }
                },
                { upsert: true }
            );
        }

        // Sync with MariaDB if available
        try {
            await pool.query(
                `INSERT INTO routes (id, name, origin, destination, distance, difficulty, traffic_index, avg_duration, terrain, first_bus, last_bus, frequency_mins)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE name=VALUES(name), origin=VALUES(origin), destination=VALUES(destination)`,
                [
                    id, name, origin, destination, distance || 100, difficulty || 4,
                    trafficIndex || 5.0, avgDuration || 120, terrain || 'Highway',
                    firstBus || '05:30:00', lastBus || '22:30:00', frequencyMins || 20
                ]
            );
        } catch (dbErr) {}

        res.status(201).json({ success: true, message: `Route ${id} created successfully.` });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to create route', error: err.message });
    }
};
