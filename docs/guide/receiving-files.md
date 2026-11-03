# Receiving files

A transfer normally goes from you to someone else. A **file request** goes the other way: you create a link, share it, and anyone who opens it can upload files to you, without an account. Use it to collect documents from clients, photos from a team, or a large file from someone who cannot send it by email.

## Create a request

1. Open **Receive files** in the sidebar and click **New request**.
2. Fill in the form and click **Create**.
3. The link (`https://your-domain/r/...`) appears on the page. Copy it and send it. You can find it again at any time on the request page.

| Option                       | What it does                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Title                        | Required. Shown to the uploader and used as the title of every transfer you receive.                                         |
| Instructions                 | Optional text shown on the upload page: tell people what you want.                                                           |
| The link expires after       | 3 days, 1 week or 1 month. It also sets how long each received transfer stays available, counted from the moment it arrives. |
| Password                     | Optional. Whoever opens the link must enter it before seeing the form. Share it through another channel.                     |
| Maximum total size           | Optional. The total of all the files that can be received through this link. It also counts against your own space quota.    |
| Maximum number of uploads    | Optional. After this many completed uploads the link stops accepting files.                                                  |
| Ask for name / ask for email | Makes the field required on the upload page. Both are optional for the uploader otherwise.                                   |

You can edit a request later (the changes apply to the next uploads), **revoke** it (the link stops accepting files at once) or delete it. Files already received stay in your transfers in every case.

## What the uploader sees

The upload page shows your instructions, the space left and the expiry. After the password (if any), the uploader enters name, email and an optional message, adds one or more files and sends them. Uploads are resumable like any other: if the connection drops, the files already uploaded are kept and the uploader selects the rest again. At the end a confirmation says that you were notified.

Your email address is never shown: the page displays your display name, or the name of the instance if you have not set one.

If the link is expired, revoked, or has reached its maximum number of uploads, the page says so instead of showing the form. A file that would exceed the remaining space is refused before the upload starts.

## Where the files arrive

- Every completed upload sends you an email (always on) with the request title, the uploader's name and email, the number and size of the files, and a link to the transfer.
- The files appear in **Transfers**. Use the origin filter and pick **Received** to show only those. A received transfer shows who sent it and their message, and has no recipients and no resend button.
- A received transfer has its own download link, exactly like one you sent: open it, copy the link, and share it with anyone, or download the files and the zip yourself. It expires after the duration chosen for the request, and you can revoke or delete it like any transfer.

## Limits and security

- Files are encrypted on disk like every other transfer, and the uploads count against your quota.
- Each uploader gets a short-lived upload token tied to that single upload, so a visitor cannot touch the uploads of others.
- Rate limits protect the link: 20 new uploads per hour per IP address and 100 per hour per request, and 10 wrong passwords in 15 minutes per request and IP address.
- Expired and revoked requests are deleted by the hourly cleanup; the transfers you received stay until their own expiry.
- If you delete a user, an admin chooses whether the user's requests move to another user or are deleted.
