import sharp from 'sharp';
import { readFileSync } from 'fs';

const variants = [1, 2, 3, 4, 5, 6];

for (const num of variants) {
  const svgBuffer = readFileSync(`logo-variant-${num}.svg`);

  await sharp(svgBuffer)
    .resize(1024, 1024)
    .png()
    .toFile(`logo-variant-${num}.png`);

  console.log(`✅ Вариант ${num} конвертирован!`);
}

console.log('🎉 Все 6 вариантов готовы!');
