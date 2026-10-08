# Google Play reviewer access

Google Play reviews an app by signing in to it. NestConnect has nothing to show
without a workspace, and the real one holds real customers' conversations. So
reviewers get a **demo workspace** of their own:

- **Separate workspace.** It is a tenant like any other, so it cannot see or
  reach another workspace's data (`check:tenant-isolation`,
  `check:tenant-http`).
- **Invented data only.** It holds a fictional café, *Harbour & Oak (demo)*,
  with five sample conversations across WhatsApp, email and website chat.
  - Every phone number is in Ofcom's drama range (`+44 7700 900xxx`).
  - Every address is on a domain reserved for examples (`example.com`/`.org`/`.net`).
- **Flagged as a sandbox** (`Organization.sandbox`; rules in
  `apps/api/src/tenancy/sandbox.ts`). In a sandbox:
  - Replies are **simulated**. The thread shows them sent; no provider
    (WhatsApp, email, Gmail, SDK push) is ever called.
  - Connecting or editing channels, groups, broadcasts, template sync and the
    WhatsApp business profile are refused.
  - App email, customer push and AI assist are off.
  - The shared login's password, profile and two-factor settings can't be
    changed from inside, and "forgot password" sends nothing.
  - **Two-factor enrolment is waived for this workspace only.** A reviewer can
    be given a password but not a phone. The password is still required, and
    every other workspace still requires 2FA (the CI check proves a real
    account without it is stopped).
- **The login is an agent, not an admin.** It can work the inbox: read, reply,
  assign, label, snooze, close.

`pnpm check:reviewer-workspace` pins all of this on Postgres, and it runs in CI
against an API that requires 2FA, as production does.

## Setting it up

Do this once the tenancy and demo-workspace PRs are deployed. Railway applies
the database migration on deploy.

You need:

- a checkout of this repository with `pnpm install` done;
- the production database's **public** connection URL: Railway → the Postgres
  service → *Variables* → `DATABASE_PUBLIC_URL`.

**Choose the sign-in email.** Use an address no workspace already uses; the
script refuses one that belongs to another account. Nothing is ever emailed to
it, so it doesn't need to be a working mailbox. A dedicated alias on a domain
you control is a good choice.

**Create the workspace with a fresh random password.** The password goes
straight into a file only you can read:

```sh
cd NestConnect
read -rs DATABASE_URL && export DATABASE_URL     # paste the public URL; it isn't echoed
pnpm --filter @ding/api reviewer:setup \
  --email <the sign-in email> \
  --generate-to ~/nestconnect-play-reviewer.txt
unset DATABASE_URL
```

The script never prints the password or the email. It refuses to:

- write the file inside the repository;
- overwrite an existing file;
- touch a workspace that isn't flagged as a sandbox.

**Move the password into your password manager**, then delete the file:
`rm ~/nestconnect-play-reviewer.txt`.

To choose your own password instead, use `--password-stdin`. It prompts
without echoing, or reads from a pipe, and needs at least 16 characters.

**Check it yourself.** Sign in on the internal-testing build with the email and
password. You should see *Harbour & Oak (demo)* with five conversations, and
no two-factor prompt. Send a reply: it shows as sent, and goes nowhere.

## Play Console

Play Console → your app → **Policy and programs → App content → App access**:

- choose **All or some functionality in my app is restricted**;
- **Add instructions** → name it *Demo workspace*;
- **Username**: the sign-in email;
- **Password**: from your password manager;
- **Any other information that may be required to access your app**: paste the
  text below, which contains no secret.

> NestConnect is a shared team inbox for businesses. Sign in with the email and
> password above (no verification code is needed for this account). You will
> see a demo business, "Harbour & Oak (demo)", with sample customer
> conversations from WhatsApp, email and website chat. All data in this demo
> workspace is fictional. Replies can be sent and appear as delivered, but no
> real message is sent to anyone.

Only enter the credentials in Play Console's App access form. Don't paste them
into tickets, chats, CI variables or this repository.

## Before each review, and after

- **Reset the sample data** before submitting a new release. It also clears
  anything the last reviewer typed and makes the timestamps recent again. The
  login is untouched:

  ```sh
  pnpm --filter @ding/api reviewer:setup --email <the sign-in email> --keep-password
  ```

- **Rotate the password** whenever you like, for example after an approval:
  run with `--generate-to` and a new file path. This signs out every session
  on the demo login. Update Play Console's App access to match.
- **Retire it.** Rotate to a random password and delete the file without
  saving it. Nobody can then sign in, and the workspace holds nothing real.

## Owner checklist

- [ ] The tenancy PR and this PR are reviewed, merged and deployed.
- [ ] The reviewer sign-in email is chosen. It is not a real person's account.
- [ ] `reviewer:setup --generate-to` has been run against production, the
      password moved to the password manager, and the file deleted.
- [ ] You signed in once on the Android build: demo data shows, no 2FA prompt,
      and a reply shows as sent.
- [ ] Play Console → App access is filled in with the text above.
- [ ] `--keep-password` is re-run before each submission.
