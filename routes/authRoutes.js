import express from 'express';
import { login, register, getProfile, getAllUsers, deleteUser, sendOtp, verifyOtp } from '../controllers/authController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.post('/login', login);
router.post('/register', register);
router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.get('/profile', authenticateToken, getProfile);
router.get('/users', getAllUsers);
router.delete('/users/:id', deleteUser);

export default router;
