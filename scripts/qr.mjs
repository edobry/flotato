// Writes the QR code for the play URL to public/qr.svg. Run: npm run qr
import { writeFileSync } from 'node:fs';
import QRCode from 'qrcode';

const url = process.argv[2] ?? 'https://edobry.github.io/flotato/';
const svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#ffffffff', light: '#00000000' } });
writeFileSync(new URL('../public/qr.svg', import.meta.url), svg);
console.log('public/qr.svg <-', url);
