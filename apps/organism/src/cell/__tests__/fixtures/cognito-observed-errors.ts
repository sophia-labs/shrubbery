/**
 * FIXTURE, not behaviour: the Cognito answers `H-oauth-connectors.md` recorded on
 * the two real first-after-idle sign-ups on Sirin, quoted as observed.
 *
 *   2026-07-12T22:20:26Z and 2026-08-07T17:10:26Z
 *   1. ConfirmSignUp        -> UnexpectedLambdaException
 *                              "PostConfirmation invocation failed due to error
 *                               CodeArtifactUserPendingException"
 *      (the idle PostConfirmation Lambda failed while it restored; the confirmation
 *       itself had already committed, so the user was CONFIRMED afterwards)
 *   2. ConfirmSignUp again  -> NotAuthorizedException
 *                              "User cannot be confirmed. Current status is CONFIRMED"
 *   3. ResendConfirmationCode -> InvalidParameterException "User is already confirmed."
 *
 * What the person saw before this fix: the raw first sentence; then "Incorrect
 * username or password."; then "Invalid input. Please check your entries." All three
 * wrong for someone whose account was confirmed and who only needed to sign in.
 *
 * The rest are neighbours that must NOT be read as "your account is confirmed".
 * Cognito's wire shape: HTTP 400, `{"__type": "<Exception>", "message": "..."}`.
 */

export interface CognitoErrorBody {
  readonly __type: string
  readonly message: string
}

/** 1. The first confirmation, when the idle PostConfirmation trigger fails. */
export const POST_CONFIRMATION_FAILED: CognitoErrorBody = {
  __type: 'UnexpectedLambdaException',
  message: 'PostConfirmation invocation failed due to error CodeArtifactUserPendingException',
}

/** 2. The retry of a confirmation that had in fact succeeded. */
export const CONFIRM_OF_CONFIRMED: CognitoErrorBody = {
  __type: 'NotAuthorizedException',
  message: 'User cannot be confirmed. Current status is CONFIRMED',
}

/** 3. Resend for a user who is already confirmed. */
export const RESEND_FOR_CONFIRMED: CognitoErrorBody = {
  __type: 'InvalidParameterException',
  message: 'User is already confirmed.',
}

// Neighbours that are not "confirmed".

export const WRONG_PASSWORD: CognitoErrorBody = {
  __type: 'NotAuthorizedException',
  message: 'Incorrect username or password.',
}

export const SIGN_IN_BEFORE_CONFIRMING: CognitoErrorBody = {
  __type: 'UserNotConfirmedException',
  message: 'User is not confirmed.',
}

export const WRONG_CODE: CognitoErrorBody = {
  __type: 'CodeMismatchException',
  message: 'Invalid verification code provided, please try again.',
}

/** Another trigger failing is not proof of anything about confirmation. */
export const PRE_SIGN_UP_FAILED: CognitoErrorBody = {
  __type: 'UnexpectedLambdaException',
  message: 'PreSignUp invocation failed due to error ResourceNotFoundException',
}

/** A confirmation that cannot happen because of some OTHER status. */
export const CONFIRM_OF_FORCE_CHANGE_PASSWORD: CognitoErrorBody = {
  __type: 'NotAuthorizedException',
  message: 'User cannot be confirmed. Current status is FORCE_CHANGE_PASSWORD',
}

/** An InvalidParameterException about something else entirely. */
export const INVALID_PARAMETER_ELSEWHERE: CognitoErrorBody = {
  __type: 'InvalidParameterException',
  message: 'Cannot reset password for the user as there is no registered/verified email or phone_number',
}
