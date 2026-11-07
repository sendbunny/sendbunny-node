# SendBunny for Node.js

Send email from your app through your own [SendBunny](https://sendbunny.co/?utm_source=github&utm_medium=readme&utm_campaign=sendbunny-node) install. One small package with no dependencies, made to be safe by default.

```js
import { SendBunny } from "sendbunny"

const sendbunny = new SendBunny()

await sendbunny.emails.send({
  from: "Acme <hello@acme.com>",
  to: "ana@example.com",
  subject: "Welcome to Acme",
  html: "<p>Thanks for signing up!</p>",
})
```

Works with Node.js 20.3+, Bun, Deno, Cloudflare Workers and Vercel. Fully typed for TypeScript.

## Install

```bash
npm install sendbunny
```

## Set up

Your SendBunny install has its own address, so the SDK needs two settings. Both are on your install's **API keys** page.

```bash
# .env
SENDBUNNY_URL=https://mail.acme.com/api/v1   # "HTTP API base URL" on the API keys page
SENDBUNNY_API_KEY=sb...                      # create a key there
```

`new SendBunny()` reads them. You can also pass them yourself: `new SendBunny({ url, apiKey })`.

Give each app the smallest key that does its job. A **Send mail** key can only send, and only sees the emails it sent itself. Keys can also be limited to certain sending addresses.

## Send email

Written in your code:

```js
const { id } = await sendbunny.emails.send({
  from: "hello@acme.com",
  to: ["ana@example.com", "ben@example.com"],
  replyTo: "support@acme.com",
  subject: "Your invoice",
  html: "<p>Here it is.</p>",
  text: "Here it is.",
})
```

From a template designed in SendBunny:

```js
await sendbunny.emails.send({
  from: "hello@acme.com",
  to: "ana@example.com",
  templateAlias: "password-reset",
  data: { name: "Ana", resetUrl: "https://acme.com/reset/abc123" },
})
```

## Add a contact

```js
const sendbunny = new SendBunny({ domain: "acme.com" }) // your sending domain

await sendbunny.contacts.add({
  email: "ana@example.com",
  name: "Ana",
  status: "subscribed",                      // or "never_subscribed" for a customer who never asked for marketing email
  agreed: { how: "form", note: "Send me product news" },
  listId: "lst_...",
  fields: { plan: "Pro" },
})
```

Adding someone who is already a contact updates them. Someone who unsubscribed stays unsubscribed.

## Track an event

Tell SendBunny something happened in your app. Automations that start on that event begin for that person.

```js
await sendbunny.events.track({
  email: "ana@example.com",
  event: "trial_started",
  data: { plan: "Pro" },
})
```

## Receive webhooks

SendBunny signs every webhook. Check the signature before you trust a request. Add the webhook's signing secret (on the webhook's page in SendBunny, it starts with `whsec_`):

```bash
SENDBUNNY_WEBHOOK_SECRET=whsec_...
```

The check needs the **raw** request body, exactly as it arrived.

Express:

```js
import express from "express"
import { verifyWebhook } from "sendbunny"

const app = express()

app.post("/webhooks/sendbunny", express.raw({ type: "application/json" }), async (req, res) => {
  let events
  try {
    events = await verifyWebhook(req.body, req.headers)
  } catch {
    return res.sendStatus(400)
  }
  for (const event of events) {
    console.log(event.type, event.data) // "email.delivered", "email.bounced", ...
  }
  res.sendStatus(200)
})
```

Next.js (App Router), or any Fetch-style handler:

```js
import { verifyWebhook } from "sendbunny"

export async function POST(request) {
  try {
    const events = await verifyWebhook(await request.text(), request.headers)
    // handle events
    return new Response(null, { status: 200 })
  } catch {
    return new Response(null, { status: 400 })
  }
}
```

`verifyWebhook` always returns a list of events. It refuses requests whose signature is wrong, and requests more than 5 minutes old, so a captured request cannot be replayed later. A delivery can arrive twice: each event has a stable `id`, so skip ids you have already handled.

## Errors

Every failure is a `SendBunnyError` with a `code`, and a `status` when SendBunny answered:

```js
import { SendBunnyError } from "sendbunny"

try {
  await sendbunny.emails.send({ /* ... */ })
} catch (err) {
  if (err instanceof SendBunnyError) {
    console.error(err.code, err.status, err.message) // "api" 400 "'to' contains an invalid address: ana@"
  }
}
```

| `code` | Meaning |
|---|---|
| `config` | A setting is missing or wrong. The message says which. |
| `api` | SendBunny said no. `status` and `message` say why. |
| `network` | SendBunny could not be reached. |
| `timeout` | No answer in time (30 seconds by default, `timeoutMs` to change). |
| `aborted` | Your own `AbortSignal` cancelled the call. |
| `bad_response` | The answer did not come from a SendBunny install. Check `SENDBUNNY_URL`. |
| `webhook_signature` | A webhook was not signed by your install, or is too old. |
| `webhook_payload` | A signed webhook did not contain SendBunny events. |

**Nothing is retried automatically.** A retry after a dropped connection could send the same email twice. After a `timeout` or `network` error, check your sent-email log before sending again.

## Security

- **Server only.** The client refuses to start in a web page, where your API key would be visible to every visitor. For sign-ups on your website, use a SendBunny form.
- **Your key goes to your install only.** Addresses must use HTTPS (plain HTTP only for `localhost`), and redirects are never followed, so the key cannot be passed on to another server.
- **Your key stays out of logs.** It never appears in error messages, `console.log` or `JSON.stringify` of the client.
- **No dependencies.** The package uses only what your runtime already has, so there is nothing else to trust.
- **Verified releases.** Every version is built and published from this repository by GitHub Actions, without stored npm tokens, and goes live only after a maintainer approves it with two-step login. npm shows where each version was built. Check your installed copy with `npm audit signatures`.

Found a security problem? Please report it privately, as described in [SECURITY.md](./SECURITY.md).

## Runtimes

| Runtime | Notes |
|---|---|
| Node.js 20.3+ | `import` or `require`. |
| Bun, Deno | Deno needs `--allow-env` to read the settings from the environment, or pass them as options. |
| Cloudflare Workers | There is no `process.env`: pass `url`, `apiKey` and `webhookSecret` from your Worker's `env`. |
| Vercel, Netlify | Node.js and Edge functions both work. |

## About SendBunny

SendBunny is an email platform that runs in your own AWS account: sending, contacts, automations, an inbox, and an MCP server so your AI agent can run your email too. SendBunny Free costs nothing; you pay Amazon only for what you send, about $0.10 per 1,000 emails. [Get it free at sendbunny.co](https://sendbunny.co/?utm_source=github&utm_medium=readme&utm_campaign=sendbunny-node).

## License

[MIT](./LICENSE)
