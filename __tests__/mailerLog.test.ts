// Week 9 audit finding: with no email service set up, the mailer printed the whole password-reset email, including
// a working reset link, to the server log. Fine on your own computer (the README says the link is printed);
// not on a deployment, whose logs more people can read. A server with API keys switched on is a deployment.

import { unsentNotice } from '../mailer';

const mail = { to: 'amina@example.com', subject: 'Reset your Kazi Connect password', text: 'Use this link:\nhttp://localhost:3000/#reset=0123456789abcdef0123456789abcdef' };

describe('what the mailer prints when no email service is set up', () => {
  it('on your own computer prints the whole message, so the reset link can be followed from the terminal', () => {
    const notice = unsentNotice(mail, false);

    expect(notice).toContain('#reset=0123456789abcdef0123456789abcdef');
    expect(notice).toContain(mail.to);
  });

  it('on a deployment prints only a note: who, which message, and what to set, but never the link or the token', () => {
    const notice = unsentNotice(mail, true);

    expect(notice).toContain(mail.to);
    expect(notice).toContain(mail.subject);
    expect(notice).toContain('BREVO_API_KEY');
    expect(notice).not.toContain('#reset=');
    expect(notice).not.toContain('0123456789abcdef');
    expect(notice).not.toContain('Use this link');
  });
});
