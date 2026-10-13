import mongoose from 'mongoose';

// User Schema
export const User = mongoose.model('User', new mongoose.Schema({
    id: { type: Number },
    employee_id: { type: String, required: true },
    name: { type: String, required: true },
    email: { type: String, required: true },
    password: { type: String, required: true },
    role: { type: String, required: true, default: 'PASSENGER' },
    phone: { type: String },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
}, { collection: 'users' }));

// Staff (Drivers & Conductors) Schema
export const Staff = mongoose.model('Staff', new mongoose.Schema({
    id: { type: String, required: true },
    name: { type: String, required: true },
    role: { type: String, required: true },
    age: { type: Number },
    experience: { type: Number },
    health_score: { type: Number, default: 85 },
    fatigue_level: { type: Number, default: 20 },
    status: { type: String, default: 'AVAILABLE' },
    assigned_route: { type: String },
    hours_worked: { type: Number, default: 0 },
    rest_hours: { type: Number, default: 8 },
    phone: { type: String },
    blood_group: { type: String },
    last_health_check: { type: Date },
    join_date: { type: Date },
    depot_location: { type: String, default: 'MGBS Depot' },
    leave_reason: { type: String }
}, { collection: 'staff' }));

// Route Schema
export const Route = mongoose.model('Route', new mongoose.Schema({
    id: { type: String, required: true },
    name: { type: String, required: true },
    origin: { type: String, required: true },
    destination: { type: String, required: true },
    distance: { type: Number },
    difficulty: { type: Number },
    traffic_index: { type: Number },
    avg_duration: { type: String },
    terrain: { type: String },
    incidents_count: { type: Number, default: 0 },
    avg_delay: { type: String }
}, { collection: 'routes' }));

// Bus Schema
export const Bus = mongoose.model('Bus', new mongoose.Schema({
    id: { type: Number },
    bus_number: { type: String, required: true },
    fleet_code: { type: String },
    bus_type: { type: String },
    depot_name: { type: String },
    assigned_route_id: { type: String },
    status: { type: String, default: 'ACTIVE' },
    first_bus: { type: String },
    last_bus: { type: String }
}, { collection: 'buses' }));

// Shift Schema
export const Shift = mongoose.model('Shift', new mongoose.Schema({
    id: { type: String, required: true },
    driver_id: { type: String, required: true },
    conductor_id: { type: String, required: true },
    route_id: { type: String, required: true },
    bus_number: { type: String },
    shift_date: { type: Date },
    start_time: { type: String },
    end_time: { type: String },
    status: { type: String, default: 'SCHEDULED' },
    fatigue_risk: { type: String, default: 'LOW' },
    notes: { type: String }
}, { collection: 'shifts' }));

// Alert Schema
export const Alert = mongoose.model('Alert', new mongoose.Schema({
    id: { type: Number },
    alert_type: { type: String },
    title: { type: String },
    message: { type: String },
    driver_id: { type: String },
    acknowledged: { type: Boolean, default: false },
    time_ago: { type: String },
    created_at: { type: Date, default: Date.now }
}, { collection: 'alerts' }));

// Incident Schema
export const Incident = mongoose.model('Incident', new mongoose.Schema({
    id: { type: Number },
    driver_id: { type: String },
    route_id: { type: String },
    severity: { type: String },
    description: { type: String },
    incident_date: { type: Date, default: Date.now }
}, { collection: 'incidents' }));

// OTP Verification Schema
export const OtpVerification = mongoose.model('OtpVerification', new mongoose.Schema({
    id: { type: Number },
    target_type: { type: String, required: true }, // EMAIL or MOBILE
    target_value: { type: String, required: true },
    otp_code: { type: String, required: true },
    expires_at: { type: Date, required: true },
    verified: { type: Number, default: 0 },
    created_at: { type: Date, default: Date.now }
}, { collection: 'otp_verifications' }));
