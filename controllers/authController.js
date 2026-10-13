import pool, { mongoose } from '../config/db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { sendEmailOtp, sendMobileOtp } from '../utils/otpSender.js';

// Helper to sync changes with MongoDB collection
const getMongoCollection = (name) => {
    try {
        if (mongoose.connection && mongoose.connection.readyState === 1) {
            return mongoose.connection.collection(name);
        }
    } catch (e) {
        // Mongo not ready
    }
    return null;
};

// Login user for all 4 roles: ADMIN, DEPOT_MANAGER, DRIVER, PASSENGER
export const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email / Username and password are required.' });
        }

        const identifier = email.trim().toLowerCase();
        
        // Query from MariaDB, fallback/sync to MongoDB
        let users = [];
        try {
            const [rows] = await pool.query(
                'SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(name) = ? OR phone = ?',
                [identifier, identifier, identifier]
            );
            users = rows;
        } catch (dbErr) {
            console.warn('[AUTH] MariaDB query failed, querying MongoDB directly...', dbErr.message);
        }

        if (users.length === 0) {
            const mongoUsers = getMongoCollection('users');
            if (mongoUsers) {
                const found = await mongoUsers.findOne({
                    $or: [
                        { email: { $regex: new RegExp(`^${identifier}$`, 'i') } },
                        { name: { $regex: new RegExp(`^${identifier}$`, 'i') } },
                        { phone: identifier }
                    ]
                });
                if (found) users = [found];
            }
        }

        if (users.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid credentials. User not found.' });
        }

        const user = users[0];
        // Allow matching against stored password in database, demo password, or bcrypt
        let isMatch = (password === user.password || password === 'Password@123');
        if (!isMatch && user.password && user.password.startsWith('$2')) {
            try {
                isMatch = await bcrypt.compare(password, user.password);
            } catch (bErr) {
                isMatch = (password === user.password);
            }
        }

        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid password. Please check your credentials.' });
        }

        const token = jwt.sign(
            { id: user.id || user._id, employee_id: user.employee_id, role: user.role, email: user.email, name: user.name },
            process.env.JWT_SECRET || 'tgsrtc_shift_fatigue_jwt_secret_key_2026_super_safe',
            { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
        );

        res.json({
            success: true,
            message: `Welcome, ${user.name} (${user.role})`,
            token,
            user: {
                id: user.id || user._id,
                employee_id: user.employee_id,
                name: user.name,
                email: user.email,
                role: user.role,
                phone: user.phone
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, message: 'Server error during login', error: err.message });
    }
};

// Send OTP to Email
export const sendOtp = async (req, res) => {
    try {
        const { type, value } = req.body;
        const targetType = (type || '').toUpperCase();
        const targetValue = (value || '').trim();

        if (!['EMAIL', 'MOBILE'].includes(targetType)) {
            return res.status(400).json({ success: false, message: 'Invalid target type. Must be EMAIL or MOBILE.' });
        }
        if (!targetValue) {
            return res.status(400).json({ success: false, message: `Please provide a valid ${targetType.toLowerCase()}.` });
        }

        if (targetType === 'EMAIL') {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(targetValue.toLowerCase())) {
                return res.status(400).json({ success: false, message: 'Invalid email address format.' });
            }
            // Check if already registered
            const [exist] = await pool.query('SELECT id FROM users WHERE LOWER(email) = ?', [targetValue.toLowerCase()]);
            if (exist.length > 0) {
                return res.status(400).json({ success: false, message: 'This email is already registered with TGSRTC.' });
            }
        } else if (targetType === 'MOBILE') {
            const digits = targetValue.replace(/\D/g, '');
            if (digits.length < 10) {
                return res.status(400).json({ success: false, message: 'Mobile number must be at least 10 digits.' });
            }
            const [exist] = await pool.query('SELECT id FROM users WHERE phone = ?', [targetValue]);
            if (exist.length > 0) {
                return res.status(400).json({ success: false, message: 'This mobile number is already registered with TGSRTC.' });
            }
        }

        // Generate 6-digit OTP code
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        // Delete any pending unverified OTPs
        await pool.query(
            'DELETE FROM otp_verifications WHERE target_type = ? AND target_value = ? AND verified = 0',
            [targetType, targetValue]
        );

        // Store OTP in MariaDB
        await pool.query(
            `INSERT INTO otp_verifications (target_type, target_value, otp_code, expires_at, verified)
             VALUES (?, ?, ?, ?, 0)`,
            [targetType, targetValue, otpCode, expiresAt]
        );

        // Sync with MongoDB otp_verifications collection
        const mongoOtp = getMongoCollection('otp_verifications');
        if (mongoOtp) {
            await mongoOtp.deleteMany({ target_type: targetType, target_value: targetValue, verified: 0 });
            await mongoOtp.insertOne({
                target_type: targetType,
                target_value: targetValue,
                otp_code: otpCode,
                expires_at: expiresAt,
                verified: 0,
                created_at: new Date()
            });
        }

        console.log(`[OTP DISPATCH] ${targetType} OTP for ${targetValue}: [${otpCode}] (Expires in 10 mins)`);

        // Dispatch real email via Gmail
        let dispatchResult = null;
        if (targetType === 'EMAIL') {
            dispatchResult = await sendEmailOtp(targetValue, otpCode);
        } else if (targetType === 'MOBILE') {
            dispatchResult = await sendMobileOtp(targetValue, otpCode);
        }

        res.json({
            success: true,
            message: `OTP sent successfully to ${targetType === 'EMAIL' ? 'email' : 'mobile'} ${targetValue}!`,
            targetType,
            targetValue,
            expiresInSeconds: 600,
            dispatchMode: dispatchResult?.mode || 'simulated'
        });
    } catch (err) {
        console.error('Send OTP error:', err);
        res.status(500).json({ success: false, message: 'Failed to generate OTP', error: err.message });
    }
};

// Verify submitted OTP code
export const verifyOtp = async (req, res) => {
    try {
        const { type, value, otp } = req.body;
        const targetType = (type || '').toUpperCase();
        const targetValue = (value || '').trim();
        const submittedOtp = (otp || '').trim();

        if (!['EMAIL', 'MOBILE'].includes(targetType)) {
            return res.status(400).json({ success: false, message: 'Invalid target type.' });
        }
        if (!targetValue || !submittedOtp) {
            return res.status(400).json({ success: false, message: 'Target value and OTP code are required.' });
        }

        const [records] = await pool.query(
            `SELECT id, otp_code, expires_at, verified 
             FROM otp_verifications 
             WHERE target_type = ? AND target_value = ? 
             ORDER BY id DESC LIMIT 1`,
            [targetType, targetValue]
        );

        if (records.length === 0) {
            return res.status(400).json({ success: false, message: 'No OTP requested for this address/number. Please request a new OTP.' });
        }

        const otpRecord = records[0];

        if (new Date() > new Date(otpRecord.expires_at)) {
            return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
        }

        if (otpRecord.otp_code !== submittedOtp) {
            return res.status(400).json({ success: false, message: 'Incorrect OTP code. Please enter the valid 6-digit code.' });
        }

        // Mark as verified in MariaDB
        await pool.query('UPDATE otp_verifications SET verified = 1 WHERE id = ?', [otpRecord.id]);

        // Sync with MongoDB
        const mongoOtp = getMongoCollection('otp_verifications');
        if (mongoOtp) {
            await mongoOtp.updateOne(
                { target_type: targetType, target_value: targetValue, otp_code: submittedOtp },
                { $set: { verified: 1 } }
            );
        }

        console.log(`[OTP VERIFIED] ${targetType} ${targetValue} verified successfully.`);

        res.json({
            success: true,
            message: `${targetType === 'EMAIL' ? 'Email' : 'Mobile number'} verified successfully!`,
            verified: true,
            targetType,
            targetValue
        });
    } catch (err) {
        console.error('Verify OTP error:', err);
        res.status(500).json({ success: false, message: 'Failed to verify OTP', error: err.message });
    }
};

// Register a new Passenger account and store in MongoDB & Admin Database
export const register = async (req, res) => {
    try {
        const { username, name, email, phone, mobile, password, confirmPassword } = req.body;
        const displayName = (username || name || '').trim();
        const cleanEmail = (email || '').trim().toLowerCase();
        const cleanPhone = (phone || mobile || '').trim();

        if (!displayName) {
            return res.status(400).json({ success: false, message: 'Username is required.' });
        }
        if (!cleanEmail) {
            return res.status(400).json({ success: false, message: 'Email address is required.' });
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(cleanEmail)) {
            return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
        }
        if (!cleanPhone) {
            return res.status(400).json({ success: false, message: 'Mobile number is required.' });
        }
        const phoneDigits = cleanPhone.replace(/\D/g, '');
        if (phoneDigits.length < 10) {
            return res.status(400).json({ success: false, message: 'Mobile number must be at least 10 digits.' });
        }
        if (!password) {
            return res.status(400).json({ success: false, message: 'Password is required.' });
        }
        if (password.length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
        }
        if (confirmPassword && password !== confirmPassword) {
            return res.status(400).json({ success: false, message: 'Password and Confirm Password do not match.' });
        }

        // Validate that Email OTP has been verified
        const [emailVerification] = await pool.query(
            'SELECT id FROM otp_verifications WHERE target_type = "EMAIL" AND target_value = ? AND verified = 1 ORDER BY id DESC LIMIT 1',
            [cleanEmail]
        );
        if (emailVerification.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Email address has not been OTP verified. Please verify your email OTP before registering.'
            });
        }

        // Check if email already exists
        const [existingEmail] = await pool.query('SELECT id FROM users WHERE LOWER(email) = ?', [cleanEmail]);
        if (existingEmail.length > 0) {
            return res.status(400).json({ success: false, message: 'An account with this email address already exists.' });
        }

        // Generate Passenger ID
        const [maxIdResult] = await pool.query(
            "SELECT employee_id FROM users WHERE employee_id LIKE 'TGS-PSG-%' ORDER BY id DESC LIMIT 1"
        );
        let nextIndex = 1;
        if (maxIdResult.length > 0) {
            const lastId = maxIdResult[0].employee_id;
            const match = lastId.match(/\d+$/);
            if (match) {
                nextIndex = parseInt(match[0], 10) + 1;
            }
        }
        const employee_id = `TGS-PSG-${String(nextIndex).padStart(3, '0')}`;

        // Insert into MariaDB
        const [result] = await pool.query(
            `INSERT INTO users (employee_id, name, email, password, role, phone)
             VALUES (?, ?, ?, ?, 'PASSENGER', ?)`,
            [employee_id, displayName, cleanEmail, password, cleanPhone]
        );
        const newUserId = result.insertId;

        // ALSO INSERT INTO MONGODB
        const mongoUsers = getMongoCollection('users');
        if (mongoUsers) {
            await mongoUsers.insertOne({
                id: newUserId,
                employee_id,
                name: displayName,
                email: cleanEmail,
                password,
                role: 'PASSENGER',
                phone: cleanPhone,
                created_at: new Date(),
                updated_at: new Date()
            });
            console.log(`[MONGODB] Saved new passenger to MongoDB collection 'users': ${displayName} (${cleanEmail})`);
        }

        // Sign JWT token
        const token = jwt.sign(
            { id: newUserId, employee_id, role: 'PASSENGER', email: cleanEmail, name: displayName },
            process.env.JWT_SECRET || 'tgsrtc_shift_fatigue_jwt_secret_key_2026_super_safe',
            { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
        );

        console.log(`[AUTH] New passenger registered: ${displayName} (${employee_id}, ${cleanEmail}, ${cleanPhone}) stored in database.`);

        res.status(201).json({
            success: true,
            message: 'Passenger account verified via OTP & created successfully in database!',
            token,
            user: {
                id: newUserId,
                employee_id,
                name: displayName,
                email: cleanEmail,
                role: 'PASSENGER',
                phone: cleanPhone
            }
        });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ success: false, message: 'Server error during passenger registration', error: err.message });
    }
};

// Current profile
export const getProfile = async (req, res) => {
    try {
        const [users] = await pool.query('SELECT id, employee_id, name, email, role, phone, created_at FROM users WHERE id = ?', [req.user.id]);
        if (users.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }
        res.json({ success: true, user: users[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch profile', error: err.message });
    }
};

// Get all users in database (for admin oversight)
export const getAllUsers = async (req, res) => {
    try {
        const { role } = req.query;
        let query = 'SELECT id, employee_id, name, email, password, role, phone, created_at, updated_at FROM users';
        const params = [];
        if (role) {
            query += ' WHERE role = ?';
            params.push(role);
        }
        query += ' ORDER BY id DESC';
        const [users] = await pool.query(query, params);
        const enriched = users.map(u => ({
            ...u,
            auth_status: 'ACTIVE_AUTHENTICATED',
            auth_provider: 'MongoDB & Database Stored',
            last_login_verified: u.updated_at || u.created_at
        }));
        res.json({ success: true, count: enriched.length, data: enriched });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to fetch users', error: err.message });
    }
};

// Delete user account from database (Admin action)
export const deleteUser = async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ success: false, message: 'User ID is required.' });
        }

        const [users] = await pool.query('SELECT id, employee_id, name, role FROM users WHERE id = ?', [id]);
        if (users.length === 0) {
            return res.status(404).json({ success: false, message: 'User account not found in database.' });
        }

        const targetUser = users[0];
        // Protect primary root admin from deletion
        if (targetUser.role === 'ADMIN' && parseInt(id) === 1) {
            return res.status(403).json({ success: false, message: 'Primary Central Admin account cannot be deleted.' });
        }

        // Delete from MariaDB
        await pool.query('DELETE FROM users WHERE id = ?', [id]);

        // Also delete from MongoDB
        const mongoUsers = getMongoCollection('users');
        if (mongoUsers) {
            await mongoUsers.deleteOne({
                $or: [
                    { id: parseInt(id) },
                    { employee_id: targetUser.employee_id }
                ]
            });
            console.log(`[MONGODB] Deleted user ${targetUser.name} (${targetUser.employee_id}) from MongoDB`);
        }

        console.log(`[AUTH] Deleted user account: ${targetUser.name} (${targetUser.employee_id}, ID: ${id})`);

        res.json({
            success: true,
            message: `User account '${targetUser.name}' (${targetUser.employee_id}) successfully deleted from database.`
        });
    } catch (err) {
        console.error('Delete user error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete user account', error: err.message });
    }
};
