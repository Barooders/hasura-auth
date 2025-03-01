import { RequestHandler } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { ReasonPhrases } from 'http-status-codes';

import { sendEmail } from '@/email';
import {
  getUserByEmail,
  generateTicketExpiresAt,
  ENV,
  createEmailRedirectionLink,
  pgClient,
} from '@/utils';
import { sendError } from '@/errors';
import { Joi, email, redirectTo } from '@/validation';
import { EMAIL_TYPES } from '@/types';

export const userPasswordResetSchema = Joi.object({
  email: email.required(),
  options: Joi.object({
    redirectTo,
  }).default(),
  recaptchaChallenge: Joi.string().allow('').optional(),
}).meta({ className: 'UserPasswordResetSchema' });

export const userPasswordResetHandler: RequestHandler<
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

  if (!user || user.disabled) {
    return sendError(res, 'user-not-found');
  }

  const ticket = `${EMAIL_TYPES.PASSWORD_RESET}:${uuidv4()}`;
  const ticketExpiresAt = generateTicketExpiresAt(60 * 60); // 1 hour

  await pgClient.updateUser({
    id: user.id,
    user: {
      ticket,
      ticketExpiresAt,
    },
  });

  const template = 'password-reset';
  const link = createEmailRedirectionLink(
    EMAIL_TYPES.PASSWORD_RESET,
    ticket,
    redirectTo
  );

  const appLink = createEmailRedirectionLink(
    EMAIL_TYPES.PASSWORD_RESET,
    ticket,
    'barooders://auth-callback'
  );

  await sendEmail({
    template,
    locals: {
      link,
      appLink,
      displayName: user.displayName,
      email,
      newEmail: user.newEmail,
      ticket,
      redirectTo: encodeURIComponent(redirectTo),
      locale: user.locale ?? ENV.AUTH_LOCALE_DEFAULT,
      serverUrl: ENV.AUTH_SERVER_URL,
      clientUrl: ENV.AUTH_CLIENT_URL,
    },
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
  });

  return res.json(ReasonPhrases.OK);
};
