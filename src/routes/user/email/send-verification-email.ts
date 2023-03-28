import { RequestHandler } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { ReasonPhrases } from 'http-status-codes';

import {
  generateTicketExpiresAt,
  getUserByEmail,
  ENV,
  createEmailRedirectionLink,
  pgClient,
} from '@/utils';
import { sendEmail } from '@/email';
import { sendError } from '@/errors';
import { Joi, email, redirectTo } from '@/validation';
import { EMAIL_TYPES } from '@/types';
import { logger } from '@/logger';

export const userEmailSendVerificationEmailSchema = Joi.object({
  email: email.required(),
  options: Joi.object({
    redirectTo,
  }).default(),
}).meta({ className: 'UserEmailSendVerificationEmailSchema' });

export const userEmailSendVerificationEmailHandler: RequestHandler<
  {},
  {},
  {
    email: string;
    options: {
      redirectTo: string;
    };
  }
> = async (req, res) => {
  const {
    email,
    options: { redirectTo },
  } = req.body;

  const user = await getUserByEmail(email);

  if (!user) {
    return sendError(res, 'user-not-found');
  }

  if (user.emailVerified) {
    return sendError(res, 'email-already-verified');
  }

  // TODO: possibly check when last email was sent to minimize abuse
  // TODO use createVerifyEmailTicket()
  const ticket = `verifyEmail:${uuidv4()}`;
  const ticketExpiresAt = generateTicketExpiresAt(60 * 60 * 24 * 30); // 30 days

  // set newEmail for user
  await pgClient.updateUser({
    id: user.id,
    user: {
      ticket,
      ticketExpiresAt,
    },
  });

  const template = 'email-verify';
  const link = createEmailRedirectionLink(
    EMAIL_TYPES.VERIFY,
    ticket,
    redirectTo
  );

  const appLink = createEmailRedirectionLink(
    EMAIL_TYPES.VERIFY,
    ticket,
    'barooders://auth-callback'
  );

  logger.error({ link, appLink, title: 'send-verification-email' });

  await sendEmail({
    template,
    message: {
      to: email,
      headers: {
        'x-ticket': {
          prepared: true,
          value: ticket,
        },
        'x-redirect-to': {
          prepared: true,
          value: redirectTo,
        },
        'x-email-template': {
          prepared: true,
          value: template,
        },
        'x-link': {
          prepared: true,
          value: link,
        },
      },
    },
    locals: {
      link,
      appLink,
      displayName: user.displayName,
      email: user.email,
      newEmail: user.newEmail,
      ticket,
      redirectTo: encodeURIComponent(redirectTo),
      locale: user.locale ?? ENV.AUTH_LOCALE_DEFAULT,
      serverUrl: ENV.AUTH_SERVER_URL,
      clientUrl: ENV.AUTH_CLIENT_URL,
    },
  });

  return res.json(ReasonPhrases.OK);
};
