import mongoose from 'mongoose';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/tgsrtc_shift_management';

// Connect Mongoose to local MongoDB
mongoose.connect(mongoUri)
    .then(() => {
        console.log(`[MONGODB SUCCESS] Connected to MongoDB database: tgsrtc_shift_management at ${mongoUri}`);
    })
    .catch(err => {
        console.error('[MONGODB ERROR] Failed to connect to MongoDB:', err.message);
    });

// Also keep MySQL pool for dual sync if needed
const mysqlPool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'tgsrtc_shift_management',
    waitForConnections: true,
    connectionLimit: 10
});

export const getMongoDb = () => mongoose.connection.db;
export { mongoose, mysqlPool };
export default mysqlPool;
