import { PIECES, PIECE_TYPES } from './pieces.js';

// Track share codes: "PT1" + base64url(deflate-raw(JSON)). Falls back to uncompressed
// JSON ("PT0") where CompressionStream is unavailable.

const ENVS = ['summer', 'winter', 'desert'];

function toCompact(track) {
  return {
    n: track.name || 'Untitled',
    e: Math.max(0, ENVS.indexOf(track.env)),
    p: track.pieces.map((pc) => [PIECE_TYPES.indexOf(pc.t), pc.x, pc.y, pc.z, pc.r, pc.m ? 1 : 0]),
  };
}

function fromCompact(obj) {
  if (!obj || !Array.isArray(obj.p)) throw new Error('Not a track');
  const pieces = [];
  for (const row of obj.p) {
    const [ti, x, y, z, r, m] = row;
    const t = PIECE_TYPES[ti];
    if (!t || !PIECES[t]) continue;
    if (![x, y, z, r].every(Number.isInteger)) continue;
    pieces.push({ t, x, y, z, r: ((r % 4) + 4) % 4, m: m ? 1 : 0 });
  }
  return {
    name: String(obj.n || 'Imported track').slice(0, 40),
    env: ENVS[obj.e] || 'summer',
    pieces,
  };
}

function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

export async function encodeTrack(track) {
  const json = new TextEncoder().encode(JSON.stringify(toCompact(track)));
  if (typeof CompressionStream !== 'undefined') {
    const packed = await pipe(json, new CompressionStream('deflate-raw'));
    return 'PT1' + bytesToB64url(packed);
  }
  return 'PT0' + bytesToB64url(json);
}

export async function decodeTrack(code) {
  const s = String(code).trim();
  const body = s.slice(3);
  let json;
  if (s.startsWith('PT1')) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot read compressed codes');
    json = await pipe(b64urlToBytes(body), new DecompressionStream('deflate-raw'));
  } else if (s.startsWith('PT0')) {
    json = b64urlToBytes(body);
  } else {
    throw new Error('Track codes start with PT0 or PT1');
  }
  return fromCompact(JSON.parse(new TextDecoder().decode(json)));
}
