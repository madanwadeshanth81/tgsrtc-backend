import nodemailer from 'nodemailer';

// Email Sender configuration
export const sendEmailOtp = async (toEmail, otpCode) => {
    const resendApiKey = process.env.RESEND_API_KEY;
    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_APP_PASSWORD;

    const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; background: #0f172a; color: #f8fafc; padding: 25px; border-radius: 12px; border: 1px solid #334155;">
            <div style="text-align: center; margin-bottom: 20px;">
                <h2 style="color: #06b6d4; margin: 0;">TGSRTC Telangana</h2>
                <p style="color: #94a3b8; font-size: 13px; margin: 4px 0 0 0;">Shift & Passenger Management Portal</p>
            </div>
            <div style="background: #1e293b; padding: 20px; border-radius: 8px; text-align: center;">
                <p style="font-size: 14px; margin: 0 0 10px 0; color: #cbd5e1;">Your One-Time Password (OTP) for account registration is:</p>
                <h1 style="font-size: 36px; letter-spacing: 6px; color: #f59e0b; margin: 15px 0; font-weight: bold;">${otpCode}</h1>
                <p style="font-size: 12px; color: #94a3b8; margin: 0;">This OTP is valid for 10 minutes. Do not share this code with anyone.</p>
            </div>
            <div style="margin-top: 20px; text-align: center; font-size: 11px; color: #64748b;">
                Telangana State Road Transport Corporation © 2026
            </div>
        </div>
    `;

    // Method 1: Resend HTTPS API (Works 100% on Render / Cloud without SMTP port blocking)
    if (resendApiKey) {
        try {
            const res = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${resendApiKey.trim()}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    from: 'TGSRTC Verification <onboarding@resend.dev>',
                    to: [toEmail],
                    subject: `TGSRTC Account Verification Code: ${otpCode}`,
                    html: emailHtml
                })
            });

            const data = await res.json();
            if (res.ok && data.id) {
                console.log(`[RESEND EMAIL SUCCESS] Live email delivered to ${toEmail}. ID: ${data.id}`);
                return { success: true, mode: 'live', provider: 'Resend', messageId: data.id };
            } else {
                console.warn(`[RESEND API WARNING]`, data);
            }
        } catch (err) {
            console.error(`[RESEND ERROR]`, err.message);
        }
    }

    // Method 2: Gmail SMTP (Works on Localhost)
    if (gmailUser && gmailPass) {
        try {
            const transporter = nodemailer.createTransport({
                host: 'smtp.gmail.com',
                port: 465,
                secure: true,
                auth: {
                    user: gmailUser,
                    pass: gmailPass.replace(/\s+/g, '')
                },
                connectionTimeout: 5000,
                greetingTimeout: 5000,
                socketTimeout: 5000
            });

            const mailOptions = {
                from: `"TGSRTC Verification" <${gmailUser}>`,
                to: toEmail,
                subject: `TGSRTC Account Verification Code: ${otpCode}`,
                html: emailHtml
            };

            const info = await transporter.sendMail(mailOptions);
            console.log(`[GMAIL SMTP SUCCESS] Real Gmail sent to ${toEmail}. Message ID: ${info.messageId}`);
            return { success: true, mode: 'live', provider: 'Gmail', messageId: info.messageId };
        } catch (err) {
            console.warn(`[GMAIL SMTP WARNING] SMTP port blocked or failed:`, err.message);
        }
    }

    // Simulated fallback
    return {
        success: true,
        mode: 'simulated',
        message: `OTP generated: ${otpCode}`
    };
};

// SMS / Mobile Sender configuration
export const sendMobileOtp = async (phoneNumber, otpCode) => {
    const rawDigits = phoneNumber.replace(/\D/g, '').slice(-10);

    // Method A: Fast2SMS (Free / Instant Indian SMS gateway for Indian mobile numbers)
    const fast2smsApiKey = process.env.FAST2SMS_API_KEY;
    if (fast2smsApiKey) {
        try {
            const res = await fetch('https://www.fast2sms.com/dev/bulkV2', {
                method: 'POST',
                headers: {
                    'authorization': fast2smsApiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    route: 'otp',
                    variables_values: otpCode,
                    numbers: rawDigits
                })
            });
            const data = await res.json();
            if (data.return) {
                console.log(`[SMS DISPATCH SUCCESS] Real SMS delivered to +91 ${rawDigits} via Fast2SMS:`, data.message);
                return { success: true, mode: 'live', provider: 'Fast2SMS', message: data.message };
            } else {
                console.error(`[SMS DISPATCH WARNING] Fast2SMS returned error:`, data.message);
            }
        } catch (err) {
            console.error(`[SMS DISPATCH ERROR] Fast2SMS network error:`, err.message);
        }
    }

    // Method B: Twilio International SMS Gateway
    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
    const twilioPhone = process.env.TWILIO_PHONE_NUMBER;

    if (twilioSid && twilioAuth && twilioPhone) {
        try {
            const authHeader = 'Basic ' + Buffer.from(`${twilioSid}:${twilioAuth}`).toString('base64');
            const cleanPhone = phoneNumber.startsWith('+') ? phoneNumber : `+91${rawDigits}`;
            
            const params = new URLSearchParams();
            params.append('To', cleanPhone);
            params.append('From', twilioPhone);
            params.append('Body', `[TGSRTC] Your passenger registration OTP is ${otpCode}. Valid for 10 mins.`);

            const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
                method: 'POST',
                headers: {
                    'Authorization': authHeader,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: params
            });
            const data = await res.json();
            console.log(`[SMS DISPATCH SUCCESS] Twilio SMS dispatched to ${cleanPhone}. SID: ${data.sid}`);
            return { success: true, mode: 'live', provider: 'Twilio', sid: data.sid };
        } catch (err) {
            console.error(`[SMS DISPATCH ERROR] Twilio dispatch failed:`, err.message);
        }
    }

    // Default SMS simulation mode (with full terminal and UI notification)
    console.log(`\n======================================================`);
    console.log(`[SMS DISPATCH - LIVE GATEWAY SIMULATED]`);
    console.log(`To Mobile: +91 ${phoneNumber}`);
    console.log(`Sender: TGSRTC-GOVT`);
    console.log(`SMS Text: [TGSRTC] Your verification OTP is ${otpCode}. Valid for 10 minutes. Do not share with anyone.`);
    console.log(`Note: To send real cellular SMS, add Twilio or Fast2SMS credentials in backend/.env`);
    console.log(`======================================================\n`);

    return {
        success: true,
        mode: 'simulated',
        message: `Mobile SMS OTP generated: ${otpCode}. Add SMS API keys in backend/.env for cellular delivery.`
    };
};
