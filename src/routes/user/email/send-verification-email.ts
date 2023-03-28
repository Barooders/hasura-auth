import { RequestHandler } from 'express';
import { ReasonPhrases } from 'http-status-codes';
import { v4 as uuidv4 } from 'uuid';

import { sendEmail } from '@/email';
import { sendError } from '@/errors';
import { EMAIL_TYPES } from '@/types';
import {
  createEmailRedirectionLink, ENV, generateTicketExpiresAt,
  getUserByEmail, pgClient
} from '@/utils';
import { email, Joi, redirectTo } from '@/validation';

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
