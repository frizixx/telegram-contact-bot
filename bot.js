import { Bot, InlineKeyboard } from 'grammy';
import { config } from 'dotenv';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const bot = new Bot(process.env.BOT_TOKEN);
const OWNER_ID = parseInt(process.env.OWNER_ID);

// JSON база данных
const DB_FILE = join(__dirname, 'bot-data.json');

// Инициализация БД
let db = {
  messages: [],
  blocklist: [],
  rateLimit: {},
  quickReplies: [
    { id: 1, label: '👋 Привет', text: 'Привет! Спасибо за сообщение, отвечу в ближайшее время.' },
    { id: 2, label: '⏰ Занят', text: 'Сейчас занят, отвечу позже. Спасибо за понимание!' },
    { id: 3, label: '✅ Принято', text: 'Сообщение принято, обработаю в течение дня.' }
  ]
};

// Загрузка БД
function loadDB() {
  if (existsSync(DB_FILE)) {
    const data = readFileSync(DB_FILE, 'utf8');
    db = JSON.parse(data);
  }
}

// Сохранение БД
function saveDB() {
  writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

// Загружаем при старте
loadDB();

// Антиспам: проверка rate limit
function checkRateLimit(userId) {
  const now = Date.now();
  const windowMs = 60000; // 1 минута
  const maxMessages = 5;

  if (!db.rateLimit[userId]) {
    db.rateLimit[userId] = { count: 1, windowStart: now };
    return true;
  }

  const record = db.rateLimit[userId];

  if (now - record.windowStart > windowMs) {
    // Новое окно
    db.rateLimit[userId] = { count: 1, windowStart: now };
    return true;
  }

  if (record.count >= maxMessages) {
    return false; // Превышен лимит
  }

  record.count++;
  return true;
}

// Проверка блэклиста
function isBlocked(userId) {
  return db.blocklist.some(u => u.userId === userId);
}

// Логирование
function log(type, message, data = {}) {
  const timestamp = new Date().toISOString();
  const emoji = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' }[type] || 'ℹ️';
  console.log(`${emoji} [${timestamp}] ${message}`, JSON.stringify(data));
}

// Команда /start
bot.command('start', async (ctx) => {
  if (ctx.from.id === OWNER_ID) {
    await ctx.reply(
      '👑 *Режим владельца активен*\n\n' +
      '📋 Доступные команды:\n' +
      '/stats — Статистика бота\n' +
      '/block <user_id> — Заблокировать пользователя\n' +
      '/unblock <user_id> — Разблокировать\n' +
      '/quickreplies — Управление быстрыми ответами\n\n' +
      '💬 Чтобы ответить пользователю — используй Reply на его сообщение',
      { parse_mode: 'Markdown' }
    );
  } else {
    await ctx.reply(
      '📬 Здравствуйте.\n\n' +
      'Это официальный контактный бот для связи.\n\n' +
      '📝 Напишите ваше сообщение, и оно будет передано.\n' +
      '⏱ Среднее время ответа: от нескольких часов до 1 рабочего дня.\n\n' +
      'Поддерживаются текстовые сообщения, фото, видео и документы.'
    );
  }
  log('info', 'User started bot', { userId: ctx.from.id, username: ctx.from.username });
});

// Команда /stats (только для владельца)
bot.command('stats', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return;

  const totalMessages = db.messages.length;
  const uniqueUsers = [...new Set(db.messages.map(m => m.userId))].length;
  const blockedUsers = db.blocklist.length;

  const today = new Date().toISOString().split('T')[0];
  const todayMessages = db.messages.filter(m => m.createdAt.startsWith(today)).length;

  // Последние 5 уникальных пользователей
  const recentUsers = [];
  const seenUsers = new Set();
  for (let i = db.messages.length - 1; i >= 0 && recentUsers.length < 5; i--) {
    const msg = db.messages[i];
    if (!seenUsers.has(msg.userId)) {
      seenUsers.add(msg.userId);
      recentUsers.push(msg);
    }
  }

  let statsText = '📊 *Статистика бота*\n\n';
  statsText += `📨 Всего сообщений: ${totalMessages}\n`;
  statsText += `👥 Уникальных пользователей: ${uniqueUsers}\n`;
  statsText += `🚫 Заблокировано: ${blockedUsers}\n`;
  statsText += `📅 Сегодня: ${todayMessages}\n\n`;
  statsText += '👤 Последние 5 пользователей:\n';

  recentUsers.forEach((u, i) => {
    statsText += `${i + 1}. ${u.firstName || 'Неизвестно'} (@${u.username || 'нет'}) [ID: ${u.userId}]\n`;
  });

  await ctx.reply(statsText, { parse_mode: 'Markdown' });
  log('info', 'Stats requested by owner');
});

// Команда /block (только для владельца)
bot.command('block', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return;

  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    await ctx.reply('Использование: /block <user_id> [причина]');
    return;
  }

  const targetUserId = parseInt(args[1]);
  const reason = args.slice(2).join(' ') || 'Не указана';

  if (isBlocked(targetUserId)) {
    await ctx.reply('⚠️ Пользователь уже заблокирован.');
    return;
  }

  db.blocklist.push({
    userId: targetUserId,
    reason,
    blockedAt: new Date().toISOString()
  });
  saveDB();

  await ctx.reply(`✅ Пользователь ${targetUserId} заблокирован.\nПричина: ${reason}`);
  log('warning', 'User blocked', { targetUserId, reason });
});

// Команда /unblock (только для владельца)
bot.command('unblock', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return;

  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    await ctx.reply('Использование: /unblock <user_id>');
    return;
  }

  const targetUserId = parseInt(args[1]);

  const index = db.blocklist.findIndex(u => u.userId === targetUserId);
  if (index === -1) {
    await ctx.reply('⚠️ Пользователь не был заблокирован.');
    return;
  }

  db.blocklist.splice(index, 1);
  saveDB();

  await ctx.reply(`✅ Пользователь ${targetUserId} разблокирован.`);
  log('info', 'User unblocked', { targetUserId });
});

// Команда /quickreplies (только для владельца)
bot.command('quickreplies', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return;

  let text = '⚡ *Быстрые ответы*\n\n';
  db.quickReplies.forEach(r => {
    text += `${r.id}. ${r.label}\n_"${r.text}"_\n\n`;
  });

  text += 'Используй их когда отвечаешь на сообщения (кнопки появятся после отправки)!';

  await ctx.reply(text, { parse_mode: 'Markdown' });
});

// Обработка всех входящих сообщений
bot.on('message', async (ctx) => {
  const userId = ctx.from.id;

  // Если пишет владелец - это ответ на чьё-то сообщение
  if (userId === OWNER_ID) {
    if (ctx.message.reply_to_message) {
      const originalText = ctx.message.reply_to_message.text || ctx.message.reply_to_message.caption || '';
      const userIdMatch = originalText.match(/👤 User ID: (\d+)/);

      if (userIdMatch) {
        const targetUserId = parseInt(userIdMatch[1]);

        try {
          const replyText = ctx.message.text || ctx.message.caption || '[медиа]';

          // Отправляем ответ с медиа если есть
          if (ctx.message.photo) {
            const photo = ctx.message.photo[ctx.message.photo.length - 1];
            await bot.api.sendPhoto(targetUserId, photo.file_id, {
              caption: `💬 Ответ от владельца:\n\n${ctx.message.caption || ''}`
            });
          } else if (ctx.message.video) {
            await bot.api.sendVideo(targetUserId, ctx.message.video.file_id, {
              caption: `💬 Ответ от владельца:\n\n${ctx.message.caption || ''}`
            });
          } else if (ctx.message.document) {
            await bot.api.sendDocument(targetUserId, ctx.message.document.file_id, {
              caption: `💬 Ответ от владельца:\n\n${ctx.message.caption || ''}`
            });
          } else {
            await bot.api.sendMessage(targetUserId, `💬 Ответ от владельца:\n\n${replyText}`);
          }

          // Кнопки быстрых ответов
          const keyboard = new InlineKeyboard();
          db.quickReplies.slice(0, 3).forEach(r => {
            keyboard.text(r.label, `qr_${r.id}_${targetUserId}`).row();
          });

          await ctx.reply('✅ Сообщение отправлено!\n\n_Или используй быстрый ответ:_', {
            reply_markup: keyboard,
            parse_mode: 'Markdown'
          });

          log('success', 'Reply sent to user', { targetUserId });
        } catch (error) {
          await ctx.reply(`❌ Ошибка отправки: ${error.message}`);
          log('error', 'Failed to send reply', { error: error.message });
        }
      }
    }
    return;
  }

  // Проверка блэклиста
  if (isBlocked(userId)) {
    log('warning', 'Blocked user tried to message', { userId });
    return;
  }

  // Проверка антиспама
  if (!checkRateLimit(userId)) {
    await ctx.reply('⚠️ Превышен лимит сообщений. Пожалуйста, подождите некоторое время перед повторной отправкой.');
    log('warning', 'Rate limit exceeded', { userId });
    return;
  }

  // Получаем информацию о пользователе
  const user = ctx.from;
  const messageText = ctx.message.text || ctx.message.caption || '[медиа без текста]';
  const messageType = ctx.message.photo ? '📸 фото' :
                      ctx.message.video ? '🎥 видео' :
                      ctx.message.document ? '📄 документ' :
                      ctx.message.sticker ? '🎨 стикер' :
                      ctx.message.voice ? '🎤 голосовое' :
                      ctx.message.audio ? '🎵 аудио' : '📝 текст';

  // Сохраняем в БД
  db.messages.push({
    userId: user.id,
    username: user.username,
    firstName: user.first_name,
    lastName: user.last_name,
    messageText,
    messageType,
    createdAt: new Date().toISOString()
  });
  saveDB();

  // Форматируем сообщение для владельца
  let forwardMessage =
    `📩 *Новое сообщение!*\n\n` +
    `👤 User ID: ${user.id}\n` +
    `👤 Username: ${user.username ? '@' + user.username : 'Не указан'}\n` +
    `📝 Имя: ${user.first_name}${user.last_name ? ' ' + user.last_name : ''}\n` +
    `🤖 Бот: ${user.is_bot ? 'Да' : 'Нет'}\n` +
    `🌐 Язык: ${user.language_code || 'Не указан'}\n` +
    `📊 Тип: ${messageType}\n` +
    `📬 Всего сообщений от пользователя: ${db.messages.filter(m => m.userId === user.id).length}\n\n`;

  if (messageText !== '[медиа без текста]') {
    forwardMessage += `💬 Сообщение:\n${messageText}`;
  }

  try {
    // Пересылаем медиа если есть
    if (ctx.message.photo) {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      await bot.api.sendPhoto(OWNER_ID, photo.file_id, {
        caption: forwardMessage,
        parse_mode: 'Markdown'
      });
    } else if (ctx.message.video) {
      await bot.api.sendVideo(OWNER_ID, ctx.message.video.file_id, {
        caption: forwardMessage,
        parse_mode: 'Markdown'
      });
    } else if (ctx.message.document) {
      await bot.api.sendDocument(OWNER_ID, ctx.message.document.file_id, {
        caption: forwardMessage,
        parse_mode: 'Markdown'
      });
    } else if (ctx.message.sticker) {
      await bot.api.sendMessage(OWNER_ID, forwardMessage, { parse_mode: 'Markdown' });
      await bot.api.sendSticker(OWNER_ID, ctx.message.sticker.file_id);
    } else if (ctx.message.voice) {
      await bot.api.sendMessage(OWNER_ID, forwardMessage, { parse_mode: 'Markdown' });
      await bot.api.sendVoice(OWNER_ID, ctx.message.voice.file_id);
    } else if (ctx.message.audio) {
      await bot.api.sendAudio(OWNER_ID, ctx.message.audio.file_id, {
        caption: forwardMessage,
        parse_mode: 'Markdown'
      });
    } else {
      await bot.api.sendMessage(OWNER_ID, forwardMessage, { parse_mode: 'Markdown' });
    }

    // Подтверждаем пользователю
    await ctx.reply(
      '✓ Ваше сообщение отправлено.\n\n' +
      'Вы получите ответ в ближайшее время.'
    );

    log('success', 'Message forwarded to owner', { userId, messageType });

  } catch (error) {
    console.error('Ошибка пересылки:', error);
    await ctx.reply('⚠️ Произошла техническая ошибка. Пожалуйста, повторите попытку позже.');
    log('error', 'Failed to forward message', { error: error.message });
  }
});

// Обработка callback кнопок (быстрые ответы)
bot.on('callback_query:data', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) {
    await ctx.answerCallbackQuery({ text: '⛔ Только владелец может использовать эти кнопки' });
    return;
  }

  const data = ctx.callbackQuery.data;

  if (data.startsWith('qr_')) {
    const parts = data.split('_');
    const replyId = parseInt(parts[1]);
    const targetUserId = parseInt(parts[2]);

    const quickReply = db.quickReplies.find(r => r.id === replyId);

    if (quickReply) {
      try {
        await bot.api.sendMessage(targetUserId, `💬 Ответ от владельца:\n\n${quickReply.text}`);
        await ctx.answerCallbackQuery({ text: '✅ Быстрый ответ отправлен!' });
        await ctx.editMessageText(`✅ Быстрый ответ "${quickReply.label}" отправлен пользователю ${targetUserId}!`);
        log('success', 'Quick reply sent via button', { targetUserId, replyId });
      } catch (error) {
        await ctx.answerCallbackQuery({ text: `❌ Ошибка: ${error.message}` });
        log('error', 'Failed to send quick reply', { error: error.message });
      }
    } else {
      await ctx.answerCallbackQuery({ text: '❌ Быстрый ответ не найден' });
    }
  }
});

// Обработка ошибок
bot.catch((err) => {
  log('error', 'Bot error', { error: err.message });
  console.error('Ошибка бота:', err);
});

// Автосохранение БД каждые 5 минут
setInterval(() => {
  saveDB();
  log('info', 'DB auto-saved');
}, 5 * 60 * 1000);

// Запуск бота
log('info', '🤖 Бот запускается...');
bot.start({
  onStart: (botInfo) => {
    log('success', `✅ Бот @${botInfo.username} успешно запущен!`);
    log('info', `📋 Owner ID: ${OWNER_ID}`);
    log('info', `💾 База данных: ${DB_FILE}`);
    log('info', `📊 Загружено сообщений: ${db.messages.length}`);
  }
});

// Graceful shutdown
process.once('SIGINT', () => {
  log('info', 'SIGINT received, saving database...');
  saveDB();
  bot.stop();
});

process.once('SIGTERM', () => {
  log('info', 'SIGTERM received, saving database...');
  saveDB();
  bot.stop();
});
