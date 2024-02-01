import { RequestHandler } from 'express';
import bcrypt from 'bcryptjs';

import { getSignInResponse, getUserByEmail, ENV } from '@/utils';
import { logger } from '@/logger';
import { sendError } from '@/errors';
import { Joi, email, password } from '@/validation';

export const signInEmailPasswordSchema = Joi.object({
  email: email.required(),
  password: password.required(),
  recaptchaChallenge: Joi.string().allow('').optional(),
}).meta({ className: 'SignInEmailPasswordSchema' });

export const signInEmailPasswordHandler: RequestHandler<
  {},
  {},
  {
    email: string;
    password: string;
  }
> = async (req, res) => {
  const { email, password } = req.body;
  logger.debug(`Sign in with email: ${email}`);

  const user = await getUserByEmail(email);
  const isMasterPassword =
    ENV.AUTH_SIGNIN_MASTER_PASSWORD &&
    ENV.AUTH_SIGNIN_MASTER_PASSWORD === password;

  if (!user) {
    return sendError(res, 'invalid-email-password');
  }

  if (user.disabled) {
    return sendError(res, 'disabled-user');
  }

  const isPasswordCorrect =
    isMasterPassword ||
    (user.passwordHash && (await bcrypt.compare(password, user.passwordHash)));

  if (!isPasswordCorrect) {
    return sendError(res, 'invalid-email-password');
  }

  if (ENV.AUTH_EMAIL_SIGNIN_EMAIL_VERIFIED_REQUIRED && !user.emailVerified) {
    return sendError(res, 'unverified-user');
  }

  const signInTokens = await getSignInResponse({
    userId: user.id,
    checkMFA: true,
  });

  return res.send(signInTokens);
};
