import { defineAuth } from '@aws-amplify/backend';

/**
 * Authentication configuration for the HR App.
 * Relies strictly on Email/Password logins and eliminates 
 * the retention of user names or extra PII.
 */
export const auth = defineAuth({
  loginWith: {
    email: {
      verificationEmailStyle: 'CODE',
      verificationEmailSubject: 'Verify Your HR App Account',
      verificationEmailBody: (createCode) => 
        `Your secure verification code for the Candidate Ranking App is: ${createCode()}`
    }
  }
});
