import sharp from 'sharp';
import { readFileSync } from 'fs';

const variants = [1, 2, 3, 4, 5, 6];

for (const num of variants) {
  const svgBuffer = readFileSync(`realistic-${num}.svg`);

  await sharp(svgBuffer)
    .resize(1024, 1024)
    .png()
    .toFile(`realistic-${num}.png`);

  console.log(`✅ Реалистичный вариант ${num} готов!`);
}

console.log('🎉 Все 6 реалистичных вариантов конвертированы!');
