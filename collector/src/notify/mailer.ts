/** The SMTP side of the email channel. Thin on purpose: everything testable lives in channels.ts. */
import nodemailer from 'nodemailer';
import type { Mailer } from './channels.js';

export function createMailer(smtpUrl: string, timeoutMs: number): Mailer {
  const transport = nodemailer.createTransport(smtpUrl, { connectionTimeout: timeoutMs, greetingTimeout: timeoutMs, socketTimeout: timeoutMs });
  return async (mail) => {
    await transport.sendMail(mail);
  };
}
