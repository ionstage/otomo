import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  SignalError,
  buildDescription,
  findPackedText,
  fromBase64url,
  packDescription,
  packFields,
  parseDescription,
  toBase64url,
  unpackDescription,
  unpackFields,
} from '../js/signal.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/descriptions.json', import.meta.url), 'utf8'));

// The plan aims for about 150 bytes or less.
const MAX_PACKED_BYTES = 150;

for (const [name, { offer, answer }] of Object.entries(fixtures)) {
  for (const description of [offer, answer]) {
    test(`${name} ${description.type}: packs small and rebuilds the same fields`, () => {
      const original = parseDescription(description.sdp);
      const text = packDescription(description);
      assert.ok(fromBase64url(text).length <= MAX_PACKED_BYTES, `${fromBase64url(text).length} bytes`);
      assert.match(text, /^[A-Za-z0-9_-]+$/);
      const rebuilt = unpackDescription(text);
      assert.equal(rebuilt.type, description.type);
      assert.deepEqual(parseDescription(rebuilt.sdp), original);
    });
  }
}

test('keeps only UDP host candidates for the first component', () => {
  const fields = parseDescription(fixtures['firefox-format'].offer.sdp);
  assert.deepEqual(fields.candidates, [
    { address: '192.168.1.21', port: 52143 },
    { address: 'fd00:1:2:3:4c3a:9ff:fe12:3456', port: 60412 },
  ]);
});

test('reads the fields of a Chrome offer', () => {
  const fields = parseDescription(fixtures['chrome-mdns'].offer.sdp);
  assert.equal(fields.setup, 'actpass');
  assert.equal(fields.mid, '0');
  assert.equal(fields.fingerprint.length, 32);
  assert.equal(fields.candidates.length, 1);
  assert.match(fields.candidates[0].address, /\.local$/);
});

test('packs an mDNS name made of a UUID into 16 bytes', () => {
  const base = parseDescription(fixtures['chrome-mdns'].offer.sdp);
  const withName = { ...base, candidates: [{ address: '7bc0de35-d8a8-45b3-a7f2-f5b9f24003fd.local', port: 1 }] };
  const withIp = { ...base, candidates: [{ address: '10.0.0.1', port: 1 }] };
  assert.equal(packFields(withName).length - packFields(withIp).length, 12);
});

test('round-trips other addresses and a media ID that is not "0"', () => {
  const fields = {
    ufrag: 'a+/Z',
    pwd: 'abcdefghijklmnopqrstuv',
    fingerprint: Array.from({ length: 32 }, (_, i) => i * 7),
    setup: 'passive',
    mid: 'data',
    candidates: [
      { address: '::1', port: 9 },
      { address: '2001:db8::8a2e:370:7334', port: 65535 },
      { address: 'fe80::1:0:0:1', port: 1234 },
      { address: '1:2:3:4:5:6:7:8', port: 1 },
      { address: 'phone.local', port: 5000 },
    ],
  };
  assert.deepEqual(unpackFields(packFields(fields)), fields);
});

test('an offer is actpass and an answer is not', () => {
  assert.equal(buildDescription({ ...parseDescription(fixtures['chrome-mdns'].offer.sdp) }).type, 'offer');
  assert.equal(buildDescription({ ...parseDescription(fixtures['chrome-mdns'].answer.sdp) }).type, 'answer');
  const { offer } = fixtures['chrome-mdns'];
  assert.throws(() => packDescription({ type: 'answer', sdp: offer.sdp }), SignalError);
});

test('the rebuilt description has what a data channel needs', () => {
  const { sdp } = unpackDescription(packDescription(fixtures['chrome-mdns'].offer));
  for (const line of [
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'a=group:BUNDLE 0',
    'a=mid:0',
    'a=sctp-port:5000',
    'a=setup:actpass',
    'a=end-of-candidates',
  ]) {
    assert.ok(sdp.split('\r\n').includes(line), line);
  }
  assert.ok(sdp.endsWith('\r\n'));
});

test('base64url round-trips every length', () => {
  for (let length = 0; length < 10; length++) {
    const bytes = Uint8Array.from({ length }, (_, i) => 255 - i * 31);
    const text = toBase64url(bytes);
    assert.equal(text.length, Math.ceil((length * 8) / 6));
    assert.deepEqual(fromBase64url(text), bytes);
  }
});

test('rejects data that is not valid', () => {
  const text = packDescription(fixtures['chrome-mdns'].offer);
  for (const bad of ['', 'not base64!', text.slice(0, -4), `${text}AAAA`, `I${text.slice(1)}`]) {
    assert.throws(() => unpackDescription(bad), SignalError, bad);
  }
});

test('rejects a description it cannot pack', () => {
  const { sdp } = fixtures['chrome-mdns'].offer;
  assert.throws(() => parseDescription(sdp.replace(/a=ice-pwd:.*\r\n/, '')), SignalError);
  assert.throws(() => parseDescription(sdp.replace('sha-256', 'sha-1')), SignalError);
  assert.throws(() => parseDescription(sdp.replace('a=setup:actpass', 'a=setup:holdconn')), SignalError);
});

test('finds the packed text in a link or on its own', () => {
  assert.equal(findPackedText('https://www.ionstage.org/otomo/#join=EATQ-_x'), 'EATQ-_x');
  assert.equal(findPackedText('  EATQ-_x\n'), 'EATQ-_x');
  assert.equal(findPackedText('Join me: https://example.org/otomo/#join=abc'), 'abc');
  assert.equal(findPackedText('not a code'), null);
  assert.equal(findPackedText(''), null);
  assert.equal(findPackedText(undefined), null);
});
