/**
 * Where the shell decides "phone": the mobile shell's compact posture and the top bar's fold (`mn-top-bar`,
 * `@media (max-width: 600px)`). One query, so a feature hidden on phones (Files, Vera 2026-10-06) hides exactly where
 * the shell already turns into its phone layout.
 */
export const PHONE_BREAKPOINT_QUERY = '(max-width: 600px)'
