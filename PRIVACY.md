# Privacy notes

## Data requested from Google

The extension requests:

- Your Google account email address, used to label connected accounts.
- Calendar-list metadata: calendar ID, display name, color, primary status, and access role.
- Free/busy time intervals for calendars you select.
- Event title, description, and start/end values from every readable calendar in your connected accounts for the current day when you open or refresh the **Today** schedule.

The extension uses Google's `freeBusy.query` endpoint for availability and the read-only `events.list` endpoint for the **Today** schedule. The Events request uses a partial-response field list limited to event ID, iCalendar UID, title, description, and start/end values. Event ID and iCalendar UID are used only in background memory to collapse duplicate copies.

Attendees, locations, conference links/data, attachments, reminders, and organizer details are never requested. If Google withholds private event details, the schedule displays **Busy** without a description.

## Local data

Stored in `chrome.storage.local` on this device:

- Connected account email addresses.
- Calendar IDs and whether each calendar is selected.
- Operating and conversion timezones.
- Last-used working hours and minimum interval.
- Output format preferences.

This extension does not use `chrome.storage.sync`.

Today’s event titles, descriptions, and times are held only in the background service worker and side-panel memory while the schedule is displayed. They are never written to `chrome.storage.local` or `chrome.storage.session`.

Chrome's local extension storage is not encrypted by this extension. It contains preferences and account/calendar identifiers, but never Google access tokens. Anyone who can read your Chrome profile files may be able to inspect that local metadata.

Stored in `chrome.storage.session`:

- Short-lived Google OAuth access tokens and their expiration times.

Session storage is memory-backed and clears when Chrome exits. Google may continue recognizing the OAuth grant, but the extension no longer retains the access token after Chrome exits.

## Network destinations

The extension connects only to:

- `accounts.google.com` through Chrome's Identity API.
- `www.googleapis.com` for account email, calendar-list metadata, free/busy queries, and today’s read-only event list.
- `oauth2.googleapis.com` for token revocation.

There is no developer backend, analytics service, advertising service, or error-reporting service.

## Clipboard

The extension has clipboard-write permission. It writes only the formatted availability shown in the side panel and only after you click **Copy to Clipboard**. It cannot read clipboard contents.

## Account removal and sign-out

Removing an account:

- Attempts to revoke the current session token.
- Deletes the token from session storage.
- Deletes the email from the connected-account list.
- Deletes that account's saved calendar-selection map.

Signing out performs the same cleanup for every account. If Google's revocation endpoint cannot be reached, local data is still removed and the extension displays a warning. The short-lived token then expires normally. You can always revoke the grant manually at <https://myaccount.google.com/connections>.

## Threat boundary

This design minimizes data collection, but any extension that can access Google Calendar availability, event titles, and descriptions must be trusted. Keep this private extension under your control, load it only from this folder, review updates before applying them, and protect your Chrome profile and operating-system account.
