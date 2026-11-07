import { SendBunnyError } from "./errors.js"

/**
 * What every call returns: the answer in `data`, or what went wrong in
 * `error`. Exactly one of the two is set, so after `if (error) ...` your
 * editor knows `data` is there.
 *
 * ```ts
 * const { data, error } = await sendbunny.emails.send({ ... })
 * if (error) return console.error(error.message)
 * console.log(data.id)
 * ```
 */
export type SendBunnyResult<T> = { data: T; error: null } | { data: null; error: SendBunnyError }

/** @internal Runs a call and turns anything thrown into `{ data: null, error }`. */
export async function attempt<T>(work: () => Promise<T>): Promise<SendBunnyResult<T>> {
  try {
    return { data: await work(), error: null }
  } catch (err) {
    if (err instanceof SendBunnyError) return { data: null, error: err }
    const detail = err instanceof Error ? err.message : String(err)
    return {
      data: null,
      error: new SendBunnyError(`Something unexpected went wrong in the SendBunny SDK: ${detail}`, { code: "unexpected", cause: err }),
    }
  }
}
