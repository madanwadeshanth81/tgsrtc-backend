import mongoose from 'mongoose';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import dns from 'dns';

// Ensure public DNS servers are used so MongoDB SRV records resolve cleanly on cloud providers
try {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) {}

dotenv.config();

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/tgsrtc_shift_management';

// Connect Mongoose to MongoDB Atlas
mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000
})
    .then(() => {
        console.log(`[MONGODB SUCCESS] Connected to MongoDB database successfully!`);
    })
    .catch(err => {
        console.error('[MONGODB ERROR] Failed to connect to MongoDB:', err.message);
    });

// Fallback dummy pool when running purely on MongoDB in the cloud
let mysqlPool = null;
if (process.env.DB_HOST && process.env.DB_HOST !== 'localhost') {
    try {
        mysqlPool = mysql.createPool({
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT || '3306'),
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'tgsrtc_shift_management',
            connectTimeout: 2000
        });
    } catch (e) {}
}

// Proxy pool that safely delegates to MongoDB when MySQL is not present
const safePool = {
    query: async (sql, params) => {
        if (mysqlPool) {
            try {
                return await mysqlPool.query(sql, params);
            } catch (err) {}
        }
        // Throw an error that triggers the clean MongoDB fallback logic in controllers
        throw new Error('MySQL not available on cloud instance. Fallback to MongoDB.');
    }
};

export const getMongoDb = () => mongoose.connection.db;
export { mongoose, safePool as mysqlPool };
export default safePool;
