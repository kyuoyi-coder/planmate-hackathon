/**
 * A mailto: link that opens the user's own email app with the message
 * filled in. Line breaks are sent as CRLF, as RFC 6068 asks.
 */
export function mailtoHref(message: { to: string; subject: string; body: string }) {
  const encode = (text: string) => encodeURIComponent(text.replace(/\r?\n/g, "\r\n"));
  return `mailto:${encodeURIComponent(message.to)}?subject=${encode(message.subject)}&body=${encode(message.body)}`;
}
