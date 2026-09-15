// Writes QR codes for the play URL and the pad URL to public/. Run: npm run qr
import { writeFileSync } from 'node:fs';
import QRCode from 'qrcode';

const targets = [
  ['qr.svg', 'https://edobry.github.io/flotato/'],
  ['qr-pad.svg', 'https://edobry.github.io/flotato/pad/'],
];
for (const [file, url] of targets) {
  const svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#ffffffff', light: '#00000000' } });
  writeFileSync(new URL('../public/' + file, import.meta.url), svg);
  console.log('public/' + file, '<-', url);
}
