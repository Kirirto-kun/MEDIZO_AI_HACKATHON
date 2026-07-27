/**
 * Stable marker appended to the embedded DocJob Android surface's user
 * agent. Keep this module dependency-free: it is shared by React Native,
 * browser code, route handlers, and Edge middleware.
 */
export const DOCJOB_MOBILE_USER_AGENT_TOKEN = 'DocJobMobile';

/** Returns true only for requests coming from the embedded mobile surface. */
export function isDocJobMobileUserAgent(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.includes(DOCJOB_MOBILE_USER_AGENT_TOKEN);
}
