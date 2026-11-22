import sharp from 'sharp';
import { readFileSync } from 'fs';

const svgBuffer = readFileSync('final-logo.svg');

await sharp(svgBuffer)
  .resize(1024, 1024)
  .png()
  .toFile('final-logo.png');

console.log('✅ Финальный логотип готов!');
