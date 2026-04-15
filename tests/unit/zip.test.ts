// @vitest-environment node
import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { buildZip } from '@shared/zip';

async function blobToBuffer(blob: Blob): Promise<Buffer> {
  return Buffer.from(await blob.arrayBuffer());
}

describe('buildZip', () => {
  it('produces a valid STORE-mode archive with the expected file count', async () => {
    const entries = [
      { name: 'hello.txt', data: new TextEncoder().encode('hello world\n') },
      { name: 'dir/a.xml', data: new TextEncoder().encode('<?xml version="1.0"?><root/>') },
      { name: 'dir/b.bin', data: new Uint8Array([0, 1, 2, 3, 255, 254, 253]) },
    ];
    const blob = buildZip(entries);
    expect(blob.type).toBe('application/zip');

    const buf = await blobToBuffer(blob);
    const zip = new AdmZip(buf);
    const files = zip.getEntries();
    expect(files).toHaveLength(3);

    const byName = Object.fromEntries(files.map((f) => [f.entryName, f]));
    expect(byName['hello.txt']!.getData().toString('utf8')).toBe('hello world\n');
    expect(byName['dir/a.xml']!.getData().toString('utf8')).toBe('<?xml version="1.0"?><root/>');
    expect(Array.from(byName['dir/b.bin']!.getData())).toEqual([0, 1, 2, 3, 255, 254, 253]);
  });

  it('handles an empty archive', async () => {
    const blob = buildZip([]);
    const buf = await blobToBuffer(blob);
    const zip = new AdmZip(buf);
    expect(zip.getEntries()).toHaveLength(0);
  });

  it('handles binary data (PNG-like bytes) faithfully', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(64).fill(0x42)]);
    const blob = buildZip([{ name: 'screenshot.png', data: png }]);
    const buf = await blobToBuffer(blob);
    const zip = new AdmZip(buf);
    const entry = zip.getEntries()[0]!;
    expect(entry.entryName).toBe('screenshot.png');
    expect(Array.from(entry.getData())).toEqual(Array.from(png));
  });

  it('uses stored (uncompressed) method — output size >= total data size', async () => {
    const data = new Uint8Array(256).fill(0x41);
    const blob = buildZip([{ name: 'a.txt', data }]);
    expect(blob.size).toBeGreaterThanOrEqual(256);
  });

  it('writes a well-formed end-of-central-directory record', async () => {
    const blob = buildZip([{ name: 'x.txt', data: new TextEncoder().encode('x') }]);
    const buf = await blobToBuffer(blob);
    // EOCD signature at buf.length - 22
    const eocd = buf.readUInt32LE(buf.length - 22);
    expect(eocd).toBe(0x06054b50);
    // total entries fields
    expect(buf.readUInt16LE(buf.length - 22 + 8)).toBe(1);
    expect(buf.readUInt16LE(buf.length - 22 + 10)).toBe(1);
  });
});
