// Packs a data-channel-only session description into the few fields that
// differ between connections, and rebuilds a full description from them.
// The packed form is base64url text for a QR code or a link's fragment.
// See section 9 of docs/design.md.
//
// Kept: the ICE user fragment and password, the DTLS fingerprint (SHA-256),
// the setup role, the media ID when it is not "0", and the UDP host
// candidates' addresses and ports, in the order given. The rest of the
// description is the same for every connection and is written out again.
//
// The candidates are rebuilt with fresh foundations and priorities that keep
// their order. Without STUN or TURN servers there are only host candidates,
// and candidates for TCP or for a second component are left out.
//
// Layout of the packed bytes:
//   1 byte    format version (high four bits), media ID follows (bit 2),
//             setup role (low two bits: 0 actpass, 1 active, 2 passive)
//   ufrag     1 byte length in characters, then 6 bits a character
//   pwd       the same
//   32 bytes  SHA-256 fingerprint
//   mid       1 byte length, then ASCII, only if the media ID flag is set
//   1 byte    number of candidates, then for each:
//             1 byte address kind (0 IPv4, 1 IPv6, 2 mDNS name made of a
//             UUID, 3 any other name), the address (4, 16, 16 bytes, or
//             1 byte length and ASCII), and 2 bytes port

const VERSION = 1;
const SETUP_ROLES = ['actpass', 'active', 'passive'];
const MID_FLAG = 0x04;
const FINGERPRINT_LENGTH = 32;

const IPV4 = 0;
const IPV6 = 1;
const MDNS_UUID = 2;
const NAME = 3;

// ICE characters are letters, digits, "+" and "/", which is the base64
// alphabet, so each fits in 6 bits.
const ICE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const UUID_NAME = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/;

export class SignalError extends Error {}

function fail(message) {
  throw new SignalError(message);
}

// Reads the fields this module keeps from a session description.
export function parseDescription(sdp) {
  if (typeof sdp !== 'string') {
    fail('The session description must be text.');
  }
  const lines = sdp.split(/\r?\n/);
  const attribute = (name) => {
    const prefix = `a=${name}:`;
    const line = lines.find((text) => text.startsWith(prefix));
    return line === undefined ? null : line.slice(prefix.length).trim();
  };
  const ufrag = attribute('ice-ufrag');
  const pwd = attribute('ice-pwd');
  const fingerprintLine = attribute('fingerprint');
  const setup = attribute('setup');
  const mid = attribute('mid') ?? '0';
  if (!ufrag || !pwd) {
    fail('The session description has no ICE user fragment or password.');
  }
  if (!fingerprintLine) {
    fail('The session description has no fingerprint.');
  }
  const [algorithm, hex = ''] = fingerprintLine.split(/\s+/);
  if (algorithm.toLowerCase() !== 'sha-256') {
    fail(`Unsupported fingerprint algorithm: ${algorithm}.`);
  }
  const fingerprint = hex.split(':').map((pair) => parseInt(pair, 16));
  if (fingerprint.length !== FINGERPRINT_LENGTH || fingerprint.some((byte) => !(byte >= 0 && byte <= 255))) {
    fail('The fingerprint is not 32 bytes.');
  }
  if (!SETUP_ROLES.includes(setup)) {
    fail(`Unsupported setup role: ${setup}.`);
  }
  const candidates = [];
  for (const line of lines) {
    if (!line.startsWith('a=candidate:')) {
      continue;
    }
    // foundation component transport priority address port "typ" type ...
    const fields = line.slice('a=candidate:'.length).trim().split(/\s+/);
    const [, component, transport, , address, port, typ, type] = fields;
    if (component !== '1' || transport.toLowerCase() !== 'udp' || typ !== 'typ' || type !== 'host') {
      continue;
    }
    const portNumber = Number(port);
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
      continue;
    }
    candidates.push({ address, port: portNumber });
  }
  return { ufrag, pwd, fingerprint, setup, mid, candidates };
}

function hexByte(byte) {
  return byte.toString(16).toUpperCase().padStart(2, '0');
}

// Writes a full session description from the kept fields.
export function buildDescription({ ufrag, pwd, fingerprint, setup, mid = '0', candidates }) {
  const lines = [
    'v=0',
    'o=- 1 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    `a=group:BUNDLE ${mid}`,
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    `a=ice-ufrag:${ufrag}`,
    `a=ice-pwd:${pwd}`,
    `a=fingerprint:sha-256 ${fingerprint.map(hexByte).join(':')}`,
    `a=setup:${setup}`,
    `a=mid:${mid}`,
    'a=sctp-port:5000',
  ];
  candidates.forEach(({ address, port }, index) => {
    // Host type preference 126, local preference falling with the order,
    // component 1.
    const priority = 126 * 2 ** 24 + (65535 - index) * 2 ** 8 + 255;
    lines.push(`a=candidate:${index + 1} 1 udp ${priority} ${address} ${port} typ host`);
  });
  lines.push('a=end-of-candidates');
  return { type: setup === 'actpass' ? 'offer' : 'answer', sdp: `${lines.join('\r\n')}\r\n` };
}

class Writer {
  constructor() {
    this.bytes = [];
  }

  byte(value) {
    this.bytes.push(value & 0xff);
  }

  ascii(text) {
    if (text.length > 255 || !/^[\x21-\x7e]*$/.test(text)) {
      fail(`Cannot pack "${text}".`);
    }
    this.byte(text.length);
    for (const char of text) {
      this.byte(char.charCodeAt(0));
    }
  }

  iceString(text) {
    if (text.length > 255) {
      fail('An ICE string is too long.');
    }
    this.byte(text.length);
    let bits = 0;
    let count = 0;
    for (const char of text) {
      const value = ICE_CHARS.indexOf(char);
      if (value < 0) {
        fail(`"${char}" is not an ICE character.`);
      }
      bits = (bits << 6) | value;
      count += 6;
      while (count >= 8) {
        count -= 8;
        this.byte(bits >> count);
      }
      bits &= (1 << count) - 1;
    }
    if (count > 0) {
      this.byte(bits << (8 - count));
    }
  }
}

class Reader {
  constructor(bytes) {
    this.bytes = bytes;
    this.offset = 0;
  }

  byte() {
    if (this.offset >= this.bytes.length) {
      fail('The connection data is cut short.');
    }
    return this.bytes[this.offset++];
  }

  take(length) {
    return Array.from({ length }, () => this.byte());
  }

  ascii() {
    return String.fromCharCode(...this.take(this.byte()));
  }

  iceString() {
    const length = this.byte();
    let text = '';
    let bits = 0;
    let count = 0;
    while (text.length < length) {
      if (count < 6) {
        bits = (bits << 8) | this.byte();
        count += 8;
      }
      count -= 6;
      text += ICE_CHARS[(bits >> count) & 0x3f];
      bits &= (1 << count) - 1;
    }
    return text;
  }
}

function parseIpv4(address) {
  const parts = address.split('.');
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) {
    return null;
  }
  return parts.map(Number);
}

function parseIpv6(address) {
  if (!/^[0-9a-fA-F:]+$/.test(address) || address.split('::').length > 2) {
    return null;
  }
  const [head, tail] = address.split('::');
  const groups = (text) => (text ? text.split(':') : []);
  const front = groups(head);
  const back = tail === undefined ? [] : groups(tail);
  const missing = 8 - front.length - back.length;
  if (tail === undefined ? missing !== 0 : missing < 1) {
    return null;
  }
  const all = [...front, ...Array(missing).fill('0'), ...back];
  if (!all.every((group) => /^[0-9a-fA-F]{1,4}$/.test(group))) {
    return null;
  }
  return all.flatMap((group) => {
    const value = parseInt(group, 16);
    return [value >> 8, value & 0xff];
  });
}

function formatIpv6(bytes) {
  const groups = [];
  for (let i = 0; i < 16; i += 2) {
    groups.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
  }
  // Shorten the longest run of two or more zero groups to "::".
  let best = { start: -1, length: 1 };
  for (let start = 0; start < 8; start++) {
    let length = 0;
    while (start + length < 8 && groups[start + length] === '0') {
      length++;
    }
    if (length > best.length) {
      best = { start, length };
    }
  }
  if (best.start < 0) {
    return groups.join(':');
  }
  const head = groups.slice(0, best.start).join(':');
  const tail = groups.slice(best.start + best.length).join(':');
  return `${head}::${tail}`;
}

function writeAddress(writer, address) {
  const ipv4 = parseIpv4(address);
  if (ipv4) {
    writer.byte(IPV4);
    ipv4.forEach((byte) => writer.byte(byte));
    return;
  }
  const ipv6 = parseIpv6(address);
  if (ipv6) {
    writer.byte(IPV6);
    ipv6.forEach((byte) => writer.byte(byte));
    return;
  }
  const uuid = UUID_NAME.exec(address);
  if (uuid) {
    writer.byte(MDNS_UUID);
    const hex = uuid.slice(1).join('');
    for (let i = 0; i < 32; i += 2) {
      writer.byte(parseInt(hex.slice(i, i + 2), 16));
    }
    return;
  }
  writer.byte(NAME);
  writer.ascii(address);
}

function readAddress(reader) {
  const kind = reader.byte();
  if (kind === IPV4) {
    return reader.take(4).join('.');
  }
  if (kind === IPV6) {
    return formatIpv6(reader.take(16));
  }
  if (kind === MDNS_UUID) {
    const hex = reader.take(16).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}.local`;
  }
  if (kind === NAME) {
    return reader.ascii();
  }
  return fail(`Unknown address kind ${kind}.`);
}

export function packFields({ ufrag, pwd, fingerprint, setup, mid = '0', candidates }) {
  const writer = new Writer();
  const hasMid = mid !== '0';
  writer.byte((VERSION << 4) | (hasMid ? MID_FLAG : 0) | SETUP_ROLES.indexOf(setup));
  writer.iceString(ufrag);
  writer.iceString(pwd);
  fingerprint.forEach((byte) => writer.byte(byte));
  if (hasMid) {
    writer.ascii(mid);
  }
  const kept = candidates.slice(0, 255);
  writer.byte(kept.length);
  for (const { address, port } of kept) {
    writeAddress(writer, address);
    writer.byte(port >> 8);
    writer.byte(port);
  }
  return Uint8Array.from(writer.bytes);
}

export function unpackFields(bytes) {
  const reader = new Reader(bytes);
  const header = reader.byte();
  if (header >> 4 !== VERSION) {
    fail('This connection data is from a different version of Otomo.');
  }
  const setup = SETUP_ROLES[header & 0x03];
  if (!setup) {
    fail('The connection data has an unknown setup role.');
  }
  const ufrag = reader.iceString();
  const pwd = reader.iceString();
  const fingerprint = reader.take(FINGERPRINT_LENGTH);
  const mid = header & MID_FLAG ? reader.ascii() : '0';
  const count = reader.byte();
  const candidates = [];
  for (let i = 0; i < count; i++) {
    const address = readAddress(reader);
    const port = (reader.byte() << 8) | reader.byte();
    candidates.push({ address, port });
  }
  if (reader.offset !== bytes.length) {
    fail('The connection data has extra bytes at the end.');
  }
  return { ufrag, pwd, fingerprint, setup, mid, candidates };
}

export function toBase64url(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const chunk = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let j = 0; j < chars; j++) {
      text += BASE64URL[(chunk >> (18 - j * 6)) & 0x3f];
    }
  }
  return text;
}

export function fromBase64url(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) {
    fail('The connection data is not valid.');
  }
  const bytes = [];
  let bits = 0;
  let count = 0;
  for (const char of text) {
    bits = (bits << 6) | BASE64URL.indexOf(char);
    count += 6;
    if (count >= 8) {
      count -= 8;
      bytes.push((bits >> count) & 0xff);
    }
    bits &= (1 << count) - 1;
  }
  return Uint8Array.from(bytes);
}

// A local description ({ type, sdp }) as base64url text.
export function packDescription(description) {
  const fields = parseDescription(description.sdp);
  const expected = fields.setup === 'actpass' ? 'offer' : 'answer';
  if (description.type !== expected) {
    fail(`An ${description.type} cannot have the setup role ${fields.setup}.`);
  }
  return toBase64url(packFields(fields));
}

// A description ({ type, sdp }) for setRemoteDescription, from packed text.
export function unpackDescription(text) {
  return buildDescription(unpackFields(fromBase64url(text)));
}

// The packed text in something a player pasted: a link with #join=, or the
// packed text alone. Returns null if there is none.
export function findPackedText(text) {
  if (typeof text !== 'string') {
    return null;
  }
  const trimmed = text.trim();
  const fragment = /#join=([A-Za-z0-9_-]+)/.exec(trimmed);
  if (fragment) {
    return fragment[1];
  }
  return /^[A-Za-z0-9_-]+$/.test(trimmed) ? trimmed : null;
}
