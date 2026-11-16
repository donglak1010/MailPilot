import type { AuthError } from '@supabase/supabase-js'

/** Map Supabase Auth errors to user-facing messages without leaking internals. */
export function authErrorMessage(error: AuthError | Error): string {
  const code = 'code' in error ? error.code : undefined
  switch (code) {
    case 'invalid_credentials':
      return 'Email or password is incorrect.'
    case 'email_not_confirmed':
      return 'Please confirm your email address first — check your inbox.'
    case 'user_already_exists':
    case 'email_exists':
      return 'An account with this email already exists. Try signing in.'
    case 'weak_password':
      return 'This password is too weak. Use a longer, less common password.'
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'Too many attempts. Please wait a minute and try again.'
    case 'signup_disabled':
      return 'New sign-ups are currently closed.'
    case 'same_password':
      return 'Choose a password different from your current one.'
    default:
      return error.message || 'Something went wrong. Please try again.'
  }
}
