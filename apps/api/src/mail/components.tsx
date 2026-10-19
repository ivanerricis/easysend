import { Fragment, type CSSProperties, type ReactNode } from 'react';
import type { Appearance, Locale } from '@easysend/shared';
import { contrastRatio, readableTextColor } from '@easysend/shared';

/**
 * Small email-client-safe building blocks: table layout, inline styles only, no web fonts, no
 * images that carry information. User-controlled text goes in as React children, which escapes it.
 */

export const FONT_STACK =
  "'IBM Plex Sans', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Zinc neutrals of the app. #18181b on #fff is 17:1, #52525b on #fff 7.7:1, on #f4f4f5 7:1. */
export const COLORS = {
  text: '#18181b',
  muted: '#52525b',
  card: '#ffffff',
  page: '#f4f4f5',
  border: '#e4e4e7',
} as const;

const PX_PER_REM = 16;
export const LOGO_WIDTH = 200;
/** Content-ID of the inline logo attachment. */
export const LOGO_CID = 'logo';

/** What every component needs to know about the instance. */
export interface EmailBrand {
  appearance: Appearance;
  locale: Locale;
}

const radiusPx = (appearance: Appearance): number => Math.round(appearance.radius * PX_PER_REM);

/** Link colour: the primary colour when it reads on white (AA), else the plain text colour. */
export function linkColor(appearance: Appearance): string {
  return contrastRatio(appearance.primaryColor, COLORS.card) >= 4.5
    ? appearance.primaryColor
    : COLORS.text;
}

const reset: CSSProperties = { margin: 0, padding: 0 };

const SENT_BY: Record<Locale, (name: string) => string> = {
  it: (name) => `Inviata da ${name}`,
  en: (name) => `Sent by ${name}`,
};

/** "Sent by <instance>" line, shared with the plain-text footer. */
export const sentByLine = (locale: Locale, instanceName: string): string =>
  SENT_BY[locale](instanceName);

/** Text with line breaks (any newline style): lines separated by `<br/>`, never raw HTML. */
export function MultilineText({ text }: { text: string }): ReactNode {
  return text.split(/\r\n|\r|\n/).map((line, index) => (
    <Fragment key={index}>
      {index > 0 ? <br /> : null}
      {line}
    </Fragment>
  ));
}

export function EmailLayout({
  brand,
  title,
  preheader,
  children,
}: {
  brand: EmailBrand;
  title: string;
  preheader: string;
  children: ReactNode;
}): ReactNode {
  const { appearance, locale } = brand;
  const footer = appearance.footer.trim();
  return (
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
        <title>{title}</title>
      </head>
      <body
        style={{
          ...reset,
          backgroundColor: COLORS.page,
          color: COLORS.text,
          fontFamily: FONT_STACK,
          fontSize: 16,
          lineHeight: 1.5,
        }}
      >
        <div
          style={{
            display: 'none',
            fontSize: 1,
            lineHeight: '1px',
            maxHeight: 0,
            maxWidth: 0,
            opacity: 0,
            overflow: 'hidden',
          }}
        >
          {preheader}
        </div>
        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          style={{ backgroundColor: COLORS.page, borderCollapse: 'collapse' }}
        >
          <tbody>
            <tr>
              <td align="center" style={{ padding: '24px 16px' }}>
                <table
                  role="presentation"
                  width="100%"
                  cellPadding={0}
                  cellSpacing={0}
                  style={{
                    maxWidth: 560,
                    backgroundColor: COLORS.card,
                    border: `1px solid ${COLORS.border}`,
                    borderTop: `4px solid ${appearance.accentColor}`,
                    borderRadius: radiusPx(appearance),
                    borderCollapse: 'separate',
                  }}
                >
                  <tbody>
                    <tr>
                      <td style={{ padding: '24px 32px 8px 32px' }}>
                        <img
                          src={`cid:${LOGO_CID}`}
                          alt={appearance.instanceName}
                          width={LOGO_WIDTH}
                          style={{
                            display: 'block',
                            border: 0,
                            height: 'auto',
                            maxWidth: '100%',
                            width: LOGO_WIDTH,
                          }}
                        />
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '8px 32px 32px 32px' }}>{children}</td>
                    </tr>
                  </tbody>
                </table>
                <table
                  role="presentation"
                  width="100%"
                  cellPadding={0}
                  cellSpacing={0}
                  style={{ maxWidth: 560 }}
                >
                  <tbody>
                    <tr>
                      <td
                        style={{
                          padding: '16px 32px',
                          color: COLORS.muted,
                          fontSize: 14,
                          lineHeight: 1.5,
                          textAlign: 'center',
                        }}
                      >
                        {footer ? (
                          <p style={{ ...reset, marginBottom: 8 }}>
                            <MultilineText text={footer} />
                          </p>
                        ) : null}
                        <p style={reset}>{sentByLine(locale, appearance.instanceName)}</p>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}

export function Heading({ children }: { children: ReactNode }): ReactNode {
  return (
    <h1
      style={{
        ...reset,
        margin: '16px 0',
        color: COLORS.text,
        fontSize: 24,
        fontWeight: 600,
        lineHeight: 1.25,
        overflowWrap: 'anywhere',
      }}
    >
      {children}
    </h1>
  );
}

export function Paragraph({
  children,
  muted = false,
}: {
  children: ReactNode;
  muted?: boolean;
}): ReactNode {
  return (
    <p
      style={{
        ...reset,
        margin: '0 0 16px 0',
        color: muted ? COLORS.muted : COLORS.text,
        fontSize: 16,
        lineHeight: 1.5,
        overflowWrap: 'anywhere',
      }}
    >
      {children}
    </p>
  );
}

/** A sender's note: free text in paragraphs (blank lines) with `<br/>` for single line breaks. */
export function MessageBlock({
  label,
  text,
  brand,
}: {
  label: string;
  text: string;
  brand: EmailBrand;
}): ReactNode {
  const blocks = text.split(/(?:\r\n|\r|\n){2,}/).filter((block) => block.trim() !== '');
  return (
    <div
      style={{
        margin: '0 0 16px 0',
        padding: '4px 0 4px 16px',
        borderLeft: `4px solid ${brand.appearance.accentColor}`,
      }}
    >
      <p
        style={{
          ...reset,
          marginBottom: 4,
          color: COLORS.muted,
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        {label}
      </p>
      {blocks.map((block, index) => (
        <p
          key={index}
          style={{
            ...reset,
            marginBottom: index === blocks.length - 1 ? 0 : 8,
            color: COLORS.text,
            fontSize: 16,
            overflowWrap: 'anywhere',
          }}
        >
          <MultilineText text={block.trim()} />
        </p>
      ))}
    </div>
  );
}

/** Bulletproof button: padding lives on the anchor, the colour on the cell (Outlook-friendly). */
export function Button({
  href,
  brand,
  children,
}: {
  href: string;
  brand: EmailBrand;
  children: ReactNode;
}): ReactNode {
  const { appearance } = brand;
  const background = appearance.primaryColor;
  return (
    <table role="presentation" cellPadding={0} cellSpacing={0} style={{ margin: '8px 0 24px 0' }}>
      <tbody>
        <tr>
          <td
            align="center"
            style={{ backgroundColor: background, borderRadius: radiusPx(appearance) }}
          >
            <a
              href={href}
              style={{
                display: 'inline-block',
                padding: '14px 28px',
                color: readableTextColor(background),
                fontFamily: FONT_STACK,
                fontSize: 16,
                fontWeight: 600,
                lineHeight: '20px',
                textDecoration: 'none',
              }}
            >
              {children}
            </a>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** The plain URL for copy and paste, when the button does not work. */
export function LinkFallback({
  label,
  url,
  brand,
}: {
  label: string;
  url: string;
  brand: EmailBrand;
}): ReactNode {
  return (
    <p
      style={{
        ...reset,
        margin: '0 0 16px 0',
        color: COLORS.muted,
        fontSize: 15,
        lineHeight: 1.5,
        overflowWrap: 'anywhere',
        wordBreak: 'break-all',
      }}
    >
      {label}
      <br />
      <a href={url} style={{ color: linkColor(brand.appearance), textDecoration: 'underline' }}>
        {url}
      </a>
    </p>
  );
}

export function Divider(): ReactNode {
  return (
    <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
      <tbody>
        <tr>
          <td
            style={{
              fontSize: 1,
              lineHeight: '1px',
              height: 1,
              borderTop: `1px solid ${COLORS.border}`,
              padding: 0,
            }}
          >
            &nbsp;
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** Label/value rows (file count, size, expiry). */
export function DetailList({
  items,
}: {
  items: Array<{ label: string; value: string }>;
}): ReactNode {
  return (
    <table
      role="presentation"
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      style={{ margin: '0 0 24px 0', borderCollapse: 'collapse' }}
    >
      <tbody>
        {items.map((item) => (
          <tr key={item.label}>
            <td
              style={{
                padding: '8px 16px 8px 0',
                borderTop: `1px solid ${COLORS.border}`,
                color: COLORS.muted,
                fontSize: 15,
                verticalAlign: 'top',
              }}
            >
              {item.label}
            </td>
            <td
              style={{
                padding: '8px 0',
                borderTop: `1px solid ${COLORS.border}`,
                color: COLORS.text,
                fontSize: 15,
                fontWeight: 600,
                textAlign: 'right',
                verticalAlign: 'top',
              }}
            >
              {item.value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
