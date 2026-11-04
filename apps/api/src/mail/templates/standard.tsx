import type { ReactElement } from 'react';
import {
  Button,
  DetailList,
  EmailLayout,
  Heading,
  LinkFallback,
  MessageBlock,
  Paragraph,
  type EmailBrand,
} from '../components.js';
import type { EmailCopy } from '../content.js';

/**
 * The one layout of every email: heading, greeting, lead, optional detail rows, optional
 * sender message, optional call to action and muted closing lines.
 */
export function StandardEmail({
  copy,
  brand,
}: {
  copy: EmailCopy;
  brand: EmailBrand;
}): ReactElement {
  return (
    <EmailLayout brand={brand} title={copy.subject} preheader={copy.preheader}>
      <Heading>{copy.heading}</Heading>
      <Paragraph>{copy.greeting}</Paragraph>
      {copy.lead.map((line) => (
        <Paragraph key={line}>{line}</Paragraph>
      ))}
      {copy.details.length > 0 ? <DetailList items={copy.details} /> : null}
      {copy.message ? (
        <MessageBlock label={copy.message.label} text={copy.message.text} brand={brand} />
      ) : null}
      {copy.cta ? (
        <>
          <Button href={copy.cta.url} brand={brand}>
            {copy.cta.label}
          </Button>
          <LinkFallback label={copy.cta.fallback} url={copy.cta.url} brand={brand} />
        </>
      ) : null}
      {copy.after.map((line) => (
        <Paragraph key={line} muted>
          {line}
        </Paragraph>
      ))}
    </EmailLayout>
  );
}
