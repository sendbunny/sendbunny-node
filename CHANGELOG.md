# Changelog

## 0.1.0 (unreleased)

First release.

- Every call returns `{ data, error }` and never throws, like the Resend SDK, so code written for Resend moves over by changing two lines.
- `emails.send`: send HTML, text, a React Email component (`react`), or a SendBunny template.
- `emails.get` and `emails.list`: look up sent email and its status.
- `contacts.create`, `contacts.get`, `contacts.update`, `contacts.list` and `contacts.remove`.
- `events.track`: report something that happened in your app, to start automations (SendBunny Premium).
- `webhooks.verify` and `verifyWebhook`: check a webhook's signature and read its events. These throw when a request is not genuine.
- Errors carry a `code` (like `validation_error`, `unauthorized`, `premium_required`), the HTTP `status`, and `uncertain` when a failed call may still have been carried out.
- Settings from `SENDBUNNY_URL`, `SENDBUNNY_API_KEY`, `SENDBUNNY_DOMAIN` and `SENDBUNNY_WEBHOOK_SECRET`.
