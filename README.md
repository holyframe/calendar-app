# Private Calendar Availability

A private Manifest V3 Chrome extension that converts Google Calendar free/busy blocks into copyable availability text.

This is a clean, original private build. It does not use the Availical extension identity, OAuth client, branding, update channel, or Web Store metadata. Its newly generated public manifest key gives it the stable private extension ID `dcnikakndffhkejpelbgcdfjbmimaikm`. This public key is not an OAuth secret; no private signing key is stored.

## Privacy design

- Requests only calendar-list metadata, free/busy blocks, and the signed-in email address.
- Never calls the Google Calendar Events endpoint.
- Never downloads event titles, descriptions, locations, attendees, or meeting links.
- Keeps OAuth access tokens in `chrome.storage.session`, which is memory-backed and clears when Chrome exits.
- Keeps account email addresses, preferences, and calendar selections in device-local extension storage, not Chrome Sync.
- Keeps raw tokens and all Google API requests in the background service worker.
- Has no analytics, advertising, backend server, content scripts, or access to browsing history.
- Writes availability to the clipboard only when you click **Copy to Clipboard**.

See [PRIVACY.md](PRIVACY.md) for the complete local-data inventory.

## One-time Google OAuth setup

Google requires the OAuth client to belong to you. The included manifest deliberately contains a placeholder and sign-in remains disabled until you replace it.

### 1. Load the extension once and copy its ID

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Choose this project folder.
5. Copy the extension ID from the extension card. The popup also displays it.

The included newly generated public manifest key keeps this ID stable even if the folder moves.

### 2. Create your Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project dedicated to this private extension.
3. Open **APIs & Services → Library**.
4. Enable **Google Calendar API**.

### 3. Configure Google Auth

1. Open **Google Auth Platform** in the same project.
2. Configure the app as **External**.
3. Use a name such as **My Private Calendar Availability**.
4. Enter your own support email.
5. Initially keep the publishing status as **Testing**.
6. Add every Google account you want to connect as a test user.
7. Add exactly these data-access scopes:
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
   - `https://www.googleapis.com/auth/calendar.events.freebusy`
   - `https://www.googleapis.com/auth/userinfo.email`

Do not add `calendar.readonly` or any write scope.

### 4. Create the OAuth client

1. Open **Google Auth Platform → Clients**.
2. Click **Create client**.
3. Choose **Web application** as the application type. This extension uses `chrome.identity.launchWebAuthFlow` so it can let you choose and connect multiple Google accounts.
4. Under **Authorized redirect URIs**, add this exact URI:

   ```text
   https://dcnikakndffhkejpelbgcdfjbmimaikm.chromiumapp.org/
   ```

   If Chrome shows a different extension ID, replace the ID in that URI with the one from your `chrome://extensions` card. Keep `https://`, `.chromiumapp.org`, and the trailing `/`. Add it as a redirect URI, not as an Authorized JavaScript origin.
5. Create the client and copy its full client ID. Do not put the client secret in this extension.

If you already created a **Chrome Extension** client, create a new **Web application** client instead; Google does not let you change an existing client's application type.

### 5. Put your client ID in the manifest

Open `manifest.json` and replace:

```json
"client_id": "REPLACE_WITH_YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com"
```

with the full client ID supplied by Google. Save the file, return to `chrome://extensions`, and click **Reload** on the extension.

The client ID identifies the OAuth application; it is public configuration, not a client secret. The redirect URI must match exactly or Google returns `Error 400: redirect_uri_mismatch`. Google notes that client-setting changes may take from a few minutes to a few hours to propagate.

### 6. Sign in safely

Open the extension and click **Sign in with Google**.

Google may show an unverified-app warning for a private/testing OAuth project. Continue only when the developer/support email and project are yours and the consent screen lists only the three scopes above.

[Google documents](https://support.google.com/cloud/answer/15549945?hl=en) that testing-mode authorizations expire after seven days. Once you have tested the extension, you can change your own OAuth app to **In production** for private use. It can remain unverified under [Google's personal-use allowance](https://support.google.com/cloud/answer/13464323?hl=en), but the warning and lifetime 100-user cap remain. Do not distribute it publicly without completing Google's verification process.

Every additional Google account must be included as a test user while the project is in Testing.

## Using the extension

- **Pick Dates:** select up to 31 individual dates, choose a time window, and find all free intervals.
- **Date Range:** scan up to 92 days and filter out intervals shorter than your minimum duration.
- **Settings → Accounts:** add or remove Google accounts.
- **Settings → Calendars:** choose which calendars count as busy.
- **Settings → Output format:** select a preset or create a custom text template.
- **Convert to timezone:** re-render the result without querying Google again.

Removing an account removes its local calendar-selection records. Sign out attempts to revoke each session token and always removes local access. You can independently revoke the OAuth grant at [Google Account Connections](https://myaccount.google.com/connections).

## Development and verification

No build step or external package is required.

Run the tests with Node.js:

```powershell
npm test
```

Then load the folder directly through `chrome://extensions`.

After changing `manifest.json` or the service worker, click **Reload** on the extension card.
