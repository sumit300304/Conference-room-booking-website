require('dotenv').config();
const nodemailer = require('nodemailer');

async function testSmtp() {
  console.log('Testing SMTP connection with your .env settings:');
  console.log('  SMTP_HOST:', process.env.SMTP_HOST);
  console.log('  SMTP_PORT:', process.env.SMTP_PORT);
  console.log('  SMTP_USER:', process.env.SMTP_USER);
  console.log('  SMTP_FROM:', process.env.SMTP_FROM);

  const host = (process.env.SMTP_HOST || '').toLowerCase();
  const pass = String(process.env.SMTP_PASS || '').trim().replace(/\s+/g, '');
  const user = String(process.env.SMTP_USER || '').trim();

  if (!host || !user || !pass || host.includes('yourprovider.com') || user.includes('your_smtp_username')) {
    console.error('\n❌ ERROR: SMTP credentials in .env are still set to default placeholders.');
    console.error('Please open .env and set your real SMTP_USER and SMTP_PASS (e.g. Gmail App Password).');
    process.exit(1);
  }

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

  console.log('\nConnecting to mail server...');
  const transporter = nodemailer.createTransport(options);

  try {
    await transporter.verify();
    console.log('✅ SUCCESS: SMTP connection established and authenticated successfully!');

    const targetRecipient = process.argv[2] || user;
    console.log(`\nSending a test email to: ${targetRecipient}...`);

    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || user,
      to: targetRecipient,
      subject: '✅ Algorisys Conference Booking - Test Email',
      text: 'Congratulations! Your SMTP configuration is working properly on localhost. Booking notifications will now be delivered to your inbox.',
      html: `
        <div style="font-family: sans-serif; max-width: 500px; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h2 style="color: #2563eb; margin-top: 0;">SMTP Test Successful</h2>
          <p>Your localhost email configuration is working perfectly.</p>
          <p>When you reserve a conference room or invite colleagues, notifications will land in this inbox!</p>
        </div>
      `,
    });

    console.log('🎉 Email sent successfully! Message ID:', info.messageId);
    console.log(`Please check your inbox at ${targetRecipient}`);
  } catch (err) {
    console.error('\n❌ SMTP Verification Failed:');
    console.error(err.message);
    if (err.message.includes('Invalid login') || err.message.includes('Username and Password not accepted')) {
      console.error('\n💡 Tip for Gmail users:');
      console.error('Google requires a 16-character "App Password" (not your normal Gmail password).');
      console.error('Generate one at: https://myaccount.google.com/apppasswords');
    }
  }
}

testSmtp();
