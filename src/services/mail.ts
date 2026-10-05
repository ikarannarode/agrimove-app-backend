import nodemailer from 'nodemailer';
import { env } from '../config';

const transport = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE === 'true',
      family: 4,
      auth: env.SMTP_USER
        ? {
            user: env.SMTP_USER,
            pass: env.SMTP_PASSWORD,
          }
        : undefined,
    })
  : null;

export async function sendOneTimeCode(
  email: string,
  code: string,
  purpose: 'verify' | 'reset'
) {
  if (!transport) {
    throw new Error(
      'Email service is not configured. Set the SMTP environment variables.'
    );
  }

  const verification = purpose === 'verify';

  await transport.sendMail({
    from: env.EMAIL_FROM,
    to: email,
    subject: verification
      ? 'Verify your Smart Krushi email'
      : 'Reset your Smart Krushi password',
    text: verification
      ? `Your email verification code is ${code}. It expires in ${env.EMAIL_VERIFICATION_MINUTES} minutes.`
      : `Your password reset code is ${code}. It expires in ${env.PASSWORD_RESET_MINUTES} minutes.`,
    html: `
      <p>${verification ? 'Your email verification code is' : 'Your password reset code is'}:</p>
      <p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p>
      <p>This code expires soon. If you did not request it, ignore this email.</p>
    `,
  });
}