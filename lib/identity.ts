// Telling students apart (Endpoints 7, 8 and 9).
//
// Students log in with their email, which holds one account only, and the server gives every account its own ID
// (usr_...). An ID a partner such as Ujuzi sends, like stu_0042, is the partner's own and is not checked here.
// An account ID is different: the server made it, so it names exactly one person, and only that person, logged in,
// may use it. Otherwise anyone could type another student's account ID, and the application would appear in that
// student's own list (Endpoint 19), under their name for the employer, and could be changed or withdrawn by anyone.

import type { ApplicationRow, UserRow } from './storeTypes';

const ACCOUNT_ID = /^usr_/i;

export const isAccountId = (studentId: string): boolean => ACCOUNT_ID.test(studentId.trim());

// Endpoint 7: the [status, message] to refuse with, or null when this caller may apply as this studentId.
export function whyNotApplicant(studentId: string, user: UserRow | null): [number, string] | null {
  if (user) {
    if (user.role !== 'student') return [403, 'Only students can do this.'];
    if (studentId !== user._id) return [400, `studentId must be your own account ID, ${user._id}, when you are logged in`];
    return null;
  }
  if (isAccountId(studentId)) return [400, `studentId ${studentId} is a Kazi Connect account ID. Log in as that student to apply with it.`];
  return null;
}

// Endpoints 8 and 9: the [status, message] to refuse with, or null when this caller may change or withdraw it.
// Applications made from an account belong to that account; all others work as before, with no login.
export function whyNotOwner(row: ApplicationRow, user: UserRow | null, verb: 'change' | 'withdraw'): [number, string] | null {
  if (!isAccountId(row.student_id)) return null;
  if (!user) return [401, `Application ${row._id} was made from a Kazi Connect account. Log in as that student to ${verb} it.`];
  if (user._id !== row.student_id) return [403, `You can only ${verb} your own applications.`];
  return null;
}
