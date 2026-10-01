# Strategic Prayer Journal — complete setup guide

The DOCX inside each month folder is the source of truth. The build reads that document, generates permanent public pages, and prepares the same daily content for WhatsApp group delivery. The public website is hosted by Netlify; the Baileys sender runs separately on a VPS.

## 1. What you need before starting

- A GitHub repository connected to the existing Netlify site.
- A Netlify account that can change the site's build settings and environment variables.
- A Linux VPS running Ubuntu 22.04+ (or another systemd-based Linux distribution), with SSH access and a public internet connection.
- A dedicated church-owned WhatsApp account. Do not use a personal account or send to a group without its administrators' authorization.
- Node.js 20 or newer, Git, and npm on both your computer and the VPS.

Baileys is an unofficial WhatsApp Web client. Its authentication folder is equivalent to a long-lived private key: never commit it, upload it, or send it in chat.

## 2. Local installation and first content check

Open PowerShell in the repository and install the dependencies:

```powershell
npm.cmd install
npm.cmd run check:content
npm.cmd run build
```

`check:content` must pass before a release. It checks that every calendar day is represented exactly once. `build` writes the deployable static site to `dist/`, which is intentionally ignored by Git.

For the supplied sources, the expected result is `Content check passed: 2026-09 (30 days), 2026-10 (31 days)`.

## 3. Add or update a monthly source document

1. Create or keep the month's existing source folder, for example `October/index.docx`. Do not rewrite the DOCX merely to fit the website.
2. Add one item to `content/months.json`:

```json
{
  "source": "October/index.docx",
  "year": 2026,
  "month": 10,
  "title": "Strategic Prayer Journal",
  "subtitle": "October prayer journey"
}
```

3. Each daily entry must begin with a date heading such as `THURSDAY, OCTOBER 1, 2026` or `OCTOBER 1 — TITLE`. The importer supports both forms because the September source uses both.
4. If the DOCX has appendices after the last daily entry, add `"dailyEndAt": "EXACT APPENDIX HEADING"` to that item. This preserves the appendix in the downloadable DOCX but excludes it from the daily web page and WhatsApp message.
5. Run the three commands in section 2 again. Fix the source heading or manifest if validation reports a missing or duplicate day.

The generated site has a home page, a month hub at `/YYYY-MM/`, a daily public page at `/YYYY-MM/DD/`, native share/copy-link controls, social metadata, and a link to download the original DOCX.

## 4. Put the website on Netlify

No manual upload is needed because Netlify is connected to GitHub.

1. Commit the source folder, `content/months.json`, `package.json`, `package-lock.json`, the scripts, `site/`, `netlify.toml`, and this README. Do not commit `.env`, `runtime/`, `dist/`, or any Baileys authentication files.
2. Push the commit to `main`.
3. In Netlify, open **Site configuration → Build & deploy** and confirm the build command is `npm run build` and the publish directory is `dist`. The committed `netlify.toml` supplies these settings automatically.
4. Trigger or wait for the GitHub deploy. Open the deploy log and confirm `Content check passed`/`Built 1 month(s) into dist/` appears with no build errors.
5. Open the live URL, then test a month URL and daily URL. Use the share button on a phone and the copy-link button on desktop.
6. If you attach a custom domain, add a Netlify environment variable named `PUBLIC_BASE_URL` with the HTTPS domain and redeploy. This makes canonical and social-share URLs use the custom domain. Without it, Netlify's built-in production `URL` is used.

## 5. Prepare the VPS

The next commands are for a fresh Ubuntu VPS. Replace `YOUR_GITHUB_REPOSITORY_URL` with the repository's HTTPS or SSH clone URL.

```bash
sudo apt update
sudo apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo useradd --system --create-home --home-dir /var/lib/prayerjournal --shell /usr/sbin/nologin prayerjournal
sudo git clone YOUR_GITHUB_REPOSITORY_URL /opt/prayerjournal
sudo chown -R root:root /opt/prayerjournal
sudo chmod -R a+rX /opt/prayerjournal
cd /opt/prayerjournal
sudo npm ci
sudo npm run build
sudo install -d -o prayerjournal -g prayerjournal -m 700 /var/lib/prayerjournal
```

Create the private configuration file at `/etc/prayerjournal/sender.env`:

```bash
sudo install -d -m 755 /etc/prayerjournal
sudo nano /etc/prayerjournal/sender.env
sudo chmod 600 /etc/prayerjournal/sender.env
```

Use this exact structure. Use the actual Netlify production URL; leave `WHATSAPP_GROUP_JIDS` blank until section 6.

```dotenv
PUBLIC_BASE_URL=https://your-site.netlify.app
WHATSAPP_GROUP_JIDS=
WHATSAPP_AUTH_DIR=/var/lib/prayerjournal/baileys-auth
WHATSAPP_LEDGER_FILE=/var/lib/prayerjournal/send-ledger.json
JOURNAL_TIMEZONE=Africa/Lagos
```

## 6. Link WhatsApp and choose groups

Run this on the VPS from an interactive SSH session. It displays a QR code; on the dedicated WhatsApp phone, open **Settings → Linked devices → Link a device** and scan it.

```bash
sudo -u prayerjournal -H bash -c 'set -a; . /etc/prayerjournal/sender.env; set +a; cd /opt/prayerjournal && npm run whatsapp:login'
```

After the link succeeds, list the groups that this account can see. This is read-only and does not send a message:

```bash
sudo -u prayerjournal -H bash -c 'set -a; . /etc/prayerjournal/sender.env; set +a; cd /opt/prayerjournal && npm run whatsapp:list-groups'
```

Copy the approved group JIDs (they end in `@g.us`) into `WHATSAPP_GROUP_JIDS`, separated by commas. Re-secure the file with `sudo chmod 600 /etc/prayerjournal/sender.env`.

Confirm exactly what would be sent **without sending anything**:

```bash
sudo -u prayerjournal -H bash -c 'set -a; . /etc/prayerjournal/sender.env; set +a; cd /opt/prayerjournal && npm run whatsapp:dry-run'
```

Review the full journal text, date, group JIDs, and public link. Do not continue until these are correct.

## 7. Schedule the 04:00 WAT delivery

Install the included systemd files, reload systemd, and enable the timer:

```bash
sudo cp /opt/prayerjournal/deploy/prayerjournal-sender.service /etc/systemd/system/
sudo cp /opt/prayerjournal/deploy/prayerjournal-sender.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now prayerjournal-sender.timer
sudo systemctl list-timers prayerjournal-sender.timer
```

The timer is explicitly set to `04:00 Africa/Lagos`, including when the VPS itself uses UTC. A scheduled run sends the full devotional plus its public daily link to each configured group. Each successful group/date pair is recorded in `/var/lib/prayerjournal/send-ledger.json`, so restarting the service cannot send it twice.

`sudo systemctl start prayerjournal-sender.service` sends the current day's message immediately. It is a real external send—use it only after the dry-run has been approved.

## 8. Monitor and update safely

Useful VPS commands:

```bash
sudo systemctl status prayerjournal-sender.timer
sudo journalctl -u prayerjournal-sender.service --since today
sudo systemctl list-timers prayerjournal-sender.timer
```

For a new month: update the DOCX and manifest locally, run the validation/build, commit and push to GitHub, then update the VPS after Netlify succeeds:

```bash
cd /opt/prayerjournal
sudo git pull --ff-only
sudo npm ci
sudo npm run check:content
sudo npm run build
```

Never delete the delivery ledger to “fix” a failed run: inspect the journal first. A group that failed is not added to the ledger and will be retried on the next service invocation; already-successful groups are skipped.
