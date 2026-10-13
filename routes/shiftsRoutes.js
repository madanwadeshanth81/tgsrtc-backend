import express from 'express';
import { getAllShifts, createShift, updateShiftStatus } from '../controllers/shiftsController.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

router.get('/', getAllShifts);
router.post('/', authenticateToken, requireRole(['ADMIN', 'DEPOT_MANAGER']), createShift);
router.patch('/:id/status', authenticateToken, requireRole(['ADMIN', 'DEPOT_MANAGER']), updateShiftStatus);

export default router;
