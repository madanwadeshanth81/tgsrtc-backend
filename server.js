import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes.js';
import staffRoutes from './routes/staffRoutes.js';
import routesRoutes from './routes/routesRoutes.js';
import shiftsRoutes from './routes/shiftsRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

// Middlewares
app.use(helmet());
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Request logging
app.use((req, res, next) => {
    console.log(`[API ${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
    next();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'ONLINE',
        system: 'TGSRTC Shift & Fatigue Management Server',
        timestamp: new Date().toISOString()
    });
});

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/routes', routesRoutes);
app.use('/api/shifts', shiftsRoutes);
app.use('/api/ops', analyticsRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('[UNHANDLED SERVER ERROR]', err);
    res.status(500).json({ success: false, message: 'Internal Server Error', error: err.message });
});

// Start Server
app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`  TGSRTC Shift Management API Server`);
    console.log(`  Status: RUNNING`);
    console.log(`  URL: http://localhost:${PORT}`);
    console.log(`====================================================`);
});
