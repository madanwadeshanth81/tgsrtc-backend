import express from 'express';
import { getAllRoutes, createRoute } from '../controllers/routesController.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

router.get('/', getAllRoutes);
router.post('/', authenticateToken, requireRole(['ADMIN', 'DEPOT_MANAGER']), createRoute);

export default router;
