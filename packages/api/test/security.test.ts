import test from 'node:test';
import assert from 'node:assert/strict';
import { base32Decode, base32Encode, generateTotpSecret, otpauthUri, totp, verifyTotp } from '../src/totp';
import { openSecret, scryptHasher, sealSecret, signToken, verifyToken, b64u } from '../src/security';

test('TOTP: cocok dengan vektor uji resmi RFC 6238 (SHA-1, 8 digit)', () => {
  const secret = Buffer.from('12345678901234567890');
  const vec: [number, string][] = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
  for (const [t, code] of vec) assert.equal(totp(secret, t, { digits: 8 }), code, `t=${t}`);
  assert.equal(totp(secret, 59), '287082'); // 6 digit = 6 digit terakhir
});

test('base32: round-trip, toleran spasi/huruf kecil, menolak karakter ilegal', () => {
  for (let n = 0; n < 40; n++) { const b = Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + n) & 255)); assert.deepEqual(base32Decode(base32Encode(b)), b); }
  assert.equal(base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI'); // RFC 4648
  assert.deepEqual(base32Decode('mzxw 6ytb-oi'), Buffer.from('foobar'));
  assert.throws(() => base32Decode('MZXW1')); // '1' bukan base32
});

test('verifyTotp: jendela ±1 langkah, mengembalikan langkah (untuk anti-ulang), menolak format salah', () => {
  const s = Buffer.from('12345678901234567890'), now = 1_700_000_000, step = Math.floor(now / 30);
  assert.equal(verifyTotp(s, totp(s, now), now), step);
  assert.equal(verifyTotp(s, totp(s, now - 30), now), step - 1);
  assert.equal(verifyTotp(s, totp(s, now + 30), now), step + 1);
  assert.equal(verifyTotp(s, totp(s, now - 90), now), null);
  assert.equal(verifyTotp(s, '12345', now), null);
  assert.equal(verifyTotp(s, '12345a', now), null);
  assert.equal(verifyTotp(s, '', now), null);
  const g = generateTotpSecret();
  assert.equal(g.secret.length, 20); assert.deepEqual(base32Decode(g.base32), g.secret);
  assert.match(otpauthUri('FICOIM', 'a@b.id', g.base32), /^otpauth:\/\/totp\/FICOIM:a%40b\.id\?secret=[A-Z2-7]+&issuer=FICOIM/);
});

test('token HS256: sah, kedaluwarsa, dimanipulasi, alg diganti, rahasia lain', () => {
  const key = Buffer.alloc(32, 7), other = Buffer.alloc(32, 8), t0 = 1_700_000_000;
  const tok = signToken({ sub: 'u1', bid: 'b1' }, key, t0, 900);
  assert.equal(verifyToken(tok, key, t0 + 10)!.sub, 'u1');
  assert.equal(verifyToken(tok, key, t0 + 900), null);       // tepat kedaluwarsa
  assert.equal(verifyToken(tok, other, t0 + 10), null);
  const [h, p, s] = tok.split('.') as [string, string, string];
  const evil = b64u(Buffer.from(JSON.stringify({ sub: 'admin', bid: 'b1', exp: t0 + 99999 })));
  assert.equal(verifyToken(`${h}.${evil}.${s}`, key, t0 + 10), null);                    // payload diganti
  assert.equal(verifyToken(`${h}.${p}.${s.slice(0, -2)}AA`, key, t0 + 10), null);         // tanda tangan diubah
  assert.equal(verifyToken(`${b64u(Buffer.from('{"alg":"none","typ":"JWT"}'))}.${p}.`, key, t0 + 10), null); // alg:none
  assert.equal(verifyToken(`${b64u(Buffer.from('{"alg":"HS512","typ":"JWT"}'))}.${p}.${s}`, key, t0 + 10), null);
  for (const junk of ['', 'a.b', 'a.b.c.d', '...', 'x'.repeat(5000)]) assert.equal(verifyToken(junk, key, t0), null);
  assert.throws(() => signToken({}, Buffer.alloc(16), t0, 60), /32 byte/);
});

test('sealSecret: enkripsi rahasia TOTP — round-trip, kunci salah, data diubah', () => {
  const key = Buffer.alloc(32, 1), plain = Buffer.from('rahasia-totp-20-byte!!');
  const sealed = sealSecret(plain, key);
  assert.deepEqual(openSecret(sealed, key), plain);
  assert.notEqual(sealSecret(plain, key), sealed); // nonce acak
  assert.equal(openSecret(sealed, Buffer.alloc(32, 2)), null);
  const raw = Buffer.from(sealed, 'base64url'); raw[20] = (raw[20] as number) ^ 1;
  assert.equal(openSecret(raw.toString('base64url'), key), null);
  assert.equal(openSecret('pendek', key), null);
  assert.throws(() => sealSecret(plain, Buffer.alloc(16)));
});

test('hash password scrypt: verifikasi, salt unik, NFKC, string korup/parameter berbahaya ditolak cepat', async () => {
  const h = scryptHasher({ logN: 12, r: 8, p: 1 });
  const a = await h.hash('Kata-Sandi-Kuat-1'), b = await h.hash('Kata-Sandi-Kuat-1');
  assert.notEqual(a, b);
  assert.ok(await h.verify('Kata-Sandi-Kuat-1', a));
  assert.ok(!(await h.verify('kata-sandi-kuat-1', a)));
  assert.ok(await h.verify('caf\u00e9-sandi-123', await h.hash('cafe\u0301-sandi-123')));
  assert.ok(await h.verify('１２３４５６７８abc', await h.hash('12345678abc')));
  const t0 = Date.now();
  for (const bad of ['', 'plain', 'scrypt$12$8$1$x', 'scrypt$99$8$1$AAAA$BBBB', 'scrypt$12$999$1$AAAA$BBBB', 'argon2$x$y$z$a$b', 'scrypt$12$8$1$AAAA$']) assert.equal(await h.verify('x', bad), false);
  assert.ok(Date.now() - t0 < 500);
});
