import sharp from 'sharp';
import { readFileSync } from 'fs';

const svgBuffer = readFileSync('bot-logo.svg');

sharp(svgBuffer)
  .resize(1024, 1024)
  .png()
  .toFile('bot-logo.png')
  .then(() => {
    console.log('✅ Logo converted to PNG successfully!');
  })
  .catch(err => {
    console.error('❌ Conversion failed:', err);
  });
