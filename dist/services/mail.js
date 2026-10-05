"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendOneTimeCode = sendOneTimeCode;
const nodemailer_1 = __importDefault(require("nodemailer"));
const config_1 = require("../config");
const transport = config_1.env.SMTP_HOST
    ? nodemailer_1.default.createTransport({
        host: config_1.env.SMTP_HOST,
        port: config_1.env.SMTP_PORT,
        secure: config_1.env.SMTP_SECURE === 'true',
        family: 4,
        auth: config_1.env.SMTP_USER
            ? {
                user: config_1.env.SMTP_USER,
                pass: config_1.env.SMTP_PASSWORD,
            }
            : undefined,
    })
    : null;
async function sendOneTimeCode(email, code, purpose) {
    if (!transport) {
        throw new Error('Email service is not configured. Set the SMTP environment variables.');
    }
    const verification = purpose === 'verify';
    await transport.sendMail({
        from: config_1.env.EMAIL_FROM,
        to: email,
        subject: verification
            ? 'Verify your Smart Krushi email'
            : 'Reset your Smart Krushi password',
        text: verification
            ? `Your email verification code is ${code}. It expires in ${config_1.env.EMAIL_VERIFICATION_MINUTES} minutes.`
            : `Your password reset code is ${code}. It expires in ${config_1.env.PASSWORD_RESET_MINUTES} minutes.`,
        html: `
      <p>${verification ? 'Your email verification code is' : 'Your password reset code is'}:</p>
      <p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p>
      <p>This code expires soon. If you did not request it, ignore this email.</p>
    `,
    });
}
