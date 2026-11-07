# SendBunny Node.js SDK

[![npm version](https://img.shields.io/npm/v/sendbunny.svg)](https://www.npmjs.com/package/sendbunny)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

The official Node.js SDK for [SendBunny](https://sendbunny.co/?utm_source=github&utm_medium=readme&utm_campaign=sendbunny-node), the email platform that runs in your own AWS account. Send email with HTML, text or [React Email](https://react.email), manage contacts, track events and verify webhooks. No dependencies.

## Install

```bash
npm install sendbunny
```

## Setup

Copy these from your SendBunny install's **API keys** page:

```bash
# .env
SENDBUNNY_URL=https://mail.acme.com/api/v1  # "HTTP API base URL"
SENDBUNNY_API_KEY=sb...                     # create a key there
SENDBUNNY_DOMAIN=acme.com                   # your sending domain
```

```js
import { SendBunny } from "sendbunny"

const sendbunny = new SendBunny()
```

Or pass them in code: `new SendBunny({ url, apiKey, domain })`.

## Send your first email

```js
const { data, error } = await sendbunny.emails.send({
  from: "Acme <hello@acme.com>",
  to: "ana@example.com",
  subject: "Hello world",
  html: "<strong>It works!</strong>",
})

if (error) {
  console.error(error.message)
} else {
  console.log(`Sent email ${data.id}`)
}
```

Every call returns `{ data, error }`. It never throws, so there is no `try` and `catch` to write.

## Send email

### HTML and text

```js
await sendbunny.emails.send({
  from: "Acme <hello@acme.com>",
  to: ["ana@example.com", "ben@example.com"],
  cc: "team@acme.com",
  replyTo: "support@acme.com",
  subject: "Your invoice",
  html: "<p>Your invoice is ready.</p>",
  text: "Your invoice is ready.",
})
```

### React Email

Build your email as a React component with [React Email](https://react.email), then pass it as `react`. Add React Email to your project first:

```bash
npm install @react-email/components @react-email/render
```

```tsx
// emails/welcome.tsx
import { Body, Button, Heading, Html, Text } from "@react-email/components"

export function WelcomeEmail({ name }: { name: string }) {
  return (
    <Html>
      <Body>
        <Heading>Welcome, {name}!</Heading>
        <Text>Thanks for signing up.</Text>
        <Button href="https://acme.com/start">Get started</Button>
      </Body>
    </Html>
  )
}
```

```tsx
import { WelcomeEmail } from "./emails/welcome"

const { data, error } = await sendbunny.emails.send({
  from: "Acme <hello@acme.com>",
  to: "ana@example.com",
  subject: "Welcome to Acme",
  react: <WelcomeEmail name="Ana" />,
})
```

The SDK turns the component into HTML and a plain-text version on your server, then sends both. In a `.js` file without JSX, write `react: createElement(WelcomeEmail, { name: "Ana" })`, with `createElement` imported from `react`.

### Templates

Use a template designed in SendBunny, filling in its placeholders:

```js
await sendbunny.emails.send({
  from: "Acme <hello@acme.com>",
  to: "ana@example.com",
  templateAlias: "password-reset",
  data: { name: "Ana", resetUrl: "https://acme.com/reset/abc123" },
})
```

SendBunny does not support `bcc`, `attachments`, `tags`, custom `headers` or scheduled sending yet. If you pass them, the email is refused with a clear error instead of going out without them.

## Look up sent email

```js
const { data, error } = await sendbunny.emails.get("bcf17da4-2d8d-43f0-8052-95033039e328")
if (!error) console.log(data.status) // "delivered"

// Newest first, a page at a time
const { data: page } = await sendbunny.emails.list({ limit: 20 })
```

## Contacts

```js
// Add someone, or update them if they are already a contact
await sendbunny.contacts.create({
  email: "ana@example.com",
  name: "Ana",
  status: "subscribed", // or "never_subscribed" for a customer who never asked for marketing email
  listId: "8f14e45f-ceea-467f-a8f2-8b5c7d1e2a90",
  fields: { plan: "Pro" },
})

await sendbunny.contacts.get("ana@example.com")
await sendbunny.contacts.update({ email: "ana@example.com", fields: { plan: "Team" } })
await sendbunny.contacts.list({ limit: 50 })
await sendbunny.contacts.remove("ana@example.com")
```

`status` is needed for someone new. Someone who unsubscribed stays unsubscribed, whatever you send.

## Events

Tell SendBunny something happened in your app. Automations that start on that event begin for that person. Automations are part of SendBunny Premium.

```js
await sendbunny.events.track({
  email: "ana@example.com",
  event: "trial_started",
  data: { plan: "Pro" },
})
```

## Webhooks

SendBunny signs every webhook. Check the signature before you trust a request. Add the webhook's signing secret, shown on its page in SendBunny:

```bash
SENDBUNNY_WEBHOOK_SECRET=whsec_...
```

`webhooks.verify` needs the **raw** request body, exactly as it arrived. Unlike the other calls, it throws when a request is not genuine, so a forgotten check can never let a fake one through.

Next.js (App Router), or any handler that gets a `Request`:

```js
import { SendBunny } from "sendbunny"

const sendbunny = new SendBunny()

export async function POST(request) {
  try {
    const events = await sendbunny.webhooks.verify(await request.text(), request.headers)
    for (const event of events) {
      console.log(event.type, event.data) // "email.delivered", "email.bounced", ...
    }
    return new Response(null, { status: 200 })
  } catch {
    return new Response(null, { status: 400 })
  }
}
```

Express:

```js
import express from "express"
import { verifyWebhook } from "sendbunny"

const app = express()

app.post("/webhooks/sendbunny", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const events = await verifyWebhook(req.body, req.headers)
    // handle events
    res.sendStatus(200)
  } catch {
    res.sendStatus(400)
  }
})
```

Requests more than 5 minutes old are refused, so a captured request cannot be replayed. A delivery can arrive twice: skip event `id`s you have already handled.

## Errors

When a call fails, `error` says why:

```js
const { error } = await sendbunny.emails.send({ /* ... */ })

if (error) {
  console.error(error.code, error.status, error.message)
  // "validation_error" 400 "'to' contains an invalid address: ana@"
}
```

| `error.code` | What happened |
|---|---|
| `validation_error` | Something in the call is missing or wrong. The message says what. |
| `unauthorized` | The API key is wrong or was revoked. |
| `forbidden` | The key may not do this. |
| `premium_required` | This needs SendBunny Premium. |
| `not_found` | No such email or contact. |
| `rate_limited` | Too many requests. Wait `error.retryAfter` seconds. |
| `server_error` | SendBunny had a problem. |
| `network`, `timeout` | No answer from SendBunny (calls wait 30 seconds by default). |

The full list is in [`SendBunnyErrorCode`](./src/errors.ts).

**Nothing is retried automatically**, because a repeated send could deliver the same email twice. `error.uncertain` tells you whether a failed call may still have been carried out:

- `false`: it was not. Fix the cause and try again.
- `true`: it may have been, after a timeout, a dropped connection or a server error. Check the email log before sending again.

## Coming from Resend?

Change two lines:

```diff
- import { Resend } from "resend"
- const resend = new Resend(process.env.RESEND_API_KEY)
+ import { SendBunny } from "sendbunny"
+ const resend = new SendBunny()
```

Your `resend.emails.send(...)` calls keep working: the same fields (`from`, `to`, `subject`, `html`, `text`, `react`, `cc`, `replyTo`), the same `{ data, error }` result and the same `data.id`. Error details are in `error.code` and `error.status`. Not supported yet: `bcc`, `attachments`, `tags`, `headers` and `scheduledAt`.

## Options

```js
const sendbunny = new SendBunny({
  timeoutMs: 10_000, // give up after 10 seconds (default 30)
})

// Any call can be cancelled, or given its own time limit
await sendbunny.emails.send(email, { signal: AbortSignal.timeout(5_000) })
```

## Security

- **Server only.** The SDK refuses to start in a web page, where your API key would be visible to every visitor.
- **Your key goes to your install only.** HTTPS is required, and redirects are never followed.
- **Your key stays out of logs.** It never appears in error messages, `console.log` or `JSON.stringify`.
- **No dependencies.** React Email is an add-on you install only if you use it.
- **Verified releases.** Every version is built from this repository by GitHub Actions and approved by a maintainer with two-step login. Check yours with `npm audit signatures`.
- **Least privilege.** A **Send mail** key can only send and look up its own emails. Contacts and events need a key with **Audience** or **Automations** access.

Found a security problem? Please report it privately, as described in [SECURITY.md](./SECURITY.md).

## Runtimes

Tested on Node.js 20, 22 and 24, with `import` or `require`. It uses only web standards (`fetch` and Web Crypto), so it is made to run on Bun, Deno and edge runtimes too. On Cloudflare Workers, pass `url`, `apiKey` and `webhookSecret` from your Worker's `env`.

## About SendBunny

SendBunny is an email platform that runs in your own AWS account: sending, contacts, automations, an inbox, and an MCP server so your AI agent can run your email too. SendBunny Free costs nothing; you pay Amazon only for what you send, about $0.10 per 1,000 emails. [Get it free at sendbunny.co](https://sendbunny.co/?utm_source=github&utm_medium=readme&utm_campaign=sendbunny-node).

## License

[MIT](./LICENSE)
