import { SetMetadata } from "@nestjs/common";

export const IS_ENROLMENT_ALLOWED_KEY = "isEnrolmentAllowed";

/**
 * Reachable by someone who has signed in but not yet set up two-factor, on a
 * deployment that requires it.
 *
 * That session is a real one — it passed the password step — but it is held at
 * the enrolment gate, and this marks the handful of routes it needs in order to
 * get through: read who it is, set up a second factor, or give up and sign out.
 * Everything else is refused by the guard.
 *
 * It is a decorator rather than a list of paths in the guard on purpose. A path
 * list rots the first time a route is renamed, and it rots in the dangerous
 * direction — silently letting a session through, or silently walling off the
 * one screen that could rescue it.
 */
export const EnrolmentAllowed = () => SetMetadata(IS_ENROLMENT_ALLOWED_KEY, true);
