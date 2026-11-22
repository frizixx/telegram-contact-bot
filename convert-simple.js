import sharp from 'sharp';
import { readFileSync } from 'fs';

const svgBuffer = readFileSync('simple-logo.svg');

await sharp(svgBuffer)
  .resize(1024, 1024)
  .png()
  .toFile('simple-logo.png');

console.log('✅ Простой логотип готов!');
