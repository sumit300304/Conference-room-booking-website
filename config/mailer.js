const nodemailer = require('nodemailer');

function isSmtpConfigured() {
  const host = process.env.SMTP_HOST || '';
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  if (!host || !user || !pass) return false;
  if (host.includes('yourprovider.com') || user.includes('your_smtp_username')) return false;
  return true;
}

let transporter = null;

function getTransporter() {
  if (!isSmtpConfigured()) return null;
  if (transporter) return transporter;

  const host = (process.env.SMTP_HOST || '').toLowerCase();
  const pass = String(process.env.SMTP_PASS || '').trim().replace(/\s+/g, '');
  const user = String(process.env.SMTP_USER || '').trim();

  const isGmail = host.includes('gmail') || user.endsWith('@gmail.com');

  const options = isGmail
    ? {
        service: 'gmail',
        auth: { user, pass },
      }
    : {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
        auth: { user, pass },
      };

  transporter = nodemailer.createTransport(options);
  return transporter;
}

/**
 * Sends the OTP verification email.
 */
async function sendOtpEmail(toEmail, fullName, otp) {
  const t = getTransporter();
  if (!t) {
    const err = new Error('SMTP_NOT_CONFIGURED');
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  await t.sendMail({
    from,
    to: toEmail,
    subject: 'Algorisys Conference Booking - Email Verification Code',
    text: `Hello ${fullName},\n\nYour verification code is: ${otp}\n\nThis code expires in 10 minutes. If you did not request this, please ignore this email.\n\n- Algorisys Conference Hall Booking System`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1e293b;">
        <h2 style="color:#0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">Algorisys Conference Hall Booking</h2>
        <p>Hello ${fullName},</p>
        <p>Your email verification code is:</p>
        <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px; color: #0f172a; background: #f1f5f9; padding: 12px; text-align: center; border-radius: 8px;">${otp}</p>
        <p>This code expires in <strong>10 minutes</strong>.</p>
        <p style="color: #64748b; font-size: 12px;">If you did not request this, you can safely ignore this email.</p>
      </div>
    `,
  });
}

/**
 * Sends confirmation email when a conference room is successfully booked.
 * Dispatches confirmation to the person who booked the hall, AND sends
 * meeting invitations to all attendees.
 */
async function sendBookingConfirmationEmail({ 
  toEmail, 
  fullName, 
  bookingCode, 
  hallName, 
  date, 
  startTime, 
  endTime, 
  purpose, 
  attendees, 
  participants,
  attendeeList = [] 
}) {
  const t = getTransporter();
  const participantText = participants ? ` (${participants})` : '';
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@algorisys.com';

  // 1. Email to the person who booked the hall
  if (!t) {
    console.log(`====================================================`);
    console.log(`[DEV NOTIFICATION - BOOKER CONFIRMATION]`);
    console.log(`To: ${fullName} <${toEmail}>`);
    console.log(`Booking ID: ${bookingCode} | Hall: ${hallName}`);
    console.log(`Date: ${date} | Time: ${startTime} – ${endTime} IST`);
    console.log(`Attendees: ${attendees}${participantText}`);
    console.log(`Agenda: ${purpose}`);
    if (Array.isArray(attendeeList) && attendeeList.length > 0) {
      console.log(`Invited Attendees (${attendeeList.length}): ${attendeeList.map((a) => `${a.name} <${a.email}>`).join(', ')}`);
    }
    console.log(`====================================================`);
  } else {
    try {
      const attendeeListHtml = Array.isArray(attendeeList) && attendeeList.length > 0
        ? `<div style="margin-top: 14px; padding: 10px 14px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; font-size: 13px; color: #166534;">
             <strong>✓ Attendee Invitations Sent:</strong> ${attendeeList.map((a) => `${a.name} (${a.email})`).join(', ')}
           </div>`
        : '';

      const info = await t.sendMail({
        from,
        to: toEmail,
        subject: `Booking Confirmed: ${hallName} on ${date} (${startTime} – ${endTime} IST) [${bookingCode}]`,
        text: `Hello ${fullName},\n\nYour conference room booking has been confirmed.\n\nBooking ID: ${bookingCode}\nConference Hall: ${hallName}\nDate: ${date}\nTime: ${startTime} – ${endTime} IST\nAttendees: ${attendees}${participantText}\nAgenda: ${purpose}\n\n${attendeeList.length > 0 ? `Attendee invitations have been dispatched to:\n${attendeeList.map((a) => `- ${a.name} (${a.email})`).join('\n')}\n\n` : ''}Thank you,\nAlgorisys Conference Hall Booking System`,
        html: `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 540px; margin: 0 auto; color: #0f172a; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; background: #ffffff;">
            <div style="background-color: #090e1a; color: #ffffff; padding: 24px; border-bottom: 2px solid #2563eb;">
              <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #60a5fa; font-weight: bold;">Algorisys Conference Suite</span>
              <h2 style="margin: 6px 0 0; font-size: 20px; font-weight: 700;">Conference Room Reserved</h2>
            </div>
            <div style="padding: 24px;">
              <p style="margin-top: 0; font-size: 15px;">Hello <strong>${fullName}</strong>,</p>
              <p style="font-size: 14px; color: #334155; line-height: 1.5;">Your conference room reservation has been confirmed in the system. Full meeting details are provided below:</p>
              <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px; margin: 20px 0;">
                <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                  <tr><td style="padding: 8px 0; color: #64748b; width: 130px; font-weight: 500;">Booking ID:</td><td style="padding: 8px 0; font-weight: 700; color: #2563eb; font-family: monospace; font-size: 15px;">${bookingCode}</td></tr>
                  <tr><td style="padding: 8px 0; color: #64748b; font-weight: 500;">Conference Hall:</td><td style="padding: 8px 0; font-weight: 700; color: #0f172a;">${hallName}</td></tr>
                  <tr><td style="padding: 8px 0; color: #64748b; font-weight: 500;">Date:</td><td style="padding: 8px 0; font-weight: 700; color: #0f172a;">${date}</td></tr>
                  <tr><td style="padding: 8px 0; color: #64748b; font-weight: 500;">Time:</td><td style="padding: 8px 0; font-weight: 700; color: #0284c7;">${startTime} – ${endTime} IST</td></tr>
                  <tr><td style="padding: 8px 0; color: #64748b; font-weight: 500;">Attendees:</td><td style="padding: 8px 0; color: #334155;"><strong>${attendees}</strong> member(s)${participantText}</td></tr>
                  <tr><td style="padding: 8px 0; color: #64748b; font-weight: 500;">Agenda:</td><td style="padding: 8px 0; color: #0f172a; font-weight: 600;">${purpose}</td></tr>
                </table>
                ${attendeeListHtml}
              </div>
              <p style="font-size: 13px; color: #64748b; margin-bottom: 0;">If your meeting concludes early, you can release the room from "My Bookings" to free it up for colleagues.</p>
            </div>
          </div>
        `,
      });
      const previewUrl = nodemailer.getTestMessageUrl(info);
      console.log(`[BOOKER EMAIL DISPATCHED] To: ${fullName} <${toEmail}> | Message ID: ${info.messageId}${previewUrl ? ` | Preview: ${previewUrl}` : ''}`);
    } catch (err) {
      console.error('Failed to send booker confirmation email:', err.message);
    }
  }

  // 2. Email to each attendee / participant (sent to their registered email address)
  if (Array.isArray(attendeeList) && attendeeList.length > 0) {
    for (const att of attendeeList) {
      const attEmail = (att.email || '').trim().toLowerCase();
      const attName = att.name || 'Colleague';
      if (!attEmail || attEmail === (toEmail || '').toLowerCase()) continue;

      if (!t) {
        console.log(`----------------------------------------------------`);
        console.log(`[DEV NOTIFICATION - ATTENDEE INVITATION]`);
        console.log(`To: ${attName} <${attEmail}>`);
        console.log(`Subject: Meeting Invitation: ${hallName} on ${date} (${startTime} – ${endTime} IST)`);
        console.log(`Date: ${date} | Time: ${startTime} – ${endTime} IST | Hall: ${hallName}`);
        console.log(`Organized by: ${fullName} (${toEmail})`);
        console.log(`Attendees: ${participants || attendees}`);
        console.log(`Agenda: ${purpose}`);
        console.log(`Booking ID: ${bookingCode}`);
        console.log(`----------------------------------------------------`);
      } else {
        try {
          const info = await t.sendMail({
            from,
            to: attEmail,
            subject: `Meeting Invitation: ${hallName} on ${date} (${startTime} – ${endTime} IST) [Scheduled by ${fullName}]`,
            text: `Hello ${attName},\n\nYou have been invited as an attendee to an upcoming meeting scheduled by ${fullName}.\n\nMeeting Details:\n- Date: ${date}\n- Time: ${startTime} – ${endTime} IST\n- Conference Hall: ${hallName}\n- Agenda: ${purpose}\n- Attendees: ${participants || attendees}\n- Organized By: ${fullName} (${toEmail})\n- Booking ID: ${bookingCode}\n\nPlease be present at ${hallName} on time.\n\nThank you,\nAlgorisys Conference Suite`,
            html: `
              <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 540px; margin: 0 auto; color: #0f172a; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; background: #ffffff;">
                <div style="background-color: #090e1a; color: #ffffff; padding: 24px; border-bottom: 2px solid #10b981;">
                  <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #34d399; font-weight: bold;">Meeting Invitation</span>
                  <h2 style="margin: 6px 0 0; font-size: 20px; font-weight: 700;">You are invited to ${hallName}</h2>
                </div>
                <div style="padding: 24px;">
                  <p style="margin-top: 0; font-size: 15px;">Hello <strong>${attName}</strong>,</p>
                  <p style="font-size: 14px; color: #334155; line-height: 1.5;"><strong>${fullName}</strong> (${toEmail}) has scheduled a conference session and included you as an attendee. Please find the meeting details below:</p>
                  <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px; margin: 20px 0;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                      <tr><td style="padding: 8px 0; color: #64748b; width: 130px; font-weight: 500;">Meeting Date:</td><td style="padding: 8px 0; font-weight: 700; color: #0f172a;">${date}</td></tr>
                      <tr><td style="padding: 8px 0; color: #64748b; font-weight: 500;">Meeting Time:</td><td style="padding: 8px 0; font-weight: 700; color: #059669;">${startTime} – ${endTime} IST</td></tr>
                      <tr><td style="padding: 8px 0; color: #64748b; font-weight: 500;">Conference Hall:</td><td style="padding: 8px 0; font-weight: 700; color: #0f172a;">${hallName}</td></tr>
                      <tr><td style="padding: 8px 0; color: #64748b; font-weight: 500;">Meeting Agenda:</td><td style="padding: 8px 0; color: #0f172a; font-weight: 600;">${purpose}</td></tr>
                      <tr><td style="padding: 8px 0; color: #64748b; font-weight: 500;">Organized By:</td><td style="padding: 8px 0; color: #2563eb; font-weight: 600;">${fullName} (${toEmail})</td></tr>
                      <tr><td style="padding: 8px 0; color: #64748b; font-weight: 500;">All Attendees:</td><td style="padding: 8px 0; color: #334155; font-size: 13px;">${participants || attendees}</td></tr>
                      <tr><td style="padding: 8px 0; color: #64748b; font-weight: 500;">Booking ID:</td><td style="padding: 8px 0; color: #64748b; font-family: monospace; font-size: 13px;">${bookingCode}</td></tr>
                    </table>
                  </div>
                  <p style="font-size: 13px; color: #64748b; margin-bottom: 0;">Please be present at ${hallName} on time. Thank you!</p>
                </div>
              </div>
            `,
          });
          const previewUrl = nodemailer.getTestMessageUrl(info);
          console.log(`[ATTENDEE EMAIL DISPATCHED] To: ${attName} <${attEmail}> | Message ID: ${info.messageId}${previewUrl ? ` | Preview: ${previewUrl}` : ''}`);
        } catch (err) {
          console.error(`Failed to send attendee email to ${attEmail}:`, err.message);
        }
      }
    }
  }
}

/**
 * Sends notification when a meeting slot has concluded.
 */
async function sendMeetingEndedEmail({ toEmail, fullName, bookingCode, hallName, date, startTime, endTime, purpose }) {
  const t = getTransporter();
  if (!t) {
    console.log(`[DEV NOTIFICATION - MEETING ENDED] To: ${fullName} <${toEmail}>`);
    console.log(`Your meeting in ${hallName} (${bookingCode}) scheduled on ${date} from ${startTime} to ${endTime} has concluded.`);
    return;
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  await t.sendMail({
    from,
    to: toEmail,
    subject: `Meeting Concluded: ${hallName} (${bookingCode})`,
    text: `Hello ${fullName},\n\nYour meeting in ${hallName} (${bookingCode}) on ${date} from ${startTime} to ${endTime} IST has now ended.\n\nThank you for using the Algorisys Conference Hall Booking System.`,
    html: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 520px; margin: 0 auto; color: #0f172a; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0; padding: 20px 24px;">
          <h2 style="margin: 0; font-size: 18px; color: #0f172a;">Meeting Concluded</h2>
          <p style="margin: 4px 0 0; font-size: 13px; color: #64748b;">Algorisys Conference Hall Booking</p>
        </div>
        <div style="padding: 24px;">
          <p style="margin-top: 0;">Hello <strong>${fullName}</strong>,</p>
          <p>Your scheduled conference room time in <strong>${hallName}</strong> has concluded:</p>
          <ul style="color: #334155; font-size: 14px; line-height: 1.6;">
            <li><strong>Booking Code:</strong> ${bookingCode}</li>
            <li><strong>Date:</strong> ${date}</li>
            <li><strong>Slot:</strong> ${startTime} – ${endTime} IST</li>
            <li><strong>Purpose:</strong> ${purpose}</li>
          </ul>
          <p style="font-size: 13px; color: #64748b; margin-bottom: 0;">Thank you for your cooperation in keeping the halls available for colleagues.</p>
        </div>
      </div>
    `,
  });
}

/**
 * Sends password reset OTP email.
 */
async function sendPasswordResetOtpEmail(toEmail, fullName, otp) {
  const t = getTransporter();
  if (!t) {
    console.log(`[DEV NOTIFICATION - PASSWORD RESET OTP] To: ${fullName} <${toEmail}> | Code: ${otp}`);
    return;
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  await t.sendMail({
    from,
    to: toEmail,
    subject: 'Algorisys Conference Booking - Password Reset Code',
    text: `Hello ${fullName},\n\nYour password reset code is: ${otp}\n\nThis code expires in 10 minutes. If you did not request a password reset, please ignore this email or contact your administrator immediately.\n\n- Algorisys Conference Hall Booking System`,
    html: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 480px; margin: 0 auto; color: #0f172a; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background-color: #0f172a; color: #ffffff; padding: 20px 24px;">
          <h2 style="margin: 0; font-size: 18px;">Password Reset Request</h2>
          <p style="margin: 4px 0 0; font-size: 13px; color: #94a3b8;">Algorisys Conference Hall Booking</p>
        </div>
        <div style="padding: 24px;">
          <p style="margin-top: 0;">Hello <strong>${fullName}</strong>,</p>
          <p>We received a request to reset your password. Use the verification code below to set a new password:</p>
          <div style="margin: 20px 0; text-align: center;">
            <span style="font-size: 30px; font-weight: 700; letter-spacing: 6px; color: #0f172a; background: #f1f5f9; padding: 12px 24px; border-radius: 8px; display: inline-block; font-family: monospace;">${otp}</span>
          </div>
          <p style="font-size: 13px; color: #64748b;">This code expires in <strong>10 minutes</strong>. If you did not request this password reset, please ignore this email or notify your system administrator.</p>
        </div>
      </div>
    `,
  });
}

/**
 * Sends welcome email to newly registered employee with temporary credentials.
 */
async function sendEmployeeWelcomeEmail({ toEmail, fullName, tempPassword, department, designation }) {
  const t = getTransporter();
  if (!t) {
    console.log(`[DEV NOTIFICATION - EMPLOYEE REGISTERED] To: ${fullName} <${toEmail}> | Temp Password: ${tempPassword}`);
    return;
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  await t.sendMail({
    from,
    to: toEmail,
    subject: 'Welcome to Algorisys Conference Suite - Your Account Credentials',
    text: `Hello ${fullName},\n\nYour employee account for the Algorisys Conference Hall Booking system has been created by the Administrator.\n\nLogin Email: ${toEmail}\nTemporary Password: ${tempPassword}\nDepartment: ${department || 'General'}\nDesignation: ${designation || 'Team Member'}\n\nPlease log in at your corporate portal and set your new permanent password.\n\n- Algorisys Conference Hall Booking System`,
    html: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 520px; margin: 0 auto; color: #0f172a; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
        <div style="background-color: #0f172a; color: #ffffff; padding: 22px 24px;">
          <h2 style="margin: 0; font-size: 19px; font-weight: 700;">Welcome to Algorisys Conference Suite</h2>
          <p style="margin: 4px 0 0; font-size: 13px; color: #94a3b8;">Corporate Room Reservation System</p>
        </div>
        <div style="padding: 24px; background: #ffffff;">
          <p style="margin-top: 0; font-size: 15px;">Hello <strong>${fullName}</strong>,</p>
          <p style="font-size: 14px; color: #334155;">Your employee account has been created by the System Administrator. You can now log in to view availability and book conference halls.</p>
          
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px 20px; margin: 20px 0;">
            <div style="margin-bottom: 10px;">
              <span style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748b; letter-spacing: 0.5px; display: block;">Login Email</span>
              <span style="font-size: 14px; font-weight: 600; color: #0f172a;">${toEmail}</span>
            </div>
            <div style="margin-bottom: 10px;">
              <span style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748b; letter-spacing: 0.5px; display: block;">Temporary Password</span>
              <span style="font-size: 15px; font-family: monospace; font-weight: 700; color: #2563eb; background: #eff6ff; padding: 4px 8px; border-radius: 6px; display: inline-block;">${tempPassword}</span>
            </div>
            ${department ? `<div style="margin-bottom: 6px;"><span style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748b; letter-spacing: 0.5px; display: block;">Department</span><span style="font-size: 13px; color: #334155;">${department}</span></div>` : ''}
            ${designation ? `<div><span style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748b; letter-spacing: 0.5px; display: block;">Designation</span><span style="font-size: 13px; color: #334155;">${designation}</span></div>` : ''}
          </div>

          <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 12px 16px; border-radius: 0 8px 8px 0; margin-bottom: 20px;">
            <p style="margin: 0; font-size: 13px; color: #1e40af; font-weight: 500;">
              <strong>Note:</strong> When you log in for the first time with this temporary password, the system will prompt you to set your new permanent password.
            </p>
          </div>

          <p style="font-size: 13px; color: #64748b; margin-bottom: 0;">If you have any questions, please reach out to your system administrator.</p>
        </div>
      </div>
    `,
  });
}

module.exports = {
  isSmtpConfigured,
  sendOtpEmail,
  sendPasswordResetOtpEmail,
  sendBookingConfirmationEmail,
  sendMeetingEndedEmail,
  sendEmployeeWelcomeEmail,
};

