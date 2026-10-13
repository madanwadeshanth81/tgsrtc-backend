import express from 'express';
import { getAllAlerts, acknowledgeAlert, getAllIncidents, getMonthlyAnalytics, getDashboardSummary } from '../controllers/analyticsController.js';
import { getAllBuses } from '../controllers/busController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.get('/alerts', getAllAlerts);
router.patch('/alerts/:id/ack', acknowledgeAlert);
router.get('/incidents', getAllIncidents);
router.get('/monthly', getMonthlyAnalytics);
router.get('/summary', getDashboardSummary);
router.get('/buses', getAllBuses);

export default router;
