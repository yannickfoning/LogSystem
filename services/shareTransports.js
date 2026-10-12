import net from 'node:net';
import tls from 'node:tls';
import os from 'node:os';

function smtpSettings() {
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.SMTP_FROM?.trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD;
  const secure = String(process.env.SMTP_SECURE || (port === 465 ? 'true' : 'false')).toLowerCase() === 'true';
  const configured = Boolean(host && from && Number.isInteger(port) && port > 0 && port <= 65535 && Boolean(user) === Boolean(password));
  return { host, from, port, user, password, secure, configured };
}

export function isEmailDeliveryConfigured() {
  return smtpSettings().configured;
}

export function isWhatsAppDeliveryConfigured() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_WHATSAPP_FROM?.trim()
  );
}

function waitForEvent(emitter, eventName, errorName = 'error') {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      emitter.off(eventName, onSuccess);
      emitter.off(errorName, onError);
    };
    const onSuccess = (...args) => { cleanup(); resolve(args); };
    const onError = error => { cleanup(); reject(error); };
    emitter.once(eventName, onSuccess);
    emitter.once(errorName, onError);
  });
}

class SmtpConnection {
  constructor(socket) {
    this.socket = socket;
    this.buffer = '';
    this.lines = [];
    this.responses = [];
    this.waiters = [];
    this.failure = null;
    this.attach(socket);
  }

  attach(socket) {
    this.onData = chunk => {
      this.buffer += chunk.toString('utf8');
      let end;
      while ((end = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, end).replace(/\r$/, '');
        this.buffer = this.buffer.slice(end + 1);
        this.lines.push(line);
        if (/^\d{3} /.test(line)) {
          const response = this.lines.join('\n');
          this.lines = [];
          const waiter = this.waiters.shift();
          if (waiter) waiter.resolve(response);
          else this.responses.push(response);
        }
      }
    };
    this.onError = error => this.fail(error);
    this.onClose = () => this.fail(new Error('SMTP server closed the connection'));
    socket.on('data', this.onData);
    socket.once('error', this.onError);
    socket.once('close', this.onClose);
  }

  detach(socket) {
    socket.off('data', this.onData);
    socket.off('error', this.onError);
    socket.off('close', this.onClose);
  }

  fail(error) {
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  async readResponse() {
    if (this.failure) throw this.failure;
    if (this.responses.length) return this.responses.shift();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error('SMTP response timeout'));
      }, 15000);
      const waiter = {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      };
      this.waiters.push(waiter);
    });
  }

  async command(command, acceptedCodes) {
    if (/[\r\n]/.test(command)) throw new Error('Invalid SMTP command');
    this.socket.write(`${command}\r\n`);
    const response = await this.readResponse();
    const code = Number(response.slice(0, 3));
    if (!acceptedCodes.includes(code)) {
      const error = new Error(`SMTP command rejected (${code})`);
      error.smtpCode = code;
      throw error;
    }
    return response;
  }

  async startTLS(host) {
    this.detach(this.socket);
    const secureSocket = tls.connect({ socket: this.socket, servername: host });
    this.socket = secureSocket;
    this.attach(secureSocket);
    await waitForEvent(secureSocket, 'secureConnect');
  }

  close() {
    this.socket.end();
  }
}

function assertSafeHeader(value, fieldName) {
  if (!value || /[\r\n]/.test(value)) throw new Error(`Invalid ${fieldName}`);
  return value;
}

function base64Lines(value) {
  const encoded = Buffer.from(value, 'utf8').toString('base64');
  return encoded.match(/.{1,76}/g)?.join('\r\n') || '';
}

function encodeSubject(value) {
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

export async function sendEmail({ to, subject, html, attachments }) {
  const settings = smtpSettings();
  if (!settings.configured) {
    const error = new Error('Le service e-mail n’est pas configuré (SMTP_HOST et SMTP_FROM requis).');
    error.statusCode = 503;
    throw error;
  }

  const recipient = assertSafeHeader(to, 'recipient');
  const from = assertSafeHeader(settings.from, 'sender');
  const safeSubject = assertSafeHeader(subject, 'subject');
  const boundary = `logsystem-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  const attachmentParts = (attachments || []).map(file => {
    const filename = String(file.filename || 'logs.csv').replace(/["\r\n]/g, '_');
    const content = typeof file.content === 'string' ? file.content : Buffer.from(file.content || '').toString('utf8');
    return [
      `--${boundary}`,
      `Content-Type: text/csv; charset=UTF-8; name="${filename}"`,
      `Content-Disposition: attachment; filename="${filename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      base64Lines(content),
    ].join('\r\n');
  });
  const message = [
    `From: ${from}`,
    `To: ${recipient}`,
    `Subject: ${encodeSubject(safeSubject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(html || ''),
    ...attachmentParts,
    `--${boundary}--`,
    '',
  ].join('\r\n');
  const safeMessage = message.replace(/(^|\r\n)\./g, '$1..');

  const socket = settings.secure
    ? tls.connect({ host: settings.host, port: settings.port, servername: settings.host })
    : net.createConnection({ host: settings.host, port: settings.port });
  const connection = new SmtpConnection(socket);
  try {
    await waitForEvent(socket, settings.secure ? 'secureConnect' : 'connect');
    const greeting = await connection.readResponse();
    if (!greeting.startsWith('220')) throw new Error(`SMTP server greeting rejected (${greeting.slice(0, 3)})`);

    let ehlo = await connection.command(`EHLO ${os.hostname().replace(/[^a-zA-Z0-9.-]/g, '') || 'localhost'}`, [250]);
    if (!settings.secure) {
      if (!/\bSTARTTLS\b/i.test(ehlo)) throw new Error('SMTP server does not support required STARTTLS encryption');
      await connection.command('STARTTLS', [220]);
      await connection.startTLS(settings.host);
      ehlo = await connection.command(`EHLO ${os.hostname().replace(/[^a-zA-Z0-9.-]/g, '') || 'localhost'}`, [250]);
    }

    if (settings.user && settings.password) {
      if (!/\bAUTH\b[^\r\n]*\bLOGIN\b/i.test(ehlo)) throw new Error('SMTP server does not support AUTH LOGIN');
      await connection.command('AUTH LOGIN', [334]);
      await connection.command(Buffer.from(settings.user).toString('base64'), [334]);
      await connection.command(Buffer.from(settings.password).toString('base64'), [235]);
    }

    const fromAddress = from.match(/<([^<>]+)>/)?.[1] || from;
    await connection.command(`MAIL FROM:<${assertSafeHeader(fromAddress, 'sender address')}>`, [250]);
    await connection.command(`RCPT TO:<${recipient}>`, [250, 251]);
    await connection.command('DATA', [354]);
    socket.write(`${safeMessage}\r\n.\r\n`);
    await connection.readResponse().then(response => {
      if (!response.startsWith('250')) throw new Error(`SMTP message rejected (${response.slice(0, 3)})`);
    });
    try { await connection.command('QUIT', [221]); } catch { /* The accepted mail has already been queued. */ }
  } finally {
    connection.close();
  }
}

export async function sendWhatsApp({ to, body }) {
  if (!isWhatsAppDeliveryConfigured()) {
    const error = new Error('Le service WhatsApp n’est pas configuré (identifiants Twilio requis).');
    error.statusCode = 503;
    throw error;
  }
  const accountSid = process.env.TWILIO_ACCOUNT_SID.trim();
  const from = process.env.TWILIO_WHATSAPP_FROM.trim();
  const normalizedTo = to.replace(/^whatsapp:/i, '');
  const normalizedFrom = from.replace(/^whatsapp:/i, '');
  const auth = Buffer.from(`${accountSid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      From: `whatsapp:${normalizedFrom}`,
      To: `whatsapp:${normalizedTo}`,
      Body: body,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || `Twilio rejected the WhatsApp message (${response.status})`);
    error.statusCode = response.status >= 500 ? 502 : 400;
    throw error;
  }
  return { sid: payload.sid, status: payload.status };
}
