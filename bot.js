import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { config } from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { writeFile } from 'fs/promises';           // [FIX-2] async writeFile
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const bot = new Bot(process.env.BOT_TOKEN);
const OWNER_ID = parseInt(process.env.OWNER_ID);

// JSON база данных - используем /tmp везде на серверах
const DB_FILE = process.env.DB_PATH || (process.env.FLY_APP_NAME ? '/tmp/bot-data.json' : process.env.RAILWAY_ENVIRONMENT ? '/tmp/bot-data.json' : join(__dirname, 'bot-data.json'));

// [FIX-1] Map: messageId владельца → userId отправителя
//   Ключ — message_id того сообщения, которое бот отправил в чат владельца.
//   Живёт только в RAM (не сериализуется): после рестарта старые треды
//   падают обратно на regex-фоллбэк, новые — сразу в Map.
const msgMap = new Map(); // Map<ownerMsgId: number, senderUserId: number>

// Инициализация БД
let db = {
  messages: [],
  blocklist: [],
  rateLimit: {},
  quickReplies: [
    { id: 1, label: '👋 Привет', text: 'Здравствуйте! Спасибо за обращение. Отвечу в ближайшее время.' },
    { id: 2, label: '⏰ Занят', text: 'Сейчас занят, отвечу позже. Спасибо за понимание!' },
    { id: 3, label: '✅ Принято', text: 'Ваше сообщение принято. Обработаю в течение дня.' }
  ],
  autoReplySent: {}, // Кому уже отправлен автоответ
  ownerLastActivity: Date.now() // Последняя активность владельца
};

// Загрузка БД (синхронно, только при старте — это нормально)
function loadDB() {
  try {
    if (existsSync(DB_FILE)) {
      const data = readFileSync(DB_FILE, 'utf8');
      db = JSON.parse(data);
      log('info', 'Database loaded successfully');
    }
  } catch (error) {
    log('warning', 'Could not load database, using defaults', { error: error.message });
  }
}

// [FIX-2] Сохранение БД — async, не блокирует event loop
let _saveInProgress = false;
let _savePending = false;

async function saveDB() {
  if (_saveInProgress) {
    // Запомним, что нужно ещё одно сохранение после текущего
    _savePending = true;
    return;
  }
  _saveInProgress = true;
  try {
    await writeFile(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (error) {
    log('error', 'Failed to save database', { error: error.message });
  } finally {
    _saveInProgress = false;
    if (_savePending) {
      _savePending = false;
      saveDB(); // сохраняем накопившееся
    }
  }
}

// Загружаем при старте
loadDB();

// Антиспам: проверка rate limit
function checkRateLimit(userId) {
  const now = Date.now();
  const WINDOW_MS = 60000;   // 1 минута
  const MAX_MESSAGES = 5;
  const BAN_TIME_MS = 300000; // 5 минут бан при превышении

  if (!db.rateLimit[userId]) {
    db.rateLimit[userId] = { count: 1, windowStart: now, bannedUntil: 0 };
    return { allowed: true };
  }

  const record = db.rateLimit[userId];

  if (now < record.bannedUntil) {
    return { allowed: false, bannedUntil: record.bannedUntil };
  }

  if (now - record.windowStart > WINDOW_MS) {
    record.count = 1;
    record.windowStart = now;
    return { allowed: true };
  }

  if (record.count >= MAX_MESSAGES) {
    record.bannedUntil = now + BAN_TIME_MS;
    return { allowed: false, bannedUntil: record.bannedUntil };
  }

  record.count++;
  return { allowed: true };
}

// Проверка блэклиста
function isBlocked(userId) {
  return db.blocklist.some(u => u.userId === userId);
}

// [FIX-6] Экранирование спецсимволов Markdown v1
function escapeMarkdown(text) {
  return String(text).replace(/([_*`\[])/g, '\\$1');
}

// Логирование
function log(type, message, data = {}) {
  const timestamp = new Date().toISOString();
  const emoji = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' }[type] || 'ℹ️';
  console.log(`${emoji} [${timestamp}] ${message}`, JSON.stringify(data));
}

// [FIX-3] Очистка autoReplySent старше 24 часов
function cleanAutoReplySent() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 часа
  let cleaned = 0;
  for (const [userId, ts] of Object.entries(db.autoReplySent)) {
    if (ts < cutoff) {
      delete db.autoReplySent[userId];
      cleaned++;
    }
  }
  if (cleaned > 0) {
    saveDB();
    log('info', `Cleaned ${cleaned} stale autoReplySent entries`);
  }
}

// Запускаем очистку раз в час
setInterval(cleanAutoReplySent, 60 * 60 * 1000);

// ─────────────────────────────────────────────────────────────────────────────
// Команды
// ─────────────────────────────────────────────────────────────────────────────

bot.command('start', async (ctx) => {
  if (ctx.from.id === OWNER_ID) {
    await ctx.reply(
      '👑 *Режим владельца активен*\n\n' +
      '📋 Доступные команды:\n' +
      '/stats — Статистика бота\n' +
      '/block <user_id> — Заблокировать пользователя\n' +
      '/unblock <user_id> — Разблокировать\n' +
      '/blocklist — Список заблокированных\n' +
      '/quickreplies — Просмотр быстрых ответов\n' +
      '/qr add <Название | текст> — Добавить быстрый ответ\n' +
      '/qr del <id> — Удалить быстрый ответ\n' +
      '/online — Отметиться как онлайн (отключит автоответчик)\n' +
      '/offline — Включить автоответчик\n\n' +
      '💬 Чтобы ответить пользователю — используй Reply на его сообщение\n\n' +
      '🤖 Автоответчик: если ты не активен >5 минут, пользователи автоматически получат сообщение "Сейчас занят, отвечу позже"',
      { parse_mode: 'Markdown' }
    );
  } else {
    // Проверка блокировки при /start
    if (isBlocked(ctx.from.id)) {
      await ctx.reply('🚫 Вы заблокированы и не можете использовать этого бота.');
      return;
    }

    try {
      const gifPath = process.env.FLY_APP_NAME ? '/app/greeting.gif' : join(__dirname, 'greeting.gif');

      if (existsSync(gifPath)) {
        await ctx.replyWithAnimation(new InputFile(gifPath), {
          caption: 'Hi!\n' +
                   'Это контактный бот для связи с Frizix.\n\n' +
                   '✉️ Напишите ваше сообщение, и оно будет передано.\n' +
                   '⏱️ Среднее время ответа: от нескольких часов до 1 рабочего дня.'
        });
      } else {
        await ctx.reply(
          'Hi!\n' +
          'Это контактный бот для связи с Frizix.\n\n' +
          '✉️ Напишите ваше сообщение, и оно будет передано.\n' +
          '⏱️ Среднее время ответа: от нескольких часов до 1 рабочего дня.'
        );
      }
    } catch (error) {
      log('error', 'Failed to send greeting media', { error: error.message });
      await ctx.reply(
        'Hi!\n' +
        'Это контактный бот для связи с Frizix.\n\n' +
        '✉️ Напишите ваше сообщение, и оно будет передано.\n' +
        '⏱️ Среднее время ответа: от нескольких часов до 1 рабочего дня.'
      );
    }
  }
  log('info', 'User started bot', { userId: ctx.from.id, username: ctx.from.username });
});

bot.command('stats', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return;

  const totalMessages = db.messages.length;
  const uniqueUsers = [...new Set(db.messages.map(m => m.userId))].length;
  const blockedUsers = db.blocklist.length;

  const today = new Date().toISOString().split('T')[0];
  const todayMessages = db.messages.filter(m => m.createdAt.startsWith(today)).length;

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

  db.blocklist.push({ userId: targetUserId, reason, blockedAt: new Date().toISOString() });
  saveDB();

  await ctx.reply(`✅ Пользователь ${targetUserId} заблокирован.\nПричина: ${reason}`);
  log('warning', 'User blocked', { targetUserId, reason });
});

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

bot.command('quickreplies', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return;

  let text = '⚡ *Быстрые ответы*\n\n';
  if (db.quickReplies.length === 0) {
    text += '_Список пуст._\n\n';
  } else {
    db.quickReplies.forEach(r => {
      text += `${r.id}. ${r.label}\n_"${escapeMarkdown(r.text)}"_\n\n`;
    });
  }
  text +=
    'Используй их когда отвечаешь на сообщения \\(кнопки появятся после отправки\\)\\!\n\n' +
    '*Управление:*\n' +
    '`/qr add <эмодзи Название | текст ответа>` — добавить\n' +
    '`/qr del <id>` — удалить';

  await ctx.reply(text, { parse_mode: 'Markdown' });
});

// [NEW-2] /qr add <эмодзи Название | текст> и /qr del <id>
bot.command('qr', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return;

  const full = ctx.message.text.slice('/qr '.length).trim();
  const [sub, ...rest] = full.split(' ');

  if (sub === 'add') {
    // Формат: /qr add 🙏 Спасибо | Большое спасибо за обращение!
    const combined = rest.join(' ');
    const pipeIdx = combined.indexOf('|');
    if (pipeIdx === -1) {
      await ctx.reply('Формат: `/qr add <Название | текст ответа>`', { parse_mode: 'Markdown' });
      return;
    }
    const label = combined.slice(0, pipeIdx).trim();
    const text  = combined.slice(pipeIdx + 1).trim();
    if (!label || !text) {
      await ctx.reply('Название и текст не могут быть пустыми.');
      return;
    }
    const newId = db.quickReplies.length
      ? Math.max(...db.quickReplies.map(r => r.id)) + 1
      : 1;
    db.quickReplies.push({ id: newId, label, text });
    saveDB();
    await ctx.reply(`✅ Быстрый ответ #${newId} добавлен:\n*${escapeMarkdown(label)}*\n_"${escapeMarkdown(text)}"_`, { parse_mode: 'Markdown' });

  } else if (sub === 'del') {
    const delId = parseInt(rest[0]);
    if (isNaN(delId)) {
      await ctx.reply('Формат: `/qr del <id>`', { parse_mode: 'Markdown' });
      return;
    }
    const idx = db.quickReplies.findIndex(r => r.id === delId);
    if (idx === -1) {
      await ctx.reply(`⚠️ Быстрый ответ #${delId} не найден.`);
      return;
    }
    const removed = db.quickReplies.splice(idx, 1)[0];
    saveDB();
    await ctx.reply(`✅ Быстрый ответ #${delId} «${removed.label}» удалён.`);

  } else {
    await ctx.reply('Команды: `/qr add <Название | текст>` или `/qr del <id>`', { parse_mode: 'Markdown' });
  }
});

// [NEW-4] /blocklist — просмотр заблокированных с кнопками разблокировки
bot.command('blocklist', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return;

  if (db.blocklist.length === 0) {
    await ctx.reply('✅ Список блокировок пуст.');
    return;
  }

  let text = `🚫 *Заблокированные пользователи* (${db.blocklist.length}):\n\n`;
  const keyboard = new InlineKeyboard();

  db.blocklist.forEach((u, i) => {
    const date = new Date(u.blockedAt).toLocaleDateString('ru-RU');
    text += `${i + 1}. ID: \`${u.userId}\`\n`;
    text += `   Причина: ${escapeMarkdown(u.reason)}\n`;
    text += `   Дата: ${date}\n\n`;
    keyboard.text(`🟢 Разблокировать ${u.userId}`, `unblock_${u.userId}`).row();
  });

  await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  log('info', 'Blocklist requested by owner');
});

bot.command('online', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return;

  db.ownerLastActivity = Date.now();
  saveDB();

  await ctx.reply('✅ Вы отмечены как онлайн. Автоответчик не будет срабатывать.');
  log('info', 'Owner marked as online');
});

bot.command('offline', async (ctx) => {
  if (ctx.from.id !== OWNER_ID) return;

  db.ownerLastActivity = Date.now() - (10 * 60 * 1000);
  saveDB();

  await ctx.reply('⏰ Автоответчик включён. Пользователи будут получать автоматическое сообщение: "Сейчас занят, отвечу позже. Спасибо за понимание!"');
  log('info', 'Owner marked as offline, auto-reply enabled');
});

// ─────────────────────────────────────────────────────────────────────────────
// Обработка сообщений
// ─────────────────────────────────────────────────────────────────────────────

bot.on('message', async (ctx) => {
  const userId = ctx.from.id;

  // Владелец отвечает на сообщение
  if (userId === OWNER_ID) {
    db.ownerLastActivity = Date.now();

    if (ctx.message.reply_to_message) {
      const replyToId = ctx.message.reply_to_message.message_id;

      // [FIX-1] Сначала ищем в Map (быстро и надёжно)
      let targetUserId = msgMap.get(replyToId);

      // Фоллбэк на regex для старых сообщений, которых нет в Map
      if (!targetUserId) {
        const originalText =
          ctx.message.reply_to_message.text ||
          ctx.message.reply_to_message.caption || '';
        const match = originalText.match(/👤 User ID: (\d+)/);
        if (match) targetUserId = parseInt(match[1]);
      }

      if (targetUserId) {
        // Сбрасываем автоответ — владелец уже ответил
        if (db.autoReplySent[targetUserId]) {
          delete db.autoReplySent[targetUserId];
          saveDB();
        }

        try {
          const replyText = ctx.message.text || ctx.message.caption || '[медиа]';

          if (ctx.message.photo) {
            const photo = ctx.message.photo[ctx.message.photo.length - 1];
            await bot.api.sendPhoto(targetUserId, photo.file_id, {
              caption: `💬 Ответ:\n\n${ctx.message.caption || ''}`
            });
          } else if (ctx.message.video) {
            await bot.api.sendVideo(targetUserId, ctx.message.video.file_id, {
              caption: `💬 Ответ:\n\n${ctx.message.caption || ''}`
            });
          } else if (ctx.message.document) {
            await bot.api.sendDocument(targetUserId, ctx.message.document.file_id, {
              caption: `💬 Ответ:\n\n${ctx.message.caption || ''}`
            });
          } else if (ctx.message.voice) {
            await bot.api.sendVoice(targetUserId, ctx.message.voice.file_id);
          } else if (ctx.message.audio) {
            await bot.api.sendAudio(targetUserId, ctx.message.audio.file_id, {
              caption: `💬 Ответ:\n\n${ctx.message.caption || ''}`
            });
          } else {
            await bot.api.sendMessage(targetUserId, `💬 Ответ:\n\n${replyText}`);
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
    const now = Date.now();
    // Антифлуд уведомлениями о блоке (не чаще 1 раза в 5 секунд)
    if (!db.rateLimit[userId] || (now - (db.rateLimit[userId].lastBlockedReply || 0) > 5000)) {
      if (!db.rateLimit[userId]) db.rateLimit[userId] = { count: 0, windowStart: now, bannedUntil: 0 };
      db.rateLimit[userId].lastBlockedReply = now;
      try {
        await ctx.reply('🚫 Вы заблокированы и не можете отправлять сообщения.');
      } catch (e) {
        log('error', 'Failed to send blocked notification to user', { error: e.message });
      }
    }
    return;
  }

  // Проверка антиспама
  const rateLimitResult = checkRateLimit(userId);
  if (!rateLimitResult.allowed) {
    const banTimeRemaining = Math.ceil((rateLimitResult.bannedUntil - Date.now()) / 60000);
    await ctx.reply(`⚠️ Превышен лимит сообщений. Вы временно заблокированы на ${banTimeRemaining} минут.`);
    log('warning', 'Rate limit exceeded, user banned', { userId, bannedUntil: rateLimitResult.bannedUntil });
    return;
  }

  // Информация о пользователе
  const user = ctx.from;
  const messageText = ctx.message.text || ctx.message.caption || '[медиа без текста]';
  const messageType = ctx.message.photo      ? '📸 фото'      :
                      ctx.message.video      ? '🎥 видео'     :
                      ctx.message.document   ? '📄 документ'  :
                      ctx.message.sticker    ? '🎨 стикер'    :
                      ctx.message.voice      ? '🎤 голосовое' :
                      ctx.message.audio      ? '🎵 аудио'     :
                      ctx.message.video_note ? '⭕ кружочек'  : '📝 текст'; // [NEW-7]

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

  const userMsgCount = db.messages.filter(m => m.userId === user.id).length;
  const isNewUser = userMsgCount === 1; // [NEW-5] первое сообщение когда-либо

  // [FIX-6] Форматируем сообщение для владельца с экранированием
  let forwardMessage =
    `📩 *Новое сообщение!*${isNewUser ? ' 🆕 _Новый пользователь_' : ''}\n\n` +
    `👤 User ID: ${user.id}\n` +
    `👤 Username: ${user.username ? '@' + escapeMarkdown(user.username) : 'Не указан'}\n` +
    `📝 Имя: ${escapeMarkdown(user.first_name)}${user.last_name ? ' ' + escapeMarkdown(user.last_name) : ''}\n` +
    `🤖 Бот: ${user.is_bot ? 'Да' : 'Нет'}\n` +
    `🌐 Язык: ${user.language_code || 'Не указан'}\n` +
    `📊 Тип: ${messageType}\n` +
    `📬 Всего сообщений от пользователя: ${userMsgCount}\n\n`;

  if (messageText !== '[медиа без текста]') {
    forwardMessage += `💬 Сообщение:\n${escapeMarkdown(messageText)}`;
  }

  try {
    let sentMsg; // сообщение, отправленное владельцу

    // [NEW-3] Клавиатура прикрепляется прямо к форварду
    const keyboard = new InlineKeyboard();
    db.quickReplies.slice(0, 3).forEach(r => {
      keyboard.text(r.label, `qr_${r.id}_${user.id}`).row();
    });
    keyboard.text('🚫 Заблокировать', `block_${user.id}`);

    if (ctx.message.photo) {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      sentMsg = await bot.api.sendPhoto(OWNER_ID, photo.file_id, {
        caption: forwardMessage,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    } else if (ctx.message.video) {
      sentMsg = await bot.api.sendVideo(OWNER_ID, ctx.message.video.file_id, {
        caption: forwardMessage,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    } else if (ctx.message.document) {
      sentMsg = await bot.api.sendDocument(OWNER_ID, ctx.message.document.file_id, {
        caption: forwardMessage,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    } else if (ctx.message.audio) {
      sentMsg = await bot.api.sendAudio(OWNER_ID, ctx.message.audio.file_id, {
        caption: forwardMessage,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    } else if (ctx.message.sticker) {
      // стикер нельзя с caption — сначала текст с кнопками, потом стикер
      sentMsg = await bot.api.sendMessage(OWNER_ID, forwardMessage, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
      await bot.api.sendSticker(OWNER_ID, ctx.message.sticker.file_id);
    } else if (ctx.message.voice) {
      sentMsg = await bot.api.sendMessage(OWNER_ID, forwardMessage, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
      await bot.api.sendVoice(OWNER_ID, ctx.message.voice.file_id);
    } else if (ctx.message.video_note) {
      sentMsg = await bot.api.sendMessage(OWNER_ID, forwardMessage, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
      await bot.api.sendVideoNote(OWNER_ID, ctx.message.video_note.file_id);
    } else {
      sentMsg = await bot.api.sendMessage(OWNER_ID, forwardMessage, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    }

    // [FIX-1] Регистрируем в Map: msgId → userId
    if (sentMsg?.message_id) {
      msgMap.set(sentMsg.message_id, user.id);
      if (msgMap.size > 10000) {
        const firstKey = msgMap.keys().next().value;
        msgMap.delete(firstKey);
      }
    }

    // Подтверждаем пользователю
    await ctx.reply(
      '✓ Ваше сообщение отправлено.\n\n' +
      'Вы получите ответ в ближайшее время.'
    );

    // Автоответчик: если владелец не активен >5 минут
    const offlineThreshold = 5 * 60 * 1000;
    const timeSinceLastActivity = Date.now() - db.ownerLastActivity;

    if (timeSinceLastActivity > offlineThreshold && !db.autoReplySent[userId]) {
      setTimeout(async () => {
        try {
          await bot.api.sendMessage(userId, '⏰ Сейчас занят, отвечу позже. Спасибо за понимание!');
          db.autoReplySent[userId] = Date.now();
          saveDB();
          log('info', 'Auto-reply sent', { userId });
        } catch (error) {
          log('error', 'Failed to send auto-reply', { error: error.message });
        }
      }, 3000);
    }

    log('success', 'Message forwarded to owner', { userId, messageType });

  } catch (error) {
    console.error('Ошибка пересылки:', error);
    await ctx.reply('⚠️ Произошла техническая ошибка. Пожалуйста, повторите попытку позже.');
    log('error', 'Failed to forward message', { error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Callback кнопки (быстрые ответы)
// ─────────────────────────────────────────────────────────────────────────────

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
        await ctx.reply(`✅ Быстрый ответ "${quickReply.label}" отправлен пользователю ${targetUserId}!`);
        log('success', 'Quick reply sent via button', { targetUserId, replyId });
      } catch (error) {
        await ctx.answerCallbackQuery({ text: `❌ Ошибка: ${error.message}` });
        log('error', 'Failed to send quick reply', { error: error.message });
      }
    } else {
      await ctx.answerCallbackQuery({ text: '❌ Быстрый ответ не найден' });
    }
  }

  // [NEW-3] Кнопка "Заблокировать" прямо в сообщении
  if (data.startsWith('block_')) {
    const targetUserId = parseInt(data.split('_')[1]);

    if (!isBlocked(targetUserId)) {
      db.blocklist.push({
        userId: targetUserId,
        reason: 'Заблокирован кнопкой',
        blockedAt: new Date().toISOString()
      });
      saveDB();
    }

    await ctx.answerCallbackQuery({ text: '🚫 Пользователь заблокирован' });

    // Меняем кнопку на "Разблокировать"
    const kb = new InlineKeyboard().text('🟢 Разблокировать', `unblock_${targetUserId}`);
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: kb });
    } catch (e) {}
    log('warning', 'User blocked via button', { targetUserId });
  }

  // [NEW-3] Кнопка "Разблокировать"
  if (data.startsWith('unblock_')) {
    const targetUserId = parseInt(data.split('_')[1]);

    const index = db.blocklist.findIndex(u => u.userId === targetUserId);
    if (index !== -1) {
      db.blocklist.splice(index, 1);
      saveDB();
    }

    await ctx.answerCallbackQuery({ text: `✅ Пользователь ${targetUserId} разблокирован` });

    try {
      const msgText = ctx.callbackQuery.message?.text || '';
      // Если нажато в /blocklist — обновляем список
      if (msgText.includes('Заблокированные пользователи')) {
        if (db.blocklist.length === 0) {
          await ctx.editMessageText('✅ Список блокировок пуст.');
        } else {
          let text = `🚫 *Заблокированные пользователи* (${db.blocklist.length}):\n\n`;
          const keyboard = new InlineKeyboard();
          db.blocklist.forEach((u, i) => {
            const date = new Date(u.blockedAt).toLocaleDateString('ru-RU');
            text += `${i + 1}. ID: \`${u.userId}\`\n`;
            text += `   Причина: ${escapeMarkdown(u.reason)}\n`;
            text += `   Дата: ${date}\n\n`;
            keyboard.text(`🟢 Разблокировать ${u.userId}`, `unblock_${u.userId}`).row();
          });
          await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: keyboard });
        }
      } else {
        // Под сообщением — возвращаем исходные кнопки
        const keyboard = new InlineKeyboard();
        db.quickReplies.slice(0, 3).forEach(r => {
          keyboard.text(r.label, `qr_${r.id}_${targetUserId}`).row();
        });
        keyboard.text('🚫 Заблокировать', `block_${targetUserId}`);
        await ctx.editMessageReplyMarkup({ reply_markup: keyboard });
      }
    } catch (e) {}
    log('info', 'User unblocked via button', { targetUserId });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Обработка ошибок
// ─────────────────────────────────────────────────────────────────────────────

bot.catch((err) => {
  log('error', 'Bot error', { error: err.message });
  console.error('Ошибка бота:', err);
});

// ─────────────────────────────────────────────────────────────────────────────
// Автосохранение БД каждые 5 минут
// ─────────────────────────────────────────────────────────────────────────────

setInterval(() => {
  saveDB();
  log('info', 'DB auto-saved');
}, 5 * 60 * 1000);

// ─────────────────────────────────────────────────────────────────────────────
// Запуск бота (long polling)
// ─────────────────────────────────────────────────────────────────────────────

log('info', '🤖 Бот запускается...');
bot.start({
  onStart: (botInfo) => {
    log('success', `✅ Бот @${botInfo.username} успешно запущен!`);
    log('info', `📋 Owner ID: ${OWNER_ID}`);
    log('info', `💾 База данных: ${DB_FILE}`);
    log('info', `📊 Загружено сообщений: ${db.messages.length}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Graceful shutdown
// ─────────────────────────────────────────────────────────────────────────────

process.once('SIGINT', async () => {
  log('info', 'SIGINT received, saving database...');
  await saveDB();
  bot.stop();
});

process.once('SIGTERM', async () => {
  log('info', 'SIGTERM received, saving database...');
  await saveDB();
  bot.stop();
});
