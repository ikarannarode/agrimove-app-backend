import { BrevoClient } from '@getbrevo/brevo';
import { env } from '../config';

const brevo = env.BREVO_API_KEY
  ? new BrevoClient({ apiKey: env.BREVO_API_KEY })
  : null;

const senderMatch = env.EMAIL_FROM.match(/^(.*?)\s*<([^<>]+)>$/);
const senderName = senderMatch?.[1]?.trim() ?? '';
const senderEmail = senderMatch?.[2]?.trim() ?? env.EMAIL_FROM.trim();
const sender = senderName
  ? { email: senderEmail, name: senderName }
  : { email: senderEmail };

export async function sendOneTimeCode(
  email: string,
  code: string,
  purpose: 'verify' | 'reset'
) {
  if (!brevo) {
    throw new Error(
      'Email service is not configured. Set the BREVO_API_KEY environment variable.'
    );
  }

  const verification = purpose === 'verify';

  await brevo.transactionalEmails.sendTransacEmail({
    sender,
    to: [{ email }],
    subject: verification
      ? 'Verify your Smart Krushi email'
      : 'Reset your Smart Krushi password',
    textContent: verification
      ? `Your email verification code is ${code}. It expires in ${env.EMAIL_VERIFICATION_MINUTES} minutes.`
      : `Your password reset code is ${code}. It expires in ${env.PASSWORD_RESET_MINUTES} minutes.`,
    htmlContent: `
      <p>
        ${verification
          ? 'Your email verification code is'
          : 'Your password reset code is'}:
      </p>
      <p style="font-size:28px;font-weight:bold;letter-spacing:6px">
        ${code}
      </p>
      <p>This code expires soon. If you did not request it, ignore this email.</p>
    `,
  });
}