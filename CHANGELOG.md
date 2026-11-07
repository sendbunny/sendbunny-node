# Changelog

## 0.1.2 (2026-11-07)

No change to how the SDK works: the same calls, the same results, the same type definitions.

- The npm page now says what SendBunny is, what it costs, and the two things you need before you start (an AWS account and Amazon SES access, both free).
- Built with TypeScript 7.

## 0.1.1 (2026-11-07)

First release. (0.1.0 was tagged but never published: its release stopped at the final package check.)

- Every call returns `{ data, error }` and never throws, like the Resend SDK, so code written for Resend moves over by changing two lines.
- `emails.send`: send HTML, text, a React Email component (`react`), or a SendBunny template.
- `emails.get` and `emails.list`: look up sent email and its status.
- `contacts.create`, `contacts.get`, `contacts.update`, `contacts.list` and `contacts.remove`.
- `events.track`: report something that happened in your app, to start automations (SendBunny Premium).
- `webhooks.verify` and `verifyWebhook`: check a webhook's signature and read its events. These throw when a request is not genuine.
- Errors carry a `code` (like `validation_error`, `unauthorized`, `premium_required`), the HTTP `status`, and `uncertain` when a failed call may still have been carried out.
- Settings from `SENDBUNNY_URL`, `SENDBUNNY_API_KEY`, `SENDBUNNY_DOMAIN` and `SENDBUNNY_WEBHOOK_SECRET`.
