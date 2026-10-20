// Minimal Mailpit client: waits for a message, reads it and extracts links.
import { mailpitUrl, sleep } from './paths.ts';

interface Summary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
  Created: string;
}

export interface MailMessage {
  ID: string;
  Subject: string;
  To: { Address: string }[];
  From: { Address: string };
  Text: string;
  HTML: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${mailpitUrl}${path}`, init);
  if (!response.ok) throw new Error(`Mailpit ${path} answered ${response.status}`);
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T; // e.g. DELETE answers "ok"
  }
}

export async function deleteAllMessages(): Promise<void> {
  await api('/api/v1/messages', { method: 'DELETE' });
}

export async function listMessages(): Promise<Summary[]> {
  return (await api<{ messages: Summary[] }>('/api/v1/messages?limit=200')).messages;
}

/**
 * Polls until a message to `to` (case-insensitive) whose subject matches `subject` arrives and
 * returns it in full. Newest first when several match.
 */
export async function waitForMessage(
  to: string,
  subject: RegExp,
  timeoutMs = 30_000,
): Promise<MailMessage> {
  const deadline = Date.now() + timeoutMs;
  const wanted = to.toLowerCase();
  for (;;) {
    const found = (await listMessages()).find(
      (m) => m.To.some((t) => t.Address.toLowerCase() === wanted) && subject.test(m.Subject),
    );
    if (found) return api<MailMessage>(`/api/v1/message/${found.ID}`);
    if (Date.now() > deadline) {
      const seen = (await listMessages()).map((m) => `${m.To[0]?.Address}: ${m.Subject}`);
      throw new Error(
        `No email to ${to} matching ${subject} within ${timeoutMs} ms. In Mailpit: ${JSON.stringify(seen)}`,
      );
    }
    await sleep(500);
  }
}

/** The first URL in the text body (or the HTML links) that matches `pattern`. */
export function extractUrl(message: MailMessage, pattern: RegExp): string {
  const candidates = [
    ...message.Text.matchAll(/https?:\/\/[^\s<>"')]+/g),
    ...message.HTML.matchAll(/href="(https?:\/\/[^"]+)"/g),
  ].map((m) => (m[1] ?? m[0]).replaceAll('&amp;', '&'));
  const url = candidates.find((candidate) => pattern.test(candidate));
  if (!url) throw new Error(`No link matching ${pattern} in "${message.Subject}"`);
  return url;
}
