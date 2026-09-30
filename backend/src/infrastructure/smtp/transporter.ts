import nodemailer from "nodemailer";

import { env } from "../../config/env.js";

export const smtpTransporter = nodemailer.createTransport({
  host: env.ETHEREAL_HOST,
  port: env.ETHEREAL_PORT,
  secure: env.ETHEREAL_PORT === 465,
  auth: {
    user: env.ETHEREAL_USER,
    pass: env.ETHEREAL_PASSWORD,
  },
});

export async function verifySmtpConnection() {
  await smtpTransporter.verify();
}
