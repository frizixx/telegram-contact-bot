import { Bot } from 'grammy';
import { config } from 'dotenv';

config();

const bot = new Bot(process.env.BOT_TOKEN);
const OWNER_ID = parseInt(process.env.OWNER_ID);

// Хранилище для связи пользователь <-> последнее сообщение владельцу
const userSessions = new Map();

// Приветствие при /start
bot.command('start', async (ctx) => {
  await ctx.reply(
    '👋 Привет! Это контактный бот.\n\n' +
    '📨 Напиши своё сообщение, и я передам его владельцу.\n' +
    '⏳ Обычно ответ приходит в течение нескольких часов.'
  );
});

// Обработка всех входящих сообщений от пользователей
bot.on('message', async (ctx) => {
  const userId = ctx.from.id;

  // Если пишет владелец - это ответ на чьё-то сообщение
  if (userId === OWNER_ID) {
    // Проверяем, это reply на пересланное сообщение
    if (ctx.message.reply_to_message) {
      const originalText = ctx.message.reply_to_message.text || '';

      // Извлекаем ID пользователя из пересланного сообщения (формат: "👤 User ID: 123456789")
      const userIdMatch = originalText.match(/👤 User ID: (\d+)/);

      if (userIdMatch) {
        const targetUserId = parseInt(userIdMatch[1]);

        try {
          // Отправляем ответ пользователю
          await bot.api.sendMessage(
            targetUserId,
            `💬 Ответ от владельца:\n\n${ctx.message.text}`
          );

          await ctx.reply('✅ Сообщение отправлено пользователю!');
        } catch (error) {
          await ctx.reply(`❌ Ошибка отправки: ${error.message}`);
        }
      } else {
        await ctx.reply('ℹ️ Чтобы ответить пользователю, используй Reply на его сообщение.');
      }
    }
    return;
  }

  // Получаем информацию о пользователе
  const user = ctx.from;
  const messageText = ctx.message.text || '[медиа или стикер]';

  // Форматируем дату создания аккаунта (если доступна через getChat)
  let accountCreated = 'Неизвестно';
  try {
    const chatInfo = await ctx.api.getChat(userId);
    if (chatInfo.user_created_date) {
      const date = new Date(chatInfo.user_created_date * 1000);
      accountCreated = date.toLocaleDateString('ru-RU');
    }
  } catch (e) {
    // Информация может быть недоступна, это нормально
  }

  // Формируем сообщение для владельца с информацией о пользователе
  const forwardMessage =
    `📩 Новое сообщение!\n\n` +
    `👤 User ID: ${user.id}\n` +
    `👤 Username: ${user.username ? '@' + user.username : 'Не указан'}\n` +
    `📝 Имя: ${user.first_name}${user.last_name ? ' ' + user.last_name : ''}\n` +
    `📅 Дата создания: ${accountCreated}\n` +
    `🤖 Бот: ${user.is_bot ? 'Да' : 'Нет'}\n` +
    `🌐 Язык: ${user.language_code || 'Не указан'}\n\n` +
    `💬 Сообщение:\n${messageText}`;

  try {
    // Отправляем владельцу
    await bot.api.sendMessage(OWNER_ID, forwardMessage);

    // Подтверждаем пользователю
    await ctx.reply(
      '✅ Сообщение отправлено!\n' +
      '⏰ Владелец получит уведомление и ответит, когда сможет.'
    );

    // Сохраняем сессию для возможности ответа
    userSessions.set(userId, {
      lastMessage: Date.now(),
      username: user.username || user.first_name
    });

  } catch (error) {
    console.error('Ошибка пересылки:', error);
    await ctx.reply('❌ Произошла ошибка. Попробуйте позже.');
  }
});

// Обработка ошибок
bot.catch((err) => {
  console.error('Ошибка бота:', err);
});

// Запуск бота
console.log('🤖 Бот запускается...');
bot.start({
  onStart: (botInfo) => {
    console.log(`✅ Бот @${botInfo.username} успешно запущен!`);
    console.log(`📋 Owner ID: ${OWNER_ID}`);
  }
});
