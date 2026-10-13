export function multipart(fields: Record<string, string | { filename: string; content: string }>) {
  const boundary = '----deps' + Math.random().toString(16).slice(2);
  let body = '';
  for (const [name, value] of Object.entries(fields)) {
    body += `--${boundary}\r\n`;
    if (typeof value === 'string') {
      body += `Content-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
    } else {
      body += `Content-Disposition: form-data; name="${name}"; filename="${value.filename}"\r\nContent-Type: application/json\r\n\r\n${value.content}\r\n`;
    }
  }
  body += `--${boundary}--\r\n`;
  return { payload: body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
