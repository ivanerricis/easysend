import type { ReactElement } from 'react';
import {
  Button,
  DetailList,
  EmailLayout,
  Heading,
  LinkFallback,
  Paragraph,
  type EmailBrand,
} from '../components.js';
import type { EmailCopy } from '../content.js';

/** Notice to the owner of a transfer on its first download. */
export function FirstDownloadEmail({
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
      <DetailList items={copy.details} />
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
