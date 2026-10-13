import express from 'express';
import { getAllStaff, getStaffById, createStaff, updateStaff, applyEmergencyLeave, deleteStaff } from '../controllers/staffController.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

router.get('/', getAllStaff);
router.get('/:id', getStaffById);
router.post('/', authenticateToken, requireRole(['ADMIN', 'DEPOT_MANAGER']), createStaff);
router.put('/:id', authenticateToken, requireRole(['ADMIN', 'DEPOT_MANAGER']), updateStaff);
router.delete('/:id', authenticateToken, requireRole(['ADMIN', 'DEPOT_MANAGER']), deleteStaff);
router.post('/:id/emergency-leave', applyEmergencyLeave);

export default router;
