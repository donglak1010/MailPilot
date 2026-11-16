# Amazon SES setup (Phase 3)

Region: **ap-northeast-1 (Tokyo)**. Keep every SES resource (identities, configuration set) in this one region.
The app never sees AWS keys in the browser — they live only in Supabase Edge Function secrets.

## 1. Account

1. Finish AWS sign-up (phone verification, payment method). Sign in to the console as root only for this setup.
2. Turn on MFA for the root user.

## 2. IAM user for MailPilot (SES only)

IAM → Users → Create user `mailpilot-ses` (no console access) → Attach policy directly → Create policy (JSON):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "MailPilotSes",
      "Effect": "Allow",
      "Action": [
        "ses:CreateEmailIdentity",
        "ses:GetEmailIdentity",
        "ses:DeleteEmailIdentity",
        "ses:PutEmailIdentityMailFromAttributes",
        "ses:GetAccount",
        "ses:SendEmail"
      ],
      "Resource": "*",
      "Condition": { "StringEquals": { "aws:RequestedRegion": "ap-northeast-1" } }
    }
  ]
}
```

Then Security credentials → Create access key → "Application running outside AWS". Copy the key pair once;
do not paste it in chat, commits or the frontend `.env`.

## 3. Configuration set + events (SNS → `ses-events`)

1. SNS (region ap-northeast-1) → Topics → Create topic, type **Standard**, name `mailpilot-ses-events`.
   Copy its ARN → secret `SES_EVENTS_TOPIC_ARN`.
2. SES → Configuration sets → Create `mailpilot-default` → secret `SES_CONFIGURATION_SET`.
   New identities are created with it as their default configuration set.
3. In the configuration set → Event destinations → Add destination:
   event types **Send, Delivery, Bounce, Complaint, Reject, Delivery delay, Rendering failure, Open, Click**;
   destination **Amazon SNS** → topic `mailpilot-ses-events`. (Open/click tracking rewrites links and adds a pixel.)
4. After the functions are deployed (step 4): SNS → the topic → Create subscription,
   protocol **HTTPS**, endpoint `https://<project-ref>.supabase.co/functions/v1/ses-events`.
   The function verifies the SNS signature and confirms the subscription automatically
   (status becomes "Confirmed" within a minute).

## 4. Edge Function secrets, Vault and deploy

Hosted project (run from the repo root, values typed by you — never paste them in chat):

```bash
supabase secrets set AWS_REGION=ap-northeast-1 SES_CONFIGURATION_SET=mailpilot-default SES_MAX_SEND_RATE=1
supabase secrets set AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...
supabase secrets set SES_EVENTS_TOPIC_ARN=arn:aws:sns:ap-northeast-1:<account>:mailpilot-ses-events
supabase secrets set APP_BASE_URL=https://<your-site> ALLOWED_ORIGINS=https://<your-site>,http://localhost:5173
supabase secrets set PUBLIC_FUNCTIONS_URL=https://<project-ref>.supabase.co/functions/v1
# two random secrets (e.g. `openssl rand -hex 32`)
supabase secrets set INTERNAL_WORKER_SECRET=<random-1> UNSUBSCRIBE_SIGNING_SECRET=<random-2>
supabase functions deploy
```

The cron job `mp-send-worker` calls the worker through `pg_net` using two **Vault** secrets.
Dashboard → SQL editor (hosted project), with the same `<random-1>` as `INTERNAL_WORKER_SECRET`:

```sql
select vault.create_secret('https://<project-ref>.supabase.co/functions/v1', 'mp_functions_url');
select vault.create_secret('<random-1>', 'mp_worker_secret');
```

Until both exist, the worker is never called and nothing is sent.

Local development uses `supabase/functions/.env` (git-ignored). With `SES_MOCK=true` no AWS call is made;
to test against real SES locally, remove `SES_MOCK` and add the AWS variables, then restart
`supabase functions serve --env-file supabase/functions/.env`.

## 5. Sending domain (test: `mail.aithubs.com`)

1. In MailPilot → Sender Domains → Add domain → `mail.aithubs.com`.
2. Add the 6 records shown to the DNS zone of `aithubs.com` (Netlify → Domains → aithubs.com → DNS settings):
   - 3 × CNAME `<token>._domainkey.mail` → `<token>.dkim.amazonses.com`
   - MX `bounce.mail` → `feedback-smtp.ap-northeast-1.amazonses.com`, priority 10
   - TXT `bounce.mail` → `v=spf1 include:amazonses.com ~all`
   - TXT `_dmarc.mail` → `v=DMARC1; p=none;` (optional; the root DMARC already applies)

   Netlify appends `.aithubs.com` to names automatically. **Do not** edit the root SPF/MX records
   (they belong to ImprovMX forwarding).
3. Press **Check status** until Domain verification, DKIM and MAIL FROM are verified.

## 6. Sandbox and production access

New accounts are in the SES sandbox: only verified recipients, 200 emails / 24 h, 1 email/s.
- To test while in sandbox, verify your own inbox: SES → Identities → Create identity → Email address.
- Request production access (SES → Account dashboard → Request production access) once the app has
  unsubscribe handling (Phase 4). Describe: consent-based lists only, double-checked suppression,
  bounce/complaint handling via SNS, expected volume.

## 7. Monitoring

CloudWatch alarms on `Reputation.BounceRate` (> 4%) and `Reputation.ComplaintRate` (> 0.08%).
