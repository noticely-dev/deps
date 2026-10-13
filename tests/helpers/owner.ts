// The owner's name must never appear on the site (spec §1). The pattern is base64-encoded so this public
// repo doesn't contain the name as plain text; the tests decode it to check the rendered pages.
export const OWNER_NAME_RE = new RegExp(Buffer.from('TWFyaXVzfEJhbmNvW3PImV0=', 'base64').toString('utf8'), 'i');
