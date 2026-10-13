import { describe, expect, it } from 'vitest';
import { createResendMailer } from '../../src/mail/mailer.js';
import { fakeFetch } from '../helpers/fakes.js';

describe('Resend mailer', () => {
  it('posts to the Resend API with auth and reply_to', async () => {
    const f = fakeFetch(() => ({ body: { id: 'x' } }));
    await createResendMailer({ apiKey: 're_test', from: 'noticely <hello@noticely.dev>', fetch: f.fetch })
      .send({ to: 'a@b.test', subject: 'Hi', text: 'Body', replyTo: 'c@d.test' });
    expect(f.calls[0]?.url).toBe('https://api.resend.com/emails');
    expect(JSON.parse(f.calls[0]?.body ?? '{}')).toEqual({ from: 'noticely <hello@noticely.dev>', to: ['a@b.test'], subject: 'Hi', text: 'Body', reply_to: 'c@d.test' });
  });

  it('sends the HTML version when there is one', async () => {
    const f = fakeFetch(() => ({ body: { id: 'x' } }));
    await createResendMailer({ apiKey: 'k', from: 'x <x@y.z>', fetch: f.fetch }).send({ to: 'a@b.test', subject: 's', text: 't', html: '<p>t</p>' });
    expect(JSON.parse(f.calls[0]?.body ?? '{}')).toMatchObject({ text: 't', html: '<p>t</p>' });
  });

  it('throws when Resend rejects the email', async () => {
    const f = fakeFetch(() => ({ status: 422, body: { message: 'bad' } }));
    await expect(createResendMailer({ apiKey: 'k', from: 'x <x@y.z>', fetch: f.fetch }).send({ to: 'a@b.test', subject: 's', text: 't' }))
      .rejects.toThrow(/422/);
  });
});
